import { Module } from '@nestjs/common';
import { GatewayMiddleware } from './gateway.middleware';
import { DashboardModule } from './dashboard/dashboard.module';

@Module({
  imports: [DashboardModule],
  providers: [GatewayMiddleware],
  exports: [GatewayMiddleware],
})
export class ProxyModule {}
