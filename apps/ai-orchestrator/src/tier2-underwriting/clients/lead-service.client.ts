import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';

export interface LeadSnapshot {
  id: string;
  status: string;
  loanAmountRequested: string;
  loanPurpose: string;
  creditScoreSnapshot: number | null;
}

/**
 * Internal HTTP client to lead-service. ai-orchestrator has its own
 * Postgres database (ai_db) and deliberately does NOT reach into
 * lead-service's `leads_db` — that would violate database-per-service
 * isolation. Fetching current lead facts is a service call, not a query;
 * the graph's "DB Agent" node does genuine Text-to-SQL, but against
 * ai-orchestrator's own `underwriting_runs` table (this service's actual
 * data), not against another service's database. See db-agent.node.ts.
 *
 * The caller's own access token is forwarded as-is (not a separate
 * service credential) — lead-service's RBAC (UNDERWRITER/ADMIN, or the
 * lead's owner) is the real authorization check here, and forwarding
 * preserves "who is asking" instead of laundering the request through an
 * over-privileged service account.
 */
@Injectable()
export class LeadServiceClient {
  private readonly logger = new Logger(LeadServiceClient.name);
  private readonly baseUrl: string;

  constructor(configService: ConfigService<AppConfig, true>) {
    this.baseUrl = configService.get('services.leadServiceUrl', { infer: true });
  }

  async getLeadSnapshot(leadId: string, bearerToken: string): Promise<LeadSnapshot> {
    const response = await fetch(`${this.baseUrl}/leads/${leadId}`, {
      headers: { Authorization: `Bearer ${bearerToken}` },
    });

    if (!response.ok) {
      this.logger.error(`lead-service returned ${response.status} for lead ${leadId}`);
      throw new ServiceUnavailableException(`Could not load lead ${leadId} from lead-service (${response.status})`);
    }

    const body = (await response.json()) as {
      id: string;
      status: string;
      loanAmountRequested: string;
      loanPurpose: string;
      creditScoreSnapshot: number | null;
    };

    return {
      id: body.id,
      status: body.status,
      loanAmountRequested: body.loanAmountRequested,
      loanPurpose: body.loanPurpose,
      creditScoreSnapshot: body.creditScoreSnapshot,
    };
  }
}
