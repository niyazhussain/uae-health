import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import type { PatientPortalSessionContext } from './patient-portal-auth.types.js';
import {
  PatientPortalInvitationAuthorizationLostError,
  PatientPortalInvitationRepository,
  PatientPortalInvitationUnavailableError,
  type PatientPortalInvitationContext,
} from './patient-portal-invitation.repository.js';
import { isPatientPortalInvitationReasonCode } from './patient-portal-invitation-reasons.js';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

@Injectable()
export class PatientPortalInvitationService {
  private readonly publicUrl: string;
  private readonly invitationTtlMilliseconds: number;

  constructor(
    private readonly repository: PatientPortalInvitationRepository,
    config: ConfigService,
  ) {
    this.publicUrl = config
      .getOrThrow<string>('PATIENT_PORTAL_PUBLIC_URL')
      .replace(/\/$/, '');
    this.invitationTtlMilliseconds =
      config.getOrThrow<number>('PATIENT_PORTAL_INVITATION_TTL_MINUTES') *
      60_000;
  }

  listContexts(
    principal: AuthenticatedPrincipal,
  ): Promise<{ contexts: PatientPortalInvitationContext[] }> {
    return this.repository
      .listContexts(principal.subject)
      .then((contexts) => ({ contexts }));
  }

  async issue(
    principal: AuthenticatedPrincipal,
    input: { organizationId: string; reason: string },
  ): Promise<{ invitationUrl: string; expiresAt: string }> {
    const reasonCode = input.reason.trim().toLowerCase();

    if (!isPatientPortalInvitationReasonCode(reasonCode)) {
      throw new BadRequestException(
        'A supported patient portal invitation reason is required.',
      );
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.invitationTtlMilliseconds);

    try {
      await this.repository.issue(
        principal.subject,
        input.organizationId,
        reasonCode,
        sha256(token),
        expiresAt,
      );
    } catch (error) {
      if (error instanceof PatientPortalInvitationAuthorizationLostError) {
        throw new ForbiddenException(
          'Patient portal invitation is not permitted for this practice.',
        );
      }

      throw new ServiceUnavailableException(
        'The patient portal invitation could not be created.',
      );
    }

    return {
      invitationUrl: `${this.publicUrl}/invite#${token}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async accept(
    session: PatientPortalSessionContext,
    token: string,
  ): Promise<{
    accepted: true;
    portalProfileId: string;
    practiceName: string;
  }> {
    const normalizedToken = token.trim();

    // A patient must intentionally return to the restricted onboarding
    // context before establishing a new practice relationship. Do not rely
    // on the UI's context switch for this boundary.
    if (
      session.context.kind !== 'onboarding' ||
      normalizedToken.length < 40 ||
      normalizedToken.length > 512
    ) {
      throw new NotFoundException('This invitation is unavailable.');
    }

    try {
      const accepted = await this.repository.accept(
        session,
        sha256(normalizedToken),
      );
      return { accepted: true, ...accepted };
    } catch (error) {
      if (error instanceof PatientPortalInvitationUnavailableError) {
        throw new NotFoundException('This invitation is unavailable.');
      }

      throw new ServiceUnavailableException(
        'The patient portal invitation could not be accepted.',
      );
    }
  }
}
