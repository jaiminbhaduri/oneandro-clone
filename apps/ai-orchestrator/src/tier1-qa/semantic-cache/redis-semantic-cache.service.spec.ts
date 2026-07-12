import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RedisSemanticCacheService } from './redis-semantic-cache.service';

// Narrow hand-rolled fake covering only what RedisSemanticCacheService
// actually calls — same approach as the in-memory Prisma fakes used
// elsewhere in this monorepo, so the test never needs a live Redis.
class FakeRedis {
  private strings = new Map<string, string>();
  private zsets = new Map<string, Map<string, number>>();

  private zset(key: string): Map<string, number> {
    if (!this.zsets.has(key)) this.zsets.set(key, new Map());
    return this.zsets.get(key)!;
  }

  async zremrangebyscore(key: string, min: string | number, max: number): Promise<number> {
    const z = this.zset(key);
    let removed = 0;
    for (const [member, score] of z.entries()) {
      if (score <= max) {
        z.delete(member);
        removed++;
      }
    }
    return removed;
  }

  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    const entries = [...this.zset(key).entries()].sort((a, b) => b[1] - a[1]);
    const end = stop === -1 ? entries.length : stop + 1;
    return entries.slice(start, end).map(([member]) => member);
  }

  async mget(...keys: string[]): Promise<(string | null)[]> {
    return keys.map((k) => this.strings.get(k) ?? null);
  }

  async zrem(key: string, ...members: string[]): Promise<number> {
    const z = this.zset(key);
    let removed = 0;
    for (const m of members) {
      if (z.delete(m)) removed++;
    }
    return removed;
  }

  multi() {
    const ops: Array<() => void> = [];
    const chain = {
      set: (key: string, value: string, _ex: string, _seconds: number) => {
        ops.push(() => this.strings.set(key, value));
        return chain;
      },
      zadd: (key: string, score: number, member: string) => {
        ops.push(() => this.zset(key).set(member, score));
        return chain;
      },
      exec: async () => {
        ops.forEach((op) => op());
        return [];
      },
    };
    return chain;
  }

  disconnect(): void {}

  // Test-only helper to simulate a key expiring independently of the ZSET (real TTL behavior).
  expireEntry(key: string): void {
    this.strings.delete(key);
  }
}

describe('RedisSemanticCacheService', () => {
  let service: RedisSemanticCacheService;
  let fakeRedis: FakeRedis;

  const configValues: Record<string, unknown> = {
    'redis.host': 'redis',
    'redis.port': 6379,
    'redis.password': 'test',
    'semanticCache.ttlSeconds': 86400,
    'semanticCache.similarityThreshold': 0.9,
    'semanticCache.maxCandidates': 500,
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        RedisSemanticCacheService,
        { provide: ConfigService, useValue: { get: (key: string) => configValues[key] } },
      ],
    }).compile();

    service = moduleRef.get(RedisSemanticCacheService);

    // The constructor eagerly opens a real ioredis connection (matching
    // this service's production self-constructing pattern) — disconnect it
    // immediately and swap in the fake so the test never touches a real
    // socket and doesn't leak ioredis's background reconnect timers.
    const realRedis = (service as unknown as { redis: { disconnect: () => void } }).redis;
    realRedis.disconnect();
    fakeRedis = new FakeRedis();
    (service as unknown as { redis: FakeRedis }).redis = fakeRedis;
  });

  it('returns null on a lookup against an empty namespace', async () => {
    await expect(service.lookup('policy-qa', [1, 0, 0])).resolves.toBeNull();
  });

  it('returns the cached answer for a near-identical embedding above the similarity threshold', async () => {
    await service.store('policy-qa', 'What counts as proof of income?', 'Pay stubs or W-2s.', [1, 0, 0]);

    const hit = await service.lookup('policy-qa', [1, 0.001, 0]);

    expect(hit).not.toBeNull();
    expect(hit!.answer).toBe('Pay stubs or W-2s.');
    expect(hit!.score).toBeGreaterThan(0.9);
  });

  it('misses when the best match is below the similarity threshold', async () => {
    await service.store('policy-qa', 'What counts as proof of income?', 'Pay stubs or W-2s.', [1, 0, 0]);

    // Orthogonal vector — cosine similarity 0.
    const hit = await service.lookup('policy-qa', [0, 1, 0]);

    expect(hit).toBeNull();
  });

  it('keeps namespaces isolated from each other', async () => {
    await service.store('policy-qa', 'q', 'answer-in-policy-qa', [1, 0, 0]);

    const hit = await service.lookup('other-namespace', [1, 0, 0]);

    expect(hit).toBeNull();
  });

  it('self-heals the index when an entry has expired but its id is still indexed', async () => {
    await service.store('policy-qa', 'q', 'a', [1, 0, 0]);

    // Simulate Redis's own TTL having already evicted the STRING key while
    // the ZSET member (which has no independent TTL) is still present.
    const indexKey = 'semcache:index:policy-qa';
    const [entryId] = await fakeRedis.zrevrange(indexKey, 0, -1);
    fakeRedis.expireEntry(`semcache:entry:policy-qa:${entryId}`);

    const hit = await service.lookup('policy-qa', [1, 0, 0]);
    expect(hit).toBeNull();

    // The stale id should have been removed from the index, not just skipped.
    const remaining = await fakeRedis.zrevrange(indexKey, 0, -1);
    expect(remaining).toHaveLength(0);
  });

  it('picks the single best match among multiple candidates', async () => {
    await service.store('policy-qa', 'q1', 'answer-for-q1', [1, 0, 0]);
    await service.store('policy-qa', 'q2', 'answer-for-q2', [0, 1, 0]);
    await service.store('policy-qa', 'q3', 'answer-for-q3', [0, 0, 1]);

    const hit = await service.lookup('policy-qa', [0, 0.999, 0.001]);

    expect(hit!.answer).toBe('answer-for-q2');
  });
});
