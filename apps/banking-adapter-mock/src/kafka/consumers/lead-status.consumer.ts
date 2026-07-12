import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Consumer, Kafka } from 'kafkajs';
import { AppConfig } from '../../config/configuration';
import { isLeadStatusEvent } from '@oneandro/common';
import { KafkaProducerService } from '../kafka-producer.service';
import { HandoffService } from '../../handoff/handoff.service';
import { NotificationsService } from '../../notifications/notifications.service';

@Injectable()
export class LeadStatusConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LeadStatusConsumer.name);
  private readonly kafka: Kafka;
  private readonly consumer: Consumer;
  private readonly topic: string;

  constructor(
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly handoffService: HandoffService,
    private readonly notificationsService: NotificationsService,
  ) {
    this.topic = this.configService.get('kafka.leadStatusTopic', { infer: true });
    this.kafka = new Kafka({
      clientId: `${this.configService.get('kafka.clientId', { infer: true })}-lead-status-consumer`,
      brokers: this.configService.get('kafka.brokers', { infer: true }),
      retry: { retries: 8, initialRetryTime: 300 },
    });
    // Own consumer group — user-service subscribes to the same topic
    // independently, and both need to see every event (fan-out).
    this.consumer = this.kafka.consumer({ groupId: 'banking-adapter-mock.lead-status-events' });
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

          if (parsed.status === 'BANK_HANDOFF') {
            // Deliberately not awaited — see HandoffService's docstring.
            // Awaiting here would block eachMessage (and therefore every
            // other lead's events) for the full simulated processing
            // delay.
            this.handoffService.processHandoff(parsed).catch((err: Error) => {
              this.logger.error(`background handoff processing failed for lead ${parsed.leadId}: ${err.message}`);
            });
          } else if (NotificationsService.isNotifiable(parsed.status)) {
            await this.notificationsService.notify(parsed);
          }
        } catch (err) {
          const reason = err instanceof Error ? err.message : 'unknown error';
          this.logger.error(`failed to process lead-status-events message key=${key}: ${reason}`);
          await this.kafkaProducer.publishToDlq(this.topic, key, raw, reason);
        }
      },
    });

    this.logger.log(`subscribed to ${this.topic} as consumer group banking-adapter-mock.lead-status-events`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer.disconnect();
  }
}
