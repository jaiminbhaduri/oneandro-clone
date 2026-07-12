import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { KafkaProducerService } from '../../src/kafka/kafka-producer.service';
import { LeadStatusConsumer } from '../../src/kafka/consumers/lead-status.consumer';
import { InMemoryPrismaService } from './in-memory-prisma';

process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters';
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';

/**
 * Mints a SYSTEM-role token the same way banking-adapter-mock's
 * ServiceTokenService does — same secret, same claim shape — so tests can
 * exercise the JwtStrategy's SYSTEM branch without a real second service.
 */
export function mintSystemToken(): string {
  return new JwtService({ secret: process.env.JWT_ACCESS_SECRET }).sign(
    { sub: 'system:banking-adapter-mock', email: 'system@oneandro.internal', role: 'SYSTEM' },
    { expiresIn: '60s' },
  );
}

export interface TestAppContext {
  app: INestApplication;
  prisma: InMemoryPrismaService;
}

export async function buildTestApp(): Promise<TestAppContext> {
  const prisma = new InMemoryPrismaService();

  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .overrideProvider(KafkaProducerService)
    .useValue({
      publish: async () => undefined,
      publishUserRegistered: async () => undefined,
      publishToDlq: async () => undefined,
      onModuleInit: async () => undefined,
      onModuleDestroy: async () => undefined,
    })
    .overrideProvider(LeadStatusConsumer)
    .useValue({ onModuleInit: async () => undefined, onModuleDestroy: async () => undefined })
    .compile();

  const app = moduleFixture.createNestApplication();
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();

  return { app, prisma: prisma as InMemoryPrismaService };
}

/** Parses `Set-Cookie` response headers into a simple name -> value map. */
export function parseCookies(setCookieHeader: string[] | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const line of setCookieHeader ?? []) {
    const [pair] = line.split(';');
    const [name, value] = pair.split('=');
    cookies[name.trim()] = value;
  }
  return cookies;
}
