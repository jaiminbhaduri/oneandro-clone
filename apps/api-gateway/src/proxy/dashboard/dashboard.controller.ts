import { Controller, Get, Req, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { AppConfig } from '../../config/configuration';
import { JwtVerifierService } from '../../auth/jwt-verifier.service';
import { RequestUser } from '@oneandro/common';

interface AggregatedSection<T> {
  ok: boolean;
  data: T | null;
  error?: string;
}

async function fetchJson<T>(url: string, bearerToken: string): Promise<AggregatedSection<T>> {
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${bearerToken}` } });
    if (!response.ok) {
      return { ok: false, data: null, error: `${response.status} ${response.statusText}` };
    }
    return { ok: true, data: (await response.json()) as T };
  } catch (err) {
    return { ok: false, data: null, error: err instanceof Error ? err.message : 'unknown error' };
  }
}

/**
 * The one genuinely gateway-owned endpoint (everything else is a proxy
 * pass-through) — combines the caller's profile (user-service) and their
 * leads (lead-service) into a single response, so a frontend doesn't need
 * two round-trips through the edge for its landing page. Failures in one
 * upstream don't fail the whole response — see AggregatedSection.
 */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  @Get('me')
  async getMyDashboard(@Req() req: Request & { user?: RequestUser }) {
    if (!req.user) {
      throw new UnauthorizedException('Authentication required');
    }

    const bearerToken = JwtVerifierService.extractToken(req.cookies, req.headers.authorization);
    if (!bearerToken) {
      // Shouldn't happen — req.user is only set when a token verified — but never trust that invariant silently.
      throw new UnauthorizedException('Authentication required');
    }

    const userServiceUrl = this.configService.get('services.userServiceUrl', { infer: true });
    const leadServiceUrl = this.configService.get('services.leadServiceUrl', { infer: true });

    const [profile, leads] = await Promise.all([
      fetchJson(`${userServiceUrl}/users/me`, bearerToken),
      fetchJson(`${leadServiceUrl}/leads/mine?pageSize=10`, bearerToken),
    ]);

    return { profile, leads };
  }
}
