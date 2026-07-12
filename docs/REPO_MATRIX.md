# Repo Matrix — OneAndro Clone (Monorepo)

Full target file tree for the project. Files marked `[P1]` are created in Phase 1
(this turn). Everything else lands in later phases as we build each service.
This doc is the single source of truth for paths — later phases should match it
exactly, or update it explicitly if a path changes.

```
fintech/
├── .github/
│   └── workflows/
│       ├── ci.yml                                   # lint + unit + e2e per service (matrix build)
│       └── docker-build.yml                         # buildx build/push all Dockerfiles on tag
│
├── apps/
│   ├── api-gateway/                                 # NestJS — JWT identity, Redis sliding-window rate limit, routing [P4, DONE]
│   │   ├── src/
│   │   │   ├── main.ts                                # trust proxy 1 hop (Nginx) — required for correct req.ip
│   │   │   ├── app.module.ts                          # configure(): GatewayMiddleware on '*'
│   │   │   ├── auth/
│   │   │   │   ├── auth.module.ts
│   │   │   │   ├── jwt-verifier.service.ts             # "soft" verify: attaches identity if valid, never 401s itself
│   │   │   │   └── jwt-verifier.service.spec.ts
│   │   │   ├── rate-limit/
│   │   │   │   ├── rate-limit.module.ts
│   │   │   │   ├── sliding-window-rate-limiter.service.ts  # Redis ZSET + atomic Lua EVAL (not a fixed bucket)
│   │   │   │   └── sliding-window-rate-limiter.service.spec.ts  # runs the real Lua via ioredis-mock's fengari VM
│   │   │   ├── proxy/
│   │   │   │   ├── proxy.module.ts
│   │   │   │   ├── gateway.middleware.ts               # auth + rate-limit + http-proxy-middleware, all one pipeline
│   │   │   │   ├── route-table.ts                      # pure functions: resolveRoute/stripApiPrefix/isAuthRateLimitScope
│   │   │   │   ├── route-table.spec.ts
│   │   │   │   └── dashboard/{dashboard.controller.ts,dashboard.module.ts}  # the one real aggregation endpoint
│   │   │   ├── common/{filters/http-exception.filter.ts,interceptors/logging.interceptor.ts,enums/role.enum.ts,interfaces/request-user.interface.ts}
│   │   │   ├── health/{health.controller.ts,health.module.ts}
│   │   │   └── config/configuration.ts
│   │   ├── Dockerfile                                  # no Prisma stage — this service is stateless besides Redis
│   │   ├── .dockerignore
│   │   ├── nest-cli.json
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── tsconfig.build.json
│   │
│   ├── user-service/                                # NestJS — identity, auth, RBAC [P2, DONE]
│   │   ├── src/
│   │   │   ├── main.ts                               # helmet, cookie-parser, CORS, ValidationPipe, Swagger @ /docs
│   │   │   ├── app.module.ts                          # wires global JwtAuthGuard + RolesGuard + filter + interceptors
│   │   │   ├── users/
│   │   │   │   ├── users.module.ts
│   │   │   │   ├── users.controller.ts                # /users/me, /users (list, RBAC), /users/:id/role, /:id/deactivate
│   │   │   │   ├── users.service.ts
│   │   │   │   ├── entities/user.entity.ts             # @Exclude()s passwordHash from every response
│   │   │   │   └── dto/{update-profile.dto.ts,assign-role.dto.ts,list-users-query.dto.ts}
│   │   │   ├── auth/
│   │   │   │   ├── auth.module.ts
│   │   │   │   ├── auth.controller.ts                  # register/login/refresh/logout/logout-all, sets httpOnly cookies
│   │   │   │   ├── auth.service.ts
│   │   │   │   ├── auth.constants.ts
│   │   │   │   ├── token.service.ts                    # refresh-token rotation + reuse detection (opaque tokens, not JWT)
│   │   │   │   ├── strategies/jwt.strategy.ts           # cookie-first extractor, Bearer header fallback
│   │   │   │   ├── token.service.spec.ts
│   │   │   │   ├── auth.service.spec.ts
│   │   │   │   └── dto/{register.dto.ts,login.dto.ts}
│   │   │   ├── common/
│   │   │   │   ├── decorators/{roles,public,current-user}.decorator.ts
│   │   │   │   ├── guards/{jwt-auth,roles}.guard.ts     # registered globally via APP_GUARD
│   │   │   │   ├── guards/roles.guard.spec.ts
│   │   │   │   ├── filters/http-exception.filter.ts     # never leaks stack traces across the trust boundary
│   │   │   │   ├── interceptors/logging.interceptor.ts
│   │   │   │   ├── enums/role.enum.ts
│   │   │   │   └── interfaces/request-user.interface.ts
│   │   │   ├── kafka/
│   │   │   │   ├── kafka.module.ts
│   │   │   │   ├── kafka-producer.service.ts          # generic publish() + publishUserRegistered() + publishToDlq()
│   │   │   │   ├── consumers/lead-status.consumer.ts  # consumes lead-status-events, DLQs on failure
│   │   │   │   └── events/{lead-status.event.ts,user-registered.event.ts}
│   │   │   ├── health/{health.controller.ts,health.module.ts}
│   │   │   ├── prisma/{prisma.module.ts,prisma.service.ts}
│   │   │   └── config/configuration.ts                 # fails fast on missing required env vars
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── migrations/{migration_lock.toml,20260712100000_init/migration.sql}
│   │   ├── test/
│   │   │   ├── auth.e2e-spec.ts                       # full HTTP pipeline: cookies, rotation, reuse detection
│   │   │   ├── users.e2e-spec.ts                      # RBAC end-to-end (403/200 by role, DTO whitelist rejection)
│   │   │   └── support/{in-memory-prisma.ts,build-test-app.ts}
│   │   ├── Dockerfile                                 # multi-stage (deps/build/prod-deps/runtime), non-root user
│   │   ├── .dockerignore
│   │   ├── nest-cli.json
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── tsconfig.build.json
│   │
│   ├── lead-service/                                # NestJS — lead lifecycle, KYC intake [P3, DONE]
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── auth/{auth.module.ts,strategies/jwt.strategy.ts}  # resource-server-only JWT verify, no DB lookup
│   │   │   ├── leads/
│   │   │   │   ├── leads.module.ts
│   │   │   │   ├── leads.controller.ts               # /leads, /leads/mine, /leads/:id, /leads/:id/status
│   │   │   │   ├── leads.service.ts
│   │   │   │   ├── leads.service.spec.ts
│   │   │   │   ├── entities/lead.entity.ts
│   │   │   │   ├── state-machine/lead-status.state-machine.ts    # CREATED->KYC_UPLOADED->CREDIT_CHECKED->APPROVED|DECLINED->BANK_HANDOFF
│   │   │   │   ├── state-machine/lead-status.state-machine.spec.ts
│   │   │   │   └── dto/{create-lead.dto.ts,update-lead-status.dto.ts,list-leads-query.dto.ts}
│   │   │   ├── kyc/
│   │   │   │   ├── kyc.module.ts
│   │   │   │   ├── kyc.controller.ts                  # POST/GET leads/:leadId/kyc (multipart)
│   │   │   │   ├── kyc.service.ts                     # mime/size validation, auto-transitions the lead
│   │   │   │   ├── storage/document-storage.service.ts # local-disk, S3-swappable interface
│   │   │   │   ├── dto/upload-kyc-document.dto.ts
│   │   │   │   └── entities/kyc-document.entity.ts    # @Exclude()s storagePath
│   │   │   ├── kafka/
│   │   │   │   ├── kafka.module.ts
│   │   │   │   ├── kafka-producer.service.ts          # publishes lead-status-events, keyed by leadId
│   │   │   │   └── events/lead-status.event.ts
│   │   │   ├── common/                                # same RBAC guard/decorator shape as user-service
│   │   │   ├── health/{health.controller.ts,health.module.ts}
│   │   │   ├── prisma/{prisma.module.ts,prisma.service.ts}
│   │   │   └── config/configuration.ts
│   │   ├── prisma/
│   │   │   ├── schema.prisma                          # Lead, KycDocument, LeadStatusHistory (audit trail)
│   │   │   └── migrations/{migration_lock.toml,20260712110000_init/migration.sql}
│   │   ├── test/
│   │   │   ├── leads.e2e-spec.ts                      # full lifecycle incl. real multipart KYC upload
│   │   │   └── support/{in-memory-prisma.ts,build-test-app.ts}
│   │   ├── Dockerfile
│   │   ├── .dockerignore
│   │   ├── nest-cli.json
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── tsconfig.build.json
│   │
│   ├── ai-orchestrator/                             # NestJS host — LangChain Tier 1 + LangGraph Tier 2 [P3, DONE]
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── auth/{auth.module.ts,strategies/jwt.strategy.ts}  # resource-server-only JWT verify
│   │   │   ├── tier1-qa/
│   │   │   │   ├── qa.module.ts
│   │   │   │   ├── qa.controller.ts                   # POST /ai/qa/ask, POST /ai/qa/ingest (admin)
│   │   │   │   ├── qa.service.ts                      # LCEL: cache check -> RAG retrieve -> prompt -> LLM -> cache store
│   │   │   │   ├── semantic-cache/redis-semantic-cache.service.ts # brute-force cosine cache, 24h TTL
│   │   │   │   ├── semantic-cache/redis-semantic-cache.service.spec.ts
│   │   │   │   └── dto/{ask-question.dto.ts,ingest-document.dto.ts}
│   │   │   ├── tier2-underwriting/
│   │   │   │   ├── underwriting.module.ts
│   │   │   │   ├── underwriting.controller.ts         # POST /ai/underwriting/run, GET /ai/underwriting/runs/:leadId
│   │   │   │   ├── clients/lead-service.client.ts     # HTTP, forwards caller's token — never touches leads_db
│   │   │   │   ├── graph/state.ts                     # Annotation.Root state schema
│   │   │   │   ├── graph/underwriter-graph.ts          # StateGraph wiring: router -> [dbAgent] -> reranker -> synthesis
│   │   │   │   ├── graph/nodes/router.node.ts          # structured-output branch decision
│   │   │   │   ├── graph/nodes/db-agent.node.ts        # Text-to-SQL via fixed template whitelist (never raw LLM SQL)
│   │   │   │   ├── graph/nodes/db-agent.node.spec.ts
│   │   │   │   ├── graph/nodes/reranker.node.ts        # pgvector top-10 -> Cohere rerank top-4
│   │   │   │   ├── graph/nodes/reranker.node.spec.ts
│   │   │   │   ├── graph/nodes/synthesis.node.ts       # APPROVE/DECLINE/REFER + rationale + confidence
│   │   │   │   └── dto/underwriting-request.dto.ts
│   │   │   ├── rag/
│   │   │   │   ├── rag.module.ts
│   │   │   │   ├── ingestion.service.ts                # RecursiveCharacterTextSplitter -> embed -> pgvector
│   │   │   │   ├── embeddings.service.ts                # OpenAIEmbeddings wrapper
│   │   │   │   ├── pgvector-store.service.ts            # raw SQL against Unsupported("vector(1536)")
│   │   │   │   └── pgvector-store.service.spec.ts
│   │   │   ├── telemetry/{langsmith.provider.ts,telemetry.module.ts} # traceConfig() tags every run
│   │   │   ├── common/                                 # same RBAC guard/decorator shape as user-service
│   │   │   ├── health/{health.controller.ts,health.module.ts}
│   │   │   ├── prisma/{prisma.module.ts,prisma.service.ts}
│   │   │   └── config/configuration.ts
│   │   ├── prisma/
│   │   │   ├── schema.prisma                          # DocumentChunk (pgvector), UnderwritingRun (audit trail)
│   │   │   └── migrations/{migration_lock.toml,20260712120000_init/migration.sql} # + hand-maintained HNSW index
│   │   ├── Dockerfile
│   │   ├── .dockerignore
│   │   ├── nest-cli.json
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── tsconfig.build.json
│   │
│   └── banking-adapter-mock/                        # NestJS — mock external bank, closes the event loop [P5, DONE]
│       ├── src/
│       │   ├── main.ts                                # HTTP app for /healthz only — real work is the Kafka consumer
│       │   ├── app.module.ts
│       │   ├── auth/
│       │   │   ├── auth.module.ts
│       │   │   ├── service-token.service.ts            # mints short-lived SYSTEM-role JWTs (self-signed, shared secret)
│       │   │   └── service-token.service.spec.ts
│       │   ├── clients/
│       │   │   ├── clients.module.ts
│       │   │   ├── lead-service.client.ts               # GET lead + PATCH status, SYSTEM token — never touches leads_db
│       │   │   └── user-service.client.ts                # GET user (email), SYSTEM token
│       │   ├── handoff/
│       │   │   ├── handoff.module.ts
│       │   │   ├── handoff.service.ts                   # simulated bank latency + decision, calls back to lead-service
│       │   │   ├── funding-decision.ts                  # pure, score-weighted APPROVE/REJECT function
│       │   │   ├── funding-decision.spec.ts
│       │   │   └── handoff.service.spec.ts
│       │   ├── notifications/
│       │   │   ├── notifications.module.ts
│       │   │   ├── notifications.service.ts              # nodemailer -> MailHog, one email per outcome status
│       │   │   └── notifications.service.spec.ts
│       │   ├── kafka/
│       │   │   ├── kafka.module.ts
│       │   │   ├── kafka-producer.service.ts             # DLQ-only — lead-service remains the sole status publisher
│       │   │   ├── consumers/lead-status.consumer.ts      # BANK_HANDOFF -> fire-and-forget handoff; outcomes -> notify
│       │   │   └── events/lead-status.event.ts
│       │   ├── health/{health.controller.ts,health.module.ts}
│       │   └── config/configuration.ts
│       ├── Dockerfile
│       ├── .dockerignore
│       ├── nest-cli.json
│       ├── package.json
│       ├── tsconfig.json
│       └── tsconfig.build.json
│
├── packages/                                        # npm workspaces [P6, DONE]
│   └── common/                                       # @oneandro/common — pre-compiled (dist/ + .d.ts), not consumed as TS source
│       ├── src/
│       │   ├── enums/role.enum.ts                    # Role (incl. SYSTEM) — the one true definition
│       │   ├── interfaces/request-user.interface.ts  # { userId, email, role: Role }
│       │   ├── events/lead-status.event.ts           # LeadStatusEvent + isLeadStatusEvent guard
│       │   └── index.ts
│       ├── package.json                              # "main"/"types" -> dist/index.{js,d.ts}
│       └── tsconfig.json
│
├── infra/
│   ├── nginx/
│   │   ├── nginx.conf                                # [P1]
│   │   ├── conf.d/default.conf                       # [P1]
│   │   └── snippets/{security-headers.conf,proxy-params.conf} # [P1]
│   ├── postgres/init/
│   │   ├── 00-databases.sql                          # [P1] provisions users_db/leads_db/ai_db
│   │   └── 01-extensions.sql                         # [P1] enables vector (ai_db) + pgcrypto (all)
│   ├── kafka/init-topics.sh                          # [P1, updated P2] + user-events/.dlq topics
│   └── redis/redis.conf                              # [P1]
│
├── scripts/
│   ├── wait-for-it.sh                                # [P1]
│   ├── seed-db.ts
│   └── dev-up.sh                                     # [P1]
│
├── docs/
│   ├── REPO_MATRIX.md                                # [P1] this file
│   ├── ARCHITECTURE.md                               # [P1]
│   └── adr/0001-microservices-boundaries.md
│
├── docker-compose.yml                                # [P1, extended every phase] all 5 services build from repo root now (P6)
├── docker-compose.override.yml                       # [P1] dev hot-reload bind mounts
├── .env.example                                      # [P1]
├── .gitignore                                        # [P1]
├── .dockerignore                                     # [P1, extended P6] now the only .dockerignore that matters — every service builds from this context
├── package.json                                      # [P6] root npm workspaces: ["apps/*", "packages/*"]
├── package-lock.json                                 # [P6] single workspace-wide lockfile — apps no longer have their own
└── README.md                                         # [P1]
```

