import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Lead, LeadStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';
import { ListLeadsQueryDto } from './dto/list-leads-query.dto';
import { LeadStatusStateMachine } from './state-machine/lead-status.state-machine';
import { LeadStatusEvent, Role, RequestUser } from '@oneandro/common';

export interface PaginatedResult<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// SYSTEM counts as staff for read/ownership purposes: banking-adapter-mock
// needs to read any lead's credit-score snapshot to make its (mock)
// funding decision, same as a human loan officer would.
const STAFF_ROLES = [Role.LOAN_OFFICER, Role.UNDERWRITER, Role.ADMIN, Role.SYSTEM];

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  // Fire-and-forget: the lead's DB state is already committed by the time
  // this is called, so a slow/unreachable Kafka broker must never block
  // the HTTP response for an operation that has already succeeded.
  // kafkajs's own retry/backoff for a stuck producer.send() can run well
  // past any reasonable request timeout — this bit a real CI run where
  // the broker's group coordinator hadn't fully settled seconds after
  // startup.
  private publishLeadStatusEventAsync(event: LeadStatusEvent): void {
    this.kafkaProducer.publishLeadStatusEvent(event).catch((err: unknown) => {
      this.logger.error(
        `failed to publish lead status event (${event.status}) for lead ${event.leadId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  private isStaff(role: Role): boolean {
    return STAFF_ROLES.includes(role);
  }

  async create(userId: string, dto: CreateLeadDto): Promise<Lead> {
    const lead = await this.prisma.lead.create({
      data: {
        userId,
        loanAmountRequested: dto.loanAmountRequested,
        loanPurpose: dto.loanPurpose,
        status: LeadStatus.CREATED,
      },
    });

    await this.prisma.leadStatusHistory.create({
      data: { leadId: lead.id, fromStatus: null, toStatus: LeadStatus.CREATED, changedByUserId: userId },
    });

    this.publishLeadStatusEventAsync({
      leadId: lead.id,
      userId: lead.userId,
      status: LeadStatus.CREATED,
      occurredAt: lead.createdAt.toISOString(),
    });

    return lead;
  }

  async findByIdOrThrow(id: string): Promise<Lead> {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }
    return lead;
  }

  /** Enforces "owner or staff" — the same shape of check every non-staff-scoped read/write needs. */
  async findAccessibleOrThrow(id: string, requester: RequestUser): Promise<Lead> {
    const lead = await this.findByIdOrThrow(id);
    if (lead.userId !== requester.userId && !this.isStaff(requester.role)) {
      throw new ForbiddenException('You do not have access to this lead');
    }
    return lead;
  }

  async listForUser(userId: string, query: ListLeadsQueryDto): Promise<PaginatedResult<Lead>> {
    return this.list({ ...query, userId });
  }

  async list(query: ListLeadsQueryDto & { userId?: string }): Promise<PaginatedResult<Lead>> {
    const where: Prisma.LeadWhereInput = {
      ...(query.status && { status: query.status }),
      ...(query.userId && { userId: query.userId }),
    };
    const skip = (query.page - 1) * query.pageSize;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.lead.findMany({ where, skip, take: query.pageSize, orderBy: { createdAt: 'desc' } }),
      this.prisma.lead.count({ where }),
    ]);

    return {
      data,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  /** Called by KycService after the first successful document upload — not a manual, role-gated transition. */
  async markKycUploaded(leadId: string, changedByUserId: string): Promise<Lead> {
    const lead = await this.findByIdOrThrow(leadId);
    if (lead.status !== LeadStatus.CREATED) {
      // Already past this stage (2nd+ document) — nothing to do.
      return lead;
    }
    return this.transition(lead, LeadStatus.KYC_UPLOADED, changedByUserId);
  }

  async updateStatus(id: string, dto: UpdateLeadStatusDto, requester: RequestUser): Promise<Lead> {
    const lead = await this.findByIdOrThrow(id);

    LeadStatusStateMachine.assertManualTransitionAllowed(lead.status, dto.toStatus, requester.role);

    const requiresReason = dto.toStatus === LeadStatus.DECLINED || dto.toStatus === LeadStatus.FUNDING_REJECTED;
    if (requiresReason && !dto.declineReason) {
      throw new ForbiddenException(`declineReason is required when moving a lead to ${dto.toStatus}`);
    }

    // Mock credit check: a real integration would call a bureau here. We
    // generate a deterministic-looking but fake score so the rest of the
    // pipeline (and the AI underwriting graph, downstream) has something
    // to reason about.
    const extra: Prisma.LeadUpdateInput = {};
    if (dto.toStatus === LeadStatus.CREDIT_CHECKED) {
      extra.creditScoreSnapshot = 550 + Math.floor(Math.random() * 250); // 550–799
    }
    if (requiresReason) {
      extra.declineReason = dto.declineReason;
    }

    return this.transition(lead, dto.toStatus, requester.userId, dto.note, extra);
  }

  private async transition(
    lead: Lead,
    toStatus: LeadStatus,
    changedByUserId: string,
    note?: string,
    extra: Prisma.LeadUpdateInput = {},
  ): Promise<Lead> {
    LeadStatusStateMachine.assertValidTransition(lead.status, toStatus);

    const [updated] = await this.prisma.$transaction([
      this.prisma.lead.update({ where: { id: lead.id }, data: { status: toStatus, ...extra } }),
      this.prisma.leadStatusHistory.create({
        data: { leadId: lead.id, fromStatus: lead.status, toStatus, changedByUserId, note },
      }),
    ]);

    this.publishLeadStatusEventAsync({
      leadId: updated.id,
      userId: updated.userId,
      status: toStatus,
      previousStatus: lead.status,
      occurredAt: updated.updatedAt.toISOString(),
    });

    return updated;
  }
}
