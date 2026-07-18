# Architecture

## Request flow

```
                                   ┌─────────────────────────┐
Internet ──▶ Nginx (edge) ──▶     │  api-gateway ×2          │
  - TLS termination (prod)        │  - JWT verify            │
  - LB (least_conn across         │  - Redis sliding-window  │
    api-gateway replicas)         │    rate limit (per user) │
  - coarse IP/conn rate limits    │  - CORS                  │
  - security headers (backstop)   │  - route + aggregate     │
  - 25MB body cap for KYC uploads └─────────┬────────┬───────┘
                                             │        │
                        ┌────────────────────┘        └───────────────────┐
                        ▼                                                 ▼
              ┌─────────────────┐                              ┌──────────────────┐
              │ user-service ×2 │                              │ lead-service ×2   │
              │ - identity      │                              │ - lead lifecycle  │
              │ - refresh-token │◀── consumes ──┐               │ - KYC intake      │
              │   rotation      │               │               │ - publishes       │
              └────────┬────────┘               │               │   lead-status-    │
                       │                         │               │   events          │
                       ▼                         │               └─────────┬─────────┘
                  Postgres                       │                         │
                  (users_db)                     │                         ▼
                                                  │                  Kafka topic:
                                                  │                  lead-status-events
                                                  │                         │
                                                  └─────────────────────────┼──────────────┐
                                                                            ▼              ▼
                                                                  banking-adapter-mock   (other
                                                                  - simulated bank        consumers)
                                                                    decisioning
                                                                  - notifications (MailHog)
                                                                            │
                                                     BANK_HANDOFF ──────────┤ (fire-and-forget,
                                                     event triggers         │  see HandoffService)
                                                     a delayed decision     ▼
                                                                  PATCH /leads/:id/status
                                                                  {toStatus: FUNDED |
                                                                   FUNDING_REJECTED}
                                                                  — self-minted SYSTEM JWT —
                                                                            │
                                                                            ▼
                                                              lead-service publishes the
                                                              resulting event back onto
                                                              lead-status-events, which
                                                              banking-adapter-mock's own
                                                              consumer picks up again to
                                                              send the outcome email

              ┌───────────────────┐
   api-gateway│ ai-orchestrator    │
   also routes│ Tier 1: LangChain  │──▶ Redis semantic cache (24h TTL, vector similarity)
   /api/v1/ai/│   policy Q&A/RAG   │
              │ Tier 2: LangGraph  │──▶ Router → DB Agent (Text-to-SQL) → Reranker → Synthesis
              │   underwriting     │        │
              └─────────┬──────────┘        ▼
                        ▼              Postgres + pgvector (ai_db)
                  LangSmith (trace/debug/cost audit — LANGCHAIN_TRACING_V2)
```

## Why these boundaries

- **`user-service` vs `lead-service`**: identity/auth churns independently
  from lead lifecycle and KYC document handling; separate deploy cadence,
  separate blast radius, separate database.
- **`api-gateway` as its own service, not just Nginx**: rate limiting needs
  to be sliding-window and identity-aware (per user, not just per IP), which
  requires Redis + application logic. Nginx does the cheap, stateless,
  IP-level flood protection in front of it; the gateway does the expensive,
  stateful, correctness-sensitive limiting. Two layers, two failure modes.
- **Kafka over direct HTTP calls for lead status**: `user-service` and
  `banking-adapter-mock` (and future consumers — analytics, notifications)
  need the same event independently and asynchronously, without
  `lead-service` knowing or caring who's listening.
- **Two-tier AI**: Tier 1 (LangChain) is cheap, cacheable, low-latency policy
  lookups — most traffic. Tier 2 (LangGraph) is expensive, multi-step,
  needs full tracing — reserved for actual underwriting decisions where a
  wrong shortcut has real cost.
- **`ai-orchestrator` fetches lead facts over HTTP, not SQL**: it has its
  own database (`ai_db` — `document_chunks`, `underwriting_runs`) and
  deliberately never queries `leads_db` directly, even though both live in
  the same Postgres instance. The DB Agent node's "Text-to-SQL" runs
  against `underwriting_runs` (data `ai-orchestrator` actually owns);
  current lead facts come from a real HTTP call to lead-service, forwarding
  the caller's own access token so lead-service's normal RBAC (owner or
  staff) is still the authority — not an over-privileged service account.
- **The DB Agent never executes LLM-generated SQL text**: the model picks a
  `templateId` from a fixed, zod-validated enum; the node runs the
  corresponding hand-written parameterized query. Free-form Text-to-SQL
  execution is a real prompt-injection/SQL-injection vector in a fintech
  app — this trades some flexibility for the query surface being fully
  auditable by reading the whitelist, not by trusting the model.
- **`api-gateway` verifies JWTs but never rejects on them.** It attaches
  identity when a token is valid (for rate-limiting) and forwards every
  request regardless — the actual "is this allowed" decision stays with
  whichever downstream service owns the resource, via the exact same
  global `JwtAuthGuard` + `@Roles()` pattern in all three of them. The
  alternative — the gateway maintaining its own map of which routes need
  which role — is two systems that have to be kept in sync forever, and
  in practice drift the first time someone adds an endpoint and forgets
  the gateway's copy.