## Service boundary summary

| Service | Owns | Talks to |
|---|---|---|
| `api-gateway` | Identity resolution (soft JWT verify — auth *enforcement* stays with each downstream service), Redis sliding-window rate limiting, CORS, routing, one aggregation endpoint (`GET /dashboard/me`) | Redis (rate-limit state), user-service, lead-service, ai-orchestrator (all internal-only, not exposed by Nginx) |
| `user-service` | Users, credentials, refresh-token rotation, RBAC | Postgres (`users_db`), Kafka (produces `user-events`, consumes `lead-status-events`) |
| `lead-service` | Lead lifecycle, KYC document intake, status state machine | Postgres (`leads_db`), Kafka (producer of `lead-status-events`), shared `lead_kyc_storage` volume |
| `ai-orchestrator` | Tier 1 LangChain Q&A + semantic cache, Tier 2 LangGraph underwriting/Text-to-SQL | Redis (cache), Postgres+pgvector (`ai_db`), OpenAI, Cohere, LangSmith, lead-service (HTTP, for lead facts — never `leads_db` directly) |
| `banking-adapter-mock` | Simulated external bank handoff decision + outcome notifications | Kafka (consumer + DLQ producer), MailHog (dev), user-service + lead-service (HTTP, self-minted `SYSTEM`-role JWT — see ARCHITECTURE.md) |

