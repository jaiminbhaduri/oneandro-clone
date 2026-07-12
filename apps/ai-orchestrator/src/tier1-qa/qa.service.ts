import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { EmbeddingsService } from '../rag/embeddings.service';
import { PgVectorStoreService } from '../rag/pgvector-store.service';
import { RedisSemanticCacheService } from './semantic-cache/redis-semantic-cache.service';
import { LangSmithService } from '../telemetry/langsmith.provider';
import { AppConfig } from '../config/configuration';

const CACHE_NAMESPACE = 'policy-qa';
const RETRIEVAL_TOP_K = 4;

export interface QaAnswer {
  answer: string;
  cacheHit: boolean;
  sources: string[];
}

/**
 * Tier 1: simple, high-volume policy Q&A. Standard LangChain LCEL pipeline
 * (prompt -> chat model -> string parser), grounded with a small RAG
 * retrieval step over `document_chunks`, with a semantic-cache short-circuit
 * in front of the LLM call to "bypass LLM charges" per the spec — the
 * expensive path (embed once + LLM call) only runs on a genuine cache miss.
 */
@Injectable()
export class QaService {
  private readonly logger = new Logger(QaService.name);
  private readonly model: ChatOpenAI;

  private readonly prompt = ChatPromptTemplate.fromMessages([
    [
      'system',
      "You are OneAndro's loan policy assistant. Answer ONLY using the provided context. " +
        "If the context doesn't contain the answer, say you don't know — never guess at " +
        'loan policy or eligibility details.\n\nContext:\n{context}',
    ],
    ['human', '{question}'],
  ]);

  constructor(
    configService: ConfigService<AppConfig, true>,
    private readonly embeddingsService: EmbeddingsService,
    private readonly vectorStore: PgVectorStoreService,
    private readonly semanticCache: RedisSemanticCacheService,
    private readonly langSmith: LangSmithService,
  ) {
    this.model = new ChatOpenAI({
      apiKey: configService.get('openai.apiKey', { infer: true }),
      model: configService.get('openai.chatModel', { infer: true }),
      temperature: 0,
    });
  }

  async ask(question: string, requester: { userId: string }): Promise<QaAnswer> {
    const queryEmbedding = await this.embeddingsService.embedQuery(question);

    const cached = await this.semanticCache.lookup(CACHE_NAMESPACE, queryEmbedding);
    if (cached) {
      return { answer: cached.answer, cacheHit: true, sources: [] };
    }

    const contextChunks = await this.vectorStore.similaritySearch(queryEmbedding, RETRIEVAL_TOP_K, 'policy:');
    const context =
      contextChunks.length > 0
        ? contextChunks.map((c, i) => `[${i + 1}] (${c.source}) ${c.content}`).join('\n\n')
        : 'No policy documents matched this question.';

    const chain = this.prompt.pipe(this.model).pipe(new StringOutputParser());
    const traceConfig = this.langSmith.traceConfig({ tier: 'tier1-qa', userId: requester.userId, cacheHit: false });

    const answer = await chain.invoke({ question, context }, traceConfig);

    // Cache under the *pre-call* embedding, not a fresh one — the point is
    // to recognize the next semantically-similar question, not this exact
    // string again.
    await this.semanticCache.store(CACHE_NAMESPACE, question, answer, queryEmbedding);

    this.logger.log(`tier1-qa: cache miss, answered via LLM (${contextChunks.length} context chunks)`);

    return { answer, cacheHit: false, sources: contextChunks.map((c) => c.source) };
  }
}
