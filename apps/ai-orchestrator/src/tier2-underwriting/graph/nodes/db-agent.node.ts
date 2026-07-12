import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import type { RunnableConfig } from '@langchain/core/runnables';
import { PrismaService } from '../../../prisma/prisma.service';
import { UnderwritingStateType, UnderwritingUpdateType } from '../state';

/**
 * Text-to-SQL, done the way it's safe to do in a fintech app: the LLM
 * never generates SQL text that gets executed. Free-form LLM-generated SQL
 * against a real database is a direct prompt-injection / SQL-injection
 * vector — a malicious or merely confused model output could read or
 * mutate anything the DB user can touch. Instead the LLM's only degree of
 * freedom is picking *which* of a small, fixed set of parameterized,
 * read-only queries to run; this node executes the actual SQL.
 *
 * Also note *what* database this queries: ai-orchestrator's own `ai_db`
 * (specifically `underwriting_runs`, this service's data), never
 * lead-service's `leads_db` — see LeadServiceClient's docstring for why
 * that boundary is deliberate.
 */
const SQL_TEMPLATES = ['PRIOR_RUNS_FOR_LEAD', 'DECISION_COUNTS_FOR_LEAD'] as const;
type SqlTemplateId = (typeof SQL_TEMPLATES)[number];

const TemplateSelectionSchema = z.object({
  templateId: z
    .enum(SQL_TEMPLATES)
    .describe(
      'PRIOR_RUNS_FOR_LEAD: most recent individual underwriting decisions for this lead. ' +
        'DECISION_COUNTS_FOR_LEAD: how many times each decision (APPROVE/DECLINE/REFER) has been made for this lead.',
    ),
});

interface PriorRunRow {
  decision: string;
  confidenceScore: number;
  createdAt: Date;
}

interface DecisionCountRow {
  decision: string;
  count: bigint;
}

async function runTemplate(
  prisma: PrismaService,
  templateId: SqlTemplateId,
  leadId: string,
): Promise<Record<string, unknown>> {
  switch (templateId) {
    case 'PRIOR_RUNS_FOR_LEAD': {
      const rows = await prisma.$queryRaw<PriorRunRow[]>`
        SELECT decision, confidence_score AS "confidenceScore", created_at AS "createdAt"
        FROM underwriting_runs
        WHERE lead_id = ${leadId}::uuid
        ORDER BY created_at DESC
        LIMIT 5
      `;
      return { priorRuns: rows };
    }
    case 'DECISION_COUNTS_FOR_LEAD': {
      const rows = await prisma.$queryRaw<DecisionCountRow[]>`
        SELECT decision, COUNT(*) AS count
        FROM underwriting_runs
        WHERE lead_id = ${leadId}::uuid
        GROUP BY decision
      `;
      // bigint from COUNT(*) doesn't survive JSON.stringify — normalize now.
      return { decisionCounts: rows.map((r) => ({ decision: r.decision, count: Number(r.count) })) };
    }
  }
}

export function createDbAgentNode(model: ChatOpenAI, prisma: PrismaService) {
  const structuredModel = model.withStructuredOutput(TemplateSelectionSchema, {
    name: 'select_underwriting_query_template',
  });

  return async (
    state: UnderwritingStateType,
    config?: RunnableConfig,
  ): Promise<UnderwritingUpdateType> => {
    const { templateId } = await structuredModel.invoke(
      `Question about lead ${state.leadId}: "${state.question}"`,
      config,
    );

    const sqlResult = await runTemplate(prisma, templateId, state.leadId);

    return { sqlTemplateId: templateId, sqlResult };
  };
}
