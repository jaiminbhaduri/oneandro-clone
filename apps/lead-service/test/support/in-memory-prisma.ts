import { randomUUID } from 'node:crypto';
import { KycDocument, Lead, LeadStatus, LeadStatusHistory, Prisma } from '@prisma/client';

/**
 * Minimal in-memory stand-in for PrismaService, scoped to exactly the
 * queries LeadsService/KycService issue. Lets the e2e suite exercise the
 * real HTTP pipeline (guards, RBAC, multipart upload, state machine) via
 * supertest without a live Postgres instance.
 */
export class InMemoryPrismaService {
  private leads = new Map<string, Lead>();
  private kycDocuments = new Map<string, KycDocument>();
  private statusHistory: LeadStatusHistory[] = [];

  lead = {
    create: async ({ data }: { data: Prisma.LeadUncheckedCreateInput }): Promise<Lead> => {
      const now = new Date();
      const lead: Lead = {
        id: randomUUID(),
        userId: data.userId as string,
        assignedLoanOfficerId: (data.assignedLoanOfficerId as string) ?? null,
        loanAmountRequested: new Prisma.Decimal(data.loanAmountRequested as number),
        loanPurpose: data.loanPurpose as string,
        status: (data.status as LeadStatus) ?? LeadStatus.CREATED,
        creditScoreSnapshot: null,
        declineReason: null,
        createdAt: now,
        updatedAt: now,
      };
      this.leads.set(lead.id, lead);
      return lead;
    },

    findUnique: async ({ where: { id } }: { where: { id: string } }): Promise<Lead | null> => {
      return this.leads.get(id) ?? null;
    },

    findMany: async ({
      where,
      skip = 0,
      take,
    }: {
      where?: { status?: LeadStatus; userId?: string };
      skip?: number;
      take?: number;
    }): Promise<Lead[]> => {
      let rows = [...this.leads.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      if (where?.status) rows = rows.filter((l) => l.status === where.status);
      if (where?.userId) rows = rows.filter((l) => l.userId === where.userId);
      return rows.slice(skip, take ? skip + take : undefined);
    },

    count: async ({ where }: { where?: { status?: LeadStatus; userId?: string } }): Promise<number> => {
      let rows = [...this.leads.values()];
      if (where?.status) rows = rows.filter((l) => l.status === where.status);
      if (where?.userId) rows = rows.filter((l) => l.userId === where.userId);
      return rows.length;
    },

    update: async ({
      where: { id },
      data,
    }: {
      where: { id: string };
      data: Partial<Lead>;
    }): Promise<Lead> => {
      const existing = this.leads.get(id);
      if (!existing) throw new Error(`no lead ${id}`);
      const updated = { ...existing, ...data, updatedAt: new Date() };
      this.leads.set(id, updated);
      return updated;
    },
  };

  leadStatusHistory = {
    create: async ({ data }: { data: Prisma.LeadStatusHistoryUncheckedCreateInput }): Promise<LeadStatusHistory> => {
      const row: LeadStatusHistory = {
        id: randomUUID(),
        leadId: data.leadId as string,
        fromStatus: (data.fromStatus as LeadStatus) ?? null,
        toStatus: data.toStatus as LeadStatus,
        changedByUserId: (data.changedByUserId as string) ?? null,
        note: (data.note as string) ?? null,
        createdAt: new Date(),
      };
      this.statusHistory.push(row);
      return row;
    },
  };

  kycDocument = {
    create: async ({ data }: { data: Prisma.KycDocumentUncheckedCreateInput }): Promise<KycDocument> => {
      const row: KycDocument = {
        id: randomUUID(),
        leadId: data.leadId as string,
        documentType: data.documentType as KycDocument['documentType'],
        originalFilename: data.originalFilename as string,
        mimeType: data.mimeType as string,
        sizeBytes: data.sizeBytes as number,
        storagePath: data.storagePath as string,
        uploadedByUserId: data.uploadedByUserId as string,
        createdAt: new Date(),
      };
      this.kycDocuments.set(row.id, row);
      return row;
    },

    findMany: async ({ where: { leadId } }: { where: { leadId: string } }): Promise<KycDocument[]> => {
      return [...this.kycDocuments.values()]
        .filter((d) => d.leadId === leadId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
  };

  async $transaction<T extends readonly unknown[]>(ops: readonly [...T]): Promise<T> {
    return Promise.all(ops) as Promise<T>;
  }

  async $queryRaw(): Promise<unknown> {
    return [{ ok: 1 }];
  }

  async $connect(): Promise<void> {}
  async $disconnect(): Promise<void> {}
}
