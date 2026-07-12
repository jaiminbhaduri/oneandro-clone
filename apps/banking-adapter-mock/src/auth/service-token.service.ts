import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AppConfig } from '../config/configuration';

const SERVICE_IDENTITY = 'system:banking-adapter-mock';
const SERVICE_EMAIL = 'system@oneandro.internal';

/**
 * Mints this service's own short-lived JWTs for calling lead-service and
 * user-service — see user-service's JwtStrategy and lead-service's Role
 * enum for the receiving end of this contract (both recognize a `SYSTEM`
 * role claim; user-service special-cases it to skip the usual DB lookup).
 *
 * A fresh token per outbound call, 60s TTL: this is background job
 * processing, not a session, so there's no refresh/rotation story to
 * build — mint, use once or a few times in quick succession, let it
 * expire.
 */
@Injectable()
export class ServiceTokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  mint(): string {
    return this.jwtService.sign(
      { sub: SERVICE_IDENTITY, email: SERVICE_EMAIL, role: 'SYSTEM' },
      { secret: this.configService.get('jwt.accessSecret', { infer: true }), expiresIn: '60s' },
    );
  }
}
