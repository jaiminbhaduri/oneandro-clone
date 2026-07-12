import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import ms from 'ms';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfig } from '../config/configuration';

export interface TokenMeta {
  userAgent?: string;
  ipAddress?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresInMs: number;
  refreshTokenExpiresInMs: number;
}

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string;
}

/**
 * Refresh-token rotation with reuse detection.
 *
 * Every refresh token belongs to a "family" created at login. Rotating
 * (POST /auth/refresh) revokes the presented token and mints a new one in
 * the same family. If a token that has *already* been revoked is presented
 * again — meaning either the legitimate client double-submitted, or an
 * attacker is replaying a stolen token after the legitimate client already
 * rotated past it — we cannot tell those apart, so we fail closed: the
 * entire family is revoked and the user has to log in again everywhere.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  private generateRawToken(): string {
    return randomBytes(64).toString('base64url');
  }

  private signAccessToken(user: Pick<User, 'id' | 'email' | 'role'>): string {
    const payload: AccessTokenPayload = { sub: user.id, email: user.email, role: user.role };
    return this.jwtService.sign(payload, {
      secret: this.configService.get('jwt.accessSecret', { infer: true }),
      expiresIn: this.configService.get('jwt.accessTtl', { infer: true }),
    });
  }

  private refreshTtlMs(): number {
    const ttl: string = this.configService.get('jwt.refreshTtl', { infer: true });
    return ms(ttl);
  }

  private accessTtlMs(): number {
    const ttl: string = this.configService.get('jwt.accessTtl', { infer: true });
    return ms(ttl);
  }

  /** Issued at login/register — starts a brand-new token family. */
  async issueTokenPair(user: User, meta: TokenMeta): Promise<TokenPair> {
    const family = randomUUID();
    return this.issueTokenPairInFamily(user, family, meta);
  }

  private async issueTokenPairInFamily(user: User, family: string, meta: TokenMeta): Promise<TokenPair> {
    const rawRefreshToken = this.generateRawToken();
    const refreshTokenExpiresInMs = this.refreshTtlMs();

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(rawRefreshToken),
        family,
        expiresAt: new Date(Date.now() + refreshTokenExpiresInMs),
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
      },
    });

    return {
      accessToken: this.signAccessToken(user),
      refreshToken: rawRefreshToken,
      accessTokenExpiresInMs: this.accessTtlMs(),
      refreshTokenExpiresInMs,
    };
  }

  async rotateRefreshToken(rawToken: string, meta: TokenMeta): Promise<TokenPair> {
    const tokenHash = this.hashToken(rawToken);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!existing) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (existing.revoked) {
      this.logger.warn(`Refresh token reuse detected for family ${existing.family} (user ${existing.userId})`);
      await this.revokeFamily(existing.family);
      throw new UnauthorizedException('Refresh token reuse detected; all sessions have been revoked');
    }

    if (existing.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    if (!existing.user.isActive) {
      throw new UnauthorizedException('Account is disabled');
    }

    const rawReplacement = this.generateRawToken();
    const replacementHash = this.hashToken(rawReplacement);
    const refreshTokenExpiresInMs = this.refreshTtlMs();

    await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: existing.id },
        data: { revoked: true, replacedByTokenHash: replacementHash },
      }),
      this.prisma.refreshToken.create({
        data: {
          userId: existing.userId,
          tokenHash: replacementHash,
          family: existing.family,
          expiresAt: new Date(Date.now() + refreshTokenExpiresInMs),
          userAgent: meta.userAgent,
          ipAddress: meta.ipAddress,
        },
      }),
    ]);

    return {
      accessToken: this.signAccessToken(existing.user),
      refreshToken: rawReplacement,
      accessTokenExpiresInMs: this.accessTtlMs(),
      refreshTokenExpiresInMs,
    };
  }

  private async revokeFamily(family: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { family, revoked: false },
      data: { revoked: true },
    });
  }

  /** Best-effort: an already-invalid token presented at logout is not an error. */
  async revokeToken(rawToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hashToken(rawToken) },
      data: { revoked: true },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true },
    });
  }
}
