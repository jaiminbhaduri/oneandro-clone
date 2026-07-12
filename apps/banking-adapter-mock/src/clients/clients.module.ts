import { Module } from '@nestjs/common';
import { LeadServiceClient } from './lead-service.client';
import { UserServiceClient } from './user-service.client';

@Module({
  providers: [LeadServiceClient, UserServiceClient],
  exports: [LeadServiceClient, UserServiceClient],
})
export class ClientsModule {}
