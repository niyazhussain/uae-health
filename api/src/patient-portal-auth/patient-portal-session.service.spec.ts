import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import type { DatabaseService } from '../database/database.service.js';
import { PatientPortalSessionService } from './patient-portal-session.service.js';

interface RetryHarness {
  withSerializableTransaction<T>(
    operation: string,
    work: () => Promise<T>,
  ): Promise<T>;
}

function config(): ConfigService {
  return {
    getOrThrow: (name: string) =>
      ({
        SESSION_IDLE_MINUTES: 30,
        SESSION_ABSOLUTE_MINUTES: 480,
        SESSION_RENEWAL_MINUTES: 5,
      })[name],
  } as ConfigService;
}

function retryableDatabaseError(code: '40001' | '40P01'): Error & {
  code: '40001' | '40P01';
} {
  return Object.assign(new Error('Synthetic transaction retry.'), { code });
}

function retryHarness(execute: () => Promise<unknown>): RetryHarness {
  const service = new PatientPortalSessionService(
    {
      client: {
        transaction: jest.fn(() => ({
          setIsolationLevel: jest.fn(() => ({ execute })),
        })),
      },
    } as unknown as DatabaseService,
    config(),
  );

  return service as unknown as RetryHarness;
}

describe('PatientPortalSessionService serializable context rotation', () => {
  it('retries transient serializable failures before returning the transaction outcome', async () => {
    const execute = jest
      .fn<() => Promise<string>>()
      .mockImplementationOnce(() =>
        Promise.reject(retryableDatabaseError('40001')),
      )
      .mockImplementationOnce(() =>
        Promise.reject(retryableDatabaseError('40P01')),
      )
      .mockResolvedValueOnce('rotated');
    const harness = retryHarness(execute);

    await expect(
      harness.withSerializableTransaction(
        'patient_portal_session_context_changed',
        () => Promise.resolve('rotated'),
      ),
    ).resolves.toBe('rotated');
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('returns a controlled retryable response after the bounded retry budget', async () => {
    const execute = jest
      .fn<() => Promise<string>>()
      .mockImplementation(() =>
        Promise.reject(retryableDatabaseError('40001')),
      );
    const harness = retryHarness(execute);

    await expect(
      harness.withSerializableTransaction(
        'patient_portal_appointment_context_changed',
        () => Promise.resolve('unreachable'),
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(execute).toHaveBeenCalledTimes(3);
  });
});
