import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer } from 'kafkajs';
import { AppConfig } from '../config/configuration';
import { UserRegisteredEvent } from './events/user-registered.event';

@Injectable()
export class KafkaProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaProducerService.name);
  private readonly kafka: Kafka;
  private readonly producer: Producer;

  constructor(private readonly configService: ConfigService<AppConfig, true>) {
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

  async publish(topic: string, key: string, value: Record<string, unknown>): Promise<void> {
    await this.producer.send({
      topic,
      messages: [{ key, value: JSON.stringify(value) }],
    });
  }

  async publishUserRegistered(event: UserRegisteredEvent): Promise<void> {
    const topic = this.configService.get('kafka.userEventsTopic', { infer: true });
    await this.publish(topic, event.userId, { type: 'user.registered', ...event });
  }

  /** Used by consumers to shovel a message they couldn't process into its dead-letter topic. */
  async publishToDlq(originTopic: string, key: string, rawValue: string, reason: string): Promise<void> {
    await this.producer.send({
      topic: `${originTopic}.dlq`,
      messages: [{ key, value: rawValue, headers: { 'x-dlq-reason': reason, 'x-origin-topic': originTopic } }],
    });
  }
}
