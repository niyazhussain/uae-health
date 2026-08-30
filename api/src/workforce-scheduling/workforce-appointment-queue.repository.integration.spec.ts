import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Kysely, sql } from 'kysely';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import { AuthorizationRepository } from '../authorization/authorization.repository.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { createDatabaseClient } from '../database/create-database-client.js';
import type { DatabaseService } from '../database/database.service.js';
import type {
  DatabaseSchema,
  PatientPortalAppointmentStatus,
} from '../database/database.types.js';
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
import * as addWorkforceAppointmentDecisions from '../database/migrations/2026-08-27T080000_add_workforce_appointment_decisions.js';
import type { WorkforceIdentityProviderPort } from '../identity-provider/identity-provider.types.js';
import { PatientAppointmentsService } from '../patient-appointments/patient-appointments.service.js';
import type { PatientPortalSessionContext } from '../patient-portal-auth/patient-portal-auth.types.js';
import { WorkforceAppointmentQueueRepository } from './workforce-appointment-queue.repository.js';
import { WorkforceAppointmentQueueService } from './workforce-appointment-queue.service.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const workforceIssuer =
  'https://workforce-idp.example.invalid/appointment-queue-tests';

function dubaiLocalDateInDays(days: number): string {
  const target = new Date(Date.now() + days * 24 * 60 * 60_000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dubai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(target);
  const value = (type: 'year' | 'month' | 'day') =>
    parts.find((part) => part.type === type)?.value;
  const year = value('year');
  const month = value('month');
  const day = value('day');
  if (!year || !month || !day) {
    throw new Error('Expected a canonical Dubai test date.');
  }
  return `${year}-${month}-${day}`;
}

const sourceLocalDate = dubaiLocalDateInDays(14);
const sourceIsoWeekday =
  ((new Date(`${sourceLocalDate}T00:00:00.000Z`).getUTCDay() + 6) % 7) + 1;
const sourceSlotStart = new Date(`${sourceLocalDate}T09:00:00.000Z`);

const fixture = {
  tenantId: 'e1000000-0000-4000-8000-000000000001',
  practiceAId: 'e1100000-0000-4000-8000-000000000001',
  practiceBId: 'e1100000-0000-4000-8000-000000000002',
  facilityA1Id: 'e1200000-0000-4000-8000-000000000001',
  facilityA2Id: 'e1200000-0000-4000-8000-000000000002',
  facilityB1Id: 'e1200000-0000-4000-8000-000000000003',
  bookablePracticeAId: 'e1300000-0000-4000-8000-000000000001',
  bookablePracticeBId: 'e1300000-0000-4000-8000-000000000002',
  identityConnectionId: 'e1400000-0000-4000-8000-000000000001',
  roles: {
    schedulingOnly: 'e1500000-0000-4000-8000-000000000001',
    patientsOnly: 'e1500000-0000-4000-8000-000000000002',
  },
  users: {
    dual: {
      id: 'e1600000-0000-4000-8000-000000000001',
      identityId: 'e1610000-0000-4000-8000-000000000001',
      membershipId: 'e1620000-0000-4000-8000-000000000001',
      subject: 'synthetic-queue-dual-authority',
    },
    schedulingOnly: {
      id: 'e1600000-0000-4000-8000-000000000002',
      identityId: 'e1610000-0000-4000-8000-000000000002',
      membershipId: 'e1620000-0000-4000-8000-000000000002',
      subject: 'synthetic-queue-scheduling-only',
    },
    patientsOnly: {
      id: 'e1600000-0000-4000-8000-000000000003',
      identityId: 'e1610000-0000-4000-8000-000000000003',
      membershipId: 'e1620000-0000-4000-8000-000000000003',
      subject: 'synthetic-queue-patients-only',
    },
    sibling: {
      id: 'e1600000-0000-4000-8000-000000000004',
      identityId: 'e1610000-0000-4000-8000-000000000004',
      membershipId: 'e1620000-0000-4000-8000-000000000004',
      subject: 'synthetic-queue-sibling-authority',
    },
  },
} as const;

interface SchedulingScope {
  organizationId: string;
  organizationName: string;
  facilityId: string;
  facilityName: string;
  bookablePracticeId: string;
}

interface ProviderChain {
  scope: SchedulingScope;
  practitionerId: string;
  practitionerFacilityAssignmentId: string;
  practitionerServiceAssignmentId: string;
  appointmentServiceId: string;
  availabilityTemplateId: string;
  sourceLocalDate: string;
}

interface PatientFixture {
  applicationUserId: string;
  identityId: string;
  relationshipId: string;
  displayName: string;
  privateEmail: string;
  privateSubject: string;
  session: PatientPortalSessionContext;
}

interface SlotFixture {
  id: string;
  startsAt: Date;
  endsAt: Date;
}

const scopeA1: SchedulingScope = {
  organizationId: fixture.practiceAId,
  organizationName: 'Synthetic Queue Practice A',
  facilityId: fixture.facilityA1Id,
  facilityName: 'Synthetic Queue Facility A1',
  bookablePracticeId: fixture.bookablePracticeAId,
};

const scopeA2: SchedulingScope = {
  organizationId: fixture.practiceAId,
  organizationName: 'Synthetic Queue Practice A',
  facilityId: fixture.facilityA2Id,
  facilityName: 'Synthetic Queue Facility A2',
  bookablePracticeId: fixture.bookablePracticeAId,
};

const scopeB1: SchedulingScope = {
  organizationId: fixture.practiceBId,
  organizationName: 'Synthetic Queue Practice B',
  facilityId: fixture.facilityB1Id,
  facilityName: 'Synthetic Queue Facility B1',
  bookablePracticeId: fixture.bookablePracticeBId,
};

function principal(subject: string): AuthenticatedPrincipal {
  return { subject, clientId: 'synthetic-queue-workforce-client' };
}

function identityProvider(): WorkforceIdentityProviderPort {
  return {
    issuer: workforceIssuer,
    protocol: 'oidc',
    provisionAccount: () => Promise.reject(new Error('Not used by this test.')),
    deleteAccount: () => Promise.reject(new Error('Not used by this test.')),
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeCode(label: string): string {
  return label
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .slice(0, 40);
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
  await addWorkforceAppointmentDecisions.up(database);
}

async function insertBaseFixture(
  database: Kysely<DatabaseSchema>,
): Promise<void> {
  await database
    .insertInto('tenants')
    .values({
      id: fixture.tenantId,
      code: 'QUEUE-TEST',
      name: 'Synthetic Appointment Queue Test Tenant',
      status: 'active',
      is_synthetic: true,
    })
    .execute();
  await database
    .insertInto('organizations')
    .values([
      {
        id: fixture.practiceAId,
        tenant_id: fixture.tenantId,
        parent_organization_id: null,
        kind: 'practice',
        code: 'QUEUE-PRACTICE-A',
        name: scopeA1.organizationName,
        is_synthetic: true,
      },
      {
        id: fixture.practiceBId,
        tenant_id: fixture.tenantId,
        parent_organization_id: null,
        kind: 'practice',
        code: 'QUEUE-PRACTICE-B',
        name: scopeB1.organizationName,
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
        code: 'QUEUE-A1',
        name: scopeA1.facilityName,
        timezone: 'Asia/Dubai',
        is_synthetic: true,
      },
      {
        id: fixture.facilityA2Id,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceAId,
        code: 'QUEUE-A2',
        name: scopeA2.facilityName,
        timezone: 'Asia/Dubai',
        is_synthetic: true,
      },
      {
        id: fixture.facilityB1Id,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceBId,
        code: 'QUEUE-B1',
        name: scopeB1.facilityName,
        timezone: 'Asia/Dubai',
        is_synthetic: true,
      },
    ])
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

  const users = Object.values(fixture.users);
  await database
    .insertInto('application_users')
    .values(
      users.map((user, index) => ({
        id: user.id,
        display_name: `Synthetic queue actor ${index + 1}`,
        primary_email: `private-queue-actor-${index + 1}@example.invalid`,
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
      code: 'queue-tests',
      name: 'Synthetic queue test connection',
      protocol: 'oidc',
      issuer: workforceIssuer,
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
        fixture.users.dual,
        fixture.users.schedulingOnly,
        fixture.users.patientsOnly,
      ].map((user) => ({
        id: user.membershipId,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceAId,
        application_user_id: user.id,
        status: 'active' as const,
        provisioning_method: 'admin_invite' as const,
      })),
      {
        id: fixture.users.sibling.membershipId,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceBId,
        application_user_id: fixture.users.sibling.id,
        status: 'active',
        provisioning_method: 'admin_invite',
      },
    ])
    .execute();
  await database
    .insertInto('membership_facilities')
    .values([
      ...[
        fixture.users.dual,
        fixture.users.schedulingOnly,
        fixture.users.patientsOnly,
      ].map((user) => ({
        tenant_id: fixture.tenantId,
        membership_id: user.membershipId,
        facility_id: fixture.facilityA1Id,
      })),
      {
        tenant_id: fixture.tenantId,
        membership_id: fixture.users.sibling.membershipId,
        facility_id: fixture.facilityB1Id,
      },
    ])
    .execute();

  const permissions = await database
    .selectFrom('permissions')
    .select(['id', 'code'])
    .where('code', 'in', ['scheduling.manage', 'patients.read'])
    .execute();
  const schedulingPermissionId = permissions.find(
    ({ code }) => code === 'scheduling.manage',
  )?.id;
  const patientsPermissionId = permissions.find(
    ({ code }) => code === 'patients.read',
  )?.id;
  const schedulerRole = await database
    .selectFrom('roles')
    .select('id')
    .where('tenant_id', 'is', null)
    .where('code', '=', 'SCHEDULER')
    .executeTakeFirst();
  if (!schedulingPermissionId || !patientsPermissionId || !schedulerRole) {
    throw new Error('Expected queue permissions and scheduler role.');
  }
  await database
    .insertInto('roles')
    .values([
      {
        id: fixture.roles.schedulingOnly,
        tenant_id: fixture.tenantId,
        code: 'QUEUE_SCHEDULING_ONLY',
        name: 'Queue scheduling only',
        description: 'Synthetic scheduling-only queue test role.',
        is_system_template: false,
        request_policy: 'admin_only',
        cloned_from_role_id: null,
        status: 'active',
        created_by_user_id: null,
      },
      {
        id: fixture.roles.patientsOnly,
        tenant_id: fixture.tenantId,
        code: 'QUEUE_PATIENTS_ONLY',
        name: 'Queue patients only',
        description: 'Synthetic patients-only queue test role.',
        is_system_template: false,
        request_policy: 'admin_only',
        cloned_from_role_id: null,
        status: 'active',
        created_by_user_id: null,
      },
    ])
    .execute();
  await database
    .insertInto('role_permissions')
    .values([
      {
        role_id: fixture.roles.schedulingOnly,
        permission_id: schedulingPermissionId,
        granted_by_user_id: null,
      },
      {
        role_id: fixture.roles.patientsOnly,
        permission_id: patientsPermissionId,
        granted_by_user_id: null,
      },
    ])
    .execute();
  await database
    .insertInto('role_assignments')
    .values([
      {
        tenant_id: fixture.tenantId,
        membership_id: fixture.users.dual.membershipId,
        role_id: schedulerRole.id,
        scope_organization_id: fixture.practiceAId,
        facility_id: fixture.facilityA1Id,
        include_descendants: false,
        assignment_source: 'system_bootstrap',
      },
      {
        tenant_id: fixture.tenantId,
        membership_id: fixture.users.schedulingOnly.membershipId,
        role_id: fixture.roles.schedulingOnly,
        scope_organization_id: fixture.practiceAId,
        facility_id: fixture.facilityA1Id,
        include_descendants: false,
        assignment_source: 'system_bootstrap',
      },
      {
        tenant_id: fixture.tenantId,
        membership_id: fixture.users.patientsOnly.membershipId,
        role_id: fixture.roles.patientsOnly,
        scope_organization_id: fixture.practiceAId,
        facility_id: fixture.facilityA1Id,
        include_descendants: false,
        assignment_source: 'system_bootstrap',
      },
      {
        tenant_id: fixture.tenantId,
        membership_id: fixture.users.sibling.membershipId,
        role_id: schedulerRole.id,
        scope_organization_id: fixture.practiceBId,
        facility_id: fixture.facilityB1Id,
        include_descendants: false,
        assignment_source: 'system_bootstrap',
      },
    ])
    .execute();
}

async function insertProviderChain(
  database: Kysely<DatabaseSchema>,
  scope: SchedulingScope,
  label: string,
): Promise<ProviderChain> {
  const practitionerId = randomUUID();
  const specialtyId = randomUUID();
  const practitionerFacilityAssignmentId = randomUUID();
  const appointmentServiceId = randomUUID();
  const practitionerServiceAssignmentId = randomUUID();
  const availabilityTemplateId = randomUUID();
  const code = safeCode(label);

  await database
    .insertInto('practitioners')
    .values({
      id: practitionerId,
      tenant_id: fixture.tenantId,
      application_user_id: null,
      display_name: `Dr Queue ${label}`,
      professional_title: 'Synthetic physician',
      status: 'active',
      is_synthetic: true,
    })
    .execute();
  await database
    .insertInto('specialties')
    .values({
      id: specialtyId,
      tenant_id: fixture.tenantId,
      organization_id: scope.organizationId,
      code: `SP-${code}`,
      name: `Queue specialty ${label}`,
      status: 'active',
      is_synthetic: true,
    })
    .execute();
  await database
    .insertInto('practitioner_facility_assignments')
    .values({
      id: practitionerFacilityAssignmentId,
      tenant_id: fixture.tenantId,
      organization_id: scope.organizationId,
      facility_id: scope.facilityId,
      practitioner_id: practitionerId,
      status: 'active',
      is_synthetic: true,
    })
    .execute();
  await database
    .insertInto('appointment_services')
    .values({
      id: appointmentServiceId,
      tenant_id: fixture.tenantId,
      organization_id: scope.organizationId,
      facility_id: scope.facilityId,
      specialty_id: specialtyId,
      code: `SV-${code}`,
      patient_facing_name: `Queue consultation ${label}`,
      duration_minutes: 30,
      allows_any_practitioner: true,
      status: 'active',
      is_synthetic: true,
    })
    .execute();
  await database
    .insertInto('practitioner_service_assignments')
    .values({
      id: practitionerServiceAssignmentId,
      tenant_id: fixture.tenantId,
      organization_id: scope.organizationId,
      facility_id: scope.facilityId,
      practitioner_facility_assignment_id: practitionerFacilityAssignmentId,
      practitioner_id: practitionerId,
      appointment_service_id: appointmentServiceId,
      status: 'active',
      is_synthetic: true,
    })
    .execute();
  await database
    .insertInto('practitioner_availability_templates')
    .values({
      id: availabilityTemplateId,
      tenant_id: fixture.tenantId,
      organization_id: scope.organizationId,
      facility_id: scope.facilityId,
      practitioner_facility_assignment_id: practitionerFacilityAssignmentId,
      practitioner_service_assignment_id: practitionerServiceAssignmentId,
      practitioner_id: practitionerId,
      appointment_service_id: appointmentServiceId,
      iso_weekday: sourceIsoWeekday,
      local_start_minute: 780,
      local_end_minute: 960,
      effective_from: sourceLocalDate,
      effective_until: null,
      source_timezone: 'Asia/Dubai',
      status: 'active',
      is_synthetic: true,
    })
    .execute();

  return {
    scope,
    practitionerId,
    practitionerFacilityAssignmentId,
    practitionerServiceAssignmentId,
    appointmentServiceId,
    availabilityTemplateId,
    sourceLocalDate,
  };
}

async function insertSlot(
  database: Kysely<DatabaseSchema>,
  chain: ProviderChain,
  offsetMinutes: number,
  withdrawalPending = false,
): Promise<SlotFixture> {
  const id = randomUUID();
  const startsAt = new Date(sourceSlotStart.getTime() + offsetMinutes * 60_000);
  const endsAt = new Date(startsAt.getTime() + 30 * 60_000);
  const generationKey = sha256(
    `uae-health:synthetic-provider-slot:v1|${chain.availabilityTemplateId}|${chain.sourceLocalDate}|${Math.floor(startsAt.getTime() / 1000)}|${Math.floor(endsAt.getTime() / 1000)}`,
  );

  await database
    .insertInto('patient_portal_appointment_slots')
    .values({
      id,
      bookable_practice_id: chain.scope.bookablePracticeId,
      tenant_id: fixture.tenantId,
      organization_id: chain.scope.organizationId,
      starts_at: startsAt,
      ends_at: endsAt,
      facility_id: chain.scope.facilityId,
      practitioner_facility_assignment_id:
        chain.practitionerFacilityAssignmentId,
      practitioner_service_assignment_id: chain.practitionerServiceAssignmentId,
      practitioner_id: chain.practitionerId,
      appointment_service_id: chain.appointmentServiceId,
      availability_template_id: chain.availabilityTemplateId,
      generation_key_hash: generationKey,
      source_local_date: chain.sourceLocalDate,
      source_timezone: 'Asia/Dubai',
      status: 'available',
      withdrawal_pending: withdrawalPending,
      is_synthetic: true,
    })
    .execute();

  return { id, startsAt, endsAt };
}

async function insertPatient(
  database: Kysely<DatabaseSchema>,
  scope: SchedulingScope,
  label: string,
): Promise<PatientFixture> {
  const applicationUserId = randomUUID();
  const identityId = randomUUID();
  const relationshipId = randomUUID();
  const displayName = `Synthetic Queue Patient ${label}`;
  const privateEmail = `private.queue.${label}@example.invalid`;
  const privateSubject = `private-queue-patient-subject-${label}`;

  await database
    .insertInto('application_users')
    .values({
      id: applicationUserId,
      display_name: displayName,
      primary_email: privateEmail,
      status: 'active',
      is_synthetic: true,
    })
    .execute();
  await database
    .insertInto('patient_portal_identities')
    .values({
      id: identityId,
      application_user_id: applicationUserId,
      issuer: 'https://patient-idp.example.invalid/queue-tests',
      subject: privateSubject,
      client_id: 'private-queue-patient-client',
      username: privateEmail,
      status: 'active',
      provider_sync_status: 'synchronized',
      provider_sync_attempted_at: null,
      provider_sync_completed_at: null,
      provider_sync_error_code: null,
      last_authenticated_at: null,
    })
    .execute();
  await database
    .insertInto('patient_portal_appointment_relationships')
    .values({
      id: relationshipId,
      tenant_id: fixture.tenantId,
      organization_id: scope.organizationId,
      patient_portal_identity_id: identityId,
      status: 'pending',
    })
    .execute();

  const sessionExpiry = new Date('2036-01-01T00:00:00.000Z');
  return {
    applicationUserId,
    identityId,
    relationshipId,
    displayName,
    privateEmail,
    privateSubject,
    session: {
      sessionId: randomUUID(),
      principal: {
        issuer: 'https://patient-idp.example.invalid/queue-tests',
        subject: privateSubject,
        clientId: 'private-queue-patient-client',
      },
      patientPortalIdentityId: identityId,
      applicationUserId,
      displayName,
      context: {
        kind: 'appointment-onboarding',
        appointmentRelationshipId: relationshipId,
        practiceName: scope.organizationName,
        tenantId: fixture.tenantId,
        organizationId: scope.organizationId,
      },
      availablePractices: [],
      appointmentOnboardingPractices: [
        {
          appointmentRelationshipId: relationshipId,
          practiceName: scope.organizationName,
        },
      ],
      csrfToken: `synthetic-csrf-${label}`,
      idleExpiresAt: sessionExpiry,
      absoluteExpiresAt: sessionExpiry,
      renewed: false,
    },
  };
}

async function insertAppointment(
  database: Kysely<DatabaseSchema>,
  chain: ProviderChain,
  patient: PatientFixture,
  slot: SlotFixture,
  status: PatientPortalAppointmentStatus = 'requested',
): Promise<{ id: string; version: number }> {
  const id = randomUUID();
  const appointment = await database
    .insertInto('patient_portal_appointments')
    .values({
      id,
      tenant_id: fixture.tenantId,
      organization_id: chain.scope.organizationId,
      patient_portal_identity_id: patient.identityId,
      patient_portal_profile_id: null,
      patient_portal_appointment_relationship_id: patient.relationshipId,
      appointment_slot_id: slot.id,
      facility_id: chain.scope.facilityId,
      practitioner_facility_assignment_id:
        chain.practitionerFacilityAssignmentId,
      practitioner_service_assignment_id: chain.practitionerServiceAssignmentId,
      practitioner_id: chain.practitionerId,
      appointment_service_id: chain.appointmentServiceId,
      status,
      version: 1,
      cancelled_at: status === 'cancelled' ? new Date() : null,
    })
    .returning(['id', 'version'])
    .executeTakeFirstOrThrow();
  return appointment;
}

function queueQuery(scope: SchedulingScope) {
  return {
    organizationId: scope.organizationId,
    facilityId: scope.facilityId,
    page: 1,
    pageSize: 100,
  };
}

function decisionInput(
  scope: SchedulingScope,
  status: 'confirmed' | 'declined',
  expectedVersion = 1,
) {
  return {
    organizationId: scope.organizationId,
    facilityId: scope.facilityId,
    status,
    expectedVersion,
    reasonCode:
      status === 'confirmed'
        ? ('appointment-request-confirmed' as const)
        : ('appointment-request-provider-unavailable' as const),
  };
}

function createSchedulingService(
  database: Kysely<DatabaseSchema>,
): WorkforceAppointmentQueueService {
  const provider = identityProvider();
  const databaseService = { client: database } as DatabaseService;
  return new WorkforceAppointmentQueueService(
    new WorkforceAppointmentQueueRepository(
      databaseService,
      new AuthorizationService(
        new AuthorizationRepository(databaseService, provider),
      ),
    ),
  );
}

function rejectedReason(result: PromiseSettledResult<unknown>): unknown {
  return result.status === 'rejected' ? result.reason : undefined;
}

describeWithDatabase('workforce appointment queue repository', () => {
  const schemaName = `workforce_appointment_queue_${process.pid}_${Date.now()}`;
  let adminDatabase: Kysely<unknown>;
  let database: Kysely<DatabaseSchema>;
  let concurrentDatabase: Kysely<DatabaseSchema>;
  let patientDatabase: Kysely<DatabaseSchema>;
  let scheduling: WorkforceAppointmentQueueService;
  let concurrentScheduling: WorkforceAppointmentQueueService;
  let patientAppointments: PatientAppointmentsService;

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
    await insertBaseFixture(database);
    scheduling = createSchedulingService(database);

    concurrentDatabase = createDatabaseClient<DatabaseSchema>({
      connectionString: databaseUrl!,
      maxConnections: 1,
      ssl: false,
    });
    await sql`set search_path to ${sql.id(schemaName)}, public`.execute(
      concurrentDatabase,
    );
    concurrentScheduling = createSchedulingService(concurrentDatabase);

    patientDatabase = createDatabaseClient<DatabaseSchema>({
      connectionString: databaseUrl!,
      maxConnections: 1,
      ssl: false,
    });
    await sql`set search_path to ${sql.id(schemaName)}, public`.execute(
      patientDatabase,
    );
    patientAppointments = new PatientAppointmentsService({
      client: patientDatabase,
    } as DatabaseService);
  });

  afterAll(async () => {
    if (patientDatabase) await patientDatabase.destroy();
    if (concurrentDatabase) await concurrentDatabase.destroy();
    if (database) await database.destroy();
    if (adminDatabase) {
      await sql`drop schema if exists ${sql.id(schemaName)} cascade`.execute(
        adminDatabase,
      );
      await adminDatabase.destroy();
    }
  });

  it('requires both exact-facility permissions and returns a private resolution queue', async () => {
    const requestedChain = await insertProviderChain(
      database,
      scopeA1,
      'scope-requested',
    );
    const requestedPatient = await insertPatient(
      database,
      scopeA1,
      'scope-requested',
    );
    const requested = await insertAppointment(
      database,
      requestedChain,
      requestedPatient,
      await insertSlot(database, requestedChain, 0),
    );

    const pendingChain = await insertProviderChain(
      database,
      scopeA1,
      'scope-pending',
    );
    const pendingPatient = await insertPatient(
      database,
      scopeA1,
      'scope-pending',
    );
    const pending = await insertAppointment(
      database,
      pendingChain,
      pendingPatient,
      await insertSlot(database, pendingChain, 0, true),
    );

    const inactiveChain = await insertProviderChain(
      database,
      scopeA1,
      'scope-inactive',
    );
    const inactivePatient = await insertPatient(
      database,
      scopeA1,
      'scope-inactive',
    );
    const inactive = await insertAppointment(
      database,
      inactiveChain,
      inactivePatient,
      await insertSlot(database, inactiveChain, 0),
    );
    await database
      .updateTable('practitioner_service_assignments')
      .set({ status: 'inactive', updated_at: new Date() })
      .where('id', '=', inactiveChain.practitionerServiceAssignmentId)
      .execute();

    const confirmedChain = await insertProviderChain(
      database,
      scopeA1,
      'scope-confirmed',
    );
    const confirmedPatient = await insertPatient(
      database,
      scopeA1,
      'scope-confirmed',
    );
    const confirmed = await insertAppointment(
      database,
      confirmedChain,
      confirmedPatient,
      await insertSlot(database, confirmedChain, 0),
      'confirmed',
    );

    const declinedChain = await insertProviderChain(
      database,
      scopeA1,
      'scope-declined',
    );
    const declinedPatient = await insertPatient(
      database,
      scopeA1,
      'scope-declined',
    );
    const declined = await insertAppointment(
      database,
      declinedChain,
      declinedPatient,
      await insertSlot(database, declinedChain, 0),
      'declined',
    );

    const otherFacilityChain = await insertProviderChain(
      database,
      scopeA2,
      'scope-other-facility',
    );
    const otherFacilityPatient = await insertPatient(
      database,
      scopeA2,
      'scope-other-facility',
    );
    const otherFacility = await insertAppointment(
      database,
      otherFacilityChain,
      otherFacilityPatient,
      await insertSlot(database, otherFacilityChain, 0),
    );

    const siblingChain = await insertProviderChain(
      database,
      scopeB1,
      'scope-sibling-practice',
    );
    const siblingPatient = await insertPatient(
      database,
      scopeB1,
      'scope-sibling-practice',
    );
    const sibling = await insertAppointment(
      database,
      siblingChain,
      siblingPatient,
      await insertSlot(database, siblingChain, 0),
    );

    const page = await scheduling.listAppointments(
      principal(fixture.users.dual.subject),
      queueQuery(scopeA1),
    );
    expect(page.total).toBe(4);
    expect(page.items.map(({ appointmentId }) => appointmentId)).toEqual(
      [confirmed.id, inactive.id, pending.id, requested.id].sort(),
    );
    expect(page.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          appointmentId: pending.id,
          withdrawalPending: true,
        }),
        expect.objectContaining({ appointmentId: inactive.id }),
        expect.objectContaining({
          appointmentId: confirmed.id,
          status: 'confirmed',
        }),
      ]),
    );
    const serialized = JSON.stringify(page);
    expect(serialized).toContain(requestedPatient.displayName);
    for (const privateValue of [
      requestedPatient.privateEmail,
      requestedPatient.privateSubject,
      requestedPatient.applicationUserId,
      requestedPatient.identityId,
      requestedPatient.relationshipId,
      otherFacility.id,
      sibling.id,
      fixture.practiceBId,
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
    expect(serialized).not.toContain(declined.id);

    const confirmedOnly = await scheduling.listAppointments(
      principal(fixture.users.dual.subject),
      { ...queueQuery(scopeA1), status: 'confirmed' },
    );
    expect(
      confirmedOnly.items.map(({ appointmentId }) => appointmentId),
    ).toEqual([confirmed.id]);

    for (const actor of [
      fixture.users.schedulingOnly,
      fixture.users.patientsOnly,
      fixture.users.sibling,
    ]) {
      await expect(
        scheduling.listAppointments(
          principal(actor.subject),
          queueQuery(scopeA1),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
    await expect(
      scheduling.listAppointments(
        principal(fixture.users.dual.subject),
        queueQuery(scopeA2),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const denials = await database
      .selectFrom('audit_events')
      .select(['facility_id', 'outcome', 'after_data'])
      .where('organization_id', '=', fixture.practiceAId)
      .where('outcome', '=', 'denied')
      .execute();
    expect(denials.length).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(denials)).not.toContain(
      requestedPatient.privateEmail,
    );
  });

  it('confirms and declines idempotently while reconciling released pending slots', async () => {
    const actor = principal(fixture.users.dual.subject);
    const confirmChain = await insertProviderChain(
      database,
      scopeA1,
      'decision-confirm',
    );
    const confirmPatient = await insertPatient(
      database,
      scopeA1,
      'decision-confirm',
    );
    const confirmSlot = await insertSlot(database, confirmChain, 0, true);
    const confirmationTarget = await insertAppointment(
      database,
      confirmChain,
      confirmPatient,
      confirmSlot,
    );
    const confirmKey = 'queue-decision-confirm-idempotency-key';
    const confirmed = await scheduling.changeAppointmentStatus(
      actor,
      confirmKey,
      confirmationTarget.id,
      decisionInput(scopeA1, 'confirmed'),
    );
    expect(confirmed.appointment).toMatchObject({
      appointmentId: confirmationTarget.id,
      status: 'confirmed',
      version: 2,
      withdrawalPending: true,
    });
    await expect(
      patientAppointments.listAppointments(confirmPatient.session),
    ).resolves.toMatchObject({
      appointments: [
        expect.objectContaining({
          appointmentId: confirmationTarget.id,
          status: 'confirmed',
          canCancel: false,
          canReschedule: false,
        }),
      ],
    });
    await expect(
      scheduling.changeAppointmentStatus(
        actor,
        confirmKey,
        confirmationTarget.id,
        decisionInput(scopeA1, 'confirmed'),
      ),
    ).resolves.toEqual(confirmed);
    await expect(
      scheduling.changeAppointmentStatus(
        actor,
        confirmKey,
        confirmationTarget.id,
        decisionInput(scopeA1, 'confirmed', 2),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      scheduling.changeAppointmentStatus(
        actor,
        'queue-decision-confirm-stale-key',
        confirmationTarget.id,
        decisionInput(scopeA1, 'confirmed'),
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    const invalidChain = await insertProviderChain(
      database,
      scopeA1,
      'decision-invalid-pending',
    );
    const invalidPatient = await insertPatient(
      database,
      scopeA1,
      'decision-invalid-pending',
    );
    const invalidSlot = await insertSlot(database, invalidChain, 0, true);
    const invalidTarget = await insertAppointment(
      database,
      invalidChain,
      invalidPatient,
      invalidSlot,
    );
    await database
      .insertInto('provider_availability_exceptions')
      .values({
        tenant_id: fixture.tenantId,
        organization_id: scopeA1.organizationId,
        facility_id: scopeA1.facilityId,
        practitioner_facility_assignment_id:
          invalidChain.practitionerFacilityAssignmentId,
        practitioner_id: invalidChain.practitionerId,
        kind: 'practitioner_unavailable',
        is_all_day: false,
        local_starts_at: `${invalidChain.sourceLocalDate} 13:00:00`,
        local_ends_at: `${invalidChain.sourceLocalDate} 13:30:00`,
        starts_at: invalidSlot.startsAt,
        ends_at: invalidSlot.endsAt,
        source_timezone: 'Asia/Dubai',
        status: 'active',
        is_synthetic: true,
      })
      .execute();
    await scheduling.changeAppointmentStatus(
      actor,
      'queue-decision-decline-invalid-pending',
      invalidTarget.id,
      decisionInput(scopeA1, 'declined'),
    );
    await expect(
      patientAppointments.listAppointments(invalidPatient.session),
    ).resolves.toMatchObject({
      appointments: [
        expect.objectContaining({
          appointmentId: invalidTarget.id,
          status: 'declined',
          canCancel: false,
          canReschedule: false,
        }),
      ],
    });
    expect(
      await database
        .selectFrom('patient_portal_appointment_slots')
        .select(['status', 'withdrawal_pending'])
        .where('id', '=', invalidSlot.id)
        .executeTakeFirstOrThrow(),
    ).toEqual({ status: 'withdrawn', withdrawal_pending: false });

    const restoredChain = await insertProviderChain(
      database,
      scopeA1,
      'decision-valid-pending',
    );
    const restoredPatient = await insertPatient(
      database,
      scopeA1,
      'decision-valid-pending',
    );
    const restoredSlot = await insertSlot(database, restoredChain, 0, true);
    const restoredTarget = await insertAppointment(
      database,
      restoredChain,
      restoredPatient,
      restoredSlot,
    );
    await scheduling.changeAppointmentStatus(
      actor,
      'queue-decision-decline-valid-pending',
      restoredTarget.id,
      decisionInput(scopeA1, 'declined'),
    );
    expect(
      await database
        .selectFrom('patient_portal_appointment_slots')
        .select(['status', 'withdrawal_pending'])
        .where('id', '=', restoredSlot.id)
        .executeTakeFirstOrThrow(),
    ).toEqual({ status: 'available', withdrawal_pending: false });

    const reusableChain = await insertProviderChain(
      database,
      scopeA1,
      'decision-capacity-release',
    );
    const firstPatient = await insertPatient(
      database,
      scopeA1,
      'decision-capacity-first',
    );
    const secondPatient = await insertPatient(
      database,
      scopeA1,
      'decision-capacity-second',
    );
    const reusableSlot = await insertSlot(database, reusableChain, 0);
    const reusableTarget = await insertAppointment(
      database,
      reusableChain,
      firstPatient,
      reusableSlot,
    );
    await scheduling.changeAppointmentStatus(
      actor,
      'queue-decision-decline-capacity-release',
      reusableTarget.id,
      decisionInput(scopeA1, 'declined'),
    );
    await expect(
      patientAppointments.createAppointment(
        secondPatient.session,
        'queue-second-patient-booking-after-decline',
        reusableSlot.id,
      ),
    ).resolves.toMatchObject({
      appointment: { status: 'requested', version: 1 },
    });

    const [commands, audits] = await Promise.all([
      database
        .selectFrom('workforce_scheduling_commands')
        .select(['idempotency_key_hash', 'request_hash', 'response_data'])
        .where('operation', '=', 'appointment_request_decision')
        .where('target_entity_id', '=', confirmationTarget.id)
        .execute(),
      database
        .selectFrom('audit_events')
        .select(['before_data', 'after_data'])
        .where('target_entity_id', '=', confirmationTarget.id)
        .where('outcome', '=', 'success')
        .execute(),
    ]);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      idempotency_key_hash: sha256(confirmKey),
    });
    expect(commands[0]?.request_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(audits).toHaveLength(1);
    const storedEvidence = JSON.stringify({ commands, audits });
    expect(storedEvidence).not.toContain(confirmKey);
    expect(storedEvidence).not.toContain(confirmPatient.privateEmail);
    expect(storedEvidence).not.toContain(confirmPatient.privateSubject);
  });

  it('replays one concurrent equivalent decision only after current dual authorization', async () => {
    const actor = principal(fixture.users.dual.subject);
    const chain = await insertProviderChain(
      database,
      scopeA1,
      'decision-concurrent-replay',
    );
    const patient = await insertPatient(
      database,
      scopeA1,
      'decision-concurrent-replay',
    );
    const slot = await insertSlot(database, chain, 0);
    const appointment = await insertAppointment(database, chain, patient, slot);
    const idempotencyKey = 'queue-concurrent-equivalent-decision-key';
    const request = decisionInput(scopeA1, 'confirmed');

    const [first, replayed] = await Promise.all([
      scheduling.changeAppointmentStatus(
        actor,
        idempotencyKey,
        appointment.id,
        request,
      ),
      concurrentScheduling.changeAppointmentStatus(
        actor,
        idempotencyKey,
        appointment.id,
        request,
      ),
    ]);
    expect(replayed).toEqual(first);
    const [commands, successAudits] = await Promise.all([
      database
        .selectFrom('workforce_scheduling_commands')
        .select('id')
        .where('operation', '=', 'appointment_request_decision')
        .where('target_entity_id', '=', appointment.id)
        .execute(),
      database
        .selectFrom('audit_events')
        .select('id')
        .where('target_entity_id', '=', appointment.id)
        .where('outcome', '=', 'success')
        .execute(),
    ]);
    expect(commands).toHaveLength(1);
    expect(successAudits).toHaveLength(1);

    const schedulerRole = await database
      .selectFrom('roles')
      .select('id')
      .where('tenant_id', 'is', null)
      .where('code', '=', 'SCHEDULER')
      .executeTakeFirstOrThrow();
    const patientsPermission = await database
      .selectFrom('permissions')
      .select('id')
      .where('code', '=', 'patients.read')
      .executeTakeFirstOrThrow();
    await database
      .deleteFrom('role_permissions')
      .where('role_id', '=', schedulerRole.id)
      .where('permission_id', '=', patientsPermission.id)
      .execute();
    try {
      await expect(
        scheduling.changeAppointmentStatus(
          actor,
          idempotencyKey,
          appointment.id,
          request,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    } finally {
      await database
        .insertInto('role_permissions')
        .values({
          role_id: schedulerRole.id,
          permission_id: patientsPermission.id,
          granted_by_user_id: null,
        })
        .onConflict((conflict) => conflict.doNothing())
        .execute();
    }

    expect(
      await database
        .selectFrom('patient_portal_appointments')
        .select(['status', 'version'])
        .where('id', '=', appointment.id)
        .executeTakeFirstOrThrow(),
    ).toEqual({ status: 'confirmed', version: 2 });
    expect(
      await database
        .selectFrom('workforce_scheduling_commands')
        .select('id')
        .where('operation', '=', 'appointment_request_decision')
        .where('target_entity_id', '=', appointment.id)
        .execute(),
    ).toHaveLength(1);
    const denial = await database
      .selectFrom('audit_events')
      .select(['facility_id', 'outcome', 'after_data'])
      .where('target_entity_id', '=', appointment.id)
      .where('outcome', '=', 'denied')
      .executeTakeFirstOrThrow();
    expect(denial).toEqual({
      facility_id: scopeA1.facilityId,
      outcome: 'denied',
      after_data: {
        permissionCode: 'patients.read',
        confidential: false,
      },
    });
  });

  it('hides guessed sibling-practice and other-facility decision targets', async () => {
    const siblingChain = await insertProviderChain(
      database,
      scopeB1,
      'decision-private-sibling',
    );
    const siblingPatient = await insertPatient(
      database,
      scopeB1,
      'decision-private-sibling',
    );
    const siblingAppointment = await insertAppointment(
      database,
      siblingChain,
      siblingPatient,
      await insertSlot(database, siblingChain, 0),
    );
    const otherFacilityChain = await insertProviderChain(
      database,
      scopeA2,
      'decision-private-facility',
    );
    const otherFacilityPatient = await insertPatient(
      database,
      scopeA2,
      'decision-private-facility',
    );
    const otherFacilityAppointment = await insertAppointment(
      database,
      otherFacilityChain,
      otherFacilityPatient,
      await insertSlot(database, otherFacilityChain, 0),
    );
    const actor = principal(fixture.users.dual.subject);
    const targets = [siblingAppointment.id, otherFacilityAppointment.id];

    for (const [index, appointmentId] of targets.entries()) {
      await expect(
        scheduling.changeAppointmentStatus(
          actor,
          `queue-private-target-decision-key-${index}`,
          appointmentId,
          decisionInput(scopeA1, 'declined'),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    }

    const denials = await database
      .selectFrom('audit_events')
      .select([
        'facility_id',
        'target_entity_id',
        'outcome',
        'before_data',
        'after_data',
      ])
      .where('target_entity_id', 'in', targets)
      .where('outcome', '=', 'denied')
      .orderBy('target_entity_id')
      .execute();
    expect(denials).toHaveLength(2);
    expect(denials).toEqual(
      targets.sort().map((targetEntityId) => ({
        facility_id: scopeA1.facilityId,
        target_entity_id: targetEntityId,
        outcome: 'denied',
        before_data: null,
        after_data: {
          permissionCode: 'patients.read',
          confidential: false,
        },
      })),
    );
    const serialized = JSON.stringify(denials);
    expect(serialized).not.toContain(siblingPatient.privateEmail);
    expect(serialized).not.toContain(siblingPatient.privateSubject);
    expect(
      await database
        .selectFrom('workforce_scheduling_commands')
        .select('id')
        .where('target_entity_id', 'in', targets)
        .execute(),
    ).toHaveLength(0);
  });

  it('rolls back a decline, its pending-slot release, and command when audit persistence fails', async () => {
    const chain = await insertProviderChain(
      database,
      scopeA1,
      'decision-audit-rollback',
    );
    const patient = await insertPatient(
      database,
      scopeA1,
      'decision-audit-rollback',
    );
    const slot = await insertSlot(database, chain, 0, true);
    const appointment = await insertAppointment(database, chain, patient, slot);
    await database
      .insertInto('provider_availability_exceptions')
      .values({
        tenant_id: fixture.tenantId,
        organization_id: scopeA1.organizationId,
        facility_id: scopeA1.facilityId,
        practitioner_facility_assignment_id:
          chain.practitionerFacilityAssignmentId,
        practitioner_id: chain.practitionerId,
        kind: 'practitioner_unavailable',
        is_all_day: false,
        local_starts_at: `${chain.sourceLocalDate} 13:00:00`,
        local_ends_at: `${chain.sourceLocalDate} 13:30:00`,
        starts_at: slot.startsAt,
        ends_at: slot.endsAt,
        source_timezone: 'Asia/Dubai',
        status: 'active',
        is_synthetic: true,
      })
      .execute();
    await sql`
      create function reject_queue_decision_audit()
      returns trigger
      language plpgsql
      as $function$
      begin
        if new.action = 'scheduling.appointment_declined'
           and new.outcome = 'success' then
          raise exception 'Synthetic queue decision audit failure.';
        end if;
        return new;
      end;
      $function$
    `.execute(database);
    await sql`
      create trigger reject_queue_decision_audit
      before insert on audit_events
      for each row execute function reject_queue_decision_audit()
    `.execute(database);

    try {
      await expect(
        scheduling.changeAppointmentStatus(
          principal(fixture.users.dual.subject),
          'queue-decision-audit-rollback-key',
          appointment.id,
          decisionInput(scopeA1, 'declined'),
        ),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    } finally {
      await sql`
        drop trigger if exists reject_queue_decision_audit on audit_events
      `.execute(database);
      await sql`drop function if exists reject_queue_decision_audit()`.execute(
        database,
      );
    }

    expect(
      await database
        .selectFrom('patient_portal_appointments')
        .select(['status', 'version'])
        .where('id', '=', appointment.id)
        .executeTakeFirstOrThrow(),
    ).toEqual({ status: 'requested', version: 1 });
    expect(
      await database
        .selectFrom('patient_portal_appointment_slots')
        .select(['status', 'withdrawal_pending'])
        .where('id', '=', slot.id)
        .executeTakeFirstOrThrow(),
    ).toEqual({ status: 'available', withdrawal_pending: true });
    expect(
      await database
        .selectFrom('workforce_scheduling_commands')
        .select('id')
        .where('operation', '=', 'appointment_request_decision')
        .where('target_entity_id', '=', appointment.id)
        .execute(),
    ).toHaveLength(0);
  });

  it('serializes confirm versus decline and confirm versus patient cancellation', async () => {
    const actor = principal(fixture.users.dual.subject);
    const decisionChain = await insertProviderChain(
      database,
      scopeA1,
      'race-confirm-decline',
    );
    const decisionPatient = await insertPatient(
      database,
      scopeA1,
      'race-confirm-decline',
    );
    const decisionSlot = await insertSlot(database, decisionChain, 0);
    const decisionTarget = await insertAppointment(
      database,
      decisionChain,
      decisionPatient,
      decisionSlot,
    );
    const decisionRace = await Promise.allSettled([
      scheduling.changeAppointmentStatus(
        actor,
        'queue-race-confirm-key',
        decisionTarget.id,
        decisionInput(scopeA1, 'confirmed'),
      ),
      concurrentScheduling.changeAppointmentStatus(
        actor,
        'queue-race-decline-key',
        decisionTarget.id,
        decisionInput(scopeA1, 'declined'),
      ),
    ]);
    expect(
      decisionRace.filter(({ status }) => status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      decisionRace.filter(({ status }) => status === 'rejected'),
    ).toHaveLength(1);
    expect(
      rejectedReason(decisionRace.find(({ status }) => status === 'rejected')!),
    ).toBeInstanceOf(ConflictException);
    const decided = await database
      .selectFrom('patient_portal_appointments')
      .select(['status', 'version'])
      .where('id', '=', decisionTarget.id)
      .executeTakeFirstOrThrow();
    expect(['confirmed', 'declined']).toContain(decided.status);
    expect(decided.version).toBe(2);
    expect(
      await database
        .selectFrom('workforce_scheduling_commands')
        .select('id')
        .where('operation', '=', 'appointment_request_decision')
        .where('target_entity_id', '=', decisionTarget.id)
        .execute(),
    ).toHaveLength(1);

    const cancellationChain = await insertProviderChain(
      database,
      scopeA1,
      'race-confirm-cancel',
    );
    const cancellationPatient = await insertPatient(
      database,
      scopeA1,
      'race-confirm-cancel',
    );
    const cancellationSlot = await insertSlot(database, cancellationChain, 0);
    await insertSlot(database, cancellationChain, 30);
    const cancellationTarget = await insertAppointment(
      database,
      cancellationChain,
      cancellationPatient,
      cancellationSlot,
    );
    const cancellationRace = await Promise.allSettled([
      scheduling.changeAppointmentStatus(
        actor,
        'queue-race-confirm-cancel-workforce-key',
        cancellationTarget.id,
        decisionInput(scopeA1, 'confirmed'),
      ),
      patientAppointments.cancelAppointment(
        cancellationPatient.session,
        'queue-race-confirm-cancel-patient-key',
        cancellationTarget.id,
        1,
      ),
    ]);
    expect(
      cancellationRace.filter(({ status }) => status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      cancellationRace.filter(({ status }) => status === 'rejected'),
    ).toHaveLength(1);
    expect(
      rejectedReason(
        cancellationRace.find(({ status }) => status === 'rejected')!,
      ),
    ).toBeInstanceOf(ConflictException);
    const cancellationOutcome = await database
      .selectFrom('patient_portal_appointments')
      .select(['status', 'version'])
      .where('id', '=', cancellationTarget.id)
      .executeTakeFirstOrThrow();
    expect(['confirmed', 'cancelled']).toContain(cancellationOutcome.status);
    expect(cancellationOutcome.version).toBe(2);
    const liveOnOriginal = await database
      .selectFrom('patient_portal_appointments')
      .select('id')
      .where('appointment_slot_id', '=', cancellationSlot.id)
      .where('status', 'in', ['requested', 'confirmed'])
      .execute();
    expect(liveOnOriginal).toHaveLength(
      cancellationOutcome.status === 'confirmed' ? 1 : 0,
    );
  });

  it('serializes decline against a concrete patient reschedule without mixing provider scope', async () => {
    const chain = await insertProviderChain(
      database,
      scopeA1,
      'race-decline-reschedule',
    );
    const patient = await insertPatient(
      database,
      scopeA1,
      'race-decline-reschedule',
    );
    const originalSlot = await insertSlot(database, chain, 0);
    const replacementSlot = await insertSlot(database, chain, 30);
    const appointment = await insertAppointment(
      database,
      chain,
      patient,
      originalSlot,
    );

    const race = await Promise.allSettled([
      scheduling.changeAppointmentStatus(
        principal(fixture.users.dual.subject),
        'queue-race-decline-reschedule-workforce-key',
        appointment.id,
        decisionInput(scopeA1, 'declined'),
      ),
      patientAppointments.rescheduleAppointment(
        patient.session,
        'queue-race-decline-reschedule-patient-key',
        appointment.id,
        replacementSlot.id,
        1,
      ),
    ]);
    expect(race.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(race.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(
      rejectedReason(race.find(({ status }) => status === 'rejected')!),
    ).toBeInstanceOf(ConflictException);

    const outcome = await database
      .selectFrom('patient_portal_appointments')
      .select([
        'status',
        'version',
        'appointment_slot_id',
        'facility_id',
        'practitioner_facility_assignment_id',
        'practitioner_service_assignment_id',
        'practitioner_id',
        'appointment_service_id',
      ])
      .where('id', '=', appointment.id)
      .executeTakeFirstOrThrow();
    expect(outcome.version).toBe(2);
    expect(['declined', 'requested']).toContain(outcome.status);
    expect(outcome.appointment_slot_id).toBe(
      outcome.status === 'requested' ? replacementSlot.id : originalSlot.id,
    );
    expect(outcome).toMatchObject({
      facility_id: chain.scope.facilityId,
      practitioner_facility_assignment_id:
        chain.practitionerFacilityAssignmentId,
      practitioner_service_assignment_id: chain.practitionerServiceAssignmentId,
      practitioner_id: chain.practitionerId,
      appointment_service_id: chain.appointmentServiceId,
    });
    const liveAppointments = await database
      .selectFrom('patient_portal_appointments')
      .select(['appointment_slot_id'])
      .where('id', '=', appointment.id)
      .where('status', 'in', ['requested', 'confirmed'])
      .execute();
    expect(liveAppointments).toHaveLength(
      outcome.status === 'requested' ? 1 : 0,
    );
  });
});
