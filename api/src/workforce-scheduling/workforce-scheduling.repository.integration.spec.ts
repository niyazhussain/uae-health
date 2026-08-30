import { ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Kysely, sql } from 'kysely';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import { AuthorizationRepository } from '../authorization/authorization.repository.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { createDatabaseClient } from '../database/create-database-client.js';
import type { DatabaseService } from '../database/database.service.js';
import type { DatabaseSchema } from '../database/database.types.js';
import * as createFacilities from '../database/migrations/2026-08-23T000000_create_facilities.js';
import * as createIdentityAuthorizationAudit from '../database/migrations/2026-08-24T000000_create_identity_authorization_audit.js';
import * as createWorkforceSessions from '../database/migrations/2026-08-24T010000_create_workforce_sessions.js';
import * as addTenantLocalRoleNameUniqueness from '../database/migrations/2026-08-26T000000_add_tenant_local_role_name_uniqueness.js';
import * as addIdentityProviderSyncStatus from '../database/migrations/2026-08-26T010000_add_identity_provider_sync_status.js';
import * as createPatientPortalIdentity from '../database/migrations/2026-08-26T020000_create_patient_portal_identity.js';
import * as createPatientRegistrationAndInvitations from '../database/migrations/2026-08-27T000000_create_patient_registration_and_invitations.js';
import * as createPatientPortalAppointments from '../database/migrations/2026-08-27T010000_create_patient_portal_appointments.js';
import * as createPractitionerProfiles from '../database/migrations/2026-08-27T020000_create_practitioner_profiles.js';
import * as createProviderSchedulingCatalogue from '../database/migrations/2026-08-27T030000_create_provider_scheduling_catalogue.js';
import * as createProviderAvailability from '../database/migrations/2026-08-27T040000_create_provider_availability.js';
import * as backfillSyntheticProviderAppointments from '../database/migrations/2026-08-27T050000_backfill_synthetic_provider_appointments.js';
import * as createWorkforceSchedulingCommands from '../database/migrations/2026-08-27T060000_create_workforce_scheduling_commands.js';
import * as addDeferredSlotWithdrawal from '../database/migrations/2026-08-27T070000_add_deferred_slot_withdrawal.js';
import type { WorkforceIdentityProviderPort } from '../identity-provider/identity-provider.types.js';
import { PatientAppointmentsService } from '../patient-appointments/patient-appointments.service.js';
import type { PatientPortalSessionContext } from '../patient-portal-auth/patient-portal-auth.types.js';
import { WorkforceSchedulingRepository } from './workforce-scheduling.repository.js';
import {
  WorkforceSchedulingAuthorizationLostError,
  WorkforceSchedulingConflictError,
  WorkforceSchedulingPersistenceError,
  WorkforceSchedulingTargetUnavailableError,
} from './workforce-scheduling.types.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const providerIssuer = 'https://workforce-idp.example.invalid/scheduling-tests';
const schedulingFixtureLocalDate = new Date(Date.now() + 14 * 24 * 60 * 60_000)
  .toISOString()
  .slice(0, 10);
const schedulingFixtureIsoWeekday =
  ((new Date(`${schedulingFixtureLocalDate}T00:00:00.000Z`).getUTCDay() + 6) %
    7) +
  1;

function schedulingFixtureInstant(utcTime: string): Date {
  return new Date(`${schedulingFixtureLocalDate}T${utcTime}:00.000Z`);
}

const fixture = {
  tenantId: 'd1000000-0000-4000-8000-000000000001',
  groupId: 'd1100000-0000-4000-8000-000000000001',
  practiceAId: 'd1200000-0000-4000-8000-000000000001',
  practiceBId: 'd1200000-0000-4000-8000-000000000002',
  facilityA1Id: 'd1300000-0000-4000-8000-000000000001',
  facilityA2Id: 'd1300000-0000-4000-8000-000000000002',
  facilityB1Id: 'd1300000-0000-4000-8000-000000000003',
  identityConnectionId: 'd1400000-0000-4000-8000-000000000001',
  users: {
    organizationScheduler: {
      id: 'd1500000-0000-4000-8000-000000000001',
      identityId: 'd1510000-0000-4000-8000-000000000001',
      membershipId: 'd1520000-0000-4000-8000-000000000001',
      subject: 'synthetic-organization-scheduler',
    },
    facilityScheduler: {
      id: 'd1500000-0000-4000-8000-000000000002',
      identityId: 'd1510000-0000-4000-8000-000000000002',
      membershipId: 'd1520000-0000-4000-8000-000000000002',
      subject: 'synthetic-facility-scheduler',
    },
    physician: {
      id: 'd1500000-0000-4000-8000-000000000003',
      identityId: 'd1510000-0000-4000-8000-000000000003',
      membershipId: 'd1520000-0000-4000-8000-000000000003',
      subject: 'synthetic-physician-only',
    },
    siblingScheduler: {
      id: 'd1500000-0000-4000-8000-000000000004',
      identityId: 'd1510000-0000-4000-8000-000000000004',
      membershipId: 'd1520000-0000-4000-8000-000000000004',
      subject: 'synthetic-sibling-scheduler',
    },
    descendantScheduler: {
      id: 'd1500000-0000-4000-8000-000000000005',
      identityId: 'd1510000-0000-4000-8000-000000000005',
      membershipId: 'd1520000-0000-4000-8000-000000000005',
      subject: 'synthetic-descendant-scheduler',
    },
  },
  practitionerId: 'd1600000-0000-4000-8000-000000000001',
  facilityAssignmentA1Id: 'd1610000-0000-4000-8000-000000000001',
  facilityAssignmentA2Id: 'd1610000-0000-4000-8000-000000000002',
  facilityAssignmentB1Id: 'd1610000-0000-4000-8000-000000000003',
  specialtyAId: 'd1620000-0000-4000-8000-000000000001',
  specialtyBId: 'd1620000-0000-4000-8000-000000000002',
  serviceA1Id: 'd1630000-0000-4000-8000-000000000001',
  serviceA2Id: 'd1630000-0000-4000-8000-000000000002',
  serviceB1Id: 'd1630000-0000-4000-8000-000000000003',
  serviceAssignmentA1Id: 'd1640000-0000-4000-8000-000000000001',
  serviceAssignmentA2Id: 'd1640000-0000-4000-8000-000000000002',
  serviceAssignmentB1Id: 'd1640000-0000-4000-8000-000000000003',
  patient: {
    applicationUserId: 'd1700000-0000-4000-8000-000000000001',
    identityId: 'd1710000-0000-4000-8000-000000000001',
    relationshipAId: 'd1720000-0000-4000-8000-000000000001',
    relationshipBId: 'd1720000-0000-4000-8000-000000000002',
  },
  bookablePracticeAId: 'd1730000-0000-4000-8000-000000000001',
  bookablePracticeBId: 'd1730000-0000-4000-8000-000000000002',
  availabilityTemplateAId: 'd1740000-0000-4000-8000-000000000001',
  availabilityTemplateBId: 'd1740000-0000-4000-8000-000000000002',
  slots: {
    appointmentA: 'd1750000-0000-4000-8000-000000000001',
    availableA: 'd1750000-0000-4000-8000-000000000002',
    appointmentB: 'd1750000-0000-4000-8000-000000000003',
  },
  appointments: {
    practiceA: 'd1760000-0000-4000-8000-000000000001',
    practiceB: 'd1760000-0000-4000-8000-000000000002',
  },
} as const;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function principal(subject: string): AuthenticatedPrincipal {
  return { subject, clientId: 'synthetic-workforce-scheduling-client' };
}

