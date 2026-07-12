import { CohereClient } from 'cohere-ai';
import { createRerankerNode } from './reranker.node';
import { EmbeddingsService } from '../../../rag/embeddings.service';
import { PgVectorStoreService, SimilarityResult } from '../../../rag/pgvector-store.service';
import { UnderwritingStateType } from '../state';

const baseState: UnderwritingStateType = {
  leadId: 'lead-1',
  userId: 'user-1',
  question: 'What proof of income is required?',
  leadSnapshot: { id: 'lead-1', status: 'CREDIT_CHECKED', loanAmountRequested: '15000', loanPurpose: 'AUTO', creditScoreSnapshot: 620 },
  needsFinancialLookup: false,
  sqlTemplateId: null,
  sqlResult: null,
  retrievedDocs: [],
  rerankedDocs: [],
  decision: null,
  rationale: null,
  confidenceScore: null,
  warnings: [],
};

function makeDoc(id: string, content: string): SimilarityResult {
  return { id, documentId: 'doc-1', source: 'policy:income', content, metadata: null, distance: 0.1 };
}

describe('createRerankerNode', () => {
  it('retrieves via pgvector then reorders using the Cohere rerank result indices', async () => {
    const docs = [makeDoc('a', 'pay stubs'), makeDoc('b', 'W-2 forms'), makeDoc('c', 'bank statements')];

    const embeddingsService = { embedQuery: jest.fn().mockResolvedValue([1, 0, 0]) } as unknown as EmbeddingsService;
    const vectorStore = { similaritySearch: jest.fn().mockResolvedValue(docs) } as unknown as PgVectorStoreService;

    // Cohere reorders: doc at original index 2 ("bank statements") is most relevant.
    const cohere = {
      rerank: jest.fn().mockResolvedValue({
        results: [
          { index: 2, relevanceScore: 0.95 },
          { index: 0, relevanceScore: 0.4 },
        ],
      }),
    } as unknown as CohereClient;

    const node = createRerankerNode(embeddingsService, vectorStore, cohere, 'rerank-v3.5');
    const result = await node(baseState);

    expect(result.retrievedDocs).toEqual(docs);
    expect(result.rerankedDocs?.map((d) => d.id)).toEqual(['c', 'a']); // reordered by Cohere, not by original retrieval order
  });

  it('caps requested rerank topN at the number of retrieved docs (never asks Cohere for more than exists)', async () => {
    const docs = [makeDoc('a', 'x'), makeDoc('b', 'y')];
    const embeddingsService = { embedQuery: jest.fn().mockResolvedValue([1, 0, 0]) } as unknown as EmbeddingsService;
    const vectorStore = { similaritySearch: jest.fn().mockResolvedValue(docs) } as unknown as PgVectorStoreService;
    const rerank = jest.fn().mockResolvedValue({ results: [{ index: 0, relevanceScore: 0.9 }] });
    const cohere = { rerank } as unknown as CohereClient;

    const node = createRerankerNode(embeddingsService, vectorStore, cohere, 'rerank-v3.5');
    await node(baseState);

    expect(rerank.mock.calls[0][0].topN).toBe(2);
  });

  it('short-circuits with a warning when pgvector finds nothing, without calling Cohere', async () => {
    const embeddingsService = { embedQuery: jest.fn().mockResolvedValue([1, 0, 0]) } as unknown as EmbeddingsService;
    const vectorStore = { similaritySearch: jest.fn().mockResolvedValue([]) } as unknown as PgVectorStoreService;
    const rerank = jest.fn();
    const cohere = { rerank } as unknown as CohereClient;

    const node = createRerankerNode(embeddingsService, vectorStore, cohere, 'rerank-v3.5');
    const result = await node(baseState);

    expect(result.retrievedDocs).toEqual([]);
    expect(result.rerankedDocs).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(rerank).not.toHaveBeenCalled();
  });
});
