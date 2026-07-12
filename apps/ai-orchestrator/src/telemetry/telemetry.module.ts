import { Global, Module } from '@nestjs/common';
import { LangSmithService } from './langsmith.provider';

@Global()
@Module({
  providers: [LangSmithService],
  exports: [LangSmithService],
})
export class TelemetryModule {}