- **Rate limiting is a sliding window (Redis ZSET + Lua), not a fixed
  bucket.** A naive `Math.floor(now / windowMs)`-keyed counter lets a
  client burst up to `2 × limit` requests across a bucket boundary. The
  gateway instead scores every accepted request by its own timestamp and
  prunes anything older than `now - windowMs` on each check, so "100
  requests per 60s" holds for *any* rolling 60-second span. The
  prune-count-and-maybe-add sequence runs as one atomic Lua `EVAL`
  because two gateway replicas share one Redis — a check-then-act split
  across round-trips would race between them.
- **banking-adapter-mock authenticates with a self-minted `SYSTEM` JWT,
  not a new auth mechanism.** Every service already trusts
  `JWT_ACCESS_SECRET`; minting a short-lived (60s) token with that same
  secret and a `SYSTEM` role claim reuses the exact verification path
  every other request goes through, rather than bolting on mTLS or a
  static API key as a parallel system. `user-service`'s `JwtStrategy` is
  the one place that needed a real code change (its usual "re-derive the
  role from the DB" check has nothing to re-derive for an identity with
  no `users` row) — see docs/REPO_MATRIX.md's "SYSTEM role" section for
  the full list of what changed and why the DB-backed enum stayed
  untouched.
- **The Kafka consumer never awaits the simulated bank delay.**
  kafkajs processes one message at a time per consumer by default; if
  `eachMessage` awaited HandoffService's multi-second simulated latency,
  every other lead's events would queue up behind it. The handoff runs
  fire-and-forget instead, which trades durability for throughput — a
  crash mid-delay loses that particular handoff's follow-up, since the
  offset already committed. Documented as a known simplification in
  HandoffService's docstring, not a silent gap: a production version
  would persist the in-flight job before acking.
- **Every Kafka producer/consumer service depends on `kafka-topic-init`
  completing, not just on `kafka` being healthy.** `kafka: service_healthy`
  only means the broker answered — with `KAFKA_AUTO_CREATE_TOPICS_ENABLE=false`
  (deliberate, so topics are provisioned explicitly, not implicitly on
  first use), a service that starts producing/consuming before
  `kafka-topic-init` has run would be talking to topics that don't exist
  yet. Found while designing the CI docker-compose smoke test
  (`.github/workflows/ci.yml`) — the first time this project's full
  startup ordering was ever actually exercised — and fixed directly in
  `docker-compose.yml` rather than worked around in CI.
- **`api-gateway`'s `GatewayMiddleware` is mounted at `'/'`, not `'*'`.**
  Under Express 5 (pulled in by `@nestjs/platform-express` ^11), a
  wildcard mount path makes Express treat the entire matched request
  path as a "mount prefix": it strips that prefix from `req.url`/
  `req.path` before invoking the middleware and re-prepends it after
  `next()` — since the wildcard always matches the whole path, this left
  `req.url` as `'/'` for every request, breaking every route the gateway
  handles, including its own health check. `req.originalUrl` is
  unaffected by mount-path stripping, but the real fix is mounting at
  `'/'` instead: it still matches every path (all paths start with
  `'/'`), but the matched prefix has zero length, so Express never
  strips or restores anything. First surfaced as an `api-gateway`
  healthcheck failure in the CI compose smoke test — this project's full
  stack had never actually been booted together before that job existed.
- **`nginx:1.27-alpine` ships no `curl`/`wget`.** Its Docker
  `HEALTHCHECK` (`wget -qO- http://localhost/healthz`) failed on every
  attempt with an exec error that never reaches nginx's own access/error
  logs — the container ran (and served requests) fine, but was
  permanently reported unhealthy. Fixed with a thin
  `infra/nginx/Dockerfile` (`FROM nginx:1.27-alpine` + `apk add wget`),
  same pattern as every other service's Dockerfile in this repo. Also
  found via the CI compose smoke test, one step past the `api-gateway`
  fix above.
