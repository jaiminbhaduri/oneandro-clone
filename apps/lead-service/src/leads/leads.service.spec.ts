import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { Lead, LeadStatus } from '@prisma/client';
import { LeadsService } from './leads.service';
import { PrismaService } from '../prisma/prisma.service';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import { Role } from '@oneandro/common';
import { LoanPurpose } from './dto/create-lead.dto';

const baseLead: Lead = {
  id: 'lead-1',
  userId: 'user-1',
  assignedLoanOfficerId: null,
  loanAmountRequested: { toString: () => '15000' } as unknown as Lead['loanAmountRequested'],
  loanPurpose: 'DEBT_CONSOLIDATION',
  status: LeadStatus.CREATED,
  creditScoreSnapshot: null,
  declineReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('LeadsService', () => {
  let service: LeadsService;
  let prisma: {
    lead: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock; findMany: jest.Mock; count: jest.Mock };
    leadStatusHistory: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let kafka: { publishLeadStatusEvent: jest.Mock };

  beforeEach(async () => {
    prisma = {
      lead: {
        create: jest.fn().mockResolvedValue(baseLead),
        findUnique: jest.fn().mockResolvedValue(baseLead),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      leadStatusHistory: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockImplementation((ops: unknown[]) => Promise.all(ops)),
    };
    kafka = { publishLeadStatusEvent: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LeadsService,
        { provide: PrismaService, useValue: prisma },
        { provide: KafkaProducerService, useValue: kafka },
      ],
    }).compile();

    service = moduleRef.get(LeadsService);
  });

  describe('create', () => {
    it('creates a lead, records history, and publishes a CREATED event', async () => {
      const lead = await service.create('user-1', {
        loanAmountRequested: 15000,
        loanPurpose: LoanPurpose.DEBT_CONSOLIDATION,
      });

      expect(lead).toEqual(baseLead);
      expect(prisma.leadStatusHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ toStatus: LeadStatus.CREATED, fromStatus: null }) }),
      );
      expect(kafka.publishLeadStatusEvent).toHaveBeenCalledWith(
        expect.objectContaining({ leadId: baseLead.id, status: LeadStatus.CREATED }),
      );
    });
  });

  describe('findAccessibleOrThrow', () => {
    it('allows the owning applicant', async () => {
      await expect(
        service.findAccessibleOrThrow('lead-1', { userId: 'user-1', email: 'a@x.com', role: Role.APPLICANT }),
      ).resolves.toEqual(baseLead);
    });

    it('allows staff regardless of ownership', async () => {
      await expect(
        service.findAccessibleOrThrow('lead-1', { userId: 'someone-else', email: 'a@x.com', role: Role.UNDERWRITER }),
      ).resolves.toEqual(baseLead);
    });

    it('rejects a non-owning applicant', async () => {
      await expect(
        service.findAccessibleOrThrow('lead-1', { userId: 'someone-else', email: 'a@x.com', role: Role.APPLICANT }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateStatus', () => {
    it('requires a declineReason when declining', async () => {
      prisma.lead.findUnique.mockResolvedValue({ ...baseLead, status: LeadStatus.CREDIT_CHECKED });

      await expect(
        service.updateStatus(
          'lead-1',
          { toStatus: LeadStatus.DECLINED },
          { userId: 'staff-1', email: 'u@x.com', role: Role.UNDERWRITER },
        ),
      ).rejects.toThrow('declineReason is required when moving a lead to DECLINED');
    });

    it('requires a declineReason when a funding attempt is rejected', async () => {
      prisma.lead.findUnique.mockResolvedValue({ ...baseLead, status: LeadStatus.BANK_HANDOFF });

      await expect(
        service.updateStatus(
          'lead-1',
          { toStatus: LeadStatus.FUNDING_REJECTED },
          { userId: 'system:banking-adapter-mock', email: 'system@oneandro.internal', role: Role.SYSTEM },
        ),
      ).rejects.toThrow('declineReason is required when moving a lead to FUNDING_REJECTED');
    });

    it('lets SYSTEM resolve a bank handoff to FUNDED', async () => {
      const handoff = { ...baseLead, status: LeadStatus.BANK_HANDOFF };
      prisma.lead.findUnique.mockResolvedValue(handoff);
      prisma.lead.update.mockResolvedValue({ ...handoff, status: LeadStatus.FUNDED });

      const result = await service.updateStatus(
        'lead-1',
        { toStatus: LeadStatus.FUNDED },
        { userId: 'system:banking-adapter-mock', email: 'system@oneandro.internal', role: Role.SYSTEM },
      );

      expect(result.status).toBe(LeadStatus.FUNDED);
      expect(kafka.publishLeadStatusEvent).toHaveBeenCalledWith(
        expect.objectContaining({ status: LeadStatus.FUNDED, previousStatus: LeadStatus.BANK_HANDOFF }),
      );
    });

    it('stamps a mock credit score when moving to CREDIT_CHECKED', async () => {
      const inProgress = { ...baseLead, status: LeadStatus.KYC_UPLOADED };
      prisma.lead.findUnique.mockResolvedValue(inProgress);
      prisma.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));
      prisma.lead.update.mockResolvedValue({ ...inProgress, status: LeadStatus.CREDIT_CHECKED, creditScoreSnapshot: 700 });

      await service.updateStatus(
        'lead-1',
        { toStatus: LeadStatus.CREDIT_CHECKED },
        { userId: 'staff-1', email: 'u@x.com', role: Role.LOAN_OFFICER },
      );

      const updateArgs = prisma.lead.update.mock.calls[0][0];
      expect(updateArgs.data.creditScoreSnapshot).toBeGreaterThanOrEqual(550);
      expect(updateArgs.data.creditScoreSnapshot).toBeLessThan(800);
      expect(kafka.publishLeadStatusEvent).toHaveBeenCalledWith(
        expect.objectContaining({ status: LeadStatus.CREDIT_CHECKED, previousStatus: LeadStatus.KYC_UPLOADED }),
      );
    });
  });

  describe('markKycUploaded', () => {
    it('is a no-op if the lead is already past CREATED (2nd+ document)', async () => {
      prisma.lead.findUnique.mockResolvedValue({ ...baseLead, status: LeadStatus.KYC_UPLOADED });

      const result = await service.markKycUploaded('lead-1', 'user-1');

      expect(result.status).toBe(LeadStatus.KYC_UPLOADED);
      expect(prisma.lead.update).not.toHaveBeenCalled();
    });
  });
});
