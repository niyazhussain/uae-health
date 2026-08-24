const validNodeEnvironments = new Set(['development', 'test', 'production']);
const validAuthModes = new Set(['disabled', 'cognito']);
const cognitoRegionByDeploymentEnvironment = {
  local: 'ap-south-1',
  development: 'ap-south-1',
  staging: 'ap-south-1',
  production: 'me-central-1',
} as const;

type DeploymentEnvironment = keyof typeof cognitoRegionByDeploymentEnvironment;

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

function readRequiredString(value: unknown, name: string): string {
  const parsed = readString(value, '', name).trim();

  if (parsed.length === 0) {
    throw new Error(`${name} is required.`);
  }

  return parsed;
}

export function validateEnvironment(
  environment: Record<string, unknown>,
): Record<string, unknown> {
  const nodeEnv = readString(environment.NODE_ENV, 'development', 'NODE_ENV');

  if (!validNodeEnvironments.has(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production.');
  }

  const authMode = readString(environment.AUTH_MODE, 'disabled', 'AUTH_MODE');

  if (!validAuthModes.has(authMode)) {
    throw new Error('AUTH_MODE must be disabled or cognito.');
  }

  const defaultDeploymentEnvironment =
    nodeEnv === 'production' ? 'production' : 'local';
  const deploymentEnvironment = readString(
    environment.DEPLOYMENT_ENVIRONMENT,
    defaultDeploymentEnvironment,
    'DEPLOYMENT_ENVIRONMENT',
  );

  if (!(deploymentEnvironment in cognitoRegionByDeploymentEnvironment)) {
    throw new Error(
      'DEPLOYMENT_ENVIRONMENT must be local, development, staging, or production.',
    );
  }

  const expectedCognitoRegion =
    cognitoRegionByDeploymentEnvironment[
      deploymentEnvironment as DeploymentEnvironment
    ];
  const cognitoRegion = readString(
    environment.COGNITO_REGION,
    expectedCognitoRegion,
    'COGNITO_REGION',
  );
  const cognitoUserPoolId =
    authMode === 'cognito'
      ? readRequiredString(
          environment.COGNITO_USER_POOL_ID,
          'COGNITO_USER_POOL_ID',
        )
      : readString(
          environment.COGNITO_USER_POOL_ID,
          '',
          'COGNITO_USER_POOL_ID',
        );
  const cognitoUserPoolClientId =
    authMode === 'cognito'
      ? readRequiredString(
          environment.COGNITO_USER_POOL_CLIENT_ID,
          'COGNITO_USER_POOL_CLIENT_ID',
        )
      : readString(
          environment.COGNITO_USER_POOL_CLIENT_ID,
          '',
          'COGNITO_USER_POOL_CLIENT_ID',
        );

  if (authMode === 'cognito') {
    if (cognitoRegion !== expectedCognitoRegion) {
      throw new Error(
        `COGNITO_REGION must be ${expectedCognitoRegion} for ${deploymentEnvironment}.`,
      );
    }

    if (!cognitoUserPoolId.startsWith(`${cognitoRegion}_`)) {
      throw new Error('COGNITO_USER_POOL_ID must belong to COGNITO_REGION.');
    }
  }

  const port = readPositiveInteger(environment.PORT ?? 3000, 'PORT');
  const syntheticAdminCognitoSubject = readString(
    environment.SYNTHETIC_ADMIN_COGNITO_SUBJECT,
    '',
    'SYNTHETIC_ADMIN_COGNITO_SUBJECT',
  ).trim();

  if (deploymentEnvironment === 'production' && syntheticAdminCognitoSubject) {
    throw new Error(
      'SYNTHETIC_ADMIN_COGNITO_SUBJECT is prohibited in production.',
    );
  }

  if (port > 65535) {
    throw new Error('PORT must be at most 65535.');
  }

  const sessionCookieSecure = readBooleanString(
    environment.SESSION_COOKIE_SECURE,
    deploymentEnvironment === 'staging' ||
      deploymentEnvironment === 'production'
      ? 'true'
      : 'false',
    'SESSION_COOKIE_SECURE',
  );
  const sessionIdleMinutes = readPositiveInteger(
    environment.SESSION_IDLE_MINUTES ?? 15,
    'SESSION_IDLE_MINUTES',
  );
  const sessionAbsoluteMinutes = readPositiveInteger(
    environment.SESSION_ABSOLUTE_MINUTES ?? 480,
    'SESSION_ABSOLUTE_MINUTES',
  );
  const sessionRenewalMinutes = readPositiveInteger(
    environment.SESSION_RENEWAL_MINUTES ?? 5,
    'SESSION_RENEWAL_MINUTES',
  );

  if (
    (deploymentEnvironment === 'staging' ||
      deploymentEnvironment === 'production') &&
    sessionCookieSecure !== 'true'
  ) {
    throw new Error(
      'SESSION_COOKIE_SECURE must be true for staging and production.',
    );
  }

  if (sessionAbsoluteMinutes < sessionIdleMinutes) {
    throw new Error(
      'SESSION_ABSOLUTE_MINUTES must be at least SESSION_IDLE_MINUTES.',
    );
  }

  if (sessionRenewalMinutes >= sessionIdleMinutes) {
    throw new Error(
      'SESSION_RENEWAL_MINUTES must be less than SESSION_IDLE_MINUTES.',
    );
  }

  return {
    ...environment,
    NODE_ENV: nodeEnv,
    PORT: port,
    AUTH_MODE: authMode,
    DEPLOYMENT_ENVIRONMENT: deploymentEnvironment,
    COGNITO_REGION: cognitoRegion,
    COGNITO_USER_POOL_ID: cognitoUserPoolId,
    COGNITO_USER_POOL_CLIENT_ID: cognitoUserPoolClientId,
    SYNTHETIC_ADMIN_COGNITO_SUBJECT: syntheticAdminCognitoSubject,
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
    SESSION_COOKIE_SECURE: sessionCookieSecure,
    SESSION_IDLE_MINUTES: sessionIdleMinutes,
    SESSION_ABSOLUTE_MINUTES: sessionAbsoluteMinutes,
    SESSION_RENEWAL_MINUTES: sessionRenewalMinutes,
    ALLOW_SYNTHETIC_SEED: readBooleanString(
      environment.ALLOW_SYNTHETIC_SEED,
      'false',
      'ALLOW_SYNTHETIC_SEED',
    ),
  };
}