function identityProvider(): WorkforceIdentityProviderPort {
  return {
    issuer: providerIssuer,
    protocol: 'oidc',
    provisionAccount: () => Promise.reject(new Error('Not used by this test.')),
    deleteAccount: () => Promise.reject(new Error('Not used by this test.')),
  };
}

async function migrateDatabase(
  database: Kysely<DatabaseSchema>,
): Promise<void> {
  await createFacilities.up(database);
  await createIdentityAuthorizationAudit.up(database);
  await createWorkforceSessions.up(database);
  await addTenantLocalRoleNameUniqueness.up(database);
  await addIdentityProviderSyncStatus.up(database);
  await createPatientPortalIdentity.up(database);
  await createPatientRegistrationAndInvitations.up(database);
  await createPatientPortalAppointments.up(database);
  await createPractitionerProfiles.up(database);
  await createProviderSchedulingCatalogue.up(database);
  await createProviderAvailability.up(database);
  await database
    .transaction()
    .execute((transaction) =>
      backfillSyntheticProviderAppointments.up(transaction),
    );
  await createWorkforceSchedulingCommands.up(database);
  await addDeferredSlotWithdrawal.up(database);
}

async function insertAuthorizationFixture(
  database: Kysely<DatabaseSchema>,
): Promise<void> {
  await database
    .insertInto('tenants')
    .values({
      id: fixture.tenantId,
      code: 'SCHEDULING-TEST',
      name: 'Synthetic Scheduling Test Tenant',
      status: 'active',
      is_synthetic: true,
    })
    .execute();
  await database
    .insertInto('organizations')
    .values([
      {
        id: fixture.groupId,
        tenant_id: fixture.tenantId,
        parent_organization_id: null,
        kind: 'group',
        code: 'SCHEDULING-GROUP',
        name: 'Synthetic Scheduling Group',
        is_synthetic: true,
      },
      {
        id: fixture.practiceAId,
        tenant_id: fixture.tenantId,
        parent_organization_id: fixture.groupId,
        kind: 'practice',
        code: 'SCHEDULING-A',
        name: 'Synthetic Scheduling Practice A',
        is_synthetic: true,
      },
      {
        id: fixture.practiceBId,
        tenant_id: fixture.tenantId,
        parent_organization_id: fixture.groupId,
        kind: 'practice',
        code: 'SCHEDULING-B',
        name: 'Synthetic Scheduling Practice B',
        is_synthetic: true,
      },
    ])
    .execute();
  await database
    .insertInto('facilities')
    .values([
      {
        id: fixture.facilityA1Id,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceAId,
        code: 'SCHEDULING-A1',
        name: 'Synthetic Practice A Facility One',
        timezone: 'Asia/Dubai',
        is_synthetic: true,
      },
      {
        id: fixture.facilityA2Id,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceAId,
        code: 'SCHEDULING-A2',
        name: 'Synthetic Practice A Facility Two',
        timezone: 'Asia/Dubai',
        is_synthetic: true,
      },
      {
        id: fixture.facilityB1Id,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceBId,
        code: 'SCHEDULING-B1',
        name: 'Synthetic Practice B Facility One',
        timezone: 'Asia/Dubai',
        is_synthetic: true,
      },
    ])
    .execute();

  const users = Object.values(fixture.users);
  await database
    .insertInto('application_users')
    .values(
      users.map((user, index) => ({
        id: user.id,
        display_name: `Synthetic scheduling actor ${index + 1}`,
        primary_email: `scheduling-actor-${index + 1}@example.invalid`,
        status: 'active' as const,
        is_synthetic: true,
      })),
    )
    .execute();
  await database
    .insertInto('identity_connections')
    .values({
      id: fixture.identityConnectionId,
      tenant_id: fixture.tenantId,
      code: 'scheduling-tests',
      name: 'Synthetic scheduling identity connection',
      protocol: 'oidc',
      issuer: providerIssuer,
      status: 'active',
      jit_provisioning_enabled: false,
    })
    .execute();
  await database
    .insertInto('user_identities')
    .values(
      users.map((user) => ({
        id: user.identityId,
        application_user_id: user.id,
        identity_connection_id: fixture.identityConnectionId,
        subject: user.subject,
        status: 'active' as const,
      })),
    )
    .execute();
  await database
    .insertInto('organization_memberships')
    .values([
      ...[
        fixture.users.organizationScheduler,
        fixture.users.facilityScheduler,
        fixture.users.physician,
      ].map((user) => ({
        id: user.membershipId,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceAId,
        application_user_id: user.id,
        status: 'active' as const,
        provisioning_method: 'admin_invite' as const,
      })),
      {
        id: fixture.users.siblingScheduler.membershipId,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceBId,
        application_user_id: fixture.users.siblingScheduler.id,
        status: 'active',
        provisioning_method: 'admin_invite',
      },
      {
        id: fixture.users.descendantScheduler.membershipId,
        tenant_id: fixture.tenantId,
        organization_id: fixture.groupId,
        application_user_id: fixture.users.descendantScheduler.id,
        status: 'active',
        provisioning_method: 'admin_invite',
      },
    ])
    .execute();
  await database
    .insertInto('membership_facilities')
    .values([
      {
        tenant_id: fixture.tenantId,
        membership_id: fixture.users.organizationScheduler.membershipId,
        facility_id: fixture.facilityA1Id,
      },
      {
        tenant_id: fixture.tenantId,
        membership_id: fixture.users.facilityScheduler.membershipId,
        facility_id: fixture.facilityA1Id,
      },
      {
        tenant_id: fixture.tenantId,
        membership_id: fixture.users.physician.membershipId,
        facility_id: fixture.facilityA1Id,
      },
      {
        tenant_id: fixture.tenantId,
        membership_id: fixture.users.siblingScheduler.membershipId,
        facility_id: fixture.facilityB1Id,
      },
    ])
    .execute();

  const roles = await database
    .selectFrom('roles')
    .select(['id', 'code'])
    .where('code', 'in', ['SCHEDULER', 'PHYSICIAN'])
    .where('tenant_id', 'is', null)
    .execute();
  const schedulerRoleId = roles.find((role) => role.code === 'SCHEDULER')?.id;
  const physicianRoleId = roles.find((role) => role.code === 'PHYSICIAN')?.id;
  if (!schedulerRoleId || !physicianRoleId) {
    throw new Error('Expected scheduling test roles were not seeded.');
  }
  await database
    .insertInto('role_assignments')
    .values([
      {
        tenant_id: fixture.tenantId,
        membership_id: fixture.users.organizationScheduler.membershipId,
        role_id: schedulerRoleId,
        scope_organization_id: fixture.practiceAId,
        facility_id: null,
        include_descendants: false,
        assignment_source: 'system_bootstrap',
      },
      {
        tenant_id: fixture.tenantId,
        membership_id: fixture.users.facilityScheduler.membershipId,
        role_id: schedulerRoleId,
        scope_organization_id: fixture.practiceAId,
        facility_id: fixture.facilityA1Id,
        include_descendants: false,
        assignment_source: 'system_bootstrap',
      },
      {
        tenant_id: fixture.tenantId,
        membership_id: fixture.users.physician.membershipId,
        role_id: physicianRoleId,
        scope_organization_id: fixture.practiceAId,
        facility_id: null,
        include_descendants: false,
        assignment_source: 'system_bootstrap',
      },
      {
        tenant_id: fixture.tenantId,
        membership_id: fixture.users.siblingScheduler.membershipId,
        role_id: schedulerRoleId,
        scope_organization_id: fixture.practiceBId,
        facility_id: null,
        include_descendants: false,
        assignment_source: 'system_bootstrap',
      },
      {
        tenant_id: fixture.tenantId,
        membership_id: fixture.users.descendantScheduler.membershipId,
        role_id: schedulerRoleId,
        scope_organization_id: fixture.practiceAId,
        facility_id: null,
        include_descendants: true,
        assignment_source: 'system_bootstrap',
      },
    ])
    .execute();
}

