import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';
import { ServiceTokenService } from '../auth/service-token.service';

export interface LeadSnapshot {
  id: string;
  userId: string;
  status: string;
  loanAmountRequested: string;
  loanPurpose: string;
  creditScoreSnapshot: number | null;
  declineReason: string | null;
}

/**
 * Own database (none, in this service's case) — never touches leads_db
 * directly. Same "call the owning service over HTTP" boundary
 * ai-orchestrator's LeadServiceClient established; this is the same
 * pattern with a self-minted SYSTEM token instead of a forwarded caller
 * token, since there's no caller here.
 */
@Injectable()
export class LeadServiceClient {
  private readonly logger = new Logger(LeadServiceClient.name);
  private readonly baseUrl: string;

  constructor(
    configService: ConfigService<AppConfig, true>,
    private readonly serviceTokenService: ServiceTokenService,
  ) {
    this.baseUrl = configService.get('services.leadServiceUrl', { infer: true });
  }

  async getLead(leadId: string): Promise<LeadSnapshot> {
    const response = await fetch(`${this.baseUrl}/leads/${leadId}`, {
      headers: { Authorization: `Bearer ${this.serviceTokenService.mint()}` },
    });

    if (!response.ok) {
      throw new Error(`lead-service GET /leads/${leadId} returned ${response.status}`);
    }

    return (await response.json()) as LeadSnapshot;
  }

  async resolveHandoff(leadId: string, toStatus: 'FUNDED' | 'FUNDING_REJECTED', declineReason?: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/leads/${leadId}/status`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${this.serviceTokenService.mint()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ toStatus, ...(declineReason && { declineReason }) }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`lead-service PATCH /leads/${leadId}/status returned ${response.status}: ${body}`);
    }

    this.logger.log(`lead ${leadId} resolved to ${toStatus}`);
  }
}
