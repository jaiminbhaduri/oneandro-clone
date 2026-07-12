export interface AppConfig {
  env: string;
  port: number;
  serviceName: string;
  jwt: {
    accessSecret: string;
  };
  kafka: {
    brokers: string[];
    clientId: string;
    leadStatusTopic: string;
  };
  services: {
    userServiceUrl: string;
    leadServiceUrl: string;
  };
  smtp: {
    host: string;
    port: number;
    fromAddress: string;
  };
  handoff: {
    minDelayMs: number;
    maxDelayMs: number;
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
  port: parseInt(process.env.PORT ?? '3004', 10),
  serviceName: process.env.SERVICE_NAME ?? 'banking-adapter-mock',
  jwt: {
    // Signs its own short-lived SYSTEM-role tokens with this — see
    // auth/service-token.service.ts — rather than forwarding a caller's
    // token, because there is no caller: this service only ever acts from
    // a Kafka consumer, never from an inbound HTTP request.
    accessSecret: required('JWT_ACCESS_SECRET'),
  },
  kafka: {
    brokers: (process.env.KAFKA_BROKER ?? 'kafka:9092').split(','),
    clientId: process.env.KAFKA_CLIENT_ID ?? 'banking-adapter-mock',
    leadStatusTopic: process.env.KAFKA_TOPIC_LEAD_STATUS_EVENTS ?? 'lead-status-events',
  },
  services: {
    userServiceUrl: required('USER_SERVICE_URL'),
    leadServiceUrl: required('LEAD_SERVICE_URL'),
  },
  smtp: {
    host: process.env.SMTP_HOST ?? 'mailhog',
    port: parseInt(process.env.SMTP_PORT ?? '1025', 10),
    fromAddress: process.env.SMTP_FROM_ADDRESS ?? 'notifications@oneandro.local',
  },
  handoff: {
    minDelayMs: parseInt(process.env.HANDOFF_MIN_DELAY_MS ?? '3000', 10),
    maxDelayMs: parseInt(process.env.HANDOFF_MAX_DELAY_MS ?? '8000', 10),
  },
});
