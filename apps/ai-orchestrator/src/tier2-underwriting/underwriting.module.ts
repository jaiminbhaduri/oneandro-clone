import { Module } from '@nestjs/common';
import { UnderwritingController } from './underwriting.controller';
import { UnderwriterGraphService } from './graph/underwriter-graph';
import { LeadServiceClient } from './clients/lead-service.client';
import { RagModule } from '../rag/rag.module';
import { TelemetryModule } from '../telemetry/telemetry.module';

@Module({
  imports: [RagModule, TelemetryModule],
  controllers: [UnderwritingController],
  providers: [UnderwriterGraphService, LeadServiceClient],
})
export class UnderwritingModule {}
