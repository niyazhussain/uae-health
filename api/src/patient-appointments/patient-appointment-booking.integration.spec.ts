import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Insertable, Kysely, sql } from 'kysely';
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
import * as addWorkforceAppointmentDecisions from '../database/migrations/2026-08-27T080000_add_workforce_appointment_decisions.js';
import type { PatientPortalSessionContext } from '../patient-portal-auth/patient-portal-auth.types.js';
import { PatientAppointmentsService } from './patient-appointments.service.js';
import type {
  PatientAppointmentCommandView,
  PatientProviderAwareAppointmentView,
} from './patient-appointments.types.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const issuer = 'https://patient-idp.example.invalid/booking-tests';
const clientId = 'synthetic-patient-booking-client';
const providerPrivateEmail = 'private.booking-doctor@example.invalid';

function fixtureUuid(sequence: number): string {
  return `fb000000-0000-4000-8000-${sequence.toString().padStart(12, '0')}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const fixture = {
  tenantId: fixtureUuid(1),
  practices: { exact: fixtureUuid(2), sibling: fixtureUuid(3) },
  facilities: { exact: fixtureUuid(4), sibling: fixtureUuid(5) },
  bookablePractices: { exact: fixtureUuid(6), sibling: fixtureUuid(7) },
  users: {
    patientA: fixtureUuid(8),
    patientB: fixtureUuid(9),
    providerLogin: fixtureUuid(10),
  },
  patientIdentities: { patientA: fixtureUuid(11), patientB: fixtureUuid(12) },
  patientProfile: fixtureUuid(13),
  patientProfileLink: fixtureUuid(14),
  relationships: { patientA: fixtureUuid(15), patientB: fixtureUuid(16) },
  sessions: {
    profileA: fixtureUuid(17),
    onboardingA: fixtureUuid(18),
    onboardingB: fixtureUuid(19),
    profileAConcurrent: fixtureUuid(44),
  },
  practitioners: {
    any: fixtureUuid(20),
    named: fixtureUuid(21),
    sibling: fixtureUuid(22),
  },
  specialties: { exact: fixtureUuid(23), sibling: fixtureUuid(24) },
  services: {
    any: fixtureUuid(25),
    named: fixtureUuid(26),
    sibling: fixtureUuid(27),
  },
  facilityAssignments: {
    any: fixtureUuid(28),
    named: fixtureUuid(29),
    sibling: fixtureUuid(30),
  },
  serviceAssignments: {
    any: fixtureUuid(31),
    named: fixtureUuid(32),
    sibling: fixtureUuid(33),
    namedAny: fixtureUuid(45),
  },
  templates: {
    any: fixtureUuid(34),
    named: fixtureUuid(35),
    sibling: fixtureUuid(36),
    namedAny: fixtureUuid(46),
  },
  slots: {
    equivalentAny: fixtureUuid(37),
    named: fixtureUuid(38),
    inactiveChain: fixtureUuid(39),
    competing: fixtureUuid(40),
    auditFailure: fixtureUuid(41),
    beyondHorizon: fixtureUuid(42),
    sibling: fixtureUuid(43),
    confirmedCancel: fixtureUuid(47),
    confirmedRescheduleOld: fixtureUuid(48),
    confirmedRescheduleNewDoctor: fixtureUuid(49),
    differentServiceOld: fixtureUuid(50),
    differentServiceTarget: fixtureUuid(51),
    staleTarget: fixtureUuid(52),
  },
} as const;

function futureInstant(days: number, minutes: number): Date {
  const value = new Date(Date.now() + days * 24 * 60 * 60_000);
  value.setUTCHours(8, 0, 0, 0);
  return new Date(value.getTime() + minutes * 60_000);
}

function sourceLocalDate(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dubai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: 'year' | 'month' | 'day') =>
    parts.find((candidate) => candidate.type === type)?.value;
  const year = part('year');
  const month = part('month');
  const day = part('day');
  if (!year || !month || !day) throw new Error('Expected a local date.');
  return `${year}-${month}-${day}`;
}

function isoWeekday(localDate: string): number {
  return ((new Date(`${localDate}T00:00:00.000Z`).getUTCDay() + 6) % 7) + 1;
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
      code: 'PATIENT-BOOKING',
      name: 'Synthetic Patient Booking Tenant',
      status: 'active',
      is_synthetic: true,
    })
    .execute();
  await database
    .insertInto('organizations')
    .values([
      {
        id: fixture.practices.exact,
        tenant_id: fixture.tenantId,
        parent_organization_id: null,
        kind: 'practice',
        code: 'BOOKING-EXACT',
        name: 'Synthetic Exact Booking Practice',
        is_synthetic: true,
      },
      {
        id: fixture.practices.sibling,
        tenant_id: fixture.tenantId,
        parent_organization_id: null,
        kind: 'practice',
        code: 'BOOKING-SIBLING',
        name: 'Private Sibling Booking Practice',
        is_synthetic: true,
      },
    ])
    .execute();
  await database
    .insertInto('facilities')
    .values([
      {
        id: fixture.facilities.exact,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        code: 'BOOKING-EXACT-FACILITY',
        name: 'Synthetic Exact Booking Facility',
        timezone: 'Asia/Dubai',
        is_synthetic: true,
      },
      {
        id: fixture.facilities.sibling,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.sibling,
        code: 'BOOKING-SIBLING-FACILITY',
        name: 'Private Sibling Booking Facility',
        timezone: 'Asia/Dubai',
        is_synthetic: true,
      },
    ])
    .execute();
  await database
    .insertInto('patient_portal_bookable_practices')
    .values([
      {
        id: fixture.bookablePractices.exact,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        timezone: 'Asia/Dubai',
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.bookablePractices.sibling,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.sibling,
        timezone: 'Asia/Dubai',
        status: 'active',
        is_synthetic: true,
      },
    ])
    .execute();
  await database
    .insertInto('application_users')
    .values([
      {
        id: fixture.users.patientA,
        display_name: 'Synthetic Booking Patient A',
        primary_email: 'private.booking.patient-a@example.invalid',
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.users.patientB,
        display_name: 'Synthetic Booking Patient B',
        primary_email: 'private.booking.patient-b@example.invalid',
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.users.providerLogin,
        display_name: 'Private Provider Login',
        primary_email: providerPrivateEmail,
        status: 'active',
        is_synthetic: true,
      },
    ])
    .execute();
  await database
    .insertInto('patient_portal_identities')
    .values([
      {
        id: fixture.patientIdentities.patientA,
        application_user_id: fixture.users.patientA,
        issuer,
        subject: 'synthetic-booking-patient-a',
        client_id: clientId,
        username: 'private.booking.patient-a@example.invalid',
        status: 'active',
        provider_sync_status: 'synchronized',
        provider_sync_attempted_at: null,
        provider_sync_completed_at: null,
        provider_sync_error_code: null,
        last_authenticated_at: null,
      },
      {
        id: fixture.patientIdentities.patientB,
        application_user_id: fixture.users.patientB,
        issuer,
        subject: 'synthetic-booking-patient-b',
        client_id: clientId,
        username: 'private.booking.patient-b@example.invalid',
        status: 'active',
        provider_sync_status: 'synchronized',
        provider_sync_attempted_at: null,
        provider_sync_completed_at: null,
        provider_sync_error_code: null,
        last_authenticated_at: null,
      },
    ])
    .execute();
  await database
    .insertInto('patient_portal_profiles')
    .values({
      id: fixture.patientProfile,
      tenant_id: fixture.tenantId,
      organization_id: fixture.practices.exact,
      application_user_id: fixture.users.patientA,
      status: 'active',
      is_synthetic: true,
    })
    .execute();
  await database
    .insertInto('patient_portal_profile_links')
    .values({
      id: fixture.patientProfileLink,
      patient_portal_profile_id: fixture.patientProfile,
      patient_portal_identity_id: fixture.patientIdentities.patientA,
      status: 'active',
      linked_by_user_id: null,
      link_reason: 'Synthetic provider-aware booking verification.',
      revoked_at: null,
      revoked_by_user_id: null,
      revocation_reason: null,
    })
    .execute();
  await database
    .insertInto('patient_portal_appointment_relationships')
    .values([
      {
        id: fixture.relationships.patientA,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        patient_portal_identity_id: fixture.patientIdentities.patientA,
        status: 'pending',
      },
      {
        id: fixture.relationships.patientB,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        patient_portal_identity_id: fixture.patientIdentities.patientB,
        status: 'pending',
      },
    ])
    .execute();

  const expiresAt = new Date(Date.now() + 8 * 60 * 60_000);
  await database
    .insertInto('patient_portal_sessions')
    .values([
      {
        id: fixture.sessions.profileA,
        session_token_hash: sha256('booking-profile-a-session'),
        csrf_token_hash: sha256('booking-profile-a-csrf'),
        patient_portal_identity_id: fixture.patientIdentities.patientA,
        patient_portal_profile_id: fixture.patientProfile,
        patient_portal_appointment_relationship_id: null,
        identity_issuer: issuer,
        identity_subject: 'synthetic-booking-patient-a',
        identity_client_id: clientId,
        identity_username: 'private.booking.patient-a@example.invalid',
        idle_expires_at: expiresAt,
        absolute_expires_at: expiresAt,
        revoked_at: null,
      },
      {
        id: fixture.sessions.onboardingA,
        session_token_hash: sha256('booking-onboarding-a-session'),
        csrf_token_hash: sha256('booking-onboarding-a-csrf'),
        patient_portal_identity_id: fixture.patientIdentities.patientA,
        patient_portal_profile_id: null,
        patient_portal_appointment_relationship_id:
          fixture.relationships.patientA,
        identity_issuer: issuer,
        identity_subject: 'synthetic-booking-patient-a',
        identity_client_id: clientId,
        identity_username: 'private.booking.patient-a@example.invalid',
        idle_expires_at: expiresAt,
        absolute_expires_at: expiresAt,
        revoked_at: null,
      },
      {
        id: fixture.sessions.profileAConcurrent,
        session_token_hash: sha256('booking-profile-a-concurrent-session'),
        csrf_token_hash: sha256('booking-profile-a-concurrent-csrf'),
        patient_portal_identity_id: fixture.patientIdentities.patientA,
        patient_portal_profile_id: fixture.patientProfile,
        patient_portal_appointment_relationship_id: null,
        identity_issuer: issuer,
        identity_subject: 'synthetic-booking-patient-a',
        identity_client_id: clientId,
        identity_username: 'private.booking.patient-a@example.invalid',
        idle_expires_at: expiresAt,
        absolute_expires_at: expiresAt,
        revoked_at: null,
      },
      {
        id: fixture.sessions.onboardingB,
        session_token_hash: sha256('booking-onboarding-b-session'),
        csrf_token_hash: sha256('booking-onboarding-b-csrf'),
        patient_portal_identity_id: fixture.patientIdentities.patientB,
        patient_portal_profile_id: null,
        patient_portal_appointment_relationship_id:
          fixture.relationships.patientB,
        identity_issuer: issuer,
        identity_subject: 'synthetic-booking-patient-b',
        identity_client_id: clientId,
        identity_username: 'private.booking.patient-b@example.invalid',
        idle_expires_at: expiresAt,
        absolute_expires_at: expiresAt,
        revoked_at: null,
      },
    ])
    .execute();
}

interface ProviderScope {
  organizationId: string;
  facilityId: string;
  bookablePracticeId: string;
  practitionerId: string;
  facilityAssignmentId: string;
  serviceAssignmentId: string;
  serviceId: string;
  templateId: string;
  templateStatus?: 'active' | 'inactive';
}

const providerScopes = {
  any: {
    organizationId: fixture.practices.exact,
    facilityId: fixture.facilities.exact,
    bookablePracticeId: fixture.bookablePractices.exact,
    practitionerId: fixture.practitioners.any,
    facilityAssignmentId: fixture.facilityAssignments.any,
    serviceAssignmentId: fixture.serviceAssignments.any,
    serviceId: fixture.services.any,
    templateId: fixture.templates.any,
    templateStatus: 'active',
  },
  named: {
    organizationId: fixture.practices.exact,
    facilityId: fixture.facilities.exact,
    bookablePracticeId: fixture.bookablePractices.exact,
    practitionerId: fixture.practitioners.named,
    facilityAssignmentId: fixture.facilityAssignments.named,
    serviceAssignmentId: fixture.serviceAssignments.named,
    serviceId: fixture.services.named,
    templateId: fixture.templates.named,
    templateStatus: 'active',
  },
  namedAny: {
    organizationId: fixture.practices.exact,
    facilityId: fixture.facilities.exact,
    bookablePracticeId: fixture.bookablePractices.exact,
    practitionerId: fixture.practitioners.named,
    facilityAssignmentId: fixture.facilityAssignments.named,
    serviceAssignmentId: fixture.serviceAssignments.namedAny,
    serviceId: fixture.services.any,
    templateId: fixture.templates.namedAny,
    templateStatus: 'inactive',
  },
  sibling: {
    organizationId: fixture.practices.sibling,
    facilityId: fixture.facilities.sibling,
    bookablePracticeId: fixture.bookablePractices.sibling,
    practitionerId: fixture.practitioners.sibling,
    facilityAssignmentId: fixture.facilityAssignments.sibling,
    serviceAssignmentId: fixture.serviceAssignments.sibling,
    serviceId: fixture.services.sibling,
    templateId: fixture.templates.sibling,
    templateStatus: 'active',
  },
} satisfies Record<string, ProviderScope>;

async function insertProviderFixture(
  database: Kysely<DatabaseSchema>,
): Promise<void> {
  await database
    .insertInto('practitioners')
    .values([
      {
        id: fixture.practitioners.any,
        tenant_id: fixture.tenantId,
        application_user_id: fixture.users.providerLogin,
        display_name: 'Dr Any Synthetic',
        professional_title: 'Synthetic family physician',
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.practitioners.named,
        tenant_id: fixture.tenantId,
        application_user_id: null,
        display_name: 'Dr Named Synthetic',
        professional_title: 'Synthetic consultant physician',
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.practitioners.sibling,
        tenant_id: fixture.tenantId,
        application_user_id: null,
        display_name: 'Private Sibling Doctor',
        professional_title: 'Private sibling title',
        status: 'active',
        is_synthetic: true,
      },
    ])
    .execute();
  await database
    .insertInto('specialties')
    .values([
      {
        id: fixture.specialties.exact,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        code: 'PRIVATE-EXACT-SPECIALTY-CODE',
        name: 'Synthetic Family Medicine',
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.specialties.sibling,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.sibling,
        code: 'PRIVATE-SIBLING-SPECIALTY-CODE',
        name: 'Private Sibling Specialty',
        status: 'active',
        is_synthetic: true,
      },
    ])
    .execute();
  await database
    .insertInto('practitioner_facility_assignments')
    .values([
      {
        id: fixture.facilityAssignments.any,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        facility_id: fixture.facilities.exact,
        practitioner_id: fixture.practitioners.any,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.facilityAssignments.named,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        facility_id: fixture.facilities.exact,
        practitioner_id: fixture.practitioners.named,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.facilityAssignments.sibling,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.sibling,
        facility_id: fixture.facilities.sibling,
        practitioner_id: fixture.practitioners.sibling,
        status: 'active',
        is_synthetic: true,
      },
    ])
    .execute();
  await database
    .insertInto('appointment_services')
    .values([
      {
        id: fixture.services.any,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        facility_id: fixture.facilities.exact,
        specialty_id: fixture.specialties.exact,
        code: 'PRIVATE-ANY-SERVICE-CODE',
        patient_facing_name: 'Synthetic Family Consultation',
        duration_minutes: 30,
        allows_any_practitioner: true,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.services.named,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        facility_id: fixture.facilities.exact,
        specialty_id: fixture.specialties.exact,
        code: 'PRIVATE-NAMED-SERVICE-CODE',
        patient_facing_name: 'Synthetic Named Doctor Consultation',
        duration_minutes: 30,
        allows_any_practitioner: false,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.services.sibling,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.sibling,
        facility_id: fixture.facilities.sibling,
        specialty_id: fixture.specialties.sibling,
        code: 'PRIVATE-SIBLING-SERVICE-CODE',
        patient_facing_name: 'Private Sibling Consultation',
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
        id: fixture.serviceAssignments.any,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        facility_id: fixture.facilities.exact,
        practitioner_facility_assignment_id: fixture.facilityAssignments.any,
        practitioner_id: fixture.practitioners.any,
        appointment_service_id: fixture.services.any,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.serviceAssignments.named,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        facility_id: fixture.facilities.exact,
        practitioner_facility_assignment_id: fixture.facilityAssignments.named,
        practitioner_id: fixture.practitioners.named,
        appointment_service_id: fixture.services.named,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.serviceAssignments.namedAny,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        facility_id: fixture.facilities.exact,
        practitioner_facility_assignment_id: fixture.facilityAssignments.named,
        practitioner_id: fixture.practitioners.named,
        appointment_service_id: fixture.services.any,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.serviceAssignments.sibling,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.sibling,
        facility_id: fixture.facilities.sibling,
        practitioner_facility_assignment_id:
          fixture.facilityAssignments.sibling,
        practitioner_id: fixture.practitioners.sibling,
        appointment_service_id: fixture.services.sibling,
        status: 'active',
        is_synthetic: true,
      },
    ])
    .execute();

  const nearDate = sourceLocalDate(futureInstant(14, 0));
  await database
    .insertInto('practitioner_availability_templates')
    .values(
      Object.values(providerScopes).map((scope) => ({
        id: scope.templateId,
        tenant_id: fixture.tenantId,
        organization_id: scope.organizationId,
        facility_id: scope.facilityId,
        practitioner_facility_assignment_id: scope.facilityAssignmentId,
        practitioner_service_assignment_id: scope.serviceAssignmentId,
        practitioner_id: scope.practitionerId,
        appointment_service_id: scope.serviceId,
        iso_weekday: isoWeekday(nearDate),
        local_start_minute: 720,
        local_end_minute: 960,
        effective_from: nearDate,
        effective_until: null,
        source_timezone: 'Asia/Dubai',
        status: scope.templateStatus,
        is_synthetic: true,
      })),
    )
    .execute();
}

function slotRow(
  id: string,
  scope: ProviderScope,
  startsAt: Date,
): Insertable<DatabaseSchema['patient_portal_appointment_slots']> {
  return {
    id,
    bookable_practice_id: scope.bookablePracticeId,
    tenant_id: fixture.tenantId,
    organization_id: scope.organizationId,
    starts_at: startsAt,
    ends_at: new Date(startsAt.getTime() + 30 * 60_000),
    facility_id: scope.facilityId,
    practitioner_facility_assignment_id: scope.facilityAssignmentId,
    practitioner_service_assignment_id: scope.serviceAssignmentId,
    practitioner_id: scope.practitionerId,
    appointment_service_id: scope.serviceId,
    availability_template_id: scope.templateId,
    generation_key_hash: sha256(`synthetic-booking-slot:${id}`),
    source_local_date: sourceLocalDate(startsAt),
    source_timezone: 'Asia/Dubai',
    status: 'available',
    withdrawal_pending: false,
    is_synthetic: true,
  };
}

async function insertSlotFixture(
  database: Kysely<DatabaseSchema>,
): Promise<void> {
  await database
    .insertInto('patient_portal_appointment_slots')
    .values([
      slotRow(
        fixture.slots.equivalentAny,
        providerScopes.any,
        futureInstant(14, 0),
      ),
      slotRow(fixture.slots.named, providerScopes.named, futureInstant(14, 0)),
      slotRow(
        fixture.slots.inactiveChain,
        providerScopes.any,
        futureInstant(14, 60),
      ),
      slotRow(
        fixture.slots.competing,
        providerScopes.any,
        futureInstant(14, 120),
      ),
      slotRow(
        fixture.slots.auditFailure,
        providerScopes.any,
        futureInstant(14, 180),
      ),
      slotRow(
        fixture.slots.beyondHorizon,
        providerScopes.any,
        futureInstant(70, 0),
      ),
      slotRow(
        fixture.slots.sibling,
        providerScopes.sibling,
        futureInstant(14, 0),
      ),
      slotRow(
        fixture.slots.confirmedCancel,
        providerScopes.any,
        futureInstant(15, 0),
      ),
      slotRow(
        fixture.slots.confirmedRescheduleOld,
        providerScopes.any,
        futureInstant(16, 0),
      ),
      slotRow(
        fixture.slots.confirmedRescheduleNewDoctor,
        providerScopes.namedAny,
        futureInstant(16, 60),
      ),
      slotRow(
        fixture.slots.differentServiceOld,
        providerScopes.any,
        futureInstant(17, 0),
      ),
      slotRow(
        fixture.slots.differentServiceTarget,
        providerScopes.named,
        futureInstant(17, 60),
      ),
      slotRow(
        fixture.slots.staleTarget,
        providerScopes.any,
        futureInstant(18, 0),
      ),
    ])
    .execute();
}

function patientSession(input: {
  patient: 'patientA' | 'patientB';
  sessionId: string;
  context: 'profile' | 'onboarding';
}): PatientPortalSessionContext {
  const patientA = input.patient === 'patientA';
  const applicationUserId = patientA
    ? fixture.users.patientA
    : fixture.users.patientB;
  const patientPortalIdentityId = patientA
    ? fixture.patientIdentities.patientA
    : fixture.patientIdentities.patientB;
  const subject = patientA
    ? 'synthetic-booking-patient-a'
    : 'synthetic-booking-patient-b';
  const relationshipId = patientA
    ? fixture.relationships.patientA
    : fixture.relationships.patientB;
  const expiresAt = new Date(Date.now() + 8 * 60 * 60_000);
  const context: PatientPortalSessionContext['context'] =
    input.context === 'profile'
      ? {
          kind: 'practice',
          portalProfileId: fixture.patientProfile,
          practiceName: 'Synthetic Exact Booking Practice',
          tenantId: fixture.tenantId,
          organizationId: fixture.practices.exact,
        }
      : {
          kind: 'appointment-onboarding',
          appointmentRelationshipId: relationshipId,
          practiceName: 'Synthetic Exact Booking Practice',
          tenantId: fixture.tenantId,
          organizationId: fixture.practices.exact,
        };

  return {
    sessionId: input.sessionId,
    principal: {
      issuer,
      subject,
      clientId,
      username: patientA
        ? 'private.booking.patient-a@example.invalid'
        : 'private.booking.patient-b@example.invalid',
    },
    patientPortalIdentityId,
    applicationUserId,
    displayName: patientA
      ? 'Synthetic Booking Patient A'
      : 'Synthetic Booking Patient B',
    context,
    availablePractices: patientA
      ? [
          {
            portalProfileId: fixture.patientProfile,
            practiceName: 'Synthetic Exact Booking Practice',
          },
        ]
      : [],
    appointmentOnboardingPractices: [
      {
        appointmentRelationshipId: relationshipId,
        practiceName: 'Synthetic Exact Booking Practice',
      },
    ],
    csrfToken: `synthetic-booking-csrf-${input.sessionId}`,
    idleExpiresAt: expiresAt,
    absoluteExpiresAt: expiresAt,
    renewed: false,
  };
}

const profileSessionA = () =>
  patientSession({
    patient: 'patientA',
    sessionId: fixture.sessions.profileA,
    context: 'profile',
  });

const concurrentProfileSessionA = () =>
  patientSession({
    patient: 'patientA',
    sessionId: fixture.sessions.profileAConcurrent,
    context: 'profile',
  });

const onboardingSessionA = () =>
  patientSession({
    patient: 'patientA',
    sessionId: fixture.sessions.onboardingA,
    context: 'onboarding',
  });

const onboardingSessionB = () =>
  patientSession({
    patient: 'patientB',
    sessionId: fixture.sessions.onboardingB,
    context: 'onboarding',
  });

function expectProviderAware(
  appointment: PatientAppointmentCommandView,
): asserts appointment is PatientProviderAwareAppointmentView {
  expect('slotId' in appointment).toBe(true);
  if (!('slotId' in appointment)) {
    throw new Error('Expected a provider-aware appointment response.');
  }
}

describeWithDatabase('patient provider-aware booking integration', () => {
  const schemaName = `patient_booking_${process.pid}_${Date.now()}`;
  let adminDatabase: Kysely<unknown>;
  let database: Kysely<DatabaseSchema>;
  let concurrentDatabase: Kysely<DatabaseSchema>;
  let appointments: PatientAppointmentsService;
  let concurrentAppointments: PatientAppointmentsService;

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
    concurrentDatabase = createDatabaseClient<DatabaseSchema>({
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
    await insertProviderFixture(database);
    await insertSlotFixture(database);
    await sql`set search_path to ${sql.id(schemaName)}, public`.execute(
      concurrentDatabase,
    );
    appointments = new PatientAppointmentsService({
      client: database,
    } as DatabaseService);
    concurrentAppointments = new PatientAppointmentsService({
      client: concurrentDatabase,
    } as DatabaseService);
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

  it('books and concurrently replays one any-doctor slot with an exact safe provider summary', async () => {
    const key = 'provider-aware-equivalent-booking-key';
    const [first, replay] = await Promise.all([
      appointments.createAppointment(
        profileSessionA(),
        key,
        fixture.slots.equivalentAny,
      ),
      concurrentAppointments.createAppointment(
        concurrentProfileSessionA(),
        key,
        fixture.slots.equivalentAny,
      ),
    ]);
    expect(replay).toEqual(first);
    expectProviderAware(first.appointment);
    expect(Object.keys(first.appointment).sort()).toEqual([
      'appointmentId',
      'canCancel',
      'canReschedule',
      'endsAt',
      'practitionerOption',
      'service',
      'slotId',
      'startsAt',
      'status',
      'version',
    ]);
    expect(first.appointment).toMatchObject({
      status: 'requested',
      version: 1,
      canCancel: true,
      canReschedule: true,
      slotId: fixture.slots.equivalentAny,
      service: {
        appointmentServiceId: fixture.services.any,
        patientFacingName: 'Synthetic Family Consultation',
        durationMinutes: 30,
        allowsAnyPractitioner: true,
        specialty: {
          specialtyId: fixture.specialties.exact,
          name: 'Synthetic Family Medicine',
        },
        facility: {
          facilityId: fixture.facilities.exact,
          name: 'Synthetic Exact Booking Facility',
          timezone: 'Asia/Dubai',
        },
      },
      practitionerOption: {
        practitionerOptionId: fixture.serviceAssignments.any,
        displayName: 'Dr Any Synthetic',
        professionalTitle: 'Synthetic family physician',
      },
    });
    const serialized = JSON.stringify(first);
    for (const privateValue of [
      providerPrivateEmail,
      fixture.practitioners.any,
      fixture.facilityAssignments.any,
      'PRIVATE-ANY-SERVICE-CODE',
      'PRIVATE-EXACT-SPECIALTY-CODE',
    ]) {
      expect(serialized).not.toContain(privateValue);
    }

    await expect(
      database
        .selectFrom('patient_portal_appointments')
        .select([
          'appointment_slot_id',
          'facility_id',
          'practitioner_facility_assignment_id',
          'practitioner_service_assignment_id',
          'practitioner_id',
          'appointment_service_id',
          'status',
          'version',
        ])
        .where('id', '=', first.appointment.appointmentId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      appointment_slot_id: fixture.slots.equivalentAny,
      facility_id: fixture.facilities.exact,
      practitioner_facility_assignment_id: fixture.facilityAssignments.any,
      practitioner_service_assignment_id: fixture.serviceAssignments.any,
      practitioner_id: fixture.practitioners.any,
      appointment_service_id: fixture.services.any,
      status: 'requested',
      version: 1,
    });
    const commands = await database
      .selectFrom('patient_portal_appointment_commands')
      .select(['response_data', 'idempotency_key_hash', 'request_hash'])
      .where(
        'patient_portal_identity_id',
        '=',
        fixture.patientIdentities.patientA,
      )
      .where('operation', '=', 'appointment_create')
      .where('idempotency_key_hash', '=', sha256(key))
      .execute();
    expect(commands).toHaveLength(1);
    expect(commands[0]?.response_data).toEqual(first);
    expect(commands[0]?.idempotency_key_hash).toBe(sha256(key));
    expect(commands[0]?.request_hash).toMatch(/^[0-9a-f]{64}$/);
    const audit = await database
      .selectFrom('audit_events')
      .select(['facility_id', 'after_data'])
      .where('action', '=', 'patient.appointment_requested')
      .where('target_entity_id', '=', first.appointment.appointmentId)
      .executeTakeFirstOrThrow();
    expect(audit).toEqual({
      facility_id: fixture.facilities.exact,
      after_data: {
        status: 'requested',
        version: 1,
        patientContextKind: 'practice',
        patientContextId: fixture.patientProfile,
        slotId: fixture.slots.equivalentAny,
        facilityId: fixture.facilities.exact,
        practitionerFacilityAssignmentId: fixture.facilityAssignments.any,
        practitionerServiceAssignmentId: fixture.serviceAssignments.any,
        practitionerId: fixture.practitioners.any,
        appointmentServiceId: fixture.services.any,
      },
    });

    await expect(
      appointments.createAppointment(
        profileSessionA(),
        key,
        fixture.slots.inactiveChain,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    await database
      .updateTable('patient_portal_sessions')
      .set({ revoked_at: new Date() })
      .where('id', '=', fixture.sessions.profileA)
      .execute();
    await expect(
      appointments.createAppointment(
        profileSessionA(),
        key,
        fixture.slots.equivalentAny,
      ),
    ).rejects.toMatchObject({ message: 'Appointment is unavailable.' });
  });

  it('books a named-doctor slot and pins that exact local service assignment', async () => {
    const response = await appointments.createAppointment(
      onboardingSessionA(),
      'provider-aware-named-booking-key',
      fixture.slots.named,
    );
    expectProviderAware(response.appointment);
    expect(response.appointment).toMatchObject({
      slotId: fixture.slots.named,
      service: {
        appointmentServiceId: fixture.services.named,
        patientFacingName: 'Synthetic Named Doctor Consultation',
        allowsAnyPractitioner: false,
      },
      practitionerOption: {
        practitionerOptionId: fixture.serviceAssignments.named,
        displayName: 'Dr Named Synthetic',
        professionalTitle: 'Synthetic consultant physician',
      },
    });
    await expect(
      database
        .selectFrom('patient_portal_appointments')
        .select([
          'patient_portal_profile_id',
          'patient_portal_appointment_relationship_id',
          'practitioner_service_assignment_id',
        ])
        .where('id', '=', response.appointment.appointmentId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      patient_portal_profile_id: null,
      patient_portal_appointment_relationship_id:
        fixture.relationships.patientA,
      practitioner_service_assignment_id: fixture.serviceAssignments.named,
    });
  });

  it('rejects inactive, sibling, and beyond-horizon slots without partial booking evidence', async () => {
    const before = await database
      .selectFrom('patient_portal_appointments')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    await expect(
      appointments.createAppointment(
        onboardingSessionA(),
        'provider-aware-beyond-horizon-key',
        fixture.slots.beyondHorizon,
      ),
    ).rejects.toMatchObject({
      message: 'The selected appointment time is no longer available.',
    });
    await expect(
      appointments.createAppointment(
        onboardingSessionA(),
        'provider-aware-sibling-slot-key',
        fixture.slots.sibling,
      ),
    ).rejects.toMatchObject({
      message: 'The selected appointment time is no longer available.',
    });

    await database
      .updateTable('appointment_services')
      .set({ status: 'inactive' })
      .where('id', '=', fixture.services.any)
      .execute();
    try {
      await expect(
        appointments.createAppointment(
          onboardingSessionA(),
          'provider-aware-inactive-chain-key',
          fixture.slots.inactiveChain,
        ),
      ).rejects.toMatchObject({
        message: 'The selected appointment time is no longer available.',
      });
    } finally {
      await database
        .updateTable('appointment_services')
        .set({ status: 'active' })
        .where('id', '=', fixture.services.any)
        .execute();
    }

    const after = await database
      .selectFrom('patient_portal_appointments')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    expect(Number(after.count)).toBe(Number(before.count));
    await expect(
      database
        .selectFrom('patient_portal_appointment_commands')
        .select('id')
        .where('idempotency_key_hash', 'in', [
          sha256('provider-aware-beyond-horizon-key'),
          sha256('provider-aware-sibling-slot-key'),
          sha256('provider-aware-inactive-chain-key'),
        ])
        .execute(),
    ).resolves.toEqual([]);
  });

  it('allows exactly one patient to reserve a concrete provider slot concurrently', async () => {
    const results = await Promise.allSettled([
      appointments.createAppointment(
        onboardingSessionA(),
        'provider-aware-competing-patient-a-key',
        fixture.slots.competing,
      ),
      concurrentAppointments.createAppointment(
        onboardingSessionB(),
        'provider-aware-competing-patient-b-key',
        fixture.slots.competing,
      ),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status).toBe('rejected');
    if (rejected?.status === 'rejected') {
      expect(rejected.reason as unknown).toBeInstanceOf(ConflictException);
    }
    await expect(
      database
        .selectFrom('patient_portal_appointments')
        .select('id')
        .where('appointment_slot_id', '=', fixture.slots.competing)
        .where('status', 'in', ['requested', 'confirmed'])
        .execute(),
    ).resolves.toHaveLength(1);
  });

  it('cancels a future confirmed appointment and reconciles its pending provider slot', async () => {
    const booked = await appointments.createAppointment(
      onboardingSessionA(),
      'provider-aware-confirmed-cancel-create-key',
      fixture.slots.confirmedCancel,
    );
    await database
      .updateTable('patient_portal_appointments')
      .set({ status: 'confirmed', version: 2, updated_at: new Date() })
      .where('id', '=', booked.appointment.appointmentId)
      .execute();
    await database
      .updateTable('patient_portal_appointment_slots')
      .set({ withdrawal_pending: true })
      .where('id', '=', fixture.slots.confirmedCancel)
      .execute();

    const key = 'provider-aware-confirmed-cancel-key';
    const cancelled = await appointments.cancelAppointment(
      onboardingSessionA(),
      key,
      booked.appointment.appointmentId,
      2,
    );
    expectProviderAware(cancelled.appointment);
    expect(cancelled.appointment).toMatchObject({
      appointmentId: booked.appointment.appointmentId,
      status: 'cancelled',
      version: 3,
      canCancel: false,
      canReschedule: false,
      slotId: fixture.slots.confirmedCancel,
      service: { appointmentServiceId: fixture.services.any },
      practitionerOption: {
        practitionerOptionId: fixture.serviceAssignments.any,
      },
    });
    await expect(
      appointments.cancelAppointment(
        onboardingSessionA(),
        key,
        booked.appointment.appointmentId,
        2,
      ),
    ).resolves.toEqual(cancelled);
    const cancelledRow = await database
      .selectFrom('patient_portal_appointments')
      .select(['status', 'version', 'cancelled_at'])
      .where('id', '=', booked.appointment.appointmentId)
      .executeTakeFirstOrThrow();
    expect(cancelledRow).toMatchObject({
      status: 'cancelled',
      version: 3,
    });
    expect(cancelledRow.cancelled_at).toBeInstanceOf(Date);
    await expect(
      database
        .selectFrom('patient_portal_appointment_slots')
        .select(['status', 'withdrawal_pending'])
        .where('id', '=', fixture.slots.confirmedCancel)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ status: 'withdrawn', withdrawal_pending: false });
    await expect(
      database
        .selectFrom('audit_events')
        .select(['facility_id', 'before_data', 'after_data'])
        .where('action', '=', 'patient.appointment_cancelled')
        .where('target_entity_id', '=', booked.appointment.appointmentId)
        .executeTakeFirstOrThrow(),
    ).resolves.toMatchObject({
      facility_id: fixture.facilities.exact,
      before_data: {
        status: 'confirmed',
        version: 2,
        patientContextKind: 'appointment-onboarding',
        patientContextId: fixture.relationships.patientA,
        slotId: fixture.slots.confirmedCancel,
        appointmentServiceId: fixture.services.any,
      },
      after_data: {
        status: 'cancelled',
        version: 3,
        releasedSlotId: fixture.slots.confirmedCancel,
        releasedSlotDisposition: 'withdrawn',
      },
    });
  });

  it('reschedules a confirmed appointment to an explicit eligible doctor and returns it to requested', async () => {
    const booked = await appointments.createAppointment(
      onboardingSessionA(),
      'provider-aware-confirmed-reschedule-create-key',
      fixture.slots.confirmedRescheduleOld,
    );
    await database
      .updateTable('patient_portal_appointments')
      .set({ status: 'confirmed', version: 2, updated_at: new Date() })
      .where('id', '=', booked.appointment.appointmentId)
      .execute();

    const key = 'provider-aware-confirmed-reschedule-key';
    const changed = await appointments.rescheduleAppointment(
      onboardingSessionA(),
      key,
      booked.appointment.appointmentId,
      fixture.slots.confirmedRescheduleNewDoctor,
      2,
    );
    expectProviderAware(changed.appointment);
    expect(changed.appointment).toMatchObject({
      appointmentId: booked.appointment.appointmentId,
      status: 'requested',
      version: 3,
      canCancel: true,
      canReschedule: true,
      slotId: fixture.slots.confirmedRescheduleNewDoctor,
      service: { appointmentServiceId: fixture.services.any },
      practitionerOption: {
        practitionerOptionId: fixture.serviceAssignments.namedAny,
        displayName: 'Dr Named Synthetic',
      },
    });
    await expect(
      database
        .selectFrom('patient_portal_appointments')
        .select([
          'status',
          'version',
          'appointment_slot_id',
          'facility_id',
          'practitioner_service_assignment_id',
          'practitioner_id',
          'appointment_service_id',
        ])
        .where('id', '=', booked.appointment.appointmentId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      status: 'requested',
      version: 3,
      appointment_slot_id: fixture.slots.confirmedRescheduleNewDoctor,
      facility_id: fixture.facilities.exact,
      practitioner_service_assignment_id: fixture.serviceAssignments.namedAny,
      practitioner_id: fixture.practitioners.named,
      appointment_service_id: fixture.services.any,
    });
    await expect(
      database
        .selectFrom('patient_portal_appointment_slots')
        .select(['status', 'withdrawal_pending'])
        .where('id', '=', fixture.slots.confirmedRescheduleOld)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ status: 'available', withdrawal_pending: false });
    await expect(
      database
        .selectFrom('audit_events')
        .select(['facility_id', 'before_data', 'after_data'])
        .where('action', '=', 'patient.appointment_reschedule_requested')
        .where('target_entity_id', '=', booked.appointment.appointmentId)
        .executeTakeFirstOrThrow(),
    ).resolves.toMatchObject({
      facility_id: fixture.facilities.exact,
      before_data: {
        status: 'confirmed',
        version: 2,
        patientContextKind: 'appointment-onboarding',
        patientContextId: fixture.relationships.patientA,
        slotId: fixture.slots.confirmedRescheduleOld,
        practitionerServiceAssignmentId: fixture.serviceAssignments.any,
        appointmentServiceId: fixture.services.any,
      },
      after_data: {
        status: 'requested',
        version: 3,
        slotId: fixture.slots.confirmedRescheduleNewDoctor,
        practitionerServiceAssignmentId: fixture.serviceAssignments.namedAny,
        appointmentServiceId: fixture.services.any,
        releasedSlotId: fixture.slots.confirmedRescheduleOld,
      },
    });

    await expect(
      appointments.rescheduleAppointment(
        onboardingSessionA(),
        key,
        booked.appointment.appointmentId,
        fixture.slots.confirmedRescheduleNewDoctor,
        2,
      ),
    ).resolves.toEqual(changed);
    await expect(
      appointments.rescheduleAppointment(
        onboardingSessionA(),
        key,
        booked.appointment.appointmentId,
        fixture.slots.staleTarget,
        2,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      appointments.rescheduleAppointment(
        onboardingSessionA(),
        'provider-aware-stale-reschedule-key',
        booked.appointment.appointmentId,
        fixture.slots.staleTarget,
        2,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      database
        .selectFrom('patient_portal_appointments')
        .select(['version', 'appointment_slot_id'])
        .where('id', '=', booked.appointment.appointmentId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      version: 3,
      appointment_slot_id: fixture.slots.confirmedRescheduleNewDoctor,
    });
  });

  it('rejects an explicit replacement slot from another appointment service without side effects', async () => {
    const booked = await appointments.createAppointment(
      onboardingSessionA(),
      'provider-aware-different-service-create-key',
      fixture.slots.differentServiceOld,
    );
    const key = 'provider-aware-different-service-reschedule-key';
    await expect(
      appointments.rescheduleAppointment(
        onboardingSessionA(),
        key,
        booked.appointment.appointmentId,
        fixture.slots.differentServiceTarget,
        1,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      database
        .selectFrom('patient_portal_appointments')
        .select(['status', 'version', 'appointment_slot_id'])
        .where('id', '=', booked.appointment.appointmentId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      status: 'requested',
      version: 1,
      appointment_slot_id: fixture.slots.differentServiceOld,
    });
    await expect(
      database
        .selectFrom('patient_portal_appointment_commands')
        .select('id')
        .where('idempotency_key_hash', '=', sha256(key))
        .execute(),
    ).resolves.toEqual([]);
  });

  it('rolls back a provider-aware reschedule when audit persistence fails', async () => {
    const key = 'provider-aware-reschedule-audit-failure-key';
    const appointment = await database
      .selectFrom('patient_portal_appointments')
      .select(['id', 'version', 'appointment_slot_id'])
      .where('appointment_slot_id', '=', fixture.slots.differentServiceOld)
      .executeTakeFirstOrThrow();
    await sql`
      create function fail_patient_reschedule_audit() returns trigger
      language plpgsql as $function$
      begin
        if new.action = 'patient.appointment_reschedule_requested' then
          raise exception 'synthetic reschedule audit failure';
        end if;
        return new;
      end;
      $function$
    `.execute(database);
    await sql`
      create trigger fail_patient_reschedule_audit_trigger
      before insert on audit_events
      for each row execute function fail_patient_reschedule_audit()
    `.execute(database);
    try {
      await expect(
        appointments.rescheduleAppointment(
          onboardingSessionA(),
          key,
          appointment.id,
          fixture.slots.staleTarget,
          appointment.version,
        ),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    } finally {
      await sql`
        drop trigger if exists fail_patient_reschedule_audit_trigger
        on audit_events
      `.execute(database);
      await sql`drop function if exists fail_patient_reschedule_audit()`.execute(
        database,
      );
    }

    await expect(
      database
        .selectFrom('patient_portal_appointments')
        .select(['version', 'appointment_slot_id'])
        .where('id', '=', appointment.id)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      version: appointment.version,
      appointment_slot_id: appointment.appointment_slot_id,
    });
    await expect(
      database
        .selectFrom('patient_portal_appointment_commands')
        .select('id')
        .where('idempotency_key_hash', '=', sha256(key))
        .execute(),
    ).resolves.toEqual([]);
  });

  it('rolls back the appointment and durable command when booking audit persistence fails', async () => {
    const key = 'provider-aware-audit-failure-booking-key';
    await sql`
      create function fail_patient_booking_audit() returns trigger
      language plpgsql as $function$
      begin
        if new.action = 'patient.appointment_requested' then
          raise exception 'synthetic booking audit failure';
        end if;
        return new;
      end;
      $function$
    `.execute(database);
    await sql`
      create trigger fail_patient_booking_audit_trigger
      before insert on audit_events
      for each row execute function fail_patient_booking_audit()
    `.execute(database);
    try {
      await expect(
        appointments.createAppointment(
          onboardingSessionA(),
          key,
          fixture.slots.auditFailure,
        ),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    } finally {
      await sql`
        drop trigger if exists fail_patient_booking_audit_trigger
        on audit_events
      `.execute(database);
      await sql`drop function if exists fail_patient_booking_audit()`.execute(
        database,
      );
    }

    await expect(
      database
        .selectFrom('patient_portal_appointments')
        .select('id')
        .where('appointment_slot_id', '=', fixture.slots.auditFailure)
        .execute(),
    ).resolves.toEqual([]);
    await expect(
      database
        .selectFrom('patient_portal_appointment_commands')
        .select('id')
        .where('idempotency_key_hash', '=', sha256(key))
        .execute(),
    ).resolves.toEqual([]);
  });
});
