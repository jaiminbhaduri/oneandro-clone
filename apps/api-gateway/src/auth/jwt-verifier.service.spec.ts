import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { JwtVerifierService } from './jwt-verifier.service';
import { Role } from '@oneandro/common';

const SECRET = 'test-access-secret-at-least-32-characters';

describe('JwtVerifierService', () => {
  let service: JwtVerifierService;
  let jwtService: JwtService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        JwtVerifierService,
        JwtService,
        { provide: ConfigService, useValue: { get: (key: string) => (key === 'jwt.accessSecret' ? SECRET : undefined) } },
      ],
    }).compile();

    service = moduleRef.get(JwtVerifierService);
    jwtService = moduleRef.get(JwtService);
  });

  it('returns null for a missing token — never throws', async () => {
    await expect(service.tryVerify(undefined)).resolves.toBeNull();
    await expect(service.tryVerify(null)).resolves.toBeNull();
  });

  it('returns null for a malformed token — never throws', async () => {
    await expect(service.tryVerify('not-a-real-jwt')).resolves.toBeNull();
  });

  it('returns null for a token signed with the wrong secret', async () => {
    const token = jwtService.sign({ sub: 'u1', email: 'a@x.com', role: 'APPLICANT' }, { secret: 'a-completely-different-secret-value' });
    await expect(service.tryVerify(token)).resolves.toBeNull();
  });

  it('returns null for an expired token', async () => {
    const token = jwtService.sign({ sub: 'u1', email: 'a@x.com', role: 'APPLICANT' }, { secret: SECRET, expiresIn: '-1s' });
    await expect(service.tryVerify(token)).resolves.toBeNull();
  });

  it('resolves the identity for a valid token', async () => {
    const token = jwtService.sign({ sub: 'u1', email: 'ada@example.com', role: 'UNDERWRITER' }, { secret: SECRET, expiresIn: '15m' });

    await expect(service.tryVerify(token)).resolves.toEqual({
      userId: 'u1',
      email: 'ada@example.com',
      role: Role.UNDERWRITER,
    });
  });
});

describe('JwtVerifierService.extractToken', () => {
  it('prefers the cookie over the Authorization header', () => {
    expect(JwtVerifierService.extractToken({ access_token: 'from-cookie' }, 'Bearer from-header')).toBe('from-cookie');
  });

  it('falls back to a Bearer Authorization header when there is no cookie', () => {
    expect(JwtVerifierService.extractToken(undefined, 'Bearer from-header')).toBe('from-header');
  });

  it('ignores a non-Bearer Authorization header', () => {
    expect(JwtVerifierService.extractToken(undefined, 'Basic dXNlcjpwYXNz')).toBeUndefined();
  });

  it('returns undefined when neither is present', () => {
    expect(JwtVerifierService.extractToken(undefined, undefined)).toBeUndefined();
  });
});
