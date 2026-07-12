# syntax=docker/dockerfile:1
#
# Build context is the REPO ROOT (see docker-compose.yml's `context: .`) —
# required so npm workspaces can resolve @oneandro/common. See
# apps/user-service/Dockerfile for the fully-commented version of this
# same pattern.

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
COPY apps/lead-service/prisma ./apps/lead-service/prisma
RUN npx prisma generate --schema apps/lead-service/prisma/schema.prisma

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY packages/common ./packages/common
COPY apps/lead-service ./apps/lead-service
RUN npm run build -w @oneandro/common
RUN npm run build -w @oneandro/lead-service

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
COPY --from=deps /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=deps /app/node_modules/@prisma/client ./node_modules/@prisma/client

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN addgroup -S oneandro && adduser -S oneandro -G oneandro
RUN apk add --no-cache wget
RUN mkdir -p /app/apps/lead-service/storage/kyc && chown -R oneandro:oneandro /app/apps/lead-service/storage

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/packages/common/dist ./packages/common/dist
COPY packages/common/package.json ./packages/common/package.json
COPY --from=build /app/apps/lead-service/dist ./apps/lead-service/dist
COPY apps/lead-service/prisma ./apps/lead-service/prisma
COPY apps/lead-service/package.json ./apps/lead-service/package.json

USER oneandro
WORKDIR /app/apps/lead-service

EXPOSE 3002
VOLUME ["/app/apps/lead-service/storage"]

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3002/healthz || exit 1

CMD ["node", "dist/main.js"]
