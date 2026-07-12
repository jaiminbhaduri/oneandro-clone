import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';
import { AppConfig } from '../config/configuration';
import { LeadServiceClient } from '../clients/lead-service.client';
import { UserServiceClient } from '../clients/user-service.client';
import { LeadStatusEvent } from '@oneandro/common';

interface EmailContent {
  subject: string;
  text: string;
}

const NOTIFIABLE_STATUSES = new Set(['APPROVED', 'DECLINED', 'FUNDED', 'FUNDING_REJECTED']);

/**
 * SMTP -> MailHog in dev (no auth, no TLS — see infra). A real deployment
 * swaps the transport for a real provider (SES, Postgrid, etc.); nothing
 * else here would change, since the transport is the only
 * provider-specific piece.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly transporter: Transporter;
  private readonly fromAddress: string;

  constructor(
    configService: ConfigService<AppConfig, true>,
    private readonly userServiceClient: UserServiceClient,
    private readonly leadServiceClient: LeadServiceClient,
  ) {
    this.transporter = nodemailer.createTransport({
      host: configService.get('smtp.host', { infer: true }),
      port: configService.get('smtp.port', { infer: true }),
      secure: false,
    });
    this.fromAddress = configService.get('smtp.fromAddress', { infer: true });
  }

  static isNotifiable(status: string): boolean {
    return NOTIFIABLE_STATUSES.has(status);
  }

  async notify(event: LeadStatusEvent): Promise<void> {
    if (!NotificationsService.isNotifiable(event.status)) {
      return;
    }

    const user = await this.userServiceClient.getUser(event.userId);
    const content = await this.buildContent(event);

    await this.transporter.sendMail({
      from: this.fromAddress,
      to: user.email,
      subject: content.subject,
      text: content.text,
    });

    this.logger.log(`sent "${content.subject}" to ${user.email} for lead ${event.leadId}`);
  }

  private async buildContent(event: LeadStatusEvent): Promise<EmailContent> {
    switch (event.status) {
      case 'APPROVED':
        return {
          subject: 'Your loan has been approved',
          text: `Good news — your loan application (${event.leadId}) has been approved and is moving to funding.`,
        };

      case 'FUNDED':
        return {
          subject: "You're funded!",
          text: `Your loan (${event.leadId}) has been funded by our banking partner. Funds are on their way.`,
        };

      case 'DECLINED': {
        const lead = await this.leadServiceClient.getLead(event.leadId);
        return {
          subject: 'Update on your loan application',
          text: `Your loan application (${event.leadId}) was not approved.${
            lead.declineReason ? ` Reason: ${lead.declineReason}` : ''
          }`,
        };
      }

      case 'FUNDING_REJECTED': {
        const lead = await this.leadServiceClient.getLead(event.leadId);
        return {
          subject: 'Update on your loan funding',
          text: `Our banking partner was unable to fund your approved loan (${event.leadId}).${
            lead.declineReason ? ` Reason: ${lead.declineReason}` : ''
          } Our team will follow up with next steps.`,
        };
      }

      default:
        // Unreachable: isNotifiable() already filtered to the four cases above.
        throw new Error(`buildContent called for non-notifiable status: ${event.status}`);
    }
  }
}
