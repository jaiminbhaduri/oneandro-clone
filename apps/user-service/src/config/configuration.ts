export interface AppConfig {
  env: string;
  port: number;
  serviceName: string;
  cookieDomain: string;
  corsOrigins: string[];
  swaggerEnabled: boolean;
  jwt: {
    accessSecret: string;
    accessTtl: string;
    refreshTtl: string;
  };
  database: {
    url: string;
  };
  kafka: {
    brokers: string[];
    clientId: string;
    leadStatusTopic: string;
    userEventsTopic: string;
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
  port: parseInt(process.env.PORT ?? '3001', 10),
  serviceName: process.env.SERVICE_NAME ?? 'user-service',
  cookieDomain: process.env.COOKIE_DOMAIN ?? 'localhost',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(','),
  swaggerEnabled: (process.env.SWAGGER_ENABLED ?? 'true') === 'true',
  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET'),
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
  },
  database: {
    url: required('DATABASE_URL'),
  },
  kafka: {
    brokers: (process.env.KAFKA_BROKER ?? 'kafka:9092').split(','),
    clientId: process.env.KAFKA_CLIENT_ID ?? 'user-service',
    leadStatusTopic: process.env.KAFKA_TOPIC_LEAD_STATUS_EVENTS ?? 'lead-status-events',
    userEventsTopic: process.env.KAFKA_TOPIC_USER_EVENTS ?? 'user-events',
  },
});
