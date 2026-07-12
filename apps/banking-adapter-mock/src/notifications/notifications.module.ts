import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { ClientsModule } from '../clients/clients.module';

@Module({
  imports: [ClientsModule],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
