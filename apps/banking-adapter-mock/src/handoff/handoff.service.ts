import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';
import { LeadServiceClient } from '../clients/lead-service.client';
import { LeadStatusEvent } from '@oneandro/common';
import { decideFundingOutcome } from './funding-decision';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Simulates a partner bank's asynchronous funding decision. Deliberately
 * NOT awaited by the Kafka consumer that calls it (see
 * LeadStatusConsumer) — kafkajs processes one message at a time by
 * default, so blocking `eachMessage` for the several-second simulated
 * delay here would stall every other lead's events behind it.
 *
 * That fire-and-forget shape has a real trade-off worth naming: the
 * consumer's offset commits as soon as this method is *dispatched*, not
 * when it finishes. If the process crashes mid-delay, that BANK_HANDOFF
 * event's follow-up is lost — it won't be retried on restart. A
 * production version of this would persist "handoff in progress" to a
 * durable store (outbox table, job queue) before acking the Kafka
 * message, so the work survives a crash. Acceptable for a mock/demo
 * service; flagging it so it doesn't look like an oversight.
 */
@Injectable()
export class HandoffService {
  private readonly logger = new Logger(HandoffService.name);
  private readonly minDelayMs: number;
  private readonly maxDelayMs: number;

  constructor(
    configService: ConfigService<AppConfig, true>,
    private readonly leadServiceClient: LeadServiceClient,
  ) {
    this.minDelayMs = configService.get('handoff.minDelayMs', { infer: true });
    this.maxDelayMs = configService.get('handoff.maxDelayMs', { infer: true });
  }

  async processHandoff(event: LeadStatusEvent): Promise<void> {
    this.logger.log(`bank handoff received for lead ${event.leadId} — simulating partner bank processing`);

    const lead = await this.leadServiceClient.getLead(event.leadId);

    await sleep(this.randomDelayMs());

    const decision = decideFundingOutcome(lead.creditScoreSnapshot);

    if (decision.toStatus === 'FUNDED') {
      await this.leadServiceClient.resolveHandoff(event.leadId, 'FUNDED');
    } else {
      await this.leadServiceClient.resolveHandoff(event.leadId, 'FUNDING_REJECTED', decision.reason);
    }

    this.logger.log(`bank handoff resolved for lead ${event.leadId}: ${decision.toStatus}`);
  }

  private randomDelayMs(): number {
    return this.minDelayMs + Math.random() * (this.maxDelayMs - this.minDelayMs);
  }
}
