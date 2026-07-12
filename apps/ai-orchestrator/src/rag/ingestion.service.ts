import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { EmbeddingsService } from './embeddings.service';
import { PgVectorStoreService } from './pgvector-store.service';

export interface IngestDocumentInput {
  source: string; // e.g. "policy:kyc-requirements-v3"
  text: string;
  metadata?: Record<string, unknown>;
}

export interface IngestResult {
  documentId: string;
  chunkIds: string[];
}

/**
 * Turns a raw policy/underwriting-guideline document into embedded,
 * searchable rows in `document_chunks`. Called from an admin-only ingestion
 * endpoint (Tier 1 controller) — not part of the request-time Q&A path.
 */
@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);
  private readonly splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 800,
    chunkOverlap: 120,
  });

  constructor(
    private readonly embeddingsService: EmbeddingsService,
    private readonly vectorStore: PgVectorStoreService,
  ) {}

  async ingest(input: IngestDocumentInput): Promise<IngestResult> {
    const documentId = randomUUID();
    const chunks = await this.splitter.splitText(input.text);

    if (chunks.length === 0) {
      throw new Error(`document "${input.source}" produced no chunks — is it empty?`);
    }

    const embeddings = await this.embeddingsService.embedDocuments(chunks);

    const chunkIds = await this.vectorStore.insertChunks(
      chunks.map((content, i) => ({
        documentId,
        source: input.source,
        content,
        embedding: embeddings[i],
        metadata: input.metadata,
      })),
    );

    this.logger.log(`ingested "${input.source}" as ${chunkIds.length} chunks (document ${documentId})`);

    return { documentId, chunkIds };
  }
}
