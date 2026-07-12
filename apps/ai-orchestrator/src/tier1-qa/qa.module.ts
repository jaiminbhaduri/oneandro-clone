import { Module } from '@nestjs/common';
import { QaController } from './qa.controller';
import { QaService } from './qa.service';
import { RedisSemanticCacheService } from './semantic-cache/redis-semantic-cache.service';
import { RagModule } from '../rag/rag.module';
import { TelemetryModule } from '../telemetry/telemetry.module';

@Module({
  imports: [RagModule, TelemetryModule],
  controllers: [QaController],
  providers: [QaService, RedisSemanticCacheService],
})
export class QaModule {}
