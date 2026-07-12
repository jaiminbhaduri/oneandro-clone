import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const configService = app.get(ConfigService<AppConfig, true>);
  const logger = new Logger('Bootstrap');

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

  if (configService.get('swaggerEnabled', { infer: true })) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('OneAndro — Lead Service')
        .setDescription('Lead lifecycle, KYC intake, and lead-status-events publishing')
        .setVersion('1.0')
        .addCookieAuth('access_token')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('docs', app, document);
  }

  const port = configService.get('port', { infer: true });
  await app.listen(port, '0.0.0.0');
  logger.log(`lead-service listening on :${port}`);
}

bootstrap();
