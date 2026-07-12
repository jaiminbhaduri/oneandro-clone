import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Consumer, Kafka } from 'kafkajs';
import { AppConfig } from '../../config/configuration';
import { UsersService } from '../../users/users.service';
import { isLeadStatusEvent } from '@oneandro/common';
import { KafkaProducerService } from '../kafka-producer.service';

@Injectable()
export class LeadStatusConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LeadStatusConsumer.name);
  private readonly kafka: Kafka;
  private readonly consumer: Consumer;
  private readonly topic: string;

  constructor(
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly usersService: UsersService,
    private readonly kafkaProducer: KafkaProducerService,
  ) {
    this.topic = this.configService.get('kafka.leadStatusTopic', { infer: true });
    this.kafka = new Kafka({
      clientId: `${this.configService.get('kafka.clientId', { infer: true })}-lead-status-consumer`,
      brokers: this.configService.get('kafka.brokers', { infer: true }),
      retry: { retries: 8, initialRetryTime: 300 },
    });
    // Distinct consumer group id from banking-adapter-mock's so both
    // services independently receive every event (fan-out, not competing
    // consumers within one logical subscriber).
    this.consumer = this.kafka.consumer({ groupId: 'user-service.lead-status-events' });
  }

  async onModuleInit(): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: this.topic, fromBeginning: false });

    await this.consumer.run({
      eachMessage: async ({ message }) => {
        const raw = message.value?.toString('utf-8') ?? '';
        const key = message.key?.toString('utf-8') ?? 'unknown';

        try {
          const parsed: unknown = JSON.parse(raw);

          if (!isLeadStatusEvent(parsed)) {
            throw new Error('payload failed LeadStatusEvent shape validation');
          }

          await this.usersService.recordLeadStatus(parsed.userId, parsed.status);
          this.logger.log(`applied lead status ${parsed.status} for user ${parsed.userId} (lead ${parsed.leadId})`);
        } catch (err) {
          const reason = err instanceof Error ? err.message : 'unknown error';
          this.logger.error(`failed to process lead-status-events message key=${key}: ${reason}`);
          await this.kafkaProducer.publishToDlq(this.topic, key, raw, reason);
        }
      },
    });

    this.logger.log(`subscribed to ${this.topic} as consumer group user-service.lead-status-events`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer.disconnect();
  }
}
