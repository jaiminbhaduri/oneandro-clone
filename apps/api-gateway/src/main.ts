import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const configService = app.get(ConfigService<AppConfig, true>);
  const logger = new Logger('Bootstrap');

  // Exactly one hop of trust: Nginx. Without this, req.ip resolves to
  // Nginx's container IP for every request, which would collapse
  // IP-keyed rate limiting (the /auth/login brute-force guard) down to a
  // single shared bucket for all clients.
  app.set('trust proxy', 1);

  // TEMP DIAGNOSTIC — pinpointing a CI-only hang that produces zero
  // downstream logs anywhere in this app. Remove once resolved.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    // eslint-disable-next-line no-console
    console.log(`[DIAG] incoming ${req.method} ${req.url} contentLength=${req.headers['content-length']} te=${req.headers['transfer-encoding']}`);
    next();
  });

  app.use(helmet());
  app.use(cookieParser());

  app.enableCors({
    origin: configService.get('corsOrigins', { infer: true }),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const port = configService.get('port', { infer: true });
  await app.listen(port, '0.0.0.0');
  logger.log(`api-gateway listening on :${port}`);
}

bootstrap();
