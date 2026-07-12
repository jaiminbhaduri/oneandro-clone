import { Module } from '@nestjs/common';
import { KafkaProducerService } from './kafka-producer.service';
import { LeadStatusConsumer } from './consumers/lead-status.consumer';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [UsersModule],
  providers: [KafkaProducerService, LeadStatusConsumer],
  exports: [KafkaProducerService],
})
export class KafkaModule {}
