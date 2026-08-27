import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import type { CreatePatientPortalProfileLink } from './patient-portal-auth.types.js';

@Injectable()
export class PatientPortalProfileLinkService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Internal persistence primitive only. Task 3.5b must authorize the
   * invitation or patient acceptance before calling it; no public controller
   * exposes this operation.
   */
  async createApprovedLink(
    command: CreatePatientPortalProfileLink,
  ): Promise<{ id: string }> {
    const reason = command.reason.trim();

    if (!reason) {
      throw new ConflictException('A portal-profile link reason is required.');
    }

    return this.database.client.transaction().execute(async (trx) => {
      const linkable = await trx
        .selectFrom('patient_portal_profiles as profile')
        .innerJoin(
          'patient_portal_identities as identity',
          'identity.application_user_id',
          'profile.application_user_id',
        )
        .select([
          'profile.id',
          'profile.tenant_id',
          'profile.organization_id',
          'profile.application_user_id',
          'identity.id as patient_portal_identity_id',
        ])
        .where('profile.id', '=', command.patientPortalProfileId)
        .where('profile.status', '=', 'active')
        .where('identity.id', '=', command.patientPortalIdentityId)
        .where('identity.status', '=', 'active')
        .whereRef(
          'profile.application_user_id',
          '=',
          'identity.application_user_id',
        )
        .executeTakeFirst();

      if (!linkable) {
        throw new NotFoundException(
          'An active matching portal profile and identity are required.',
        );
      }

      const existingLink = await trx
        .selectFrom('patient_portal_profile_links')
        .select('id')
        .where('patient_portal_profile_id', '=', command.patientPortalProfileId)
        .executeTakeFirst();

      if (existingLink) {
        throw new ConflictException('The portal profile is already linked.');
      }

      const link = await trx
        .insertInto('patient_portal_profile_links')
        .values({
          patient_portal_profile_id: command.patientPortalProfileId,
          patient_portal_identity_id: command.patientPortalIdentityId,
          status: 'active',
          linked_by_user_id: command.actorUserId,
          link_reason: reason,
          revoked_at: null,
          revoked_by_user_id: null,
          revocation_reason: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('audit_events')
        .values({
          actor_type: command.actorUserId ? 'user' : 'system',
          actor_identifier: command.actorUserId
            ? 'patient-portal-link-approver'
            : 'patient-portal-bootstrap',
          actor_user_id: command.actorUserId,
          effective_user_id: linkable.application_user_id,
          tenant_id: linkable.tenant_id,
          organization_id: linkable.organization_id,
          facility_id: null,
          action: 'identity.patient_portal_profile_linked',
          target_entity_type: 'patient_portal_profile_link',
          target_entity_id: link.id,
          outcome: 'success',
          correlation_id: command.correlationId,
          reason,
          before_data: null,
          after_data: {
            profileId: linkable.id,
            identityId: linkable.patient_portal_identity_id,
          },
        })
        .execute();

      return link;
    });
  }
}
