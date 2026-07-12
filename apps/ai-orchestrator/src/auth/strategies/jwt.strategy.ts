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

/** Resource-server-only verification — see configuration.ts for the trade-off. */
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
