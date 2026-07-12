import { randomUUID } from 'node:crypto';
import { Prisma, RefreshToken, User } from '@prisma/client';

/**
 * A minimal in-memory stand-in for PrismaService, scoped to exactly the
 * queries UsersService/TokenService issue. Lets the e2e suite exercise the
 * real HTTP pipeline (guards, cookies, validation, serialization) via
 * supertest without a live Postgres instance.
 */
export class InMemoryPrismaService {
  private users = new Map<string, User>();
  private refreshTokens = new Map<string, RefreshToken>();

  user = {
    create: async ({ data }: { data: Prisma.UserCreateInput }): Promise<User> => {
      const email = data.email as string;
      if ([...this.users.values()].some((u) => u.email === email)) {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`email`)', {
          code: 'P2002',
          clientVersion: 'test',
        });
      }

      const now = new Date();
      const user: User = {
        id: randomUUID(),
        email,
        passwordHash: data.passwordHash as string,
        firstName: data.firstName as string,
        lastName: data.lastName as string,
        role: 'APPLICANT',
        isEmailVerified: false,
        isActive: true,
        lastLeadStatus: null,
        lastLeadStatusAt: null,
        createdAt: now,
        updatedAt: now,
      };
      this.users.set(user.id, user);
      return user;
    },

    findUnique: async ({ where }: { where: { id?: string; email?: string } }): Promise<User | null> => {
      if (where.id) return this.users.get(where.id) ?? null;
      if (where.email) return [...this.users.values()].find((u) => u.email === where.email) ?? null;
      return null;
    },

    findMany: async ({
      where,
      skip = 0,
      take,
    }: {
      where?: { role?: string };
      skip?: number;
      take?: number;
      orderBy?: unknown;
    }): Promise<User[]> => {
      let rows = [...this.users.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      if (where?.role) rows = rows.filter((u) => u.role === where.role);
      return rows.slice(skip, take ? skip + take : undefined);
    },

    count: async ({ where }: { where?: { role?: string } }): Promise<number> => {
      let rows = [...this.users.values()];
      if (where?.role) rows = rows.filter((u) => u.role === where.role);
      return rows.length;
    },

    update: async ({ where: { id }, data }: { where: { id: string }; data: Partial<User> }): Promise<User> => {
      const existing = this.users.get(id);
      if (!existing) throw new Error(`no user ${id}`);
      const updated = { ...existing, ...data, updatedAt: new Date() };
      this.users.set(id, updated);
      return updated;
    },

    updateMany: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<User>;
    }): Promise<{ count: number }> => {
      const existing = this.users.get(where.id);
      if (!existing) return { count: 0 };
      this.users.set(where.id, { ...existing, ...data, updatedAt: new Date() });
      return { count: 1 };
    },
  };

  refreshToken = {
    create: async ({ data }: { data: Prisma.RefreshTokenUncheckedCreateInput }): Promise<RefreshToken> => {
      const row: RefreshToken = {
        id: randomUUID(),
        userId: data.userId as string,
        tokenHash: data.tokenHash as string,
        family: data.family as string,
        revoked: false,
        replacedByTokenHash: null,
        userAgent: (data.userAgent as string) ?? null,
        ipAddress: (data.ipAddress as string) ?? null,
        expiresAt: data.expiresAt as Date,
        createdAt: new Date(),
      };
      this.refreshTokens.set(row.id, row);
      return row;
    },

    findUnique: async ({
      where,
    }: {
      where: { tokenHash: string };
      include?: { user: true };
    }): Promise<(RefreshToken & { user: User }) | null> => {
      const row = [...this.refreshTokens.values()].find((t) => t.tokenHash === where.tokenHash);
      if (!row) return null;
      const user = this.users.get(row.userId);
      if (!user) return null;
      return { ...row, user };
    },

    update: async ({
      where: { id },
      data,
    }: {
      where: { id: string };
      data: Partial<RefreshToken>;
    }): Promise<RefreshToken> => {
      const existing = this.refreshTokens.get(id);
      if (!existing) throw new Error(`no refresh token ${id}`);
      const updated = { ...existing, ...data };
      this.refreshTokens.set(id, updated);
      return updated;
    },

    updateMany: async ({
      where,
      data,
    }: {
      where: { tokenHash?: string; family?: string; userId?: string; revoked?: boolean };
      data: Partial<RefreshToken>;
    }): Promise<{ count: number }> => {
      let count = 0;
      for (const [id, row] of this.refreshTokens.entries()) {
        const matches =
          (where.tokenHash === undefined || row.tokenHash === where.tokenHash) &&
          (where.family === undefined || row.family === where.family) &&
          (where.userId === undefined || row.userId === where.userId) &&
          (where.revoked === undefined || row.revoked === where.revoked);
        if (matches) {
          this.refreshTokens.set(id, { ...row, ...data });
          count++;
        }
      }
      return { count };
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
