import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { AppConfig } from '../config/configuration';

/** [allowed(0|1), remaining, retryAfterMs] — the shape SLIDING_WINDOW_LUA returns. */
type SlidingWindowResult = [number, number, number];

interface RedisWithSlidingWindow extends Redis {
  slidingWindow(key: string, now: number, windowMs: number, limit: number, member: string): Promise<SlidingWindowResult>;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Milliseconds until the caller should retry — 0 when allowed. */
  retryAfterMs: number;
}

/**
 * Sliding-window-log algorithm on a Redis ZSET, not a fixed/rolling
 * bucket: every accepted request's timestamp is a member of
 * `ratelimit:{scope}:{identity}`, scored by that timestamp. A check
 * prunes everything older than `now - windowMs`, counts what's left, and
 * only then decides — so "100 requests per 60s" means exactly that for
 * *any* 60-second window, not up to 200 across a fixed-bucket boundary
 * (the classic weakness of `Math.floor(now / windowMs)`-keyed limiters).
 *
 * The prune-count-and-maybe-add sequence runs as a single Lua script
 * (EVAL), not as separate ioredis calls, because this service runs
 * inside *two* gateway replicas (api-gateway-1/2) sharing one Redis. A
 * check-then-act sequence split across round-trips is a race: both
 * replicas could read "99 of 100 used" in the same instant and both
 * allow, breaching the limit. A Lua script is atomic on the Redis side
 * regardless of how many separate Node processes are calling it.
 */
@Injectable()
export class SlidingWindowRateLimiterService implements OnModuleDestroy {
  private static readonly REDIS_TIMEOUT_MS = 3000;

  private readonly logger = new Logger(SlidingWindowRateLimiterService.name);
  private readonly redis: RedisWithSlidingWindow;

  constructor(private readonly configService: ConfigService<AppConfig, true>) {
    this.redis = new Redis({
      host: this.configService.get('redis.host', { infer: true }),
      port: this.configService.get('redis.port', { infer: true }),
      password: this.configService.get('redis.password', { infer: true }),
    }) as RedisWithSlidingWindow;

    this.redis.defineCommand('slidingWindow', {
      numberOfKeys: 1,
      lua: SLIDING_WINDOW_LUA,
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.redis.disconnect();
  }

  /**
   * @param scope     Logical bucket, e.g. "auth" or "general" — same identity gets independent quotas per scope.
   * @param identity  userId if authenticated, IP address otherwise.
   */
  async consume(scope: string, identity: string, limit: number, windowMs: number): Promise<RateLimitDecision> {
    const key = `ratelimit:${scope}:${identity}`;
    const now = Date.now();
    // Unique member per request — Date.now() alone can collide when two
    // requests land in the same millisecond, which would silently
    // undercount (ZADD on an existing member just updates its score).
    const member = `${now}-${randomUUID()}`;

    try {
      const [allowed, remaining, retryAfterMs] = await this.withTimeout(
        this.redis.slidingWindow(key, now, windowMs, limit, member),
        SlidingWindowRateLimiterService.REDIS_TIMEOUT_MS,
      );

      if (!allowed) {
        this.logger.warn(`rate limit exceeded: scope=${scope} identity=${identity} limit=${limit}/${windowMs}ms`);
      }

      return { allowed: allowed === 1, limit, remaining, retryAfterMs };
    } catch (err) {
      // Every request passing through the gateway goes through this call
      // — a slow or unresponsive Redis must never turn into an indefinite
      // hang for the entire gateway. Fail open (let the request through)
      // and log loudly, so a real Redis problem gets noticed and fixed
      // rather than silently wedging every request behind it.
      this.logger.error(
        `rate limiter unavailable (scope=${scope} identity=${identity}): ${err instanceof Error ? err.message : String(err)} — failing open`,
      );
      return { allowed: true, limit, remaining: limit, retryAfterMs: 0 };
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Redis command timed out after ${ms}ms`)), ms);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err: unknown) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }
}

// KEYS[1] = rate limit key
// ARGV[1] = now (ms, integer)
// ARGV[2] = window (ms, integer)
// ARGV[3] = limit (integer)
// ARGV[4] = member (unique id for this request)
// returns { allowed(0|1), remaining, retryAfterMs }
// Exported (not just module-private) so the test suite can register the
// exact same script against a mock Redis, instead of a hand-copied
// duplicate that could silently drift from what ships in production.
export const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)

if count < limit then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, window)
  return { 1, limit - count - 1, 0 }
else
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retryAfterMs = window
  if oldest[2] ~= nil then
    retryAfterMs = (tonumber(oldest[2]) + window) - now
  end
  return { 0, 0, retryAfterMs }
end
`;
