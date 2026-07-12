import { Module } from '@nestjs/common';
import { HandoffService } from './handoff.service';
import { ClientsModule } from '../clients/clients.module';

@Module({
  imports: [ClientsModule],
  providers: [HandoffService],
  exports: [HandoffService],
})
export class HandoffModule {}
