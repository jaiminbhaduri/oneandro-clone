import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { RequestUser, Role } from '@oneandro/common';
import { AppConfig } from '../../config/configuration';

const ACCESS_TOKEN_COOKIE = 'access_token';

function cookieExtractor(req: Request): string | null {
  return req?.cookies?.[ACCESS_TOKEN_COOKIE] ?? null;
}

interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string;
}

/**
 * Resource-server-only JWT verification: checks signature + expiry against
 * the shared JWT_ACCESS_SECRET and trusts the embedded claims. Unlike
 * user-service's strategy, there is no DB round-trip here — lead-service
 * doesn't own a users table. See configuration.ts for the trade-off this
 * implies.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService<AppConfig, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([cookieExtractor, ExtractJwt.fromAuthHeaderAsBearerToken()]),
      ignoreExpiration: false,
      secretOrKey: configService.get('jwt.accessSecret', { infer: true }),
    });
  }

  validate(payload: AccessTokenPayload): RequestUser {
    return { userId: payload.sub, email: payload.email, role: payload.role as Role };
  }
}
