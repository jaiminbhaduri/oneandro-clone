import { Module } from '@nestjs/common';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { DocumentStorageService } from './storage/document-storage.service';
import { LeadsModule } from '../leads/leads.module';

@Module({
  imports: [LeadsModule],
  controllers: [KycController],
  providers: [KycService, DocumentStorageService],
})
export class KycModule {}
