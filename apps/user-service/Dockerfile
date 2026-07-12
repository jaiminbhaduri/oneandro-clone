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
# Prisma Client generation needs the `prisma` CLI, which is a
# devDependency — this `deps` stage is the only one that has it. The
# generated client gets copied forward from here into both the `build`
# stage and the `prod-deps` stage below, rather than re-running `prisma
# generate` in a stage that's missing the CLI (a real bug the original,
# pre-workspace Dockerfile had and never got caught, since there's no
# Docker daemon in this sandbox to actually build against).
COPY apps/user-service/prisma ./apps/user-service/prisma
RUN npx prisma generate --schema apps/user-service/prisma/schema.prisma

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
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
# See the comment in `deps` — this stage has no `prisma` CLI to regenerate
# the client, so bring over what `deps` already generated instead.
COPY --from=deps /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=deps /app/node_modules/@prisma/client ./node_modules/@prisma/client

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN addgroup -S oneandro && adduser -S oneandro -G oneandro
RUN apk add --no-cache wget

COPY --from=prod-deps /app/node_modules ./node_modules
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
