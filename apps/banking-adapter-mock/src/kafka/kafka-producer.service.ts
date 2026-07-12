import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer } from 'kafkajs';
import { AppConfig } from '../config/configuration';

/**
 * This service is a pure consumer of lead-status-events — it never
 * publishes lead-status changes itself (it drives them by calling
 * lead-service's HTTP API, which is the one true publisher; see
 * HandoffService). The only thing this producer is for is shovelling a
 * message this service couldn't process into the DLQ, same pattern as
 * user-service's consumer.
 */
@Injectable()
export class KafkaProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaProducerService.name);
  private readonly kafka: Kafka;
  private readonly producer: Producer;

  constructor(configService: ConfigService<AppConfig, true>) {
    this.kafka = new Kafka({
      clientId: `${configService.get('kafka.clientId', { infer: true })}-producer`,
      brokers: configService.get('kafka.brokers', { infer: true }),
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

  async publishToDlq(originTopic: string, key: string, rawValue: string, reason: string): Promise<void> {
    await this.producer.send({
      topic: `${originTopic}.dlq`,
      messages: [{ key, value: rawValue, headers: { 'x-dlq-reason': reason, 'x-origin-topic': originTopic } }],
    });
  }
}
