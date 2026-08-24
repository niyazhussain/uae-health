import { validateEnvironment } from './validate-environment.js';

describe('validateEnvironment authentication', () => {
  it('defaults local authentication to disabled', () => {
    expect(validateEnvironment({})).toMatchObject({
      AUTH_MODE: 'disabled',
      DEPLOYMENT_ENVIRONMENT: 'local',
      COGNITO_REGION: 'ap-south-1',
      COGNITO_USER_POOL_ID: '',
      COGNITO_USER_POOL_CLIENT_ID: '',
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
});