async function insertCatalogueFixture(
  database: Kysely<DatabaseSchema>,
): Promise<void> {
  await database
    .insertInto('practitioners')
    .values({
      id: fixture.practitionerId,
      tenant_id: fixture.tenantId,
      application_user_id: null,
      display_name: 'Synthetic Shared Physician',
      professional_title: 'General physician',
      status: 'active',
      is_synthetic: true,
    })
    .execute();
  await database
    .insertInto('specialties')
    .values([
      {
        id: fixture.specialtyAId,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceAId,
        code: 'GENERAL-A',
        name: 'General medicine A',
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.specialtyBId,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceBId,
        code: 'GENERAL-B',
        name: 'General medicine B',
        status: 'active',
        is_synthetic: true,
      },
    ])
    .execute();
  await database
    .insertInto('practitioner_facility_assignments')
    .values([
      {
        id: fixture.facilityAssignmentA1Id,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceAId,
        facility_id: fixture.facilityA1Id,
        practitioner_id: fixture.practitionerId,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.facilityAssignmentA2Id,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceAId,
        facility_id: fixture.facilityA2Id,
        practitioner_id: fixture.practitionerId,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.facilityAssignmentB1Id,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceBId,
        facility_id: fixture.facilityB1Id,
        practitioner_id: fixture.practitionerId,
        status: 'active',
        is_synthetic: true,
      },
    ])
    .execute();
  await database
    .insertInto('appointment_services')
    .values([
      {
        id: fixture.serviceA1Id,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceAId,
        facility_id: fixture.facilityA1Id,
        specialty_id: fixture.specialtyAId,
        code: 'CONSULT-A1',
        patient_facing_name: 'General consultation A1',
        duration_minutes: 30,
        allows_any_practitioner: true,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.serviceA2Id,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceAId,
        facility_id: fixture.facilityA2Id,
        specialty_id: fixture.specialtyAId,
        code: 'CONSULT-A2',
        patient_facing_name: 'General consultation A2',
        duration_minutes: 30,
        allows_any_practitioner: true,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.serviceB1Id,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceBId,
        facility_id: fixture.facilityB1Id,
        specialty_id: fixture.specialtyBId,
        code: 'CONSULT-B1',
        patient_facing_name: 'General consultation B1',
        duration_minutes: 30,
        allows_any_practitioner: true,
        status: 'active',
        is_synthetic: true,
      },
    ])
    .execute();
  await database
    .insertInto('practitioner_service_assignments')
    .values([
      {
        id: fixture.serviceAssignmentA1Id,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceAId,
        facility_id: fixture.facilityA1Id,
        practitioner_facility_assignment_id: fixture.facilityAssignmentA1Id,
        practitioner_id: fixture.practitionerId,
        appointment_service_id: fixture.serviceA1Id,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.serviceAssignmentA2Id,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceAId,
        facility_id: fixture.facilityA2Id,
        practitioner_facility_assignment_id: fixture.facilityAssignmentA2Id,
        practitioner_id: fixture.practitionerId,
        appointment_service_id: fixture.serviceA2Id,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.serviceAssignmentB1Id,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceBId,
        facility_id: fixture.facilityB1Id,
        practitioner_facility_assignment_id: fixture.facilityAssignmentB1Id,
        practitioner_id: fixture.practitionerId,
        appointment_service_id: fixture.serviceB1Id,
        status: 'active',
        is_synthetic: true,
      },
    ])
    .execute();
}

