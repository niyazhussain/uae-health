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

function parseOrigins(value: string, name: string): string[] {
  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    throw new Error(`${name} must contain at least one origin.`);
  }

  for (const origin of origins) {
    let parsed: URL;

    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`${name} must contain valid HTTP origins.`);
    }

    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.origin !== origin ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error(`${name} must contain exact HTTP origins.`);
    }
  }

  return origins;
}

function readPatientPortalPublicUrl(value: unknown): string {
  const configured = readString(
    value,
    'http://localhost:5173/patient-portal',
    'PATIENT_PORTAL_PUBLIC_URL',
  )
    .trim()
    .replace(/\/+$/, '');

  let parsed: URL;

  try {
    parsed = new URL(configured);
  } catch {
    throw new Error('PATIENT_PORTAL_PUBLIC_URL must be an exact HTTP URL.');
  }

  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.origin === 'null' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('PATIENT_PORTAL_PUBLIC_URL must be an exact HTTP URL.');
  }

  return configured;
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

  const patientAuthMode = readString(
    environment.PATIENT_AUTH_MODE,
    'disabled',
    'PATIENT_AUTH_MODE',
  );

  if (!validAuthModes.has(patientAuthMode)) {
    throw new Error('PATIENT_AUTH_MODE must be disabled or cognito.');
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

  const patientCognitoUserPoolId =
    patientAuthMode === 'cognito'
      ? readRequiredString(
          environment.PATIENT_COGNITO_USER_POOL_ID,
          'PATIENT_COGNITO_USER_POOL_ID',
        )
      : readString(
          environment.PATIENT_COGNITO_USER_POOL_ID,
          '',
          'PATIENT_COGNITO_USER_POOL_ID',
        );
  const patientCognitoUserPoolClientId =
    patientAuthMode === 'cognito'
      ? readRequiredString(
          environment.PATIENT_COGNITO_USER_POOL_CLIENT_ID,
          'PATIENT_COGNITO_USER_POOL_CLIENT_ID',
        )
      : readString(
          environment.PATIENT_COGNITO_USER_POOL_CLIENT_ID,
          '',
          'PATIENT_COGNITO_USER_POOL_CLIENT_ID',
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

  if (patientAuthMode === 'cognito') {
    if (cognitoRegion !== expectedCognitoRegion) {
      throw new Error(
        `COGNITO_REGION must be ${expectedCognitoRegion} for ${deploymentEnvironment}.`,
      );
    }

    if (!patientCognitoUserPoolId.startsWith(`${cognitoRegion}_`)) {
      throw new Error(
        'PATIENT_COGNITO_USER_POOL_ID must belong to COGNITO_REGION.',
      );
    }

    if (
      authMode === 'cognito' &&
      patientCognitoUserPoolId === cognitoUserPoolId
    ) {
      throw new Error(
        'PATIENT_COGNITO_USER_POOL_ID must be separate from COGNITO_USER_POOL_ID.',
      );
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
    environment.SESSION_IDLE_MINUTES ?? 30,
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

  const corsOrigin = readString(
    environment.CORS_ORIGIN,
    'http://localhost:5173',
    'CORS_ORIGIN',
  );
  const workforceCorsOrigin = readString(
    environment.WORKFORCE_CORS_ORIGIN,
    'http://localhost:5173',
    'WORKFORCE_CORS_ORIGIN',
  );
  const patientCorsOrigin = readString(
    environment.PATIENT_CORS_ORIGIN,
    'http://localhost:5173',
    'PATIENT_CORS_ORIGIN',
  );
  const transportOrigins = new Set(parseOrigins(corsOrigin, 'CORS_ORIGIN'));
  const workforceOrigins = parseOrigins(
    workforceCorsOrigin,
    'WORKFORCE_CORS_ORIGIN',
  );
  const patientOrigins = parseOrigins(patientCorsOrigin, 'PATIENT_CORS_ORIGIN');

  if (
    [...workforceOrigins, ...patientOrigins].some(
      (origin) => !transportOrigins.has(origin),
    )
  ) {
    throw new Error(
      'CORS_ORIGIN must include every workforce and patient session origin.',
    );
  }

  if (
    patientAuthMode === 'cognito' &&
    (deploymentEnvironment === 'staging' ||
      deploymentEnvironment === 'production') &&
    workforceOrigins.some((origin) => patientOrigins.includes(origin))
  ) {
    throw new Error(
      'WORKFORCE_CORS_ORIGIN and PATIENT_CORS_ORIGIN must be separate for staging and production.',
    );
  }

  const patientPublicRegistrationEnabled = readBooleanString(
    environment.PATIENT_PUBLIC_REGISTRATION_ENABLED,
    'false',
    'PATIENT_PUBLIC_REGISTRATION_ENABLED',
  );
  const patientRegistrationEmailHmacSecret = readString(
    environment.PATIENT_REGISTRATION_EMAIL_HMAC_SECRET,
    '',
    'PATIENT_REGISTRATION_EMAIL_HMAC_SECRET',
  );
  const patientPortalPublicUrl = readPatientPortalPublicUrl(
    environment.PATIENT_PORTAL_PUBLIC_URL,
  );
  const patientPublicRegistrationWindowSeconds = readPositiveInteger(
    environment.PATIENT_PUBLIC_REGISTRATION_WINDOW_SECONDS ?? 900,
    'PATIENT_PUBLIC_REGISTRATION_WINDOW_SECONDS',
  );
  const patientPublicRegistrationIpLimit = readPositiveInteger(
    environment.PATIENT_PUBLIC_REGISTRATION_IP_LIMIT ?? 5,
    'PATIENT_PUBLIC_REGISTRATION_IP_LIMIT',
  );
  const patientPublicRegistrationEmailLimit = readPositiveInteger(
    environment.PATIENT_PUBLIC_REGISTRATION_EMAIL_LIMIT ?? 3,
    'PATIENT_PUBLIC_REGISTRATION_EMAIL_LIMIT',
  );
  const patientPortalInvitationTtlMinutes = readPositiveInteger(
    environment.PATIENT_PORTAL_INVITATION_TTL_MINUTES ?? 10080,
    'PATIENT_PORTAL_INVITATION_TTL_MINUTES',
  );

  if (patientPublicRegistrationEnabled === 'true') {
    if (patientAuthMode !== 'cognito') {
      throw new Error(
        'PATIENT_PUBLIC_REGISTRATION_ENABLED requires PATIENT_AUTH_MODE=cognito.',
      );
    }

    if (patientRegistrationEmailHmacSecret.length < 32) {
      throw new Error(
        'PATIENT_REGISTRATION_EMAIL_HMAC_SECRET must be at least 32 characters when public patient registration is enabled.',
      );
    }

    const patientPortalPublicOrigin = new URL(patientPortalPublicUrl).origin;

    if (!patientOrigins.includes(patientPortalPublicOrigin)) {
      throw new Error(
        'PATIENT_PORTAL_PUBLIC_URL must use an allowed PATIENT_CORS_ORIGIN.',
      );
    }

    if (deploymentEnvironment !== 'local') {
      throw new Error(
        'PATIENT_PUBLIC_REGISTRATION_ENABLED is limited to local synthetic QA until public-edge abuse controls, trusted-proxy ingress, and the API workload IAM attachment are approved.',
      );
    }
  }

  return {
    ...environment,
    NODE_ENV: nodeEnv,
    PORT: port,
    AUTH_MODE: authMode,
    PATIENT_AUTH_MODE: patientAuthMode,
    DEPLOYMENT_ENVIRONMENT: deploymentEnvironment,
    COGNITO_REGION: cognitoRegion,
    COGNITO_USER_POOL_ID: cognitoUserPoolId,
    COGNITO_USER_POOL_CLIENT_ID: cognitoUserPoolClientId,
    PATIENT_COGNITO_USER_POOL_ID: patientCognitoUserPoolId,
    PATIENT_COGNITO_USER_POOL_CLIENT_ID: patientCognitoUserPoolClientId,
    PATIENT_PUBLIC_REGISTRATION_ENABLED: patientPublicRegistrationEnabled,
    PATIENT_REGISTRATION_EMAIL_HMAC_SECRET: patientRegistrationEmailHmacSecret,
    PATIENT_PORTAL_PUBLIC_URL: patientPortalPublicUrl,
    PATIENT_PUBLIC_REGISTRATION_WINDOW_SECONDS:
      patientPublicRegistrationWindowSeconds,
    PATIENT_PUBLIC_REGISTRATION_IP_LIMIT: patientPublicRegistrationIpLimit,
    PATIENT_PUBLIC_REGISTRATION_EMAIL_LIMIT:
      patientPublicRegistrationEmailLimit,
    PATIENT_PORTAL_INVITATION_TTL_MINUTES: patientPortalInvitationTtlMinutes,
    SYNTHETIC_ADMIN_COGNITO_SUBJECT: syntheticAdminCognitoSubject,
    CORS_ORIGIN: corsOrigin,
    WORKFORCE_CORS_ORIGIN: workforceCorsOrigin,
    PATIENT_CORS_ORIGIN: patientCorsOrigin,
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
