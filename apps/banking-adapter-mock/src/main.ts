import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';

// No inbound API surface beyond /healthz — this service is a Kafka
// consumer that makes outbound HTTP calls, not something the edge routes
// requests to. Still bootstrapped as a full Nest HTTP app (rather than
// NestFactory.createApplicationContext) purely so Docker's healthcheck
// has something to hit and `docker compose ps` shows real health status,
// consistent with every other service in this monorepo.
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const configService = app.get(ConfigService<AppConfig, true>);
  const logger = new Logger('Bootstrap');

  const port = configService.get('port', { infer: true });
  await app.listen(port, '0.0.0.0');
  logger.log(`banking-adapter-mock listening on :${port}`);
}

bootstrap();
