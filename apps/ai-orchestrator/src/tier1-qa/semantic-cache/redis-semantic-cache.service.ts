import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { AppConfig } from '../../config/configuration';

export interface SemanticCacheHit {
  answer: string;
  score: number;
  cachedAt: number;
}

interface CacheEntry {
  query: string;
  answer: string;
  embedding: number[];
  cachedAt: number;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Brute-force cosine-similarity semantic cache on plain Redis — the
 * docker-compose `redis` service is stock `redis:7.4-alpine`, with no
 * RediSearch/vector module. At Tier-1 policy-Q&A scale (hundreds of
 * distinct questions, not millions), scanning a capped, TTL-pruned
 * candidate set per namespace in application code is simpler and cheaper
 * than standing up a second Redis with a vector-search module. The
 * interface is narrow enough (`lookup`/`store`) that a RediSearch- or
 * pgvector-backed implementation could replace this later without
 * touching QaService.
 *
 * Storage shape per namespace (e.g. "policy-qa"):
 *   semcache:index:{namespace}            ZSET    member=entryId  score=cachedAt(ms)
 *   semcache:entry:{namespace}:{entryId}  STRING  JSON-encoded CacheEntry, EX ttlSeconds
 *
 * The ZSET score doubles as the TTL window: `lookup()` prunes anything
 * older than `ttlSeconds` from the index before scanning candidates, and
 * self-heals the index if it finds an id whose entry already expired
 * (Redis key TTL doesn't clean up ZSET membership on its own).
 */
@Injectable()
export class RedisSemanticCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisSemanticCacheService.name);
  private readonly redis: Redis;
  private readonly ttlSeconds: number;
  private readonly similarityThreshold: number;
  private readonly maxCandidates: number;

  constructor(configService: ConfigService<AppConfig, true>) {
    this.redis = new Redis({
      host: configService.get('redis.host', { infer: true }),
      port: configService.get('redis.port', { infer: true }),
      password: configService.get('redis.password', { infer: true }),
    });
    this.ttlSeconds = configService.get('semanticCache.ttlSeconds', { infer: true });
    this.similarityThreshold = configService.get('semanticCache.similarityThreshold', { infer: true });
    this.maxCandidates = configService.get('semanticCache.maxCandidates', { infer: true });
  }

  async onModuleDestroy(): Promise<void> {
    this.redis.disconnect();
  }

  private indexKey(namespace: string): string {
    return `semcache:index:${namespace}`;
  }

  private entryKey(namespace: string, id: string): string {
    return `semcache:entry:${namespace}:${id}`;
  }

  /** Returns the best cached answer for a semantically-similar prior query, or null on a miss. */
  async lookup(namespace: string, queryEmbedding: number[]): Promise<SemanticCacheHit | null> {
    const indexKey = this.indexKey(namespace);
    const cutoff = Date.now() - this.ttlSeconds * 1000;

    await this.redis.zremrangebyscore(indexKey, '-inf', cutoff);

    const candidateIds = await this.redis.zrevrange(indexKey, 0, this.maxCandidates - 1);
    if (candidateIds.length === 0) return null;

    const raw = await this.redis.mget(...candidateIds.map((id) => this.entryKey(namespace, id)));

    let best: { entry: CacheEntry; score: number } | null = null;
    const staleIds: string[] = [];

    raw.forEach((json, i) => {
      if (!json) {
        staleIds.push(candidateIds[i]); // TTL beat us to it — self-heal the index below.
        return;
      }
      const entry = JSON.parse(json) as CacheEntry;
      const score = cosineSimilarity(queryEmbedding, entry.embedding);
      if (!best || score > best.score) {
        best = { entry, score };
      }
    });

    if (staleIds.length > 0) {
      await this.redis.zrem(indexKey, ...staleIds);
    }

    if (!best) return null;
    const winner = best as { entry: CacheEntry; score: number };

    if (winner.score < this.similarityThreshold) {
      this.logger.debug(`semantic cache miss in "${namespace}" (best score ${winner.score.toFixed(3)})`);
      return null;
    }

    this.logger.log(`semantic cache HIT in "${namespace}" (score ${winner.score.toFixed(3)}) — bypassing LLM call`);
    return { answer: winner.entry.answer, score: winner.score, cachedAt: winner.entry.cachedAt };
  }

  async store(namespace: string, query: string, answer: string, embedding: number[]): Promise<void> {
    const id = randomUUID();
    const entry: CacheEntry = { query, answer, embedding, cachedAt: Date.now() };

    await this.redis
      .multi()
      .set(this.entryKey(namespace, id), JSON.stringify(entry), 'EX', this.ttlSeconds)
      .zadd(this.indexKey(namespace), entry.cachedAt, id)
      .exec();
  }
}
