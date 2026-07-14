# syntax=docker/dockerfile:1
#
# The stock nginx:1.27-alpine image has no curl/wget — its HEALTHCHECK
# in docker-compose.yml (`wget -qO- http://localhost/healthz`) failed on
# every attempt with an exec error that never reaches nginx's own
# access/error logs, so the container ran fine but was permanently
# reported unhealthy. Same fix pattern as every other service's
# Dockerfile in this repo.
FROM nginx:1.27-alpine
RUN apk add --no-cache wget
