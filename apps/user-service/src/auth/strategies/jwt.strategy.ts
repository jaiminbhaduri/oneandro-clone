import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { UsersService } from '../../users/users.service';
import { AccessTokenPayload } from '../token.service';
import { RequestUser } from '@oneandro/common';
import { Role } from '@oneandro/common';
import { ACCESS_TOKEN_COOKIE } from '../auth.constants';
import { AppConfig } from '../../config/configuration';

function cookieExtractor(req: Request): string | null {
  return req?.cookies?.[ACCESS_TOKEN_COOKIE] ?? null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService<AppConfig, true>,
    private readonly usersService: UsersService,
  ) {
    super({
      // Cookie first (browser clients), Authorization header as a fallback
      // for service-to-service calls and API tooling (e.g. Swagger "Try it").
      jwtFromRequest: ExtractJwt.fromExtractors([cookieExtractor, ExtractJwt.fromAuthHeaderAsBearerToken()]),
      ignoreExpiration: false,
      secretOrKey: configService.get('jwt.accessSecret', { infer: true }),
    });
  }

  async validate(payload: AccessTokenPayload): Promise<RequestUser> {
    if (payload.role === Role.SYSTEM) {
      // Service-to-service token: no corresponding row in `users`, so the
      // usual "re-derive the role from the DB, never trust the claim"
      // defense (below) doesn't apply — there's no DB record to re-derive
      // from. Trust it directly. Safe because SYSTEM tokens are only ever
      // minted by other internal services holding JWT_ACCESS_SECRET, with
      // a short TTL (see banking-adapter-mock's ServiceTokenService) —
      // there's no "stale role after a demotion" risk the DB check exists
      // to catch for real user accounts.
      return { userId: payload.sub, email: payload.email, role: Role.SYSTEM };
    }

    const user = await this.usersService.findByIdOrThrow(payload.sub).catch(() => null);

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account no longer active');
    }

    return { userId: user.id, email: user.email, role: user.role as Role };
  }
}
