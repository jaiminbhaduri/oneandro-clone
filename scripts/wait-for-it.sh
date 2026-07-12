#!/bin/sh
# Minimal TCP-wait helper for local scripting / CI steps that run outside
# docker-compose's own healthcheck/depends_on graph (e.g. a host-side
# migration runner). Usage: wait-for-it.sh host:port -- command args...
set -e

hostport="$1"; shift
host="${hostport%%:*}"
port="${hostport##*:}"

if [ "$1" = "--" ]; then shift; fi

echo "waiting for $host:$port ..."
until nc -z "$host" "$port" 2>/dev/null; do
  sleep 1
done
echo "$host:$port is up"

if [ "$#" -gt 0 ]; then
  exec "$@"
fi
