#!/bin/sh
# One-command local bring-up: infra first (so Postgres/Kafka/Redis are
# healthy before any service tries to connect), then everything else.
set -e

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo ".env not found — copying from .env.example"
  cp .env.example .env
fi

echo "==> starting data + eventing layer"
docker compose up -d postgres redis kafka

echo "==> waiting for health checks"
docker compose up -d kafka-topic-init

echo "==> starting application services + edge"
docker compose up -d --build

echo "==> starting dev tools"
docker compose up -d pgadmin redis-commander kafka-ui mailhog

echo ""
echo "Nginx edge:        http://localhost"
echo "pgAdmin:            http://localhost:5050"
echo "Redis Commander:    http://localhost:8081"
echo "Kafka UI:           http://localhost:8082"
echo "MailHog:            http://localhost:8025"
