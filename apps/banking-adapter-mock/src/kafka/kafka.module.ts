import { Module } from '@nestjs/common';
import { KafkaProducerService } from './kafka-producer.service';
import { LeadStatusConsumer } from './consumers/lead-status.consumer';
import { HandoffModule } from '../handoff/handoff.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [HandoffModule, NotificationsModule],
  providers: [KafkaProducerService, LeadStatusConsumer],
})
export class KafkaModule {}
