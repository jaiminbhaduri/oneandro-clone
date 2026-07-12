import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { AuthModule } from './auth/auth.module';
import { ClientsModule } from './clients/clients.module';
import { HandoffModule } from './handoff/handoff.module';
import { NotificationsModule } from './notifications/notifications.module';
import { KafkaModule } from './kafka/kafka.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    AuthModule,
    ClientsModule,
    HandoffModule,
    NotificationsModule,
    KafkaModule,
    HealthModule,
  ],
})
export class AppModule {}
