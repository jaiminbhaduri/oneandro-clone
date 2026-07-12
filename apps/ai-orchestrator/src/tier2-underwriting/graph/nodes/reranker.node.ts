import { CohereClient } from 'cohere-ai';
import type { RunnableConfig } from '@langchain/core/runnables';
import { EmbeddingsService } from '../../../rag/embeddings.service';
import { PgVectorStoreService, SimilarityResult } from '../../../rag/pgvector-store.service';
import { UnderwritingStateType, UnderwritingUpdateType } from '../state';

// Retrieve broad (recall), rerank narrow (precision) — the two-stage
// pattern the spec's "Reranker Node" bullet is describing: pgvector's
// cosine search is cheap but coarse, Cohere's cross-encoder rerank is
// expensive but much better at judging true relevance, so it only ever
// looks at the pre-filtered top-K instead of the whole corpus.
const RETRIEVAL_TOP_K = 10;
const RERANK_TOP_N = 4;

export function createRerankerNode(
  embeddingsService: EmbeddingsService,
  vectorStore: PgVectorStoreService,
  cohere: CohereClient,
  rerankModel: string,
) {
  return async (state: UnderwritingStateType, _config?: RunnableConfig): Promise<UnderwritingUpdateType> => {
    const queryEmbedding = await embeddingsService.embedQuery(state.question);
    const retrievedDocs = await vectorStore.similaritySearch(queryEmbedding, RETRIEVAL_TOP_K, 'policy:');

    if (retrievedDocs.length === 0) {
      return {
        retrievedDocs: [],
        rerankedDocs: [],
        warnings: ['No policy documents matched this question — synthesis will proceed on lead data alone.'],
      };
    }

    const rerankResponse = await cohere.rerank({
      model: rerankModel,
      query: state.question,
      documents: retrievedDocs.map((doc) => ({ text: doc.content })),
      topN: Math.min(RERANK_TOP_N, retrievedDocs.length),
    });

    const rerankedDocs: SimilarityResult[] = rerankResponse.results.map((result) => retrievedDocs[result.index]);

    return { retrievedDocs, rerankedDocs };
  };
}
