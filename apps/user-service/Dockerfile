# syntax=docker/dockerfile:1
#
# Build context is the REPO ROOT (see docker-compose.yml's `context: .`),
# not this directory — required so npm workspaces can resolve this
# service's @oneandro/common dependency, which lives in packages/common,
# outside apps/user-service. Every COPY below is written relative to that
# root context.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/common/package.json ./packages/common/package.json
COPY apps/api-gateway/package.json ./apps/api-gateway/package.json
COPY apps/user-service/package.json ./apps/user-service/package.json
COPY apps/lead-service/package.json ./apps/lead-service/package.json
COPY apps/ai-orchestrator/package.json ./apps/ai-orchestrator/package.json
COPY apps/banking-adapter-mock/package.json ./apps/banking-adapter-mock/package.json
RUN npm ci --ignore-scripts
# In this project's actual package-lock.json, `prisma`/@prisma/client/
# @prisma/engines resolve NESTED under apps/user-service/node_modules,
# not hoisted to the workspace root (verified directly against the
# lockfile, not assumed — every one of the three Prisma-using services
# resolves this way). `cd` into the app directory so `npx` finds the CLI
# via ordinary directory-walk-up resolution, and so `prisma generate`
# writes its output to the exact nested location this app will
# `require('@prisma/client')` from at runtime. Running `npx prisma
# generate` from /app (the root) — what this Dockerfile originally did —
# fails outright with "prisma: not found"; this was never caught locally
# because local testing always `cd`'d into the app first.
COPY apps/user-service/prisma ./apps/user-service/prisma
RUN cd apps/user-service && npx prisma generate

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/user-service/node_modules ./apps/user-service/node_modules
COPY packages/common ./packages/common
COPY apps/user-service ./apps/user-service
RUN npm run build -w @oneandro/common
RUN npm run build -w @oneandro/user-service

FROM node:22-alpine AS prod-deps
WORKDIR /app
# argon2 (a real user-service runtime dependency) falls back to
# compiling its native binding via node-gyp if no prebuilt binary matches
# this platform/Node ABI — these are what that needs. Cheap even when
# unused (a matching prebuild is the common case).
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
COPY packages/common/package.json ./packages/common/package.json
COPY apps/api-gateway/package.json ./apps/api-gateway/package.json
COPY apps/user-service/package.json ./apps/user-service/package.json
COPY apps/lead-service/package.json ./apps/lead-service/package.json
COPY apps/ai-orchestrator/package.json ./apps/ai-orchestrator/package.json
COPY apps/banking-adapter-mock/package.json ./apps/banking-adapter-mock/package.json
RUN npm ci --omit=dev
# This stage's npm ci installed @prisma/client's un-generated stub at
# apps/user-service/node_modules/@prisma/client (nested — see `deps`
# above) and has no `prisma` CLI to regenerate it (devDependency, omitted
# by --omit=dev). Overwrite the stub with deps' real generated output, at
# that same nested path.
COPY --from=deps /app/apps/user-service/node_modules/.prisma ./apps/user-service/node_modules/.prisma
COPY --from=deps /app/apps/user-service/node_modules/@prisma/client ./apps/user-service/node_modules/@prisma/client

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN addgroup -S oneandro && adduser -S oneandro -G oneandro
RUN apk add --no-cache wget

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/user-service/node_modules ./apps/user-service/node_modules
COPY --from=build /app/packages/common/dist ./packages/common/dist
COPY packages/common/package.json ./packages/common/package.json
COPY --from=build /app/apps/user-service/dist ./apps/user-service/dist
COPY apps/user-service/prisma ./apps/user-service/prisma
COPY apps/user-service/package.json ./apps/user-service/package.json

USER oneandro
WORKDIR /app/apps/user-service

EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3001/healthz || exit 1

CMD ["node", "dist/main.js"]