- **Publishing a Kafka event never blocks the HTTP response that
  triggered it** (`AuthService#register`'s `user.registered` publish,
  `LeadsService#create`/`#transition`'s `lead-status-events` publish).
  All three publish *after* the triggering DB write already committed —
  the operation has fully succeeded from the caller's perspective by
  that point, so a slow or momentarily-unavailable broker must not hold
  the response open. kafkajs's own retry/backoff for a stuck
  `producer.send()` can run well past any reasonable request timeout
  (`retries: 8` starting at 300ms, capped by a 30s-per-attempt default
  `maxRetryTime`) — found while chasing a CI compose smoke test hang on
  `POST /auth/register`. This turned out not to be that hang's actual
  cause (see the rate-limiter timeout entry below), but the risk is real
  independent of that: any of these three producer calls sits behind an
  HTTP response with no bound on how long a struggling broker can hold
  it open. Fixed by making all three fire-and-forget with a logged
  failure, the same trade-off already documented for `HandoffService`'s
  own Kafka producer call.
- **`SlidingWindowRateLimiterService.consume()` had no bound on how long
  it could wait on Redis** — every request through `api-gateway` calls
  it (`GatewayMiddleware`'s auth/rate-limit stage, ahead of both locally
  handled and proxied routes), so a slow or unresponsive Redis meant a
  slow or unresponsive gateway, full stop. Found while still chasing the
  same `POST /auth/register` hang as the two entries above — this
  wasn't its cause either (Redis was responding fine the whole time; see
  the `fixRequestBody` entry below for what actually was), but the gap
  was real regardless: nothing bounded how long a struggling Redis could
  hold up every request behind it. Fixed with a 3s timeout around the
  Redis call (`Promise.race` via `withTimeout()`) that fails *open* —
  allows the request through, rather than blocking or rejecting it — and
  logs loudly so a real Redis problem is visible instead of silently
  wedging the gateway. A rate limiter should never be a single point of
  total failure for every request behind it.
- **The actual cause of that `POST /auth/register` hang: NestJS's global
  body parser and `http-proxy-middleware` both want to own the request
  stream.** `NestFactory.create()` applies Express's body parser ahead
  of every middleware, including `GatewayMiddleware` — so by the time a
  proxied request reaches `createProxyMiddleware()`'s internals, the
  incoming stream has already been fully drained into `req.body`, and
  `http-proxy-middleware`'s normal behavior (pipe the raw request stream
  to the target) has nothing left to pipe. The outgoing request to the
  target still carries the original `Content-Length` header, so the
  target sits waiting for body bytes that will never arrive — and
  because the connection itself is healthy, nothing on either side ever
  errors or times out on its own. `GET /healthz` has no body, so it was
  never affected and every healthcheck kept passing throughout; the
  *first* proxied request with a body (`POST /auth/register`, the smoke
  test's very first real call) hung until nginx's own
  `proxy_read_timeout 30s` gave up — with zero log output anywhere in
  `api-gateway` or the target service, since neither side's application
  code was ever reached. Confirmed by temporarily logging every raw
  incoming request as the first line of `main.ts`'s middleware chain
  (before `helmet`/`cookie-parser`/anything else): the request reached
  Express fine, and the last thing logged before the hang was a
  `util._extend` deprecation warning from inside `http-proxy-middleware`
  itself. Fixed with the library's own documented answer to this exact
  problem — `fixRequestBody(proxyReq, req)` in the `proxyReq` handler,
  which re-serializes `req.body` onto the outgoing request when the
  source stream was already drained. Verified locally without Docker: a
  throwaway Node HTTP server stood in for `user-service`, and the same
  `POST /auth/register` payload that previously vanished came back
  correctly echoed once this was in place.
- **Baking `storage/kyc` into `lead-service`'s image raced Docker's own
  volume-seeding on startup.** `lead-service-1` and `lead-service-2`
  both mount the same named volume (`lead_kyc_storage`) and start at
  nearly the same time; when Docker mounts a fresh, empty named volume
  over a path that has content in the image, it seeds the volume by
  copying that image content in — and two containers doing that
  concurrently for the same volume raced on creating the nested `kyc`
  subdirectory: `failed to mkdir .../lead_kyc_storage/_data/kyc: file
  exists`, hard-failing container creation. `DocumentStorageService`
  already creates directories lazily and idempotently at runtime
  (`mkdir(dirname(absolutePath), { recursive: true })` on every save),
  so the image never needed to pre-create the nested directory in the
  first place — only the volume's mount point itself needs to exist with
  correct ownership. Fixed by narrowing the Dockerfile's `RUN mkdir` to
  just `storage/` (the mount point), not `storage/kyc` (the nested path
  Docker was racing on seeding).

## Network segmentation

- `edge` network: only `nginx` is on it and published to the host.
- `backend` network: `api-gateway`, all services, Postgres, Redis, Kafka,
  and dev tools. Application services are never directly reachable from the
  host or the internet — only through the gateway, only through Nginx.

## Security posture (Phase 1 pieces)

| Concern | Where enforced |
|---|---|
| DDoS / request flood | Nginx `limit_req_zone` (general + tighter auth-endpoint zone), `limit_conn_zone` |
| Brute-force login | Nginx `edge_auth` zone (5r/m) ahead of gateway-level lockout logic (Phase 2) |
| Large-payload abuse | Nginx `client_max_body_size` — 2MB default, 25MB only on the KYC upload route |
| XSS / clickjacking / MIME sniffing | `infra/nginx/snippets/security-headers.conf` |
| Secrets in Redis config | `redis.conf` never contains the password; passed via `--requirepass` from `.env` at container start |
| Redis command abuse | `FLUSHALL`, `FLUSHDB`, `CONFIG` renamed to no-ops in `redis.conf` |
| SQL injection | Prisma parameterized queries in every service (Phase 2+) |
| Lateral movement | Network segmentation (`edge` vs `backend`); Postgres/Redis ports only published for local dev convenience, removed in prod compose overlay |
