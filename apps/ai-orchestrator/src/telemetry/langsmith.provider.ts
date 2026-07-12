import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'langsmith';
import type { RunnableConfig } from '@langchain/core/runnables';
import { AppConfig } from '../config/configuration';

export type Tier = 'tier1-qa' | 'tier2-underwriting';

export interface TraceContext {
  tier: Tier;
  leadId?: string;
  userId?: string;
  cacheHit?: boolean;
}

/**
 * Thin wrapper around the ambient LangSmith env-var wiring
 * (LANGCHAIN_TRACING_V2 / LANGCHAIN_API_KEY / LANGCHAIN_PROJECT /
 * LANGCHAIN_ENDPOINT). LangChain's global tracer already auto-attaches to
 * every `.invoke()` call once those env vars are set — this class adds the
 * two things ambient env vars alone don't give you:
 *
 *   1. Fail-fast/loud config validation at boot (a silently-untraced
 *      production run is a worse failure mode than a boot-time warning).
 *   2. A single place (`traceConfig`) that stamps consistent tags/metadata
 *      — tier, leadId, userId, cache outcome — onto every run, so LangSmith
 *      can actually be sliced by those dimensions for cost/latency
 *      auditing instead of showing an undifferentiated stream of calls.
 */
@Injectable()
export class LangSmithService implements OnModuleInit {
  private readonly logger = new Logger(LangSmithService.name);
  private client?: Client;
  readonly tracingEnabled: boolean;

  constructor(private readonly configService: ConfigService<AppConfig, true>) {
    this.tracingEnabled = this.configService.get('langsmith.tracingEnabled', { infer: true });
  }

  onModuleInit(): void {
    if (!this.tracingEnabled) {
      this.logger.warn('LangSmith tracing disabled (LANGCHAIN_TRACING_V2 != "true") — runs will not be traced');
      return;
    }

    const apiKey = this.configService.get('langsmith.apiKey', { infer: true });
    if (!apiKey) {
      this.logger.warn(
        'LANGCHAIN_TRACING_V2=true but LANGCHAIN_API_KEY is unset — the LangChain global tracer will fail ' +
          'to authenticate and silently drop traces. Set LANGCHAIN_API_KEY or disable tracing.',
      );
    }

    this.client = new Client({
      apiKey,
      apiUrl: this.configService.get('langsmith.endpoint', { infer: true }),
    });

    this.logger.log(
      `LangSmith tracing enabled for project "${this.configService.get('langsmith.project', { infer: true })}"`,
    );
  }

  /** Merges caller-supplied RunnableConfig overrides with standardized tags/metadata for the given trace context. */
  traceConfig(context: TraceContext, overrides: RunnableConfig = {}): RunnableConfig {
    return {
      ...overrides,
      runName: overrides.runName ?? this.runName(context),
      tags: [context.tier, ...(overrides.tags ?? [])],
      metadata: {
        service: 'ai-orchestrator',
        tier: context.tier,
        ...(context.leadId && { leadId: context.leadId }),
        ...(context.userId && { userId: context.userId }),
        ...(context.cacheHit !== undefined && { cacheHit: context.cacheHit }),
        ...overrides.metadata,
      },
    };
  }

  private runName(context: TraceContext): string {
    return context.leadId ? `${context.tier}:lead-${context.leadId}` : context.tier;
  }

  /** Escape hatch for callers that need the raw client (e.g. fetching run feedback/cost after the fact). */
  get underlyingClient(): Client | undefined {
    return this.client;
  }
}
