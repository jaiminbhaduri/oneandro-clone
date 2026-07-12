import { Annotation } from '@langchain/langgraph';
import { SimilarityResult } from '../../rag/pgvector-store.service';
import { LeadSnapshot } from '../clients/lead-service.client';

export type UnderwritingDecisionValue = 'APPROVE' | 'DECLINE' | 'REFER';

const replace = <T>() => ({ reducer: (_left: T, right: T) => right });

/**
 * Shared state threaded through every node in underwriter-graph.ts.
 * leadId/userId/question/leadSnapshot are set once at invocation; every
 * other field starts at its default and is filled in as the graph runs.
 */
export const UnderwritingState = Annotation.Root({
  leadId: Annotation<string>,
  userId: Annotation<string>,
  question: Annotation<string>,
  leadSnapshot: Annotation<LeadSnapshot>,

  // Router node output — read by the conditional edge that decides whether
  // the DB Agent node runs at all.
  needsFinancialLookup: Annotation<boolean>({ ...replace<boolean>(), default: () => false }),

  // DB Agent node output.
  sqlTemplateId: Annotation<string | null>({ ...replace<string | null>(), default: () => null }),
  sqlResult: Annotation<Record<string, unknown> | null>({
    ...replace<Record<string, unknown> | null>(),
    default: () => null,
  }),

  // Reranker node input/output.
  retrievedDocs: Annotation<SimilarityResult[]>({ ...replace<SimilarityResult[]>(), default: () => [] }),
  rerankedDocs: Annotation<SimilarityResult[]>({ ...replace<SimilarityResult[]>(), default: () => [] }),

  // Synthesis node output — the final answer.
  decision: Annotation<UnderwritingDecisionValue | null>({
    ...replace<UnderwritingDecisionValue | null>(),
    default: () => null,
  }),
  rationale: Annotation<string | null>({ ...replace<string | null>(), default: () => null }),
  confidenceScore: Annotation<number | null>({ ...replace<number | null>(), default: () => null }),

  // Non-fatal issues any node can append without aborting the run (e.g. "no
  // policy documents matched" or "credit score missing from snapshot").
  warnings: Annotation<string[]>({ reducer: (left: string[], right: string[]) => left.concat(right), default: () => [] }),
});

export type UnderwritingStateType = typeof UnderwritingState.State;
export type UnderwritingUpdateType = typeof UnderwritingState.Update;
