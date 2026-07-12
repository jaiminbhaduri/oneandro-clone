import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AppConfig } from '../config/configuration';
import { RequestUser, Role } from '@oneandro/common';

interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string;
}

/**
 * Deliberately "soft": the gateway does not decide whether a route
 * requires authentication — every downstream service already enforces
 * that itself (global JwtAuthGuard + per-route @Roles(), same as
 * user-service/lead-service/ai-orchestrator). Duplicating that decision
 * here would mean keeping two systems in sync forever, and the gateway
 * would eventually drift from the real rule.
 *
 * What the gateway *does* need identity for is rate limiting — an
 * authenticated user should get a fair-usage quota keyed to them, not to
 * whatever IP they happen to be behind. So: verify if a token is present,
 * attach the identity if valid, and silently proceed as anonymous
 * (IP-keyed) otherwise. An invalid/expired token is never a 401 from the
 * gateway itself — it's still forwarded, and the downstream service
 * makes the real call.
 */
@Injectable()
export class JwtVerifierService {
  private readonly logger = new Logger(JwtVerifierService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  async tryVerify(rawToken: string | undefined | null): Promise<RequestUser | null> {
    if (!rawToken) return null;

    try {
      const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(rawToken, {
        secret: this.configService.get('jwt.accessSecret', { infer: true }),
      });
      return { userId: payload.sub, email: payload.email, role: payload.role as Role };
    } catch (err) {
      this.logger.debug(`rejected access token: ${err instanceof Error ? err.message : 'unknown error'}`);
      return null;
    }
  }

  static extractToken(cookieHeader: Record<string, string> | undefined, authHeader: string | undefined): string | undefined {
    const cookieToken = cookieHeader?.['access_token'];
    if (cookieToken) return cookieToken;

    if (authHeader?.startsWith('Bearer ')) return authHeader.slice('Bearer '.length);

    return undefined;
  }
}
