import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { TokenService } from './token.service';
import { PrismaService } from '../prisma/prisma.service';
import { User } from '@prisma/client';

function hash(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

const baseUser: User = {
  id: 'user-1',
  email: 'ada@example.com',
  passwordHash: 'irrelevant',
  firstName: 'Ada',
  lastName: 'Lovelace',
  role: 'APPLICANT',
  isEmailVerified: false,
  isActive: true,
  lastLeadStatus: null,
  lastLeadStatusAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('TokenService', () => {
  let tokenService: TokenService;
  let prisma: {
    refreshToken: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      refreshToken: {
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn().mockImplementation((ops: unknown[]) => Promise.all(ops)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TokenService,
        { provide: PrismaService, useValue: prisma },
        JwtService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              const values: Record<string, string> = {
                'jwt.accessSecret': 'test-secret-at-least-32-characters-long',
                'jwt.accessTtl': '15m',
                'jwt.refreshTtl': '7d',
              };
              return values[key];
            },
          },
        },
      ],
    }).compile();

    tokenService = moduleRef.get(TokenService);
  });

  describe('issueTokenPair', () => {
    it('creates a refresh token row and returns a signed access token', async () => {
      const pair = await tokenService.issueTokenPair(baseUser, { ipAddress: '127.0.0.1' });

      expect(pair.accessToken.split('.')).toHaveLength(3); // header.payload.signature
      expect(pair.refreshToken).toHaveLength(86); // 64 random bytes, base64url, no padding
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);

      const createArgs = prisma.refreshToken.create.mock.calls[0][0];
      expect(createArgs.data.userId).toBe(baseUser.id);
      expect(createArgs.data.tokenHash).toBe(hash(pair.refreshToken));
    });
  });

  describe('rotateRefreshToken', () => {
    it('rejects a token that does not exist', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(tokenService.rotateRefreshToken('bogus-token', {})).rejects.toThrow(UnauthorizedException);
    });

    it('rotates a valid token: revokes the old row, issues a new one in the same family', async () => {
      const family = 'family-1';
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: baseUser.id,
        tokenHash: hash('old-raw-token'),
        family,
        revoked: false,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        user: baseUser,
      });

      const pair = await tokenService.rotateRefreshToken('old-raw-token', { ipAddress: '10.0.0.1' });

      expect(pair.refreshToken).not.toBe('old-raw-token');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);

      const [updateCall, createCall] = prisma.$transaction.mock.calls[0][0];
      expect(updateCall).toBeDefined();
      expect(createCall).toBeDefined();
    });

    it('rejects an expired token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-2',
        userId: baseUser.id,
        tokenHash: hash('expired-token'),
        family: 'family-2',
        revoked: false,
        expiresAt: new Date(Date.now() - 1000),
        user: baseUser,
      });

      await expect(tokenService.rotateRefreshToken('expired-token', {})).rejects.toThrow('Refresh token expired');
    });

    it('detects reuse of an already-revoked token and revokes the whole family', async () => {
      const family = 'family-3';
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-3',
        userId: baseUser.id,
        tokenHash: hash('stolen-token'),
        family,
        revoked: true,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        user: baseUser,
      });

      await expect(tokenService.rotateRefreshToken('stolen-token', {})).rejects.toThrow(
        'Refresh token reuse detected; all sessions have been revoked',
      );

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { family, revoked: false },
        data: { revoked: true },
      });
    });

    it('rejects a token belonging to a disabled account', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-4',
        userId: baseUser.id,
        tokenHash: hash('valid-token'),
        family: 'family-4',
        revoked: false,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        user: { ...baseUser, isActive: false },
      });

      await expect(tokenService.rotateRefreshToken('valid-token', {})).rejects.toThrow('Account is disabled');
    });
  });

  describe('revokeAllForUser', () => {
    it('revokes every active refresh token for the user', async () => {
      await tokenService.revokeAllForUser(baseUser.id);

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: baseUser.id, revoked: false },
        data: { revoked: true },
      });
    });
  });
});
