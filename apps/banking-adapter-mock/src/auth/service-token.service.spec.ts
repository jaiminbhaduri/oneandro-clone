import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ServiceTokenService } from './service-token.service';

const SECRET = 'test-access-secret-at-least-32-characters';

describe('ServiceTokenService', () => {
  let service: ServiceTokenService;
  let jwtService: JwtService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ServiceTokenService,
        JwtService,
        { provide: ConfigService, useValue: { get: (key: string) => (key === 'jwt.accessSecret' ? SECRET : undefined) } },
      ],
    }).compile();

    service = moduleRef.get(ServiceTokenService);
    jwtService = moduleRef.get(JwtService);
  });

  it('mints a token carrying the SYSTEM role claim', async () => {
    const token = service.mint();
    const payload = await jwtService.verifyAsync(token, { secret: SECRET });

    expect(payload.role).toBe('SYSTEM');
    expect(payload.sub).toBe('system:banking-adapter-mock');
    expect(payload.email).toBe('system@oneandro.internal');
  });

  it('mints a short-lived token (<=60s)', async () => {
    const token = service.mint();
    const payload = await jwtService.verifyAsync(token, { secret: SECRET });

    expect(payload.exp - payload.iat).toBeLessThanOrEqual(60);
  });

  it('a token signed with the wrong secret fails verification — same guarantee every other service relies on', async () => {
    const token = service.mint();
    await expect(jwtService.verifyAsync(token, { secret: 'a-totally-different-secret-value' })).rejects.toThrow();
  });
});
