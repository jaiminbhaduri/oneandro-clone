-- AlterEnum
-- Adds the two terminal bank-handoff outcomes. Each ADD VALUE is a
-- separate statement (Postgres requirement) and neither is used elsewhere
-- in this migration, so this is safe to run inside Prisma's transactional
-- wrapper (PG12+: ADD VALUE may run in a transaction as long as the new
-- value isn't referenced in that same transaction).
ALTER TYPE "LeadStatus" ADD VALUE 'FUNDED';
ALTER TYPE "LeadStatus" ADD VALUE 'FUNDING_REJECTED';
