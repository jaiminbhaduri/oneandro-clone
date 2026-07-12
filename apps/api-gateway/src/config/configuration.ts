export interface AppConfig {
  env: string;
  port: number;
  serviceName: string;
  corsOrigins: string[];
  apiPrefix: string;
  jwt: {
    accessSecret: string;
  };
  redis: {
    host: string;
    port: number;
    password: string;
  };
  rateLimit: {
    windowMs: number;
    generalMaxRequests: number;
    authMaxRequests: number;
  };
  services: {
    userServiceUrl: string;
    leadServiceUrl: string;
    aiOrchestratorUrl: string;
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
  port: parseInt(process.env.PORT ?? '3000', 10),
  serviceName: process.env.SERVICE_NAME ?? 'api-gateway',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(','),
  // Nginx forwards the full incoming URI unchanged (see infra/nginx/conf.d/default.conf
  // — proxy_pass has no path component, so it never strips the location
  // prefix). Stripping /api/v1 is this service's job; keep this in sync
  // with the Nginx location blocks if either ever changes.
  apiPrefix: process.env.API_PREFIX ?? '/api/v1',
  jwt: {
    // Same shared secret every resource server verifies against. The
    // gateway never *issues* tokens — only user-service does that.
    accessSecret: required('JWT_ACCESS_SECRET'),
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'redis',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: required('REDIS_PASSWORD'),
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10),
    generalMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS ?? '100', 10),
    authMaxRequests: parseInt(process.env.RATE_LIMIT_AUTH_MAX_REQUESTS ?? '5', 10),
  },
  services: {
    // Each gateway replica is statically paired with one backend replica
    // in docker-compose.yml (api-gateway-1 -> user-service-1/lead-service-1,
    // api-gateway-2 -> ...-2) — load is spread across backend replicas by
    // Nginx's least_conn LB across gateway replicas, not by the gateway
    // doing its own client-side load balancing. A real deployment would
    // put a service-discovery/LB layer here instead of a static URL.
    userServiceUrl: required('USER_SERVICE_URL'),
    leadServiceUrl: required('LEAD_SERVICE_URL'),
    aiOrchestratorUrl: required('AI_ORCHESTRATOR_URL'),
  },
});
