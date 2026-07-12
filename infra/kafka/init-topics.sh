#!/bin/sh
set -eu

BOOTSTRAP="kafka:9092"
KAFKA_BIN="/opt/kafka/bin"

create_topic() {
  name="$1"; partitions="$2"; replication="$3"; retention_ms="$4"

  "$KAFKA_BIN/kafka-topics.sh" --bootstrap-server "$BOOTSTRAP" \
    --create --if-not-exists \
    --topic "$name" \
    --partitions "$partitions" \
    --replication-factor "$replication" \
    --config "retention.ms=$retention_ms"

  echo "ensured topic: $name"
}

# lead-status-events: lead-service publishes state transitions
# (created -> kyc_uploaded -> credit_checked -> approved/declined -> bank_handoff).
# user-service and banking-adapter-mock consume it independently — separate
# consumer groups, so both see every event.
create_topic "lead-status-events" 3 1 604800000   # 7d retention

# Dead-letter topic for events that fail consumer processing after retries.
create_topic "lead-status-events.dlq" 1 1 1209600000  # 14d retention

# user-events: user-service publishes lifecycle events (user.registered, ...)
# for downstream consumers (notifications, analytics) added in later phases.
create_topic "user-events" 3 1 604800000            # 7d retention
create_topic "user-events.dlq" 1 1 1209600000        # 14d retention

echo "kafka topic bootstrap complete"
