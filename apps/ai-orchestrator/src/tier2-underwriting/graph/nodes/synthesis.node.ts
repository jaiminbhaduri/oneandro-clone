import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import type { RunnableConfig } from '@langchain/core/runnables';
import { UnderwritingStateType, UnderwritingUpdateType } from '../state';

const SynthesisSchema = z.object({
  decision: z
    .enum(['APPROVE', 'DECLINE', 'REFER'])
    .describe('REFER means a human underwriter must review — use it whenever the evidence is ambiguous or incomplete. Never guess.'),
  rationale: z
    .string()
    .min(20)
    .describe('A concise, specific explanation citing the concrete facts (credit score, policy clause, prior history) that drove the decision.'),
  confidenceScore: z.number().min(0).max(1).describe("The model's confidence in this decision, from 0 to 1."),
});

/**
 * Final node: combines the lead snapshot, any DB Agent history lookup, and
 * the reranked policy context into one decision. This is advisory, not
 * authoritative — nothing downstream treats an APPROVE/DECLINE from here
 * as final; a human underwriter still drives the actual lead-status
 * transition via lead-service's PATCH /leads/:id/status.
 */
export function createSynthesisNode(model: ChatOpenAI) {
  const structuredModel = model.withStructuredOutput(SynthesisSchema, {
    name: 'synthesize_underwriting_decision',
  });

  return async (
    state: UnderwritingStateType,
    config?: RunnableConfig,
  ): Promise<UnderwritingUpdateType> => {
    const policyContext =
      state.rerankedDocs.length > 0
        ? state.rerankedDocs.map((doc, i) => `[${i + 1}] (${doc.source}) ${doc.content}`).join('\n\n')
        : 'No relevant policy documents were found.';

    const historyContext = state.sqlResult ? JSON.stringify(state.sqlResult) : 'Not looked up for this question.';

    const prompt = [
      'You are an underwriting decision-support assistant for a consumer loan platform.',
      'You never have final authority — REFER whenever evidence is ambiguous, contradictory, or insufficient.',
      '',
      `Question: ${state.question}`,
      '',
      `Lead snapshot: status=${state.leadSnapshot.status}, requested=${state.leadSnapshot.loanAmountRequested}, ` +
        `purpose=${state.leadSnapshot.loanPurpose}, creditScore=${state.leadSnapshot.creditScoreSnapshot ?? 'unknown'}`,
      '',
      `Prior underwriting history for this lead: ${historyContext}`,
      '',
      `Relevant policy context:\n${policyContext}`,
    ].join('\n');

    const result = await structuredModel.invoke(prompt, config);

    return {
      decision: result.decision,
      rationale: result.rationale,
      confidenceScore: result.confidenceScore,
    };
  };
}
