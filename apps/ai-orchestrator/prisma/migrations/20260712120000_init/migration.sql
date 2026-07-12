CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "UnderwritingDecision" AS ENUM ('APPROVE', 'DECLINE', 'REFER');

-- CreateTable
CREATE TABLE "document_chunks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "underwriting_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lead_id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "decision" "UnderwritingDecision" NOT NULL,
    "rationale" TEXT NOT NULL,
    "confidence_score" DOUBLE PRECISION NOT NULL,
    "used_sql_template" TEXT,
    "retrieved_source_ids" UUID[],
    "langsmith_run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "underwriting_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_chunks_document_id_idx" ON "document_chunks"("document_id");

-- CreateIndex
CREATE INDEX "underwriting_runs_lead_id_idx" ON "underwriting_runs"("lead_id");

-- Prisma has no concept of vector indexes, so this one is hand-maintained:
-- HNSW over cosine distance, matching the `<=>` operator PgVectorStoreService
-- uses for similarity search. Requires pgvector >= 0.5.0 (pgvector/pgvector:pg16
-- ships a current version). Rebuilding this after bulk ingestion is cheap
-- enough at portfolio scale to not bother with ivfflat's train-then-build
-- two-step.
CREATE INDEX "document_chunks_embedding_hnsw_idx" ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);
