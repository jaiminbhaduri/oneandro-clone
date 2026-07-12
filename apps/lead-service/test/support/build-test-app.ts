import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { KafkaProducerService } from '../../src/kafka/kafka-producer.service';
import { DocumentStorageService } from '../../src/kyc/storage/document-storage.service';
import { Role } from '@oneandro/common';
import { InMemoryPrismaService } from './in-memory-prisma';

process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters';
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';

export interface TestAppContext {
  app: INestApplication;
  prisma: InMemoryPrismaService;
  tokenFor: (userId: string, role: Role, email?: string) => string;
}

export async function buildTestApp(): Promise<TestAppContext> {
  const prisma = new InMemoryPrismaService();
  const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });

  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .overrideProvider(KafkaProducerService)
    .useValue({ publishLeadStatusEvent: async () => undefined, onModuleInit: async () => undefined, onModuleDestroy: async () => undefined })
    .overrideProvider(DocumentStorageService)
    .useValue({
      save: async (_leadId: string, _filename: string, buffer: Buffer) => ({
        storagePath: `fake/${randomSuffix()}`,
        sizeBytes: buffer.length,
      }),
    })
    .compile();

  const app = moduleFixture.createNestApplication();
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();

  return {
    app,
    prisma,
    tokenFor: (userId, role, email = `${userId}@example.com`) => jwt.sign({ sub: userId, email, role }),
  };
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2);
}
