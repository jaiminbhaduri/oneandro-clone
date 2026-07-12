-- pgvector powers embedding storage for the AI orchestrator's RAG +
-- Text-to-SQL layers; pgcrypto gives every service gen_random_uuid() for PKs.
\c ai_db
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

\c users_db
CREATE EXTENSION IF NOT EXISTS pgcrypto;

\c leads_db
CREATE EXTENSION IF NOT EXISTS pgcrypto;
