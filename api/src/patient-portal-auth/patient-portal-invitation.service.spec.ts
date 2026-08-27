import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import type { PatientPortalSessionContext } from './patient-portal-auth.types.js';
import { PatientPortalInvitationRepository } from './patient-portal-invitation.repository.js';
import { PatientPortalInvitationService } from './patient-portal-invitation.service.js';

const onboardingSession: PatientPortalSessionContext = {
  sessionId: 'patient-session-id',
  principal: {
    issuer: 'https://identity.example.invalid/patient-pool',
    subject: 'patient-subject-123',
    clientId: 'patient-client-123',
  },
  patientPortalIdentityId: 'patient-identity-id',
  applicationUserId: 'patient-user-id',
  displayName: 'Synthetic Patient',
  context: { kind: 'onboarding' },
  availablePractices: [],
  appointmentOnboardingPractices: [],
  csrfToken: 'csrf-token',
  idleExpiresAt: new Date('2026-08-27T12:30:00.000Z'),
  absoluteExpiresAt: new Date('2026-08-27T20:00:00.000Z'),
  renewed: false,
};

function createService() {
  const issue = jest.fn().mockResolvedValue({
    invitationId: 'invitation-id',
    expiresAt: new Date('2026-09-03T10:00:00.000Z'),
  });
  const accept = jest.fn().mockResolvedValue({
    portalProfileId: 'portal-profile-id',
    practiceName: 'Synthetic Practice',
  });
  const repository = {
    issue,
    accept,
    listContexts: jest.fn(),
  } as unknown as PatientPortalInvitationRepository;
  const config = {
    getOrThrow: (name: string) =>
      ({
        PATIENT_PORTAL_PUBLIC_URL: 'https://patient.uae-health.example',
        PATIENT_PORTAL_INVITATION_TTL_MINUTES: 10_080,
      })[name],
  } as ConfigService;

  return {
    service: new PatientPortalInvitationService(repository, config),
    issue,
    accept,
  };
}

describe('PatientPortalInvitationService', () => {
  it('accepts only a safe invitation reason code and never forwards free text', async () => {
    const { service, issue } = createService();

    await service.issue(
      { subject: 'workforce-subject', clientId: 'workforce-client' },
      {
        organizationId: '00000000-0000-4000-8000-000000000001',
        reason: 'patient-portal-onboarding',
      },
    );

    expect(issue).toHaveBeenCalledWith(
      'workforce-subject',
      '00000000-0000-4000-8000-000000000001',
      'patient-portal-onboarding',
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.any(Date),
    );
    await expect(
      service.issue(
        { subject: 'workforce-subject', clientId: 'workforce-client' },
        {
          organizationId: '00000000-0000-4000-8000-000000000001',
          reason: 'Patient mentioned private clinical details.',
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(issue).toHaveBeenCalledTimes(1);
  });

  it('requires the restricted onboarding context before invitation acceptance', async () => {
    const { service, accept } = createService();

    await expect(
      service.accept(
        {
          ...onboardingSession,
          context: {
            kind: 'practice',
            portalProfileId: 'existing-profile-id',
            practiceName: 'Existing Practice',
            tenantId: 'tenant-id',
            organizationId: 'organization-id',
          },
        },
        'a'.repeat(43),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(accept).not.toHaveBeenCalled();
  });

  it('returns the same generic unavailable response for a malformed token', async () => {
    const { service, accept } = createService();

    await expect(
      service.accept(onboardingSession, 'not-a-token'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(accept).not.toHaveBeenCalled();
  });
});