async function insertPatientAppointmentFixture(
  database: Kysely<DatabaseSchema>,
): Promise<void> {
  await database
    .insertInto('application_users')
    .values({
      id: fixture.patient.applicationUserId,
      display_name: 'Synthetic scheduling patient',
      primary_email: 'scheduling-patient@example.invalid',
      status: 'active',
      is_synthetic: true,
    })
    .execute();
  await database
    .insertInto('patient_portal_identities')
    .values({
      id: fixture.patient.identityId,
      application_user_id: fixture.patient.applicationUserId,
      issuer: 'https://patient-idp.example.invalid/scheduling-tests',
      subject: 'synthetic-scheduling-patient',
      client_id: 'synthetic-patient-scheduling-client',
      username: 'scheduling-patient@example.invalid',
      status: 'active',
      provider_sync_attempted_at: null,
      provider_sync_completed_at: null,
      provider_sync_error_code: null,
      last_authenticated_at: null,
    })
    .execute();
  await database
    .insertInto('patient_portal_bookable_practices')
    .values([
      {
        id: fixture.bookablePracticeAId,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceAId,
        timezone: 'Asia/Dubai',
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.bookablePracticeBId,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceBId,
        timezone: 'Asia/Dubai',
        status: 'active',
        is_synthetic: true,
      },
    ])
    .execute();
  await database
    .insertInto('patient_portal_appointment_relationships')
    .values([
      {
        id: fixture.patient.relationshipAId,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceAId,
        patient_portal_identity_id: fixture.patient.identityId,
        status: 'pending',
      },
      {
        id: fixture.patient.relationshipBId,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceBId,
        patient_portal_identity_id: fixture.patient.identityId,
        status: 'pending',
      },
    ])
    .execute();
  await database
    .insertInto('practitioner_availability_templates')
    .values([
      {
        id: fixture.availabilityTemplateAId,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceAId,
        facility_id: fixture.facilityA1Id,
        practitioner_facility_assignment_id: fixture.facilityAssignmentA1Id,
        practitioner_service_assignment_id: fixture.serviceAssignmentA1Id,
        practitioner_id: fixture.practitionerId,
        appointment_service_id: fixture.serviceA1Id,
        iso_weekday: schedulingFixtureIsoWeekday,
        local_start_minute: 780,
        local_end_minute: 840,
        effective_from: schedulingFixtureLocalDate,
        effective_until: null,
        source_timezone: 'Asia/Dubai',
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.availabilityTemplateBId,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceBId,
        facility_id: fixture.facilityB1Id,
        practitioner_facility_assignment_id: fixture.facilityAssignmentB1Id,
        practitioner_service_assignment_id: fixture.serviceAssignmentB1Id,
        practitioner_id: fixture.practitionerId,
        appointment_service_id: fixture.serviceB1Id,
        iso_weekday: schedulingFixtureIsoWeekday,
        local_start_minute: 870,
        local_end_minute: 900,
        effective_from: schedulingFixtureLocalDate,
        effective_until: null,
        source_timezone: 'Asia/Dubai',
        status: 'active',
        is_synthetic: true,
      },
    ])
    .execute();
  await database
    .insertInto('patient_portal_appointment_slots')
    .values([
      {
        id: fixture.slots.appointmentA,
        bookable_practice_id: fixture.bookablePracticeAId,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceAId,
        starts_at: schedulingFixtureInstant('09:00'),
        ends_at: schedulingFixtureInstant('09:30'),
        facility_id: fixture.facilityA1Id,
        practitioner_facility_assignment_id: fixture.facilityAssignmentA1Id,
        practitioner_service_assignment_id: fixture.serviceAssignmentA1Id,
        practitioner_id: fixture.practitionerId,
        appointment_service_id: fixture.serviceA1Id,
        availability_template_id: fixture.availabilityTemplateAId,
        generation_key_hash: 'a'.repeat(64),
        source_local_date: schedulingFixtureLocalDate,
        source_timezone: 'Asia/Dubai',
        status: 'available',
        is_synthetic: true,
      },
      {
        id: fixture.slots.availableA,
        bookable_practice_id: fixture.bookablePracticeAId,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceAId,
        starts_at: schedulingFixtureInstant('09:30'),
        ends_at: schedulingFixtureInstant('10:00'),
        facility_id: fixture.facilityA1Id,
        practitioner_facility_assignment_id: fixture.facilityAssignmentA1Id,
        practitioner_service_assignment_id: fixture.serviceAssignmentA1Id,
        practitioner_id: fixture.practitionerId,
        appointment_service_id: fixture.serviceA1Id,
        availability_template_id: fixture.availabilityTemplateAId,
        generation_key_hash: 'b'.repeat(64),
        source_local_date: schedulingFixtureLocalDate,
        source_timezone: 'Asia/Dubai',
        status: 'available',
        is_synthetic: true,
      },
      {
        id: fixture.slots.appointmentB,
        bookable_practice_id: fixture.bookablePracticeBId,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceBId,
        starts_at: schedulingFixtureInstant('10:30'),
        ends_at: schedulingFixtureInstant('11:00'),
        facility_id: fixture.facilityB1Id,
        practitioner_facility_assignment_id: fixture.facilityAssignmentB1Id,
        practitioner_service_assignment_id: fixture.serviceAssignmentB1Id,
        practitioner_id: fixture.practitionerId,
        appointment_service_id: fixture.serviceB1Id,
        availability_template_id: fixture.availabilityTemplateBId,
        generation_key_hash: 'c'.repeat(64),
        source_local_date: schedulingFixtureLocalDate,
        source_timezone: 'Asia/Dubai',
        status: 'available',
        is_synthetic: true,
      },
    ])
    .execute();
  await database
    .insertInto('patient_portal_appointments')
    .values([
      {
        id: fixture.appointments.practiceA,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceAId,
        patient_portal_identity_id: fixture.patient.identityId,
        patient_portal_profile_id: null,
        patient_portal_appointment_relationship_id:
          fixture.patient.relationshipAId,
        appointment_slot_id: fixture.slots.appointmentA,
        facility_id: fixture.facilityA1Id,
        practitioner_facility_assignment_id: fixture.facilityAssignmentA1Id,
        practitioner_service_assignment_id: fixture.serviceAssignmentA1Id,
        practitioner_id: fixture.practitionerId,
        appointment_service_id: fixture.serviceA1Id,
        status: 'requested',
        version: 1,
        cancelled_at: null,
      },
      {
        id: fixture.appointments.practiceB,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceBId,
        patient_portal_identity_id: fixture.patient.identityId,
        patient_portal_profile_id: null,
        patient_portal_appointment_relationship_id:
          fixture.patient.relationshipBId,
        appointment_slot_id: fixture.slots.appointmentB,
        facility_id: fixture.facilityB1Id,
        practitioner_facility_assignment_id: fixture.facilityAssignmentB1Id,
        practitioner_service_assignment_id: fixture.serviceAssignmentB1Id,
        practitioner_id: fixture.practitionerId,
        appointment_service_id: fixture.serviceB1Id,
        status: 'requested',
        version: 1,
        cancelled_at: null,
      },
    ])
    .execute();
}

