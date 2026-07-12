import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StateGraph, START, END } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { CohereClient } from 'cohere-ai';
import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingsService } from '../../rag/embeddings.service';
import { PgVectorStoreService, SimilarityResult } from '../../rag/pgvector-store.service';
import { LangSmithService } from '../../telemetry/langsmith.provider';
import { LeadServiceClient } from '../clients/lead-service.client';
import { AppConfig } from '../../config/configuration';
import { UnderwritingState } from './state';
import { createRouterNode } from './nodes/router.node';
import { createDbAgentNode } from './nodes/db-agent.node';
import { createRerankerNode } from './nodes/reranker.node';
import { createSynthesisNode } from './nodes/synthesis.node';

export interface UnderwritingRunResult {
  id: string;
  leadId: string;
  question: string;
  decision: 'APPROVE' | 'DECLINE' | 'REFER';
  rationale: string;
  confidenceScore: number;
  usedSqlTemplate: string | null;
  warnings: string[];
  createdAt: Date;
}

/** Builds and compiles the graph. Return type is left to inference — LangGraph's own generics are hard to name by hand without drifting out of sync with the library's internals. */
function buildGraph(model: ChatOpenAI, cohere: CohereClient, rerankModel: string, prisma: PrismaService, embeddingsService: EmbeddingsService, vectorStore: PgVectorStoreService) {
  const graph = new StateGraph(UnderwritingState)
    .addNode('router', createRouterNode(model))
    .addNode('dbAgent', createDbAgentNode(model, prisma))
    .addNode('reranker', createRerankerNode(embeddingsService, vectorStore, cohere, rerankModel))
    .addNode('synthesis', createSynthesisNode(model))
    .addEdge(START, 'router')
    .addConditionalEdges('router', (state) => (state.needsFinancialLookup ? 'dbAgent' : 'reranker'), {
      dbAgent: 'dbAgent',
      reranker: 'reranker',
    })
    .addEdge('dbAgent', 'reranker')
    .addEdge('reranker', 'synthesis')
    .addEdge('synthesis', END);

  return graph.compile();
}

/**
 * Wires the four Tier-2 nodes into a real branching graph — not a linear
 * chain:
 *
 *        START
 *          |
 *        router ──(needsFinancialLookup)──▶ dbAgent
 *          |                                    |
 *          └────(no financial lookup needed)────┤
 *                                                ▼
 *                                            reranker
 *                                                |
 *                                            synthesis
 *                                                |
 *                                               END
 *
 * The router node runs on every request; the DB Agent node is skipped
 * entirely when the router decides the question doesn't need this lead's
 * underwriting history — that's the "multi-agent" routing the spec calls
 * for, implemented with LangGraph's `addConditionalEdges` rather than an
 * if/else wrapped around a linear prompt chain.
 */
@Injectable()
export class UnderwriterGraphService {
  private readonly logger = new Logger(UnderwriterGraphService.name);
  private readonly compiledGraph: ReturnType<typeof buildGraph>;

  constructor(
    configService: ConfigService<AppConfig, true>,
    private readonly prisma: PrismaService,
    private readonly embeddingsService: EmbeddingsService,
    private readonly vectorStore: PgVectorStoreService,
    private readonly langSmith: LangSmithService,
    private readonly leadServiceClient: LeadServiceClient,
  ) {
    const model = new ChatOpenAI({
      apiKey: configService.get('openai.apiKey', { infer: true }),
      model: configService.get('openai.chatModel', { infer: true }),
      temperature: 0,
    });

    const cohere = new CohereClient({ token: configService.get('cohere.apiKey', { infer: true }) });
    const rerankModel = configService.get('cohere.rerankModel', { infer: true });

    this.compiledGraph = buildGraph(model, cohere, rerankModel, this.prisma, this.embeddingsService, this.vectorStore);
  }

  async run(leadId: string, question: string, requester: { userId: string }, bearerToken: string): Promise<UnderwritingRunResult> {
    const leadSnapshot = await this.leadServiceClient.getLeadSnapshot(leadId, bearerToken);

    const traceConfig = this.langSmith.traceConfig({ tier: 'tier2-underwriting', leadId, userId: requester.userId });

    const finalState = await this.compiledGraph.invoke(
      { leadId, userId: requester.userId, question, leadSnapshot },
      traceConfig,
    );

    if (!finalState.decision || !finalState.rationale || finalState.confidenceScore === null) {
      // Should be unreachable — synthesis always sets these — but fail loudly rather than persist a half run.
      throw new Error('Underwriting graph completed without producing a decision');
    }

    const run = await this.prisma.underwritingRun.create({
      data: {
        leadId,
        question,
        decision: finalState.decision,
        rationale: finalState.rationale,
        confidenceScore: finalState.confidenceScore,
        usedSqlTemplate: finalState.sqlTemplateId,
        retrievedSourceIds: finalState.rerankedDocs.map((doc: SimilarityResult) => doc.id),
      },
    });

    this.logger.log(
      `underwriting run ${run.id} for lead ${leadId}: ${finalState.decision} (confidence ${finalState.confidenceScore.toFixed(2)})`,
    );

    return {
      id: run.id,
      leadId: run.leadId,
      question: run.question,
      decision: finalState.decision,
      rationale: finalState.rationale,
      confidenceScore: finalState.confidenceScore,
      usedSqlTemplate: finalState.sqlTemplateId,
      warnings: finalState.warnings,
      createdAt: run.createdAt,
    };
  }
}
