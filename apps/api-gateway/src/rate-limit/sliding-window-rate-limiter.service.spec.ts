import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const RedisMock = require('ioredis-mock');
import { SlidingWindowRateLimiterService, SLIDING_WINDOW_LUA } from './sliding-window-rate-limiter.service';

/**
 * ioredis-mock embeds a real Lua VM (fengari) behind EVAL/defineCommand —
 * this test registers the exact SLIDING_WINDOW_LUA script the service
 * ships and runs it for real, not a mock of "the service calls Redis with
 * these args." TypeScript can't catch a Lua bug; only executing the Lua
 * can.
 */
describe('SlidingWindowRateLimiterService', () => {
  let service: SlidingWindowRateLimiterService;
  let mockRedis: InstanceType<typeof RedisMock>;

  const configValues: Record<string, unknown> = {
    'redis.host': 'redis',
    'redis.port': 6379,
    'redis.password': 'test',
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        SlidingWindowRateLimiterService,
        { provide: ConfigService, useValue: { get: (key: string) => configValues[key] } },
      ],
    }).compile();

    service = moduleRef.get(SlidingWindowRateLimiterService);

    // Same swap pattern as the ai-orchestrator semantic-cache tests:
    // disconnect the real ioredis connection the constructor opened, then
    // replace it with a mock that has the real production Lua registered.
    const realRedis = (service as unknown as { redis: { disconnect: () => void } }).redis;
    realRedis.disconnect();

    mockRedis = new RedisMock();
    mockRedis.defineCommand('slidingWindow', { numberOfKeys: 1, lua: SLIDING_WINDOW_LUA });
    (service as unknown as { redis: typeof mockRedis }).redis = mockRedis;
  });

  afterEach(() => {
    mockRedis.disconnect();
  });

  it('allows requests up to the limit and denies the one after', async () => {
    const decisions = [];
    for (let i = 0; i < 4; i++) {
      decisions.push(await service.consume('general', 'user-1', 3, 60_000));
    }

    expect(decisions.map((d) => d.allowed)).toEqual([true, true, true, false]);
    expect(decisions.map((d) => d.remaining)).toEqual([2, 1, 0, 0]);
  });

  it('reports a retryAfterMs close to the window size on denial', async () => {
    await service.consume('general', 'user-1', 1, 60_000);
    const denied = await service.consume('general', 'user-1', 1, 60_000);

    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(59_000);
    expect(denied.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it('keeps identities independent — one user being limited does not affect another', async () => {
    await service.consume('general', 'user-1', 1, 60_000);
    const userOneSecond = await service.consume('general', 'user-1', 1, 60_000);
    const userTwoFirst = await service.consume('general', 'user-2', 1, 60_000);

    expect(userOneSecond.allowed).toBe(false);
    expect(userTwoFirst.allowed).toBe(true);
  });

  it('keeps scopes independent for the same identity — hitting the general limit does not touch the auth quota', async () => {
    await service.consume('general', '10.0.0.1', 1, 60_000);
    const generalSecond = await service.consume('general', '10.0.0.1', 1, 60_000);
    const authFirst = await service.consume('auth', '10.0.0.1', 5, 60_000);

    expect(generalSecond.allowed).toBe(false);
    expect(authFirst.allowed).toBe(true);
  });

  it('lets requests through again once the window has fully elapsed (true sliding, not a fixed bucket)', async () => {
    const realNow = Date.now;
    let simulatedNow = realNow();
    jest.spyOn(Date, 'now').mockImplementation(() => simulatedNow);

    try {
      await service.consume('general', 'user-3', 1, 1000);
      const immediatelyAfter = await service.consume('general', 'user-3', 1, 1000);
      expect(immediatelyAfter.allowed).toBe(false);

      simulatedNow += 1001;
      const afterWindow = await service.consume('general', 'user-3', 1, 1000);
      expect(afterWindow.allowed).toBe(true);
    } finally {
      jest.spyOn(Date, 'now').mockRestore();
    }
  });

  it('does not undercount two requests landing in the same millisecond (unique member per request)', async () => {
    const realNow = Date.now;
    jest.spyOn(Date, 'now').mockImplementation(() => 1_700_000_000_000);

    try {
      const first = await service.consume('general', 'user-4', 2, 60_000);
      const second = await service.consume('general', 'user-4', 2, 60_000);
      const third = await service.consume('general', 'user-4', 2, 60_000);

      expect([first.allowed, second.allowed, third.allowed]).toEqual([true, true, false]);
    } finally {
      jest.spyOn(Date, 'now').mockRestore();
    }
  });

  it('remains correct across many concurrent requests for the same identity (no lost updates)', async () => {
    const limit = 20;
    const results = await Promise.all(
      Array.from({ length: 50 }, () => service.consume('general', 'concurrent-user', limit, 60_000)),
    );

    const allowedCount = results.filter((r) => r.allowed).length;
    expect(allowedCount).toBe(limit);
  });

  it('fails open (allows the request) if Redis never responds, instead of hanging forever', async () => {
    // Every request passing through the gateway goes through consume() —
    // if Redis is unreachable or overloaded, that must degrade to "let
    // the request through" within a bounded time, not stall the entire
    // gateway indefinitely.
    jest.spyOn(mockRedis, 'slidingWindow').mockReturnValue(new Promise(() => {}));

    const decision = await service.consume('general', 'user-5', 5, 60_000);

    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(5);
  }, 10_000);
});
