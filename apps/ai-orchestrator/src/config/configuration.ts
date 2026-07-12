export interface AppConfig {
  env: string;
  port: number;
  serviceName: string;
  corsOrigins: string[];
  swaggerEnabled: boolean;
  jwt: {
    accessSecret: string;
  };
  database: {
    url: string;
  };
  redis: {
    host: string;
    port: number;
    password: string;
  };
  openai: {
    apiKey: string;
    chatModel: string;
    embeddingModel: string;
  };
  cohere: {
    apiKey: string;
    rerankModel: string;
  };
  langsmith: {
    tracingEnabled: boolean;
    apiKey?: string;
    project: string;
    endpoint?: string;
  };
  semanticCache: {
    ttlSeconds: number;
    similarityThreshold: number;
    maxCandidates: number;
  };
  services: {
    leadServiceUrl: string;
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export default (): AppConfig => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3003', 10),
  serviceName: process.env.SERVICE_NAME ?? 'ai-orchestrator',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(','),
  swaggerEnabled: (process.env.SWAGGER_ENABLED ?? 'true') === 'true',
  jwt: {
    // Same resource-server pattern as lead-service: verify signature +
    // expiry against the shared secret, trust the claims, no DB round-trip.
    accessSecret: required('JWT_ACCESS_SECRET'),
  },
  database: {
    url: required('DATABASE_URL'),
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'redis',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: required('REDIS_PASSWORD'),
  },
  openai: {
    apiKey: required('OPENAI_API_KEY'),
    chatModel: process.env.OPENAI_CHAT_MODEL ?? 'gpt-4o-mini',
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small',
  },
  cohere: {
    apiKey: required('COHERE_API_KEY'),
    rerankModel: process.env.COHERE_RERANK_MODEL ?? 'rerank-v3.5',
  },
  langsmith: {
    tracingEnabled: (process.env.LANGCHAIN_TRACING_V2 ?? 'false') === 'true',
    apiKey: process.env.LANGCHAIN_API_KEY,
    project: process.env.LANGCHAIN_PROJECT ?? 'oneandro-clone-dev',
    endpoint: process.env.LANGCHAIN_ENDPOINT,
  },
  semanticCache: {
    ttlSeconds: parseInt(process.env.SEMANTIC_CACHE_TTL_SECONDS ?? String(24 * 60 * 60), 10),
    similarityThreshold: parseFloat(process.env.SEMANTIC_CACHE_SIMILARITY_THRESHOLD ?? '0.92'),
    maxCandidates: parseInt(process.env.SEMANTIC_CACHE_MAX_CANDIDATES ?? '500', 10),
  },
  services: {
    leadServiceUrl: process.env.LEAD_SERVICE_URL ?? 'http://lead-service-1:3002',
  },
});
