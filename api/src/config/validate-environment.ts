const validNodeEnvironments = new Set(['development', 'test', 'production']);

function readString(
  value: unknown,
  defaultValue: string,
  name: string,
): string {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string.`);
  }

  return value;
}

function readPositiveInteger(value: unknown, name: string): number {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

function readBooleanString(
  value: unknown,
  defaultValue: 'true' | 'false',
  name: string,
): 'true' | 'false' {
  const parsed = readString(value, defaultValue, name);

  if (parsed !== 'true' && parsed !== 'false') {
    throw new Error(`${name} must be true or false.`);
  }

  return parsed;
}

function readDatabaseUrl(value: unknown): string {
  const databaseUrl = readString(
    value,
    'postgresql://uae_health:local-development-only@127.0.0.1:5433/uae_health',
    'DATABASE_URL',
  );
  const parsed = new URL(databaseUrl);

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error(
      'DATABASE_URL must use the postgres or postgresql protocol.',
    );
  }

  return databaseUrl;
}

export function validateEnvironment(
  environment: Record<string, unknown>,
): Record<string, unknown> {
  const nodeEnv = readString(environment.NODE_ENV, 'development', 'NODE_ENV');

  if (!validNodeEnvironments.has(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production.');
  }

  const port = readPositiveInteger(environment.PORT ?? 3000, 'PORT');

  if (port > 65535) {
    throw new Error('PORT must be at most 65535.');
  }

  return {
    ...environment,
    NODE_ENV: nodeEnv,
    PORT: port,
    CORS_ORIGIN: readString(
      environment.CORS_ORIGIN,
      'http://localhost:5173',
      'CORS_ORIGIN',
    ),
    ENABLE_API_DOCS: readBooleanString(
      environment.ENABLE_API_DOCS,
      nodeEnv === 'production' ? 'false' : 'true',
      'ENABLE_API_DOCS',
    ),
    THROTTLE_TTL: readPositiveInteger(
      environment.THROTTLE_TTL ?? 60000,
      'THROTTLE_TTL',
    ),
    THROTTLE_LIMIT: readPositiveInteger(
      environment.THROTTLE_LIMIT ?? 120,
      'THROTTLE_LIMIT',
    ),
    DATABASE_URL: readDatabaseUrl(environment.DATABASE_URL),
    DATABASE_MAX_CONNECTIONS: readPositiveInteger(
      environment.DATABASE_MAX_CONNECTIONS ?? 5,
      'DATABASE_MAX_CONNECTIONS',
    ),
    DATABASE_SSL: readBooleanString(
      environment.DATABASE_SSL,
      'false',
      'DATABASE_SSL',
    ),
    ALLOW_SYNTHETIC_SEED: readBooleanString(
      environment.ALLOW_SYNTHETIC_SEED,
      'false',
      'ALLOW_SYNTHETIC_SEED',
    ),
  };
}
