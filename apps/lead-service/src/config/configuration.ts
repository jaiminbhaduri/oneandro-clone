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
  kafka: {
    brokers: string[];
    clientId: string;
    leadStatusTopic: string;
  };
  kyc: {
    storageDir: string;
    maxFileSizeBytes: number;
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
  port: parseInt(process.env.PORT ?? '3002', 10),
  serviceName: process.env.SERVICE_NAME ?? 'lead-service',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(','),
  swaggerEnabled: (process.env.SWAGGER_ENABLED ?? 'true') === 'true',
  jwt: {
    // Same secret user-service signs access tokens with. lead-service is a
    // pure resource server here: it verifies signature + expiry and trusts
    // the embedded {sub, email, role} claims — it does *not* re-check
    // account status against a users table it doesn't own. That's a
    // deliberate microservices trade-off (see docs/ARCHITECTURE.md): a
    // deactivated user stays valid until their access token naturally
    // expires (<=15m) rather than every service taking a synchronous
    // dependency on user-service for every request.
    accessSecret: required('JWT_ACCESS_SECRET'),
  },
  database: {
    url: required('DATABASE_URL'),
  },
  kafka: {
    brokers: (process.env.KAFKA_BROKER ?? 'kafka:9092').split(','),
    clientId: process.env.KAFKA_CLIENT_ID ?? 'lead-service',
    leadStatusTopic: process.env.KAFKA_TOPIC_LEAD_STATUS_EVENTS ?? 'lead-status-events',
  },
  kyc: {
    storageDir: process.env.KYC_STORAGE_DIR ?? '/app/storage/kyc',
    maxFileSizeBytes: parseInt(process.env.KYC_MAX_FILE_SIZE_BYTES ?? String(10 * 1024 * 1024), 10),
  },
});
