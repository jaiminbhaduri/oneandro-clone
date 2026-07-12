import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer } from 'kafkajs';
import { AppConfig } from '../config/configuration';
import { LeadStatusEvent } from '@oneandro/common';

@Injectable()
export class KafkaProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaProducerService.name);
  private readonly kafka: Kafka;
  private readonly producer: Producer;
  private readonly topic: string;

  constructor(private readonly configService: ConfigService<AppConfig, true>) {
    this.topic = this.configService.get('kafka.leadStatusTopic', { infer: true });
    this.kafka = new Kafka({
      clientId: this.configService.get('kafka.clientId', { infer: true }),
      brokers: this.configService.get('kafka.brokers', { infer: true }),
      retry: { retries: 8, initialRetryTime: 300 },
    });
    this.producer = this.kafka.producer({ allowAutoTopicCreation: false });
  }

  async onModuleInit(): Promise<void> {
    await this.producer.connect();
    this.logger.log('Kafka producer connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.producer.disconnect();
  }

  /**
   * Partition key is the leadId, not userId: every event for a given lead
   * must land in the same partition so consumers see status transitions
   * in order. (Cross-lead ordering doesn't matter and shouldn't force a
   * single-partition topic.)
   */
  async publishLeadStatusEvent(event: LeadStatusEvent): Promise<void> {
    await this.producer.send({
      topic: this.topic,
      messages: [{ key: event.leadId, value: JSON.stringify(event) }],
    });
  }
}