## SYSTEM role (added in Phase 5; `Role` itself deduplicated in Phase 6)

Closing the loop — having the bank's mock decision actually change the
lead's status — needed banking-adapter-mock to call back into lead-service
and user-service with *some* identity. Rather than inventing a separate
auth mechanism (mTLS, static API keys), it mints its own short-lived JWT
using the same `JWT_ACCESS_SECRET` every service already trusts, carrying
a `SYSTEM` role claim. Touched three services to support this:

- **user-service**: `Role.SYSTEM` recognized, but deliberately kept out of
  the Prisma-generated enum backing `users.role` — `AssignableRole =
  Exclude<Role, Role.SYSTEM>` (defined locally in
  `apps/user-service/src/common/enums/role.enum.ts`, re-exporting `Role`
  from `@oneandro/common` alongside it) is what `AssignRoleDto` and
  `UsersService.setRole()` actually accept, so "assign SYSTEM to a real
  account" is a compile error, not a runtime check. `JwtStrategy`
  special-cases `payload.role === SYSTEM` to skip its usual DB lookup
  (there's no `users` row for a service identity). `GET /users/:id`
  additionally allows `SYSTEM` (banking-adapter-mock looks up an
  applicant's email to notify them).
- **lead-service**: `Role.SYSTEM` added to `STAFF_ROLES` (read access to
  any lead) and to the state machine's role map for exactly
  `BANK_HANDOFF -> FUNDED` and `BANK_HANDOFF -> FUNDING_REJECTED` (`ADMIN`
  is also allowed on those two, for manual override/testing). New Prisma
  migration `20260712130000_add_funding_outcome_statuses` adds the two
  enum values via `ALTER TYPE ... ADD VALUE`.
- **ai-orchestrator / api-gateway**: recognize `Role.SYSTEM` (it's now
  just part of the one shared enum) but never receive or mint a SYSTEM
  token themselves.

As of Phase 6, `Role` (with `SYSTEM`), `RequestUser`, and `LeadStatusEvent`
all live in exactly one place — `packages/common/src` — not four/three/two
hand-copied files respectively. Every service imports them from
`@oneandro/common`; only user-service's `AssignableRole`/`ASSIGNABLE_ROLES`
stay local, since that split only makes sense for the one service with a
persisted `role` column.

## npm workspaces and what it changed in Docker (Phase 6)

`packages/common` is a real npm workspace package (`@oneandro/common`),
not TS-source-shared-by-path-mapping — it has its own `tsc` build
producing `dist/*.js` + `dist/*.d.ts`, and every service depends on it as
`"@oneandro/common": "^0.1.0"`, resolved locally via npm's workspace
symlinking rather than the registry (npm workspaces has no `@oneandro/common`
published anywhere; `npm ci` links `packages/common` directly).

This has one unavoidable consequence: **every service's Docker build
context changed from `./apps/<service>` to the repo root.** A build
context scoped to `apps/user-service` alone cannot see `packages/common` —
Docker has no concept of "also grab this other directory." Every
Dockerfile now:

1. Copies the root `package.json` + `package-lock.json`, plus **every**
   workspace's `package.json` (all 5 apps + `packages/common`) — not just
   the one being built. `npm ci` validates the lockfile against the full
   workspace shape; a partial set of package.json files works fine (only
   source is missing, not manifests) but skipping any of them risks
   `npm ci` refusing to proceed. (Verified locally without Docker by
   replicating this exact partial-context install in a scratch directory —
   see the session transcript.)
2. Runs `npm run build -w @oneandro/common` before building the target
   app, since the app's own `tsc`/`nest build` needs
   `node_modules/@oneandro/common/dist/index.d.ts` to already exist.
3. In the runtime stage, copies both the app's `dist/` **and**
   `packages/common/dist/` — the compiled app still resolves
   `@oneandro/common` at require-time through the same workspace symlink.

Also fixed as part of this: the old per-service Dockerfiles' `prod-deps`
stage ran `npm ci --omit=dev && npx prisma generate`, but `prisma` (the
CLI) is a devDependency — `--omit=dev` would have made that `prisma`
invocation fail. Never caught before because there's no Docker daemon in
this environment to actually build against. Fixed by generating the
Prisma Client once in the `deps` stage (which has the CLI) and copying the
generated `node_modules/.prisma` + `node_modules/@prisma/client` forward
into `prod-deps` instead of regenerating there.

Per-app `package-lock.json` and `.dockerignore` files are gone — only the
root ones are authoritative now. jest's `transform` pattern narrowed from
matching `.ts` *and* `.js` files to `.ts` only, because ts-jest was
picking up `packages/common/dist/*.js` (a symlinked workspace dependency,
not covered by Jest's default `node_modules` exclusion once resolved
through the workspace symlink) and warning on every test run.

## Network segmentation (enforced in `docker-compose.yml`)

- **`edge`** — only `nginx` is reachable from the host; talks to `api-gateway` replicas.
- **`backend`** — `api-gateway`, all microservices, Postgres, Redis, Kafka, and dev tools. Not published to the host except via explicit dev-tool ports.

## Migrations run as one-shot jobs, not on app boot

`user-service-migrate` (see `docker-compose.yml`) builds from the Dockerfile's
`build` stage — the one with the Prisma CLI and devDependencies, which the
slim `runtime` stage deliberately drops — and runs `prisma migrate deploy`
once, gated on Postgres being healthy. Both `user-service` replicas then
`depends_on: user-service-migrate: condition: service_completed_successfully`.
This avoids two replicas racing to apply schema changes on their own boot,
and keeps the runtime image free of migration tooling it doesn't need at
steady state. Every service with its own database follows this same pattern.
