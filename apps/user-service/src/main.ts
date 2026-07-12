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

  // Versioning/URL-prefixing (e.g. /api/v1/...) is owned by the edge
  // (Nginx) + api-gateway, not by individual services — user-service
  // exposes clean internal routes (/auth/*, /users/*, /healthz) that the
  // gateway proxies to.
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
        .setTitle('OneAndro — User Service')
        .setDescription('Identity, authentication, and RBAC for the OneAndro clone')
        .setVersion('1.0')
        .addCookieAuth('access_token')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('docs', app, document);
  }

  const port = configService.get('port', { infer: true });
  await app.listen(port, '0.0.0.0');
  logger.log(`user-service listening on :${port}`);
}

bootstrap();
