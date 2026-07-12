import { Module } from '@nestjs/common';
import { EmbeddingsService } from './embeddings.service';
import { PgVectorStoreService } from './pgvector-store.service';
import { IngestionService } from './ingestion.service';

@Module({
  providers: [EmbeddingsService, PgVectorStoreService, IngestionService],
  exports: [EmbeddingsService, PgVectorStoreService, IngestionService],
})
export class RagModule {}
