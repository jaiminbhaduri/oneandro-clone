/**
 * Contract for messages on the `lead-status-events` Kafka topic.
 * lead-service is the sole publisher (see its LeadStatusStateMachine and
 * Prisma `LeadStatus` enum, which this status union must stay in sync
 * with); user-service and banking-adapter-mock are independent consumers
 * — each in its own consumer group, so both see every event.
 */
export interface LeadStatusEvent {
  leadId: string;
  userId: string;
  status: 'CREATED' | 'KYC_UPLOADED' | 'CREDIT_CHECKED' | 'APPROVED' | 'DECLINED' | 'BANK_HANDOFF' | 'FUNDED' | 'FUNDING_REJECTED';
  previousStatus?: string;
  occurredAt: string;
}

/** Runtime shape guard for consumers parsing an untrusted Kafka message payload. */
export function isLeadStatusEvent(value: unknown): value is LeadStatusEvent {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.leadId === 'string' &&
    typeof v.userId === 'string' &&
    typeof v.status === 'string' &&
    typeof v.occurredAt === 'string'
  );
}
