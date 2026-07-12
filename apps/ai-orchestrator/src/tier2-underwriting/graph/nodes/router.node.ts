import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import type { RunnableConfig } from '@langchain/core/runnables';
import { UnderwritingStateType, UnderwritingUpdateType } from '../state';

const RouterDecisionSchema = z.object({
  needsFinancialLookup: z
    .boolean()
    .describe(
      'True if answering the question requires looking at this lead\'s prior underwriting history ' +
        '(e.g. "has this applicant been declined before", "how many times has this been reviewed") — ' +
        'false if the current lead snapshot (credit score, amount, purpose) and policy documents alone ' +
        'are enough.',
    ),
});

/**
 * Router node: a small structured-output LLM call that decides whether the
 * DB Agent node needs to run at all. This is the "multi-agent" branch point
 * — underwriter-graph.ts wires this decision into a real conditional edge
 * (router -> dbAgent -> reranker, or router -> reranker directly), not just
 * a linear chain.
 */
export function createRouterNode(model: ChatOpenAI) {
  const structuredModel = model.withStructuredOutput(RouterDecisionSchema, {
    name: 'route_underwriting_question',
  });

  return async (
    state: UnderwritingStateType,
    config?: RunnableConfig,
  ): Promise<UnderwritingUpdateType> => {
    const result = await structuredModel.invoke(
      [
        'You are routing a question about a loan applicant to the right data source.',
        `Question: "${state.question}"`,
        `Current lead snapshot: status=${state.leadSnapshot.status}, ` +
          `requested=${state.leadSnapshot.loanAmountRequested}, ` +
          `purpose=${state.leadSnapshot.loanPurpose}, ` +
          `creditScore=${state.leadSnapshot.creditScoreSnapshot ?? 'unknown'}.`,
      ].join('\n'),
      config,
    );

    return { needsFinancialLookup: result.needsFinancialLookup };
  };
}
