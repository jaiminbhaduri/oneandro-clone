import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface DocumentChunkInput {
  documentId: string;
  source: string;
  content: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

export interface SimilarityResult {
  id: string;
  documentId: string;
  source: string;
  content: string;
  metadata: Record<string, unknown> | null;
  /** Cosine distance: 0 = identical direction, 2 = opposite. Lower is more similar. */
  distance: number;
}

interface DocumentChunkRow {
  id: string;
  documentId: string;
  source: string;
  content: string;
  metadata: Record<string, unknown> | null;
  distance: number;
}

/**
 * Prisma (as of v6) has no native `vector` column type or distance-operator
 * query builder — `schema.prisma` declares the column via
 * `Unsupported("vector(1536)")` purely so migrations know it exists,
 * and every read/write here goes through `$queryRaw`/`$executeRaw`.
 *
 * The embedding is always passed as a *bound parameter* (a plain string
 * built from our own `number[]`, never from user input) and cast with
 * `::vector` on the Postgres side — this is not string interpolation into
 * the query text, so it carries the same injection safety as any other
 * parameterized Prisma query.
 */
@Injectable()
export class PgVectorStoreService {
  constructor(private readonly prisma: PrismaService) {}

  private toVectorLiteral(embedding: number[]): string {
    if (embedding.length === 0 || embedding.some((n) => !Number.isFinite(n))) {
      throw new Error('embedding must be a non-empty array of finite numbers');
    }
    return `[${embedding.join(',')}]`;
  }

  async insertChunk(input: DocumentChunkInput): Promise<string> {
    const vectorLiteral = this.toVectorLiteral(input.embedding);
    const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;

    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO document_chunks (document_id, source, content, embedding, metadata)
      VALUES (
        ${input.documentId}::uuid,
        ${input.source},
        ${input.content},
        ${vectorLiteral}::vector,
        ${metadataJson}::jsonb
      )
      RETURNING id
    `;

    return rows[0].id;
  }

  async insertChunks(inputs: DocumentChunkInput[]): Promise<string[]> {
    const ids: string[] = [];
    for (const input of inputs) {
      ids.push(await this.insertChunk(input));
    }
    return ids;
  }

  async similaritySearch(queryEmbedding: number[], topK: number, sourcePrefix?: string): Promise<SimilarityResult[]> {
    const vectorLiteral = this.toVectorLiteral(queryEmbedding);

    const rows = sourcePrefix
      ? await this.prisma.$queryRaw<DocumentChunkRow[]>`
          SELECT
            id,
            document_id AS "documentId",
            source,
            content,
            metadata,
            embedding <=> ${vectorLiteral}::vector AS distance
          FROM document_chunks
          WHERE source LIKE ${`${sourcePrefix}%`}
          ORDER BY embedding <=> ${vectorLiteral}::vector
          LIMIT ${topK}
        `
      : await this.prisma.$queryRaw<DocumentChunkRow[]>`
          SELECT
            id,
            document_id AS "documentId",
            source,
            content,
            metadata,
            embedding <=> ${vectorLiteral}::vector AS distance
          FROM document_chunks
          ORDER BY embedding <=> ${vectorLiteral}::vector
          LIMIT ${topK}
        `;

    return rows;
  }

  async deleteByDocumentId(documentId: string): Promise<number> {
    return this.prisma.$executeRaw`DELETE FROM document_chunks WHERE document_id = ${documentId}::uuid`;
  }
}
