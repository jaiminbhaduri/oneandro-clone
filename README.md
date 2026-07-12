# OneAndro Clone — Production-Grade Fintech Microservices Platform

A portfolio-grade, security-hardened clone of Andromeda Loans' "OneAndro" lead
platform: decoupled NestJS microservices, an event-driven lead pipeline over
Kafka, a tiered AI orchestration layer (LangChain + LangGraph + LangSmith),
and a hardened Nginx/Redis edge.

## Status: all six phases built

See [`docs/REPO_MATRIX.md`](docs/REPO_MATRIX.md) for the full file tree and
the specific design decisions made in each phase; [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
for the request-flow diagram and the "why" behind the service boundaries.

| Phase | What it shipped |
|---|---|
| 1 | Infra foundation — Nginx, Kafka (KRaft), Postgres+pgvector, Redis, dev tools |
| 2 | `apps/user-service` — identity, JWT auth, refresh-token rotation, RBAC |
| 3 | `apps/lead-service` — lead lifecycle state machine, KYC uploads |
| 3 | `apps/ai-orchestrator` — LangChain semantic cache, LangGraph underwriting graph, pgvector |
| 4 | `apps/api-gateway` — Redis sliding-window rate limiting, routing, aggregation |
| 5 | `apps/banking-adapter-mock` — closes the event loop: simulated bank decision + notifications |
| 6 | `packages/common` — npm workspaces, deduplicated `Role`/`RequestUser`/`LeadStatusEvent` |

Every service has its own test suite (unit + e2e where applicable) that
passes independently of Docker — see each `apps/*/package.json`.

## Quickstart

```bash
npm install                # installs the whole workspace (apps/* + packages/common)
cp .env.example .env       # then fill in real secrets — never commit .env
./scripts/dev-up.sh
```

`docker compose up` builds every service from the **repo root** as its
build context (not `apps/<service>`) — required so npm workspaces can
resolve `@oneandro/common`. See the "npm workspaces" section in
[`docs/REPO_MATRIX.md`](docs/REPO_MATRIX.md) if you're touching any
Dockerfile.

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Stack

| Layer | Tech |
|---|---|
| Edge | Nginx (LB, TLS termination point, rate limiting, security headers) |
| Gateway | NestJS — soft JWT identity resolution, Redis sliding-window rate limiting, routing/aggregation |
| Services | NestJS + TypeScript, Prisma, PostgreSQL |
| Eventing | Kafka (KRaft mode) — `lead-status-events`, `user-events`, each with a DLQ |
| AI | LangChain (Tier 1 Q&A + semantic cache) / LangGraph (Tier 2 underwriting, Text-to-SQL) / LangSmith (tracing) |
| Vector store | PostgreSQL + pgvector, with a Cohere re-ranking layer |
| Cache / rate limit | Redis |
| Shared types | `@oneandro/common` (npm workspace) — `Role`, `RequestUser`, `LeadStatusEvent` |
