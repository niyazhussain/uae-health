import { validateEnvironment } from './validate-environment.js';

describe('validateEnvironment authentication', () => {
  it('defaults local authentication to disabled', () => {
    expect(validateEnvironment({})).toMatchObject({
      AUTH_MODE: 'disabled',
      PATIENT_AUTH_MODE: 'disabled',
      DEPLOYMENT_ENVIRONMENT: 'local',
      COGNITO_REGION: 'ap-south-1',
      COGNITO_USER_POOL_ID: '',
      COGNITO_USER_POOL_CLIENT_ID: '',
      PATIENT_COGNITO_USER_POOL_ID: '',
      PATIENT_COGNITO_USER_POOL_CLIENT_ID: '',
      CORS_ORIGIN: 'http://localhost:5173',
      WORKFORCE_CORS_ORIGIN: 'http://localhost:5173',
      PATIENT_CORS_ORIGIN: 'http://localhost:5173',
    });
  });

  it('requires Cognito pool and client configuration when enabled', () => {
    expect(() => validateEnvironment({ AUTH_MODE: 'cognito' })).toThrow(
      'COGNITO_USER_POOL_ID is required.',
    );
  });

  it('rejects a user pool outside the configured deployment region', () => {
    expect(() =>
      validateEnvironment({
        AUTH_MODE: 'cognito',
        DEPLOYMENT_ENVIRONMENT: 'development',
        COGNITO_REGION: 'ap-south-1',
        COGNITO_USER_POOL_ID: 'me-central-1_example',
        COGNITO_USER_POOL_CLIENT_ID: 'client-id',
      }),
    ).toThrow('COGNITO_USER_POOL_ID must belong to COGNITO_REGION.');
  });

  it('requires a separate configured patient pool when patient authentication is enabled', () => {
    expect(() => validateEnvironment({ PATIENT_AUTH_MODE: 'cognito' })).toThrow(
      'PATIENT_COGNITO_USER_POOL_ID is required.',
    );

    expect(() =>
      validateEnvironment({
        AUTH_MODE: 'cognito',
        PATIENT_AUTH_MODE: 'cognito',
        COGNITO_REGION: 'ap-south-1',
        COGNITO_USER_POOL_ID: 'ap-south-1_workforce',
        COGNITO_USER_POOL_CLIENT_ID: 'workforce-client',
        PATIENT_COGNITO_USER_POOL_ID: 'ap-south-1_workforce',
        PATIENT_COGNITO_USER_POOL_CLIENT_ID: 'patient-client',
      }),
    ).toThrow(
      'PATIENT_COGNITO_USER_POOL_ID must be separate from COGNITO_USER_POOL_ID.',
    );
  });

  it('accepts an independent patient pool in the configured region', () => {
    expect(
      validateEnvironment({
        PATIENT_AUTH_MODE: 'cognito',
        COGNITO_REGION: 'ap-south-1',
        PATIENT_COGNITO_USER_POOL_ID: 'ap-south-1_patient',
        PATIENT_COGNITO_USER_POOL_CLIENT_ID: 'patient-client',
      }),
    ).toMatchObject({
      PATIENT_AUTH_MODE: 'cognito',
      PATIENT_COGNITO_USER_POOL_ID: 'ap-south-1_patient',
    });
  });

  it('requires separate patient and workforce mutation origins outside local', () => {
    expect(() =>
      validateEnvironment({
        PATIENT_AUTH_MODE: 'cognito',
        DEPLOYMENT_ENVIRONMENT: 'staging',
        COGNITO_REGION: 'ap-south-1',
        PATIENT_COGNITO_USER_POOL_ID: 'ap-south-1_patient',
        PATIENT_COGNITO_USER_POOL_CLIENT_ID: 'patient-client',
        CORS_ORIGIN: 'https://stage.uae-health.com',
        WORKFORCE_CORS_ORIGIN: 'https://stage.uae-health.com',
        PATIENT_CORS_ORIGIN: 'https://stage.uae-health.com',
      }),
    ).toThrow(
      'WORKFORCE_CORS_ORIGIN and PATIENT_CORS_ORIGIN must be separate for staging and production.',
    );

    expect(
      validateEnvironment({
        PATIENT_AUTH_MODE: 'cognito',
        DEPLOYMENT_ENVIRONMENT: 'staging',
        COGNITO_REGION: 'ap-south-1',
        PATIENT_COGNITO_USER_POOL_ID: 'ap-south-1_patient',
        PATIENT_COGNITO_USER_POOL_CLIENT_ID: 'patient-client',
        CORS_ORIGIN:
          'https://stage.uae-health.com,https://patient.stage.uae-health.com',
        WORKFORCE_CORS_ORIGIN: 'https://stage.uae-health.com',
        PATIENT_CORS_ORIGIN: 'https://patient.stage.uae-health.com',
      }),
    ).toMatchObject({
      PATIENT_CORS_ORIGIN: 'https://patient.stage.uae-health.com',
    });
  });

  it('keeps public patient registration disabled unless local synthetic safeguards are configured', () => {
    expect(() =>
      validateEnvironment({
        PATIENT_PUBLIC_REGISTRATION_ENABLED: 'true',
      }),
    ).toThrow(
      'PATIENT_PUBLIC_REGISTRATION_ENABLED requires PATIENT_AUTH_MODE=cognito.',
    );

    expect(() =>
      validateEnvironment({
        PATIENT_AUTH_MODE: 'cognito',
        COGNITO_REGION: 'ap-south-1',
        PATIENT_COGNITO_USER_POOL_ID: 'ap-south-1_patient',
        PATIENT_COGNITO_USER_POOL_CLIENT_ID: 'patient-client',
        PATIENT_PUBLIC_REGISTRATION_ENABLED: 'true',
      }),
    ).toThrow(
      'PATIENT_REGISTRATION_EMAIL_HMAC_SECRET must be at least 32 characters',
    );

    expect(
      validateEnvironment({
        PATIENT_AUTH_MODE: 'cognito',
        COGNITO_REGION: 'ap-south-1',
        PATIENT_COGNITO_USER_POOL_ID: 'ap-south-1_patient',
        PATIENT_COGNITO_USER_POOL_CLIENT_ID: 'patient-client',
        PATIENT_PUBLIC_REGISTRATION_ENABLED: 'true',
        PATIENT_REGISTRATION_EMAIL_HMAC_SECRET:
          'synthetic-local-registration-hmac-secret',
        PATIENT_PORTAL_PUBLIC_URL: 'http://localhost:5173/patient-portal',
      }),
    ).toMatchObject({
      PATIENT_PUBLIC_REGISTRATION_ENABLED: 'true',
      PATIENT_PUBLIC_REGISTRATION_WINDOW_SECONDS: 900,
      PATIENT_PUBLIC_REGISTRATION_IP_LIMIT: 5,
      PATIENT_PUBLIC_REGISTRATION_EMAIL_LIMIT: 3,
    });
  });

  it('rejects public patient registration outside local synthetic QA', () => {
    expect(() =>
      validateEnvironment({
        PATIENT_AUTH_MODE: 'cognito',
        DEPLOYMENT_ENVIRONMENT: 'staging',
        COGNITO_REGION: 'ap-south-1',
        PATIENT_COGNITO_USER_POOL_ID: 'ap-south-1_patient',
        PATIENT_COGNITO_USER_POOL_CLIENT_ID: 'patient-client',
        CORS_ORIGIN:
          'https://stage.uae-health.com,https://patient.stage.uae-health.com',
        WORKFORCE_CORS_ORIGIN: 'https://stage.uae-health.com',
        PATIENT_CORS_ORIGIN: 'https://patient.stage.uae-health.com',
        PATIENT_PUBLIC_REGISTRATION_ENABLED: 'true',
        PATIENT_REGISTRATION_EMAIL_HMAC_SECRET:
          'synthetic-local-registration-hmac-secret',
        PATIENT_PORTAL_PUBLIC_URL: 'https://patient.stage.uae-health.com',
      }),
    ).toThrow(
      'PATIENT_PUBLIC_REGISTRATION_ENABLED is limited to local synthetic QA until public-edge abuse controls, trusted-proxy ingress, and the API workload IAM attachment are approved.',
    );
  });

  it('requires the UAE Cognito region for production', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        AUTH_MODE: 'cognito',
        DEPLOYMENT_ENVIRONMENT: 'production',
        COGNITO_REGION: 'ap-south-1',
        COGNITO_USER_POOL_ID: 'ap-south-1_example',
        COGNITO_USER_POOL_CLIENT_ID: 'client-id',
      }),
    ).toThrow('COGNITO_REGION must be me-central-1 for production.');
  });

  it('accepts the Mumbai Cognito region for staging', () => {
    expect(
      validateEnvironment({
        NODE_ENV: 'production',
        AUTH_MODE: 'cognito',
        DEPLOYMENT_ENVIRONMENT: 'staging',
        COGNITO_REGION: 'ap-south-1',
        COGNITO_USER_POOL_ID: 'ap-south-1_example',
        COGNITO_USER_POOL_CLIENT_ID: 'client-id',
      }),
    ).toMatchObject({
      DEPLOYMENT_ENVIRONMENT: 'staging',
      COGNITO_REGION: 'ap-south-1',
    });
  });

  it('allows an explicit synthetic administrator binding outside production', () => {
    expect(
      validateEnvironment({
        DEPLOYMENT_ENVIRONMENT: 'staging',
        SYNTHETIC_ADMIN_COGNITO_SUBJECT: 'synthetic-admin-subject',
      }),
    ).toMatchObject({
      SYNTHETIC_ADMIN_COGNITO_SUBJECT: 'synthetic-admin-subject',
    });
  });

  it('prohibits a synthetic administrator binding in production', () => {
    expect(() =>
      validateEnvironment({
        DEPLOYMENT_ENVIRONMENT: 'production',
        SYNTHETIC_ADMIN_COGNITO_SUBJECT: 'must-not-be-used',
      }),
    ).toThrow('SYNTHETIC_ADMIN_COGNITO_SUBJECT is prohibited in production.');
  });

  it('configures a bounded local workforce session by default', () => {
    expect(validateEnvironment({})).toMatchObject({
      SESSION_COOKIE_SECURE: 'false',
      SESSION_IDLE_MINUTES: 30,
      SESSION_ABSOLUTE_MINUTES: 480,
      SESSION_RENEWAL_MINUTES: 5,
    });
  });

  it('requires secure workforce cookies in staging', () => {
    expect(() =>
      validateEnvironment({
        AUTH_MODE: 'cognito',
        DEPLOYMENT_ENVIRONMENT: 'staging',
        COGNITO_REGION: 'ap-south-1',
        COGNITO_USER_POOL_ID: 'ap-south-1_example',
        COGNITO_USER_POOL_CLIENT_ID: 'client-id',
        SESSION_COOKIE_SECURE: 'false',
      }),
    ).toThrow('SESSION_COOKIE_SECURE must be true for staging and production.');
  });
});
