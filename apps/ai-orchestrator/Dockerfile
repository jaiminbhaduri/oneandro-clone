# syntax=docker/dockerfile:1
#
# Build context is the REPO ROOT (see docker-compose.yml's `context: .`) —
# required so npm workspaces can resolve @oneandro/common. See
# apps/user-service/Dockerfile for the fully-commented version of this
# same pattern, including why each stage copies BOTH the root
# node_modules AND apps/ai-orchestrator/node_modules — in this project's
# actual lockfile, most of every service's dependency tree (not just
# Prisma) resolves nested per-app, not hoisted to the workspace root.

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
COPY apps/ai-orchestrator/prisma ./apps/ai-orchestrator/prisma
RUN cd apps/ai-orchestrator && npx prisma generate

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/ai-orchestrator/node_modules ./apps/ai-orchestrator/node_modules
COPY packages/common ./packages/common
COPY apps/ai-orchestrator ./apps/ai-orchestrator
RUN npm run build -w @oneandro/common
RUN npm run build -w @oneandro/ai-orchestrator

FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/common/package.json ./packages/common/package.json
COPY apps/api-gateway/package.json ./apps/api-gateway/package.json
COPY apps/user-service/package.json ./apps/user-service/package.json
COPY apps/lead-service/package.json ./apps/lead-service/package.json
COPY apps/ai-orchestrator/package.json ./apps/ai-orchestrator/package.json
COPY apps/banking-adapter-mock/package.json ./apps/banking-adapter-mock/package.json
RUN npm ci --omit=dev
COPY --from=deps /app/apps/ai-orchestrator/node_modules/.prisma ./apps/ai-orchestrator/node_modules/.prisma
COPY --from=deps /app/apps/ai-orchestrator/node_modules/@prisma/client ./apps/ai-orchestrator/node_modules/@prisma/client

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN addgroup -S oneandro && adduser -S oneandro -G oneandro
RUN apk add --no-cache wget

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/ai-orchestrator/node_modules ./apps/ai-orchestrator/node_modules
COPY --from=build /app/packages/common/dist ./packages/common/dist
COPY packages/common/package.json ./packages/common/package.json
COPY --from=build /app/apps/ai-orchestrator/dist ./apps/ai-orchestrator/dist
COPY apps/ai-orchestrator/prisma ./apps/ai-orchestrator/prisma
COPY apps/ai-orchestrator/package.json ./apps/ai-orchestrator/package.json

USER oneandro
WORKDIR /app/apps/ai-orchestrator

EXPOSE 3003

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3003/healthz || exit 1

CMD ["node", "dist/main.js"]
