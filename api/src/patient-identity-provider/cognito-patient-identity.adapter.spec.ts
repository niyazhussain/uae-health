import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import { CognitoPatientIdentityAdapter } from './cognito-patient-identity.adapter.js';

function config(): ConfigService {
  const values: Record<string, string> = {
    PATIENT_AUTH_MODE: 'cognito',
    COGNITO_REGION: 'ap-south-1',
    PATIENT_COGNITO_USER_POOL_ID: 'ap-south-1_patient',
    PATIENT_COGNITO_USER_POOL_CLIENT_ID: 'patient-client-id',
  };
  return {
    getOrThrow: (name: string) => values[name],
  } as ConfigService;
}

describe('CognitoPatientIdentityAdapter', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates a patient account with email_verified and only provisioning data', async () => {
    const send = jest
      .spyOn(CognitoIdentityProviderClient.prototype, 'send')
      .mockResolvedValue({
        User: {
          Username: 'patient@example.invalid',
          Attributes: [
            { Name: 'sub', Value: 'patient-subject-123' },
            { Name: 'email', Value: 'patient@example.invalid' },
          ],
        },
      } as never);
    const adapter = new CognitoPatientIdentityAdapter(config());

    await expect(
      adapter.provisionAccount('patient@example.invalid', 'Synthetic Patient'),
    ).resolves.toEqual({
      kind: 'created',
      subject: 'patient-subject-123',
      externalAccountId: 'patient@example.invalid',
    });

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(AdminCreateUserCommand);
    const input = (command as AdminCreateUserCommand).input;
    expect(input).toMatchObject({
      UserPoolId: 'ap-south-1_patient',
      Username: 'patient@example.invalid',
      DesiredDeliveryMediums: ['EMAIL'],
    });
    expect(input.UserAttributes).toEqual(
      expect.arrayContaining([
        { Name: 'email', Value: 'patient@example.invalid' },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'name', Value: 'Synthetic Patient' },
      ]),
    );
  });

  it('uses only AdminDeleteUser for compensation', async () => {
    const send = jest
      .spyOn(CognitoIdentityProviderClient.prototype, 'send')
      .mockResolvedValue({} as never);
    const adapter = new CognitoPatientIdentityAdapter(config());

    await adapter.deleteAccount('patient-provider-username');

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(AdminDeleteUserCommand);
    expect((command as AdminDeleteUserCommand).input).toEqual({
      UserPoolId: 'ap-south-1_patient',
      Username: 'patient-provider-username',
    });
  });
});