function patientSession(): PatientPortalSessionContext {
  const future = new Date('2036-01-01T00:00:00.000Z');
  return {
    sessionId: 'd1770000-0000-4000-8000-000000000001',
    principal: {
      issuer: 'https://patient-idp.example.invalid/scheduling-tests',
      subject: 'synthetic-scheduling-patient',
      clientId: 'synthetic-patient-scheduling-client',
    },
    patientPortalIdentityId: fixture.patient.identityId,
    applicationUserId: fixture.patient.applicationUserId,
    displayName: 'Synthetic scheduling patient',
    context: {
      kind: 'appointment-onboarding',
      appointmentRelationshipId: fixture.patient.relationshipAId,
      practiceName: 'Synthetic Scheduling Practice A',
      tenantId: fixture.tenantId,
      organizationId: fixture.practiceAId,
    },
    availablePractices: [],
    appointmentOnboardingPractices: [
      {
        appointmentRelationshipId: fixture.patient.relationshipAId,
        practiceName: 'Synthetic Scheduling Practice A',
      },
    ],
    csrfToken: 'synthetic-patient-csrf-token',
    idleExpiresAt: future,
    absoluteExpiresAt: future,
    renewed: false,
  };
}

describeWithDatabase('workforce scheduling repository', () => {
  const schemaName = `workforce_scheduling_${process.pid}_${Date.now()}`;
  let adminDatabase: Kysely<unknown>;
  let database: Kysely<DatabaseSchema>;
  let concurrentDatabase: Kysely<DatabaseSchema>;
  let repository: WorkforceSchedulingRepository;
  let concurrentRepository: WorkforceSchedulingRepository;
  let patientAppointments: PatientAppointmentsService;
  let concurrentPatientAppointments: PatientAppointmentsService;

  beforeAll(async () => {
    adminDatabase = createDatabaseClient<unknown>({
      connectionString: databaseUrl!,
      maxConnections: 1,
      ssl: false,
    });
    database = createDatabaseClient<DatabaseSchema>({
      connectionString: databaseUrl!,
      maxConnections: 1,
      ssl: false,
    });
    await sql`create schema ${sql.id(schemaName)}`.execute(adminDatabase);
    await sql`set search_path to ${sql.id(schemaName)}, public`.execute(
      database,
    );
    await migrateDatabase(database);
    await insertAuthorizationFixture(database);
    await insertCatalogueFixture(database);
    await insertPatientAppointmentFixture(database);

    const provider = identityProvider();
    const databaseService = { client: database } as DatabaseService;
    const authorization = new AuthorizationService(
      new AuthorizationRepository(databaseService, provider),
    );
    repository = new WorkforceSchedulingRepository(
      databaseService,
      authorization,
      provider,
    );
    patientAppointments = new PatientAppointmentsService(databaseService);

    concurrentDatabase = createDatabaseClient<DatabaseSchema>({
      connectionString: databaseUrl!,
      maxConnections: 1,
      ssl: false,
    });
    await sql`set search_path to ${sql.id(schemaName)}, public`.execute(
      concurrentDatabase,
    );
    const concurrentDatabaseService = {
      client: concurrentDatabase,
    } as DatabaseService;
    const concurrentAuthorization = new AuthorizationService(
      new AuthorizationRepository(concurrentDatabaseService, provider),
    );
    concurrentRepository = new WorkforceSchedulingRepository(
      concurrentDatabaseService,
      concurrentAuthorization,
      provider,
    );
    concurrentPatientAppointments = new PatientAppointmentsService(
      concurrentDatabaseService,
    );
  });

  afterAll(async () => {
    if (concurrentDatabase) await concurrentDatabase.destroy();
    if (database) await database.destroy();
    if (adminDatabase) {
      await sql`drop schema if exists ${sql.id(schemaName)} cascade`.execute(
        adminDatabase,
      );
      await adminDatabase.destroy();
    }
  });

  it('limits contexts and facility-owned reads to exact direct authority', async () => {
    const organizationContexts = await repository.listContexts(
      principal(fixture.users.organizationScheduler.subject),
    );
    expect(organizationContexts).toEqual([
      {
        tenantId: fixture.tenantId,
        tenantName: 'Synthetic Scheduling Test Tenant',
        organizationId: fixture.practiceAId,
        organizationName: 'Synthetic Scheduling Practice A',
        canManagePracticeCatalogue: true,
        facilities: [
          {
            facilityId: fixture.facilityA1Id,
            facilityName: 'Synthetic Practice A Facility One',
            timezone: 'Asia/Dubai',
          },
        ],
      },
    ]);

    const facilityContexts = await repository.listContexts(
      principal(fixture.users.facilityScheduler.subject),
    );
    expect(facilityContexts[0]).toMatchObject({
      organizationId: fixture.practiceAId,
      canManagePracticeCatalogue: false,
      facilities: [{ facilityId: fixture.facilityA1Id }],
    });
    expect(
      await repository.listContexts(principal(fixture.users.physician.subject)),
    ).toEqual([]);
    expect(
      await repository.listContexts(
        principal(fixture.users.siblingScheduler.subject),
      ),
    ).toEqual([
      expect.objectContaining({ organizationId: fixture.practiceBId }),
    ]);
    expect(
      await repository.listContexts(
        principal(fixture.users.descendantScheduler.subject),
      ),
    ).toEqual([]);
  });

  it('returns only safe exact-practice and authorized-facility catalogue data', async () => {
    const actor = principal(fixture.users.organizationScheduler.subject);
    const query = {
      organizationId: fixture.practiceAId,
      page: 1,
      pageSize: 20,
    };
    const practitioners = await repository.listPractitioners(actor, query);
    expect(practitioners.total).toBe(1);
    expect(practitioners.items).toEqual([
      expect.objectContaining({
        practitionerId: fixture.practitionerId,
        displayName: 'Synthetic Shared Physician',
        applicationUserLinked: false,
        facilityAssignments: [
          expect.objectContaining({
            assignmentId: fixture.facilityAssignmentA1Id,
            facilityId: fixture.facilityA1Id,
          }),
        ],
        serviceAssignments: [
          expect.objectContaining({
            assignmentId: fixture.serviceAssignmentA1Id,
            facilityId: fixture.facilityA1Id,
          }),
        ],
      }),
    ]);
    const serializedPractitioners = JSON.stringify(practitioners);
    expect(serializedPractitioners).not.toContain('@example.invalid');
    expect(serializedPractitioners).not.toContain('synthetic-');
    expect(serializedPractitioners).not.toContain(fixture.facilityA2Id);
    expect(serializedPractitioners).not.toContain(fixture.practiceBId);

    const services = await repository.listServices(actor, query);
    expect(
      services.items.map((service) => service.appointmentServiceId),
    ).toEqual([fixture.serviceA1Id]);
    const specialties = await repository.listSpecialties(actor, query);
    expect(specialties.items.map((specialty) => specialty.specialtyId)).toEqual(
      [fixture.specialtyAId],
    );
  });

  it('denies physician-only, inherited, sibling, and missing-facility authority', async () => {
    const query = {
      organizationId: fixture.practiceAId,
      page: 1,
      pageSize: 20,
    };
    await expect(
      repository.listSpecialties(
        principal(fixture.users.physician.subject),
        query,
      ),
    ).rejects.toBeInstanceOf(WorkforceSchedulingAuthorizationLostError);
    await expect(
      repository.listSpecialties(
        principal(fixture.users.descendantScheduler.subject),
        query,
      ),
    ).rejects.toBeInstanceOf(WorkforceSchedulingAuthorizationLostError);
    await expect(
      repository.listSpecialties(
        principal(fixture.users.siblingScheduler.subject),
        query,
      ),
    ).rejects.toBeInstanceOf(WorkforceSchedulingAuthorizationLostError);

    const organizationActor = principal(
      fixture.users.organizationScheduler.subject,
    );
    const services = await repository.listServices(organizationActor, query);
    expect(services.items).toHaveLength(1);
    expect(services.items[0]?.facilityId).toBe(fixture.facilityA1Id);

    const denials = await database
      .selectFrom('audit_events')
      .select(['action', 'outcome', 'organization_id'])
      .where('outcome', '=', 'denied')
      .where('organization_id', '=', fixture.practiceAId)
      .execute();
    expect(denials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'scheduling.specialties.read',
          outcome: 'denied',
          organization_id: fixture.practiceAId,
        }),
      ]),
    );
  });

  it('commits one durable result for concurrent equivalent commands and reauthorizes before replay', async () => {
    const idempotencyKey = 'concurrent-practitioner-create';
    const request = {
      principal: principal(fixture.users.organizationScheduler.subject),
      idempotencyKey,
      input: {
        organizationId: fixture.practiceAId,
        facilityId: fixture.facilityA1Id,
        displayName: 'Synthetic Concurrent Physician',
        professionalTitle: 'General physician',
        reasonCode: 'catalogue-setup' as const,
      },
    };

    const [first, second] = await Promise.all([
      repository.createPractitioner(request),
      concurrentRepository.createPractitioner(request),
    ]);
    expect(second).toEqual(first);
    const practitionerId = first.practitioner.practitionerId;

    const [practitioners, assignments, commands, successAudits] =
      await Promise.all([
        database
          .selectFrom('practitioners')
          .select('id')
          .where('display_name', '=', request.input.displayName)
          .execute(),
        database
          .selectFrom('practitioner_facility_assignments')
          .select('id')
          .where('practitioner_id', '=', practitionerId)
          .execute(),
        database
          .selectFrom('workforce_scheduling_commands')
          .select([
            'idempotency_key_hash',
            'request_hash',
            'response_data',
            'organization_id',
          ])
          .where('operation', '=', 'practitioner_create')
          .where('target_entity_id', '=', practitionerId)
          .execute(),
        database
          .selectFrom('audit_events')
          .select('id')
          .where('action', '=', 'scheduling.practitioner_created')
          .where('target_entity_id', '=', practitionerId)
          .where('outcome', '=', 'success')
          .execute(),
      ]);
    expect(practitioners).toHaveLength(1);
    expect(assignments).toHaveLength(1);
    expect(commands).toHaveLength(1);
    expect(successAudits).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      idempotency_key_hash: sha256(idempotencyKey),
      organization_id: fixture.practiceAId,
    });
    expect(commands[0]?.request_hash).toMatch(/^[0-9a-f]{64}$/);
    const serializedCommand = JSON.stringify(commands[0]);
    expect(serializedCommand).not.toContain(idempotencyKey);
    expect(serializedCommand).not.toContain('@example.invalid');
    expect(serializedCommand).not.toContain(request.principal.subject);

    await expect(
      repository.createPractitioner({
        ...request,
        input: { ...request.input, displayName: 'Changed replay payload' },
      }),
    ).rejects.toBeInstanceOf(WorkforceSchedulingConflictError);

    const actorAssignment = await database
      .selectFrom('role_assignments')
      .select('id')
      .where(
        'membership_id',
        '=',
        fixture.users.organizationScheduler.membershipId,
      )
      .where('scope_organization_id', '=', fixture.practiceAId)
      .where('facility_id', 'is', null)
      .executeTakeFirstOrThrow();
    await database
      .updateTable('role_assignments')
      .set({
        revoked_at: new Date(),
        revocation_reason: 'Synthetic authorization replay test.',
      })
      .where('id', '=', actorAssignment.id)
      .execute();
    try {
      await expect(
        repository.createPractitioner(request),
      ).rejects.toBeInstanceOf(WorkforceSchedulingAuthorizationLostError);
    } finally {
      await database
        .updateTable('role_assignments')
        .set({
          revoked_at: null,
          revoked_by_user_id: null,
          revocation_reason: null,
        })
        .where('id', '=', actorAssignment.id)
        .execute();
    }

    expect(
      await database
        .selectFrom('audit_events')
        .select('id')
        .where('action', '=', 'scheduling.practitioner_created')
        .where('target_entity_id', '=', fixture.facilityA1Id)
        .where('outcome', '=', 'denied')
        .execute(),
    ).toHaveLength(1);
    expect(
      await database
        .selectFrom('workforce_scheduling_commands')
        .select('id')
        .where('operation', '=', 'practitioner_create')
        .where('target_entity_id', '=', practitionerId)
        .execute(),
    ).toHaveLength(1);
  });

  it('records durable privacy-safe denial evidence for a guessed scoped target', async () => {
    const guessedFacilityId = 'd1300000-0000-4000-8000-000000000099';
    const idempotencyKey = 'guessed-facility-target';
    await expect(
      repository.createPractitioner({
        principal: principal(fixture.users.organizationScheduler.subject),
        idempotencyKey,
        input: {
          organizationId: fixture.practiceAId,
          facilityId: guessedFacilityId,
          displayName: 'Must not be created',
          professionalTitle: 'Unavailable target',
          reasonCode: 'catalogue-setup',
        },
      }),
    ).rejects.toBeInstanceOf(WorkforceSchedulingTargetUnavailableError);

    const denial = await database
      .selectFrom('audit_events')
      .select([
        'actor_user_id',
        'organization_id',
        'facility_id',
        'action',
        'target_entity_type',
        'target_entity_id',
        'outcome',
      ])
      .where('action', '=', 'scheduling.catalogue_target_unavailable')
      .where('target_entity_type', '=', 'facility')
      .where('target_entity_id', '=', guessedFacilityId)
      .executeTakeFirstOrThrow();
    expect(denial).toEqual({
      actor_user_id: fixture.users.organizationScheduler.id,
      organization_id: fixture.practiceAId,
      facility_id: null,
      action: 'scheduling.catalogue_target_unavailable',
      target_entity_type: 'facility',
      target_entity_id: guessedFacilityId,
      outcome: 'denied',
    });
    expect(
      await database
        .selectFrom('workforce_scheduling_commands')
        .select('id')
        .where('idempotency_key_hash', '=', sha256(idempotencyKey))
        .execute(),
    ).toHaveLength(0);
    expect(
      await database
        .selectFrom('practitioners')
        .select('id')
        .where('display_name', '=', 'Must not be created')
        .execute(),
    ).toHaveLength(0);
  });

  it('uses returned timestamps for optimistic updates and rejects stale writes without evidence', async () => {
    const actor = principal(fixture.users.organizationScheduler.subject);
    const created = await repository.createSpecialty({
      principal: actor,
      idempotencyKey: 'timestamp-specialty-create',
      input: {
        organizationId: fixture.practiceAId,
        code: 'TIMESTAMP-SPECIALTY',
        name: 'Timestamp specialty',
        reasonCode: 'catalogue-setup',
      },
    });
    const originalUpdatedAt = created.specialty.updatedAt;
    const updated = await repository.updateSpecialty(
      {
        principal: actor,
        idempotencyKey: 'timestamp-specialty-update',
        input: {
          organizationId: fixture.practiceAId,
          name: 'Timestamp specialty renamed',
          expectedUpdatedAt: originalUpdatedAt,
          reasonCode: 'service-configuration',
        },
      },
      created.specialty.specialtyId,
    );
    expect(updated.specialty.name).toBe('Timestamp specialty renamed');

    await expect(
      repository.updateSpecialty(
        {
          principal: actor,
          idempotencyKey: 'timestamp-specialty-stale-update',
          input: {
            organizationId: fixture.practiceAId,
            name: 'Must not overwrite',
            expectedUpdatedAt: originalUpdatedAt,
            reasonCode: 'service-configuration',
          },
        },
        created.specialty.specialtyId,
      ),
    ).rejects.toBeInstanceOf(WorkforceSchedulingConflictError);

    const stored = await database
      .selectFrom('specialties')
      .select(['name', 'updated_at'])
      .where('id', '=', created.specialty.specialtyId)
      .executeTakeFirstOrThrow();
    expect(stored.name).toBe('Timestamp specialty renamed');
    expect(stored.updated_at.toISOString()).toBe(updated.specialty.updatedAt);
    expect(
      await database
        .selectFrom('workforce_scheduling_commands')
        .select('id')
        .where('operation', '=', 'specialty_update')
        .where('target_entity_id', '=', created.specialty.specialtyId)
        .execute(),
    ).toHaveLength(1);
    expect(
      await database
        .selectFrom('audit_events')
        .select('id')
        .where('action', '=', 'scheduling.specialty_updated')
        .where('target_entity_id', '=', created.specialty.specialtyId)
        .where('outcome', '=', 'success')
        .execute(),
    ).toHaveLength(1);
  });

  it('rolls back catalogue and command state when required success audit persistence fails', async () => {
    const idempotencyKey = 'audit-rollback-specialty-create';
    const auditCountBefore = await database
      .selectFrom('audit_events')
      .select((expression) => expression.fn.countAll<string>().as('count'))
      .where('action', '=', 'scheduling.specialty_created')
      .where('outcome', '=', 'success')
      .executeTakeFirstOrThrow();
    await sql`
      create function reject_scheduling_specialty_audit()
      returns trigger
      language plpgsql
      as $function$
      begin
        if new.action = 'scheduling.specialty_created'
           and new.outcome = 'success' then
          raise exception 'Synthetic scheduling audit failure.';
        end if;
        return new;
      end;
      $function$
    `.execute(database);
    await sql`
      create trigger reject_scheduling_specialty_audit
      before insert on audit_events
      for each row execute function reject_scheduling_specialty_audit()
    `.execute(database);

    try {
      await expect(
        repository.createSpecialty({
          principal: principal(fixture.users.organizationScheduler.subject),
          idempotencyKey,
          input: {
            organizationId: fixture.practiceAId,
            code: 'AUDIT-ROLLBACK',
            name: 'Audit rollback specialty',
            reasonCode: 'catalogue-setup',
          },
        }),
      ).rejects.toBeInstanceOf(WorkforceSchedulingPersistenceError);
    } finally {
      await sql`
        drop trigger if exists reject_scheduling_specialty_audit on audit_events
      `.execute(database);
      await sql`drop function if exists reject_scheduling_specialty_audit()`.execute(
        database,
      );
    }

    expect(
      await database
        .selectFrom('specialties')
        .select('id')
        .where('code', '=', 'AUDIT-ROLLBACK')
        .execute(),
    ).toHaveLength(0);
    expect(
      await database
        .selectFrom('workforce_scheduling_commands')
        .select('id')
        .where('idempotency_key_hash', '=', sha256(idempotencyKey))
        .execute(),
    ).toHaveLength(0);
    const auditCountAfter = await database
      .selectFrom('audit_events')
      .select((expression) => expression.fn.countAll<string>().as('count'))
      .where('action', '=', 'scheduling.specialty_created')
      .where('outcome', '=', 'success')
      .executeTakeFirstOrThrow();
    expect(auditCountAfter.count).toBe(auditCountBefore.count);
  });

  it('deactivation hides the active chain, preserves requests, and requires explicit eligibility restoration', async () => {
    const session = patientSession();
    const baseline = await patientAppointments.listAvailability(session);
    expect(baseline.slots.map((slot) => slot.slotId)).toEqual([
      fixture.slots.availableA,
    ]);

    const affiliation = await database
      .selectFrom('practitioner_facility_assignments')
      .select('updated_at')
      .where('id', '=', fixture.facilityAssignmentA1Id)
      .executeTakeFirstOrThrow();
    const deactivated =
      await repository.changePractitionerFacilityAssignmentStatus(
        {
          principal: principal(fixture.users.organizationScheduler.subject),
          idempotencyKey: 'deactivate-active-chain-affiliation',
          input: {
            organizationId: fixture.practiceAId,
            status: 'inactive',
            expectedUpdatedAt: affiliation.updated_at.toISOString(),
            reasonCode: 'staffing-change',
          },
        },
        fixture.facilityAssignmentA1Id,
      );
    expect(deactivated.affectedAppointmentIds).toEqual([
      fixture.appointments.practiceA,
    ]);
    expect(deactivated.affectedAppointmentCount).toBe(1);
    expect(deactivated.affectedAppointmentIdsTruncated).toBe(false);

    const cascadeAudit = await database
      .selectFrom('audit_events')
      .select('after_data')
      .where(
        'action',
        '=',
        'scheduling.practitioner_facility_assignment_status_changed',
      )
      .where('target_entity_id', '=', fixture.facilityAssignmentA1Id)
      .where('outcome', '=', 'success')
      .executeTakeFirstOrThrow();
    expect(cascadeAudit.after_data).toMatchObject({
      affectedAppointmentCount: 1,
      affectedAppointmentIdsTruncated: false,
      cascadedEligibilityAssignmentCount: 1,
      cascadedEligibilityAssignmentIds: [fixture.serviceAssignmentA1Id],
      cascadedEligibilityAssignmentIdsTruncated: false,
    });

    const [localEligibility, siblingAppointment, preservedSlot] =
      await Promise.all([
        database
          .selectFrom('practitioner_service_assignments')
          .select(['status', 'updated_at'])
          .where('id', '=', fixture.serviceAssignmentA1Id)
          .executeTakeFirstOrThrow(),
        database
          .selectFrom('patient_portal_appointments')
          .select('status')
          .where('id', '=', fixture.appointments.practiceB)
          .executeTakeFirstOrThrow(),
        database
          .selectFrom('patient_portal_appointment_slots')
          .select('status')
          .where('id', '=', fixture.slots.appointmentA)
          .executeTakeFirstOrThrow(),
      ]);
    expect(localEligibility.status).toBe('inactive');
    expect(siblingAppointment.status).toBe('requested');
    expect(preservedSlot.status).toBe('available');
    expect((await patientAppointments.listAvailability(session)).slots).toEqual(
      [],
    );
    await expect(
      patientAppointments.createAppointment(
        session,
        'inactive-chain-booking-attempt',
        fixture.slots.availableA,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    const historical = await patientAppointments.listAppointments(session);
    expect(
      historical.appointments.map((appointment) => appointment.appointmentId),
    ).toContain(fixture.appointments.practiceA);
    const cancelled = await patientAppointments.cancelAppointment(
      session,
      'cancel-after-chain-deactivation',
      fixture.appointments.practiceA,
      1,
    );
    expect(cancelled.appointment.status).toBe('cancelled');

    const reactivated =
      await repository.changePractitionerFacilityAssignmentStatus(
        {
          principal: principal(fixture.users.organizationScheduler.subject),
          idempotencyKey: 'reactivate-active-chain-affiliation',
          input: {
            organizationId: fixture.practiceAId,
            status: 'active',
            expectedUpdatedAt: deactivated.assignment.updatedAt,
            reasonCode: 'staffing-change',
          },
        },
        fixture.facilityAssignmentA1Id,
      );
    expect(reactivated.assignment.status).toBe('active');
    expect((await patientAppointments.listAvailability(session)).slots).toEqual(
      [],
    );

    const restoredEligibility =
      await repository.changePractitionerServiceAssignmentStatus(
        {
          principal: principal(fixture.users.organizationScheduler.subject),
          idempotencyKey: 'reactivate-active-chain-eligibility',
          input: {
            organizationId: fixture.practiceAId,
            status: 'active',
            expectedUpdatedAt: localEligibility.updated_at.toISOString(),
            reasonCode: 'staffing-change',
          },
        },
        fixture.serviceAssignmentA1Id,
      );
    expect(restoredEligibility.assignment.status).toBe('active');
    expect(
      (await patientAppointments.listAvailability(session)).slots.map(
        (slot) => slot.slotId,
      ),
    ).toEqual([fixture.slots.appointmentA, fixture.slots.availableA]);
  });

  it('serializes provider deactivation against patient booking', async () => {
    const affiliation = await database
      .selectFrom('practitioner_facility_assignments')
      .select('updated_at')
      .where('id', '=', fixture.facilityAssignmentA1Id)
      .executeTakeFirstOrThrow();
    const booking = concurrentPatientAppointments.createAppointment(
      patientSession(),
      'concurrent-booking-deactivation',
      fixture.slots.availableA,
    );
    const deactivation = repository.changePractitionerFacilityAssignmentStatus(
      {
        principal: principal(fixture.users.organizationScheduler.subject),
        idempotencyKey: 'concurrent-provider-deactivation',
        input: {
          organizationId: fixture.practiceAId,
          status: 'inactive',
          expectedUpdatedAt: affiliation.updated_at.toISOString(),
          reasonCode: 'staffing-change',
        },
      },
      fixture.facilityAssignmentA1Id,
    );
    const [bookingResult, deactivationResult] = await Promise.allSettled([
      booking,
      deactivation,
    ]);
    expect(deactivationResult.status).toBe('fulfilled');
    if (deactivationResult.status !== 'fulfilled') return;

    if (bookingResult.status === 'fulfilled') {
      expect(deactivationResult.value.affectedAppointmentIds).toContain(
        bookingResult.value.appointment.appointmentId,
      );
    } else {
      expect(bookingResult.reason).toBeInstanceOf(ConflictException);
      expect(
        await database
          .selectFrom('patient_portal_appointments')
          .select('id')
          .where('appointment_slot_id', '=', fixture.slots.availableA)
          .where('status', '=', 'requested')
          .execute(),
      ).toHaveLength(0);
    }

    const reactivated =
      await repository.changePractitionerFacilityAssignmentStatus(
        {
          principal: principal(fixture.users.organizationScheduler.subject),
          idempotencyKey: 'concurrent-provider-reactivation',
          input: {
            organizationId: fixture.practiceAId,
            status: 'active',
            expectedUpdatedAt: deactivationResult.value.assignment.updatedAt,
            reasonCode: 'staffing-change',
          },
        },
        fixture.facilityAssignmentA1Id,
      );
    expect(reactivated.assignment.status).toBe('active');
    const eligibility = await database
      .selectFrom('practitioner_service_assignments')
      .select('updated_at')
      .where('id', '=', fixture.serviceAssignmentA1Id)
      .executeTakeFirstOrThrow();
    await repository.changePractitionerServiceAssignmentStatus(
      {
        principal: principal(fixture.users.organizationScheduler.subject),
        idempotencyKey: 'concurrent-provider-eligibility-reactivation',
        input: {
          organizationId: fixture.practiceAId,
          status: 'active',
          expectedUpdatedAt: eligibility.updated_at.toISOString(),
          reasonCode: 'staffing-change',
        },
      },
      fixture.serviceAssignmentA1Id,
    );
  });
});
