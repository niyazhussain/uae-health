import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Kysely, sql } from 'kysely';
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
import type { PatientPortalSessionContext } from '../patient-portal-auth/patient-portal-auth.types.js';
import { PatientAppointmentsService } from './patient-appointments.service.js';
import type {
  PatientAppointmentPractitionerOptionView,
  PatientAppointmentServiceView,
  PatientAppointmentSlotView,
} from './patient-appointments.types.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const patientIssuer =
  'https://patient-idp.example.invalid/discovery-integration-tests';

function fixtureUuid(sequence: number): string {
  return `fa000000-0000-4000-8000-${sequence.toString().padStart(12, '0')}`;
}

let fixtureSequence = 0;
const nextFixtureUuid = () => fixtureUuid(++fixtureSequence);

const fixture = {
  tenantId: nextFixtureUuid(),
  practices: {
    exact: nextFixtureUuid(),
    sibling: nextFixtureUuid(),
  },
  facilities: {
    exact: nextFixtureUuid(),
    sibling: nextFixtureUuid(),
  },
  bookablePractices: {
    exact: nextFixtureUuid(),
    sibling: nextFixtureUuid(),
  },
  identityConnectionId: nextFixtureUuid(),
  users: {
    patient: nextFixtureUuid(),
    foreignPatient: nextFixtureUuid(),
    linkedPractitioner: nextFixtureUuid(),
  },
  userIdentities: {
    linkedPractitioner: nextFixtureUuid(),
  },
  memberships: {
    linkedPractitionerSibling: nextFixtureUuid(),
  },
  patientIdentities: {
    patient: nextFixtureUuid(),
    foreignPatient: nextFixtureUuid(),
  },
  patientProfile: nextFixtureUuid(),
  patientProfileLink: nextFixtureUuid(),
  relationships: {
    exact: nextFixtureUuid(),
    foreignExact: nextFixtureUuid(),
    sibling: nextFixtureUuid(),
  },
  practitioners: {
    shared: nextFixtureUuid(),
    tiedName: nextFixtureUuid(),
    inactive: nextFixtureUuid(),
    inactiveAffiliation: nextFixtureUuid(),
    inactiveEligibility: nextFixtureUuid(),
    nonSynthetic: nextFixtureUuid(),
  },
  specialties: {
    active: nextFixtureUuid(),
    retired: nextFixtureUuid(),
    nonSynthetic: nextFixtureUuid(),
    sibling: nextFixtureUuid(),
  },
  services: {
    any: nextFixtureUuid(),
    namedOnly: nextFixtureUuid(),
    empty: nextFixtureUuid(),
    inactive: nextFixtureUuid(),
    retiredSpecialty: nextFixtureUuid(),
    inactivePractitioner: nextFixtureUuid(),
    inactiveAffiliation: nextFixtureUuid(),
    inactiveEligibility: nextFixtureUuid(),
    nonSynthetic: nextFixtureUuid(),
    sibling: nextFixtureUuid(),
  },
  facilityAssignments: {
    sharedExact: nextFixtureUuid(),
    tiedNameExact: nextFixtureUuid(),
    inactivePractitioner: nextFixtureUuid(),
    inactive: nextFixtureUuid(),
    inactiveEligibility: nextFixtureUuid(),
    nonSynthetic: nextFixtureUuid(),
    sharedSibling: nextFixtureUuid(),
  },
  serviceAssignments: {
    anyShared: nextFixtureUuid(),
    anyTiedName: nextFixtureUuid(),
    anyInactivePractitioner: nextFixtureUuid(),
    anyInactiveAffiliation: nextFixtureUuid(),
    anyInactiveEligibility: nextFixtureUuid(),
    anyNonSynthetic: nextFixtureUuid(),
    namedShared: nextFixtureUuid(),
    emptyShared: nextFixtureUuid(),
    inactiveService: nextFixtureUuid(),
    retiredSpecialty: nextFixtureUuid(),
    inactivePractitioner: nextFixtureUuid(),
    inactiveAffiliation: nextFixtureUuid(),
    inactiveEligibility: nextFixtureUuid(),
    nonSynthetic: nextFixtureUuid(),
    siblingShared: nextFixtureUuid(),
  },
  templates: {
    anyShared: nextFixtureUuid(),
    anyTiedName: nextFixtureUuid(),
    namedShared: nextFixtureUuid(),
    inactiveService: nextFixtureUuid(),
    retiredSpecialty: nextFixtureUuid(),
    inactivePractitioner: nextFixtureUuid(),
    inactiveAffiliation: nextFixtureUuid(),
    inactiveEligibility: nextFixtureUuid(),
    nonSynthetic: nextFixtureUuid(),
    siblingShared: nextFixtureUuid(),
  },
  slots: {
    tiedShared: nextFixtureUuid(),
    tiedOther: nextFixtureUuid(),
    withdrawalPending: nextFixtureUuid(),
    withdrawn: nextFixtureUuid(),
    requested: nextFixtureUuid(),
    confirmed: nextFixtureUuid(),
    declined: nextFixtureUuid(),
    cancelled: nextFixtureUuid(),
    laterVisible: nextFixtureUuid(),
    past: nextFixtureUuid(),
    beyondPublicationHorizon: nextFixtureUuid(),
    named: nextFixtureUuid(),
    inactiveService: nextFixtureUuid(),
    retiredSpecialty: nextFixtureUuid(),
    inactivePractitioner: nextFixtureUuid(),
    inactiveAffiliation: nextFixtureUuid(),
    inactiveEligibility: nextFixtureUuid(),
    nonSynthetic: nextFixtureUuid(),
    sibling: nextFixtureUuid(),
  },
  appointments: {
    requested: nextFixtureUuid(),
    confirmed: nextFixtureUuid(),
    declined: nextFixtureUuid(),
    cancelled: nextFixtureUuid(),
    siblingPrivate: nextFixtureUuid(),
  },
} as const;

const privateSentinels = {
  providerEmail: 'private.shared-doctor@example.invalid',
  providerSubject: 'private-shared-doctor-subject',
  patientEmail: 'private.discovery-patient@example.invalid',
  siblingPracticeName: 'Private Sibling Discovery Practice',
  siblingFacilityName: 'Private Sibling Discovery Facility',
  serviceCode: 'PRIVATE-INTERNAL-SERVICE',
  specialtyCode: 'PRIVATE-INTERNAL-SPECIALTY',
} as const;

function futureInstant(minutesFromBase: number): Date {
  const value = new Date(Date.now() + 14 * 24 * 60 * 60_000);
  value.setUTCHours(6, 0, 0, 0);
  return new Date(value.getTime() + minutesFromBase * 60_000);
}

function farFutureInstant(): Date {
  const value = new Date(Date.now() + 70 * 24 * 60 * 60_000);
  value.setUTCHours(6, 0, 0, 0);
  return value;
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
  if (!year || !month || !day) {
    throw new Error('Expected a canonical synthetic discovery date.');
  }
  return `${year}-${month}-${day}`;
}

function isoWeekday(localDate: string): number {
  return ((new Date(`${localDate}T00:00:00.000Z`).getUTCDay() + 6) % 7) + 1;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

interface ProviderScope {
  practitionerId: string;
  facilityAssignmentId: string;
  serviceAssignmentId: string;
  serviceId: string;
  templateId: string;
  organizationId?: string;
  facilityId?: string;
  bookablePracticeId?: string;
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
      code: 'PATIENT-DISCOVERY',
      name: 'Synthetic Patient Discovery Tenant',
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
        code: 'DISCOVERY-EXACT',
        name: 'Synthetic Exact Discovery Practice',
        is_synthetic: true,
      },
      {
        id: fixture.practices.sibling,
        tenant_id: fixture.tenantId,
        parent_organization_id: null,
        kind: 'practice',
        code: 'DISCOVERY-SIBLING',
        name: privateSentinels.siblingPracticeName,
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
        code: 'DISCOVERY-EXACT-FACILITY',
        name: 'Synthetic Exact Discovery Facility',
        timezone: 'Asia/Dubai',
        is_synthetic: true,
      },
      {
        id: fixture.facilities.sibling,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.sibling,
        code: 'DISCOVERY-SIBLING-FACILITY',
        name: privateSentinels.siblingFacilityName,
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
        id: fixture.users.patient,
        display_name: 'Synthetic Discovery Patient',
        primary_email: privateSentinels.patientEmail,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.users.foreignPatient,
        display_name: 'Private Foreign Discovery Patient',
        primary_email: 'private.foreign-patient@example.invalid',
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.users.linkedPractitioner,
        display_name: 'Private Linked Workforce Identity',
        primary_email: privateSentinels.providerEmail,
        status: 'active',
        is_synthetic: true,
      },
    ])
    .execute();
  await database
    .insertInto('identity_connections')
    .values({
      id: fixture.identityConnectionId,
      tenant_id: fixture.tenantId,
      code: 'discovery-workforce-idp',
      name: 'Private discovery workforce identity provider',
      protocol: 'oidc',
      issuer: 'https://workforce-idp.example.invalid/private-discovery',
      status: 'active',
      jit_provisioning_enabled: false,
    })
    .execute();
  await database
    .insertInto('user_identities')
    .values({
      id: fixture.userIdentities.linkedPractitioner,
      application_user_id: fixture.users.linkedPractitioner,
      identity_connection_id: fixture.identityConnectionId,
      subject: privateSentinels.providerSubject,
      status: 'active',
      provider_sync_status: 'synchronized',
      provider_sync_attempted_at: null,
      provider_sync_completed_at: null,
      provider_sync_error_code: null,
      last_authenticated_at: null,
    })
    .execute();
  await database
    .insertInto('organization_memberships')
    .values({
      id: fixture.memberships.linkedPractitionerSibling,
      tenant_id: fixture.tenantId,
      organization_id: fixture.practices.sibling,
      application_user_id: fixture.users.linkedPractitioner,
      status: 'active',
      provisioning_method: 'admin_invite',
      external_id: 'private-shared-doctor-membership',
    })
    .execute();

  await database
    .insertInto('patient_portal_identities')
    .values([
      {
        id: fixture.patientIdentities.patient,
        application_user_id: fixture.users.patient,
        issuer: patientIssuer,
        subject: 'synthetic-discovery-patient',
        client_id: 'synthetic-discovery-client',
        username: privateSentinels.patientEmail,
        status: 'active',
        provider_sync_status: 'synchronized',
        provider_sync_attempted_at: null,
        provider_sync_completed_at: null,
        provider_sync_error_code: null,
        last_authenticated_at: null,
      },
      {
        id: fixture.patientIdentities.foreignPatient,
        application_user_id: fixture.users.foreignPatient,
        issuer: patientIssuer,
        subject: 'private-foreign-discovery-patient',
        client_id: 'synthetic-discovery-client',
        username: 'private.foreign-patient@example.invalid',
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
      application_user_id: fixture.users.patient,
      status: 'active',
      is_synthetic: true,
    })
    .execute();
  await database
    .insertInto('patient_portal_profile_links')
    .values({
      id: fixture.patientProfileLink,
      patient_portal_profile_id: fixture.patientProfile,
      patient_portal_identity_id: fixture.patientIdentities.patient,
      status: 'active',
      linked_by_user_id: null,
      link_reason: 'Synthetic discovery integration fixture.',
      revoked_at: null,
      revoked_by_user_id: null,
      revocation_reason: null,
    })
    .execute();
  await database
    .insertInto('patient_portal_appointment_relationships')
    .values([
      {
        id: fixture.relationships.exact,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        patient_portal_identity_id: fixture.patientIdentities.patient,
        status: 'pending',
      },
      {
        id: fixture.relationships.foreignExact,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        patient_portal_identity_id: fixture.patientIdentities.foreignPatient,
        status: 'pending',
      },
      {
        id: fixture.relationships.sibling,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.sibling,
        patient_portal_identity_id: fixture.patientIdentities.patient,
        status: 'pending',
      },
    ])
    .execute();
}

async function insertCatalogueFixture(
  database: Kysely<DatabaseSchema>,
): Promise<void> {
  await database
    .insertInto('practitioners')
    .values([
      {
        id: fixture.practitioners.shared,
        tenant_id: fixture.tenantId,
        application_user_id: fixture.users.linkedPractitioner,
        display_name: 'Dr Same Name',
        professional_title: 'Consultant physician',
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.practitioners.tiedName,
        tenant_id: fixture.tenantId,
        application_user_id: null,
        display_name: 'Dr Same Name',
        professional_title: 'Specialist physician',
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.practitioners.inactive,
        tenant_id: fixture.tenantId,
        application_user_id: null,
        display_name: 'Private Inactive Practitioner',
        professional_title: 'Inactive physician',
        status: 'inactive',
        is_synthetic: true,
      },
      {
        id: fixture.practitioners.inactiveAffiliation,
        tenant_id: fixture.tenantId,
        application_user_id: null,
        display_name: 'Private Inactive Affiliation Practitioner',
        professional_title: 'Physician',
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.practitioners.inactiveEligibility,
        tenant_id: fixture.tenantId,
        application_user_id: null,
        display_name: 'Private Inactive Eligibility Practitioner',
        professional_title: 'Physician',
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.practitioners.nonSynthetic,
        tenant_id: fixture.tenantId,
        application_user_id: null,
        display_name: 'Private Non Synthetic Practitioner',
        professional_title: 'Physician',
        status: 'active',
        is_synthetic: false,
      },
    ])
    .execute();
  await database
    .insertInto('specialties')
    .values([
      {
        id: fixture.specialties.active,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        code: privateSentinels.specialtyCode,
        name: 'General medicine',
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.specialties.retired,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        code: 'PRIVATE-RETIRED-SPECIALTY',
        name: 'Private Retired Specialty',
        status: 'retired',
        is_synthetic: true,
      },
      {
        id: fixture.specialties.nonSynthetic,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        code: 'PRIVATE-NON-SYNTHETIC-SPECIALTY',
        name: 'Private Non Synthetic Specialty',
        status: 'active',
        is_synthetic: false,
      },
      {
        id: fixture.specialties.sibling,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.sibling,
        code: 'PRIVATE-SIBLING-SPECIALTY',
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
        id: fixture.facilityAssignments.sharedExact,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        facility_id: fixture.facilities.exact,
        practitioner_id: fixture.practitioners.shared,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.facilityAssignments.tiedNameExact,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        facility_id: fixture.facilities.exact,
        practitioner_id: fixture.practitioners.tiedName,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.facilityAssignments.inactivePractitioner,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        facility_id: fixture.facilities.exact,
        practitioner_id: fixture.practitioners.inactive,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.facilityAssignments.inactive,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        facility_id: fixture.facilities.exact,
        practitioner_id: fixture.practitioners.inactiveAffiliation,
        status: 'inactive',
        is_synthetic: true,
      },
      {
        id: fixture.facilityAssignments.inactiveEligibility,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        facility_id: fixture.facilities.exact,
        practitioner_id: fixture.practitioners.inactiveEligibility,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.facilityAssignments.nonSynthetic,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        facility_id: fixture.facilities.exact,
        practitioner_id: fixture.practitioners.nonSynthetic,
        status: 'active',
        is_synthetic: false,
      },
      {
        id: fixture.facilityAssignments.sharedSibling,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.sibling,
        facility_id: fixture.facilities.sibling,
        practitioner_id: fixture.practitioners.shared,
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
        specialty_id: fixture.specialties.active,
        code: privateSentinels.serviceCode,
        patient_facing_name: 'Consultation',
        duration_minutes: 30,
        allows_any_practitioner: true,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.services.namedOnly,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        facility_id: fixture.facilities.exact,
        specialty_id: fixture.specialties.active,
        code: 'PRIVATE-NAMED-ONLY-SERVICE',
        patient_facing_name: 'Named consultation',
        duration_minutes: 30,
        allows_any_practitioner: false,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.services.empty,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        facility_id: fixture.facilities.exact,
        specialty_id: fixture.specialties.active,
        code: 'PRIVATE-EMPTY-SERVICE',
        patient_facing_name: 'Consultation',
        duration_minutes: 45,
        allows_any_practitioner: true,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.services.inactive,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        facility_id: fixture.facilities.exact,
        specialty_id: fixture.specialties.active,
        code: 'PRIVATE-INACTIVE-SERVICE',
        patient_facing_name: 'Private Inactive Service',
        duration_minutes: 30,
        allows_any_practitioner: true,
        status: 'inactive',
        is_synthetic: true,
      },
      {
        id: fixture.services.retiredSpecialty,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        facility_id: fixture.facilities.exact,
        specialty_id: fixture.specialties.retired,
        code: 'PRIVATE-RETIRED-SPECIALTY-SERVICE',
        patient_facing_name: 'Private Retired Specialty Service',
        duration_minutes: 30,
        allows_any_practitioner: true,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.services.inactivePractitioner,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        facility_id: fixture.facilities.exact,
        specialty_id: fixture.specialties.active,
        code: 'PRIVATE-INACTIVE-PRACTITIONER-SERVICE',
        patient_facing_name: 'Private Inactive Practitioner Service',
        duration_minutes: 30,
        allows_any_practitioner: true,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.services.inactiveAffiliation,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        facility_id: fixture.facilities.exact,
        specialty_id: fixture.specialties.active,
        code: 'PRIVATE-INACTIVE-AFFILIATION-SERVICE',
        patient_facing_name: 'Private Inactive Affiliation Service',
        duration_minutes: 30,
        allows_any_practitioner: true,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.services.inactiveEligibility,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        facility_id: fixture.facilities.exact,
        specialty_id: fixture.specialties.active,
        code: 'PRIVATE-INACTIVE-ELIGIBILITY-SERVICE',
        patient_facing_name: 'Private Inactive Eligibility Service',
        duration_minutes: 30,
        allows_any_practitioner: true,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.services.nonSynthetic,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        facility_id: fixture.facilities.exact,
        specialty_id: fixture.specialties.nonSynthetic,
        code: 'PRIVATE-NON-SYNTHETIC-SERVICE',
        patient_facing_name: 'Private Non Synthetic Service',
        duration_minutes: 30,
        allows_any_practitioner: true,
        status: 'active',
        is_synthetic: false,
      },
      {
        id: fixture.services.sibling,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.sibling,
        facility_id: fixture.facilities.sibling,
        specialty_id: fixture.specialties.sibling,
        code: 'PRIVATE-SIBLING-SERVICE',
        patient_facing_name: 'Private Sibling Service',
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
        id: fixture.serviceAssignments.anyShared,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        facility_id: fixture.facilities.exact,
        practitioner_facility_assignment_id:
          fixture.facilityAssignments.sharedExact,
        practitioner_id: fixture.practitioners.shared,
        appointment_service_id: fixture.services.any,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.serviceAssignments.anyTiedName,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        facility_id: fixture.facilities.exact,
        practitioner_facility_assignment_id:
          fixture.facilityAssignments.tiedNameExact,
        practitioner_id: fixture.practitioners.tiedName,
        appointment_service_id: fixture.services.any,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.serviceAssignments.anyInactivePractitioner,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        facility_id: fixture.facilities.exact,
        practitioner_facility_assignment_id:
          fixture.facilityAssignments.inactivePractitioner,
        practitioner_id: fixture.practitioners.inactive,
        appointment_service_id: fixture.services.any,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.serviceAssignments.anyInactiveAffiliation,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        facility_id: fixture.facilities.exact,
        practitioner_facility_assignment_id:
          fixture.facilityAssignments.inactive,
        practitioner_id: fixture.practitioners.inactiveAffiliation,
        appointment_service_id: fixture.services.any,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.serviceAssignments.anyInactiveEligibility,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        facility_id: fixture.facilities.exact,
        practitioner_facility_assignment_id:
          fixture.facilityAssignments.inactiveEligibility,
        practitioner_id: fixture.practitioners.inactiveEligibility,
        appointment_service_id: fixture.services.any,
        status: 'inactive',
        is_synthetic: true,
      },
      {
        id: fixture.serviceAssignments.anyNonSynthetic,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        facility_id: fixture.facilities.exact,
        practitioner_facility_assignment_id:
          fixture.facilityAssignments.nonSynthetic,
        practitioner_id: fixture.practitioners.nonSynthetic,
        appointment_service_id: fixture.services.any,
        status: 'active',
        is_synthetic: false,
      },
      {
        id: fixture.serviceAssignments.namedShared,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        facility_id: fixture.facilities.exact,
        practitioner_facility_assignment_id:
          fixture.facilityAssignments.sharedExact,
        practitioner_id: fixture.practitioners.shared,
        appointment_service_id: fixture.services.namedOnly,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.serviceAssignments.emptyShared,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        facility_id: fixture.facilities.exact,
        practitioner_facility_assignment_id:
          fixture.facilityAssignments.sharedExact,
        practitioner_id: fixture.practitioners.shared,
        appointment_service_id: fixture.services.empty,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.serviceAssignments.inactiveService,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        facility_id: fixture.facilities.exact,
        practitioner_facility_assignment_id:
          fixture.facilityAssignments.sharedExact,
        practitioner_id: fixture.practitioners.shared,
        appointment_service_id: fixture.services.inactive,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.serviceAssignments.retiredSpecialty,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        facility_id: fixture.facilities.exact,
        practitioner_facility_assignment_id:
          fixture.facilityAssignments.sharedExact,
        practitioner_id: fixture.practitioners.shared,
        appointment_service_id: fixture.services.retiredSpecialty,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.serviceAssignments.inactivePractitioner,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        facility_id: fixture.facilities.exact,
        practitioner_facility_assignment_id:
          fixture.facilityAssignments.inactivePractitioner,
        practitioner_id: fixture.practitioners.inactive,
        appointment_service_id: fixture.services.inactivePractitioner,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.serviceAssignments.inactiveAffiliation,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        facility_id: fixture.facilities.exact,
        practitioner_facility_assignment_id:
          fixture.facilityAssignments.inactive,
        practitioner_id: fixture.practitioners.inactiveAffiliation,
        appointment_service_id: fixture.services.inactiveAffiliation,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.serviceAssignments.inactiveEligibility,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        facility_id: fixture.facilities.exact,
        practitioner_facility_assignment_id:
          fixture.facilityAssignments.inactiveEligibility,
        practitioner_id: fixture.practitioners.inactiveEligibility,
        appointment_service_id: fixture.services.inactiveEligibility,
        status: 'inactive',
        is_synthetic: true,
      },
      {
        id: fixture.serviceAssignments.nonSynthetic,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.exact,
        facility_id: fixture.facilities.exact,
        practitioner_facility_assignment_id:
          fixture.facilityAssignments.nonSynthetic,
        practitioner_id: fixture.practitioners.nonSynthetic,
        appointment_service_id: fixture.services.nonSynthetic,
        status: 'active',
        is_synthetic: false,
      },
      {
        id: fixture.serviceAssignments.siblingShared,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.sibling,
        facility_id: fixture.facilities.sibling,
        practitioner_facility_assignment_id:
          fixture.facilityAssignments.sharedSibling,
        practitioner_id: fixture.practitioners.shared,
        appointment_service_id: fixture.services.sibling,
        status: 'active',
        is_synthetic: true,
      },
    ])
    .execute();

  const localDate = sourceLocalDate(futureInstant(0));
  const weekday = isoWeekday(localDate);
  const templates = [
    [
      fixture.templates.anyShared,
      fixture.serviceAssignments.anyShared,
      fixture.facilityAssignments.sharedExact,
      fixture.practitioners.shared,
      fixture.services.any,
      fixture.practices.exact,
      fixture.facilities.exact,
      true,
    ],
    [
      fixture.templates.anyTiedName,
      fixture.serviceAssignments.anyTiedName,
      fixture.facilityAssignments.tiedNameExact,
      fixture.practitioners.tiedName,
      fixture.services.any,
      fixture.practices.exact,
      fixture.facilities.exact,
      true,
    ],
    [
      fixture.templates.namedShared,
      fixture.serviceAssignments.namedShared,
      fixture.facilityAssignments.sharedExact,
      fixture.practitioners.shared,
      fixture.services.namedOnly,
      fixture.practices.exact,
      fixture.facilities.exact,
      true,
    ],
    [
      fixture.templates.inactiveService,
      fixture.serviceAssignments.inactiveService,
      fixture.facilityAssignments.sharedExact,
      fixture.practitioners.shared,
      fixture.services.inactive,
      fixture.practices.exact,
      fixture.facilities.exact,
      true,
    ],
    [
      fixture.templates.retiredSpecialty,
      fixture.serviceAssignments.retiredSpecialty,
      fixture.facilityAssignments.sharedExact,
      fixture.practitioners.shared,
      fixture.services.retiredSpecialty,
      fixture.practices.exact,
      fixture.facilities.exact,
      true,
    ],
    [
      fixture.templates.inactivePractitioner,
      fixture.serviceAssignments.inactivePractitioner,
      fixture.facilityAssignments.inactivePractitioner,
      fixture.practitioners.inactive,
      fixture.services.inactivePractitioner,
      fixture.practices.exact,
      fixture.facilities.exact,
      true,
    ],
    [
      fixture.templates.inactiveAffiliation,
      fixture.serviceAssignments.inactiveAffiliation,
      fixture.facilityAssignments.inactive,
      fixture.practitioners.inactiveAffiliation,
      fixture.services.inactiveAffiliation,
      fixture.practices.exact,
      fixture.facilities.exact,
      true,
    ],
    [
      fixture.templates.inactiveEligibility,
      fixture.serviceAssignments.inactiveEligibility,
      fixture.facilityAssignments.inactiveEligibility,
      fixture.practitioners.inactiveEligibility,
      fixture.services.inactiveEligibility,
      fixture.practices.exact,
      fixture.facilities.exact,
      true,
    ],
    [
      fixture.templates.nonSynthetic,
      fixture.serviceAssignments.nonSynthetic,
      fixture.facilityAssignments.nonSynthetic,
      fixture.practitioners.nonSynthetic,
      fixture.services.nonSynthetic,
      fixture.practices.exact,
      fixture.facilities.exact,
      false,
    ],
    [
      fixture.templates.siblingShared,
      fixture.serviceAssignments.siblingShared,
      fixture.facilityAssignments.sharedSibling,
      fixture.practitioners.shared,
      fixture.services.sibling,
      fixture.practices.sibling,
      fixture.facilities.sibling,
      true,
    ],
  ] as const;
  await database
    .insertInto('practitioner_availability_templates')
    .values(
      templates.map(
        ([
          id,
          serviceAssignmentId,
          facilityAssignmentId,
          practitionerId,
          serviceId,
          organizationId,
          facilityId,
          isSynthetic,
        ]) => ({
          id,
          tenant_id: fixture.tenantId,
          organization_id: organizationId,
          facility_id: facilityId,
          practitioner_facility_assignment_id: facilityAssignmentId,
          practitioner_service_assignment_id: serviceAssignmentId,
          practitioner_id: practitionerId,
          appointment_service_id: serviceId,
          iso_weekday: weekday,
          local_start_minute: 0,
          local_end_minute: 1440,
          effective_from: localDate,
          effective_until: null,
          source_timezone: 'Asia/Dubai',
          status: 'inactive' as const,
          is_synthetic: isSynthetic,
        }),
      ),
    )
    .execute();
}

const providerScopes = {
  anyShared: {
    practitionerId: fixture.practitioners.shared,
    facilityAssignmentId: fixture.facilityAssignments.sharedExact,
    serviceAssignmentId: fixture.serviceAssignments.anyShared,
    serviceId: fixture.services.any,
    templateId: fixture.templates.anyShared,
  },
  anyTiedName: {
    practitionerId: fixture.practitioners.tiedName,
    facilityAssignmentId: fixture.facilityAssignments.tiedNameExact,
    serviceAssignmentId: fixture.serviceAssignments.anyTiedName,
    serviceId: fixture.services.any,
    templateId: fixture.templates.anyTiedName,
  },
  namedShared: {
    practitionerId: fixture.practitioners.shared,
    facilityAssignmentId: fixture.facilityAssignments.sharedExact,
    serviceAssignmentId: fixture.serviceAssignments.namedShared,
    serviceId: fixture.services.namedOnly,
    templateId: fixture.templates.namedShared,
  },
  inactiveService: {
    practitionerId: fixture.practitioners.shared,
    facilityAssignmentId: fixture.facilityAssignments.sharedExact,
    serviceAssignmentId: fixture.serviceAssignments.inactiveService,
    serviceId: fixture.services.inactive,
    templateId: fixture.templates.inactiveService,
  },
  retiredSpecialty: {
    practitionerId: fixture.practitioners.shared,
    facilityAssignmentId: fixture.facilityAssignments.sharedExact,
    serviceAssignmentId: fixture.serviceAssignments.retiredSpecialty,
    serviceId: fixture.services.retiredSpecialty,
    templateId: fixture.templates.retiredSpecialty,
  },
  inactivePractitioner: {
    practitionerId: fixture.practitioners.inactive,
    facilityAssignmentId: fixture.facilityAssignments.inactivePractitioner,
    serviceAssignmentId: fixture.serviceAssignments.inactivePractitioner,
    serviceId: fixture.services.inactivePractitioner,
    templateId: fixture.templates.inactivePractitioner,
  },
  inactiveAffiliation: {
    practitionerId: fixture.practitioners.inactiveAffiliation,
    facilityAssignmentId: fixture.facilityAssignments.inactive,
    serviceAssignmentId: fixture.serviceAssignments.inactiveAffiliation,
    serviceId: fixture.services.inactiveAffiliation,
    templateId: fixture.templates.inactiveAffiliation,
  },
  inactiveEligibility: {
    practitionerId: fixture.practitioners.inactiveEligibility,
    facilityAssignmentId: fixture.facilityAssignments.inactiveEligibility,
    serviceAssignmentId: fixture.serviceAssignments.inactiveEligibility,
    serviceId: fixture.services.inactiveEligibility,
    templateId: fixture.templates.inactiveEligibility,
  },
  nonSynthetic: {
    practitionerId: fixture.practitioners.nonSynthetic,
    facilityAssignmentId: fixture.facilityAssignments.nonSynthetic,
    serviceAssignmentId: fixture.serviceAssignments.nonSynthetic,
    serviceId: fixture.services.nonSynthetic,
    templateId: fixture.templates.nonSynthetic,
  },
  sibling: {
    practitionerId: fixture.practitioners.shared,
    facilityAssignmentId: fixture.facilityAssignments.sharedSibling,
    serviceAssignmentId: fixture.serviceAssignments.siblingShared,
    serviceId: fixture.services.sibling,
    templateId: fixture.templates.siblingShared,
    organizationId: fixture.practices.sibling,
    facilityId: fixture.facilities.sibling,
    bookablePracticeId: fixture.bookablePractices.sibling,
  },
} satisfies Record<string, ProviderScope>;

interface SlotDefinition {
  id: string;
  scope: ProviderScope;
  startsAt: Date;
  status?: 'available' | 'withdrawn';
  withdrawalPending?: boolean;
  isSynthetic?: boolean;
}

function slotRow(definition: SlotDefinition) {
  const organizationId =
    definition.scope.organizationId ?? fixture.practices.exact;
  const facilityId = definition.scope.facilityId ?? fixture.facilities.exact;
  const bookablePracticeId =
    definition.scope.bookablePracticeId ?? fixture.bookablePractices.exact;
  const endsAt = new Date(definition.startsAt.getTime() + 30 * 60_000);

  return {
    id: definition.id,
    bookable_practice_id: bookablePracticeId,
    tenant_id: fixture.tenantId,
    organization_id: organizationId,
    starts_at: definition.startsAt,
    ends_at: endsAt,
    facility_id: facilityId,
    practitioner_facility_assignment_id: definition.scope.facilityAssignmentId,
    practitioner_service_assignment_id: definition.scope.serviceAssignmentId,
    practitioner_id: definition.scope.practitionerId,
    appointment_service_id: definition.scope.serviceId,
    availability_template_id: definition.scope.templateId,
    generation_key_hash: sha256(`discovery-slot|${definition.id}`),
    source_local_date: sourceLocalDate(definition.startsAt),
    source_timezone: 'Asia/Dubai',
    status: definition.status ?? ('available' as const),
    withdrawal_pending: definition.withdrawalPending ?? false,
    is_synthetic: definition.isSynthetic ?? true,
  };
}

const pastSlotStart = new Date(Date.now() - 24 * 60 * 60_000);
pastSlotStart.setUTCSeconds(0, 0);

const slotDefinitions: SlotDefinition[] = [
  {
    id: fixture.slots.tiedShared,
    scope: providerScopes.anyShared,
    startsAt: futureInstant(0),
  },
  {
    id: fixture.slots.tiedOther,
    scope: providerScopes.anyTiedName,
    startsAt: futureInstant(0),
  },
  {
    id: fixture.slots.withdrawalPending,
    scope: providerScopes.anyShared,
    startsAt: futureInstant(30),
    withdrawalPending: true,
  },
  {
    id: fixture.slots.withdrawn,
    scope: providerScopes.anyShared,
    startsAt: futureInstant(60),
    status: 'withdrawn',
  },
  {
    id: fixture.slots.requested,
    scope: providerScopes.anyShared,
    startsAt: futureInstant(90),
  },
  {
    id: fixture.slots.confirmed,
    scope: providerScopes.anyShared,
    startsAt: futureInstant(120),
  },
  {
    id: fixture.slots.declined,
    scope: providerScopes.anyShared,
    startsAt: futureInstant(150),
  },
  {
    id: fixture.slots.cancelled,
    scope: providerScopes.anyShared,
    startsAt: futureInstant(180),
  },
  {
    id: fixture.slots.laterVisible,
    scope: providerScopes.anyShared,
    startsAt: futureInstant(210),
  },
  {
    id: fixture.slots.past,
    scope: providerScopes.anyTiedName,
    startsAt: pastSlotStart,
  },
  {
    id: fixture.slots.beyondPublicationHorizon,
    scope: providerScopes.anyTiedName,
    startsAt: farFutureInstant(),
  },
  {
    id: fixture.slots.named,
    scope: providerScopes.namedShared,
    startsAt: futureInstant(300),
  },
  {
    id: fixture.slots.inactiveService,
    scope: providerScopes.inactiveService,
    startsAt: futureInstant(330),
  },
  {
    id: fixture.slots.retiredSpecialty,
    scope: providerScopes.retiredSpecialty,
    startsAt: futureInstant(360),
  },
  {
    id: fixture.slots.inactivePractitioner,
    scope: providerScopes.inactivePractitioner,
    startsAt: futureInstant(0),
  },
  {
    id: fixture.slots.inactiveAffiliation,
    scope: providerScopes.inactiveAffiliation,
    startsAt: futureInstant(0),
  },
  {
    id: fixture.slots.inactiveEligibility,
    scope: providerScopes.inactiveEligibility,
    startsAt: futureInstant(0),
  },
  {
    id: fixture.slots.nonSynthetic,
    scope: providerScopes.nonSynthetic,
    startsAt: futureInstant(0),
    isSynthetic: false,
  },
  {
    id: fixture.slots.sibling,
    scope: providerScopes.sibling,
    startsAt: futureInstant(24 * 60),
  },
];

function appointmentRow(input: {
  id: string;
  slotId: string;
  scope: ProviderScope;
  status: PatientPortalAppointmentStatus;
  relationshipId?: string;
  patientIdentityId?: string;
}) {
  const organizationId = input.scope.organizationId ?? fixture.practices.exact;
  return {
    id: input.id,
    tenant_id: fixture.tenantId,
    organization_id: organizationId,
    patient_portal_identity_id:
      input.patientIdentityId ?? fixture.patientIdentities.patient,
    patient_portal_profile_id: null,
    patient_portal_appointment_relationship_id:
      input.relationshipId ?? fixture.relationships.exact,
    appointment_slot_id: input.slotId,
    facility_id: input.scope.facilityId ?? fixture.facilities.exact,
    practitioner_facility_assignment_id: input.scope.facilityAssignmentId,
    practitioner_service_assignment_id: input.scope.serviceAssignmentId,
    practitioner_id: input.scope.practitionerId,
    appointment_service_id: input.scope.serviceId,
    status: input.status,
    version: 1,
    cancelled_at: input.status === 'cancelled' ? new Date() : null,
  };
}

async function insertSlotFixture(
  database: Kysely<DatabaseSchema>,
): Promise<void> {
  await database
    .insertInto('patient_portal_appointment_slots')
    .values(slotDefinitions.map(slotRow))
    .execute();
  await database
    .insertInto('patient_portal_appointments')
    .values([
      appointmentRow({
        id: fixture.appointments.requested,
        slotId: fixture.slots.requested,
        scope: providerScopes.anyShared,
        status: 'requested',
        relationshipId: fixture.relationships.foreignExact,
        patientIdentityId: fixture.patientIdentities.foreignPatient,
      }),
      appointmentRow({
        id: fixture.appointments.confirmed,
        slotId: fixture.slots.confirmed,
        scope: providerScopes.anyShared,
        status: 'confirmed',
      }),
      appointmentRow({
        id: fixture.appointments.declined,
        slotId: fixture.slots.declined,
        scope: providerScopes.anyShared,
        status: 'declined',
      }),
      appointmentRow({
        id: fixture.appointments.cancelled,
        slotId: fixture.slots.cancelled,
        scope: providerScopes.anyShared,
        status: 'cancelled',
      }),
      appointmentRow({
        id: fixture.appointments.siblingPrivate,
        slotId: fixture.slots.sibling,
        scope: providerScopes.sibling,
        status: 'requested',
        relationshipId: fixture.relationships.sibling,
      }),
    ])
    .execute();
}

function patientSession(
  context: PatientPortalSessionContext['context'],
): PatientPortalSessionContext {
  const expiresAt = new Date(Date.now() + 8 * 60 * 60_000);
  return {
    sessionId: fixtureUuid(900_001),
    principal: {
      issuer: patientIssuer,
      subject: 'synthetic-discovery-patient',
      clientId: 'synthetic-discovery-client',
      username: privateSentinels.patientEmail,
    },
    patientPortalIdentityId: fixture.patientIdentities.patient,
    applicationUserId: fixture.users.patient,
    displayName: 'Synthetic Discovery Patient',
    context,
    availablePractices: [
      {
        portalProfileId: fixture.patientProfile,
        practiceName: 'Synthetic Exact Discovery Practice',
      },
    ],
    appointmentOnboardingPractices: [
      {
        appointmentRelationshipId: fixture.relationships.exact,
        practiceName: 'Synthetic Exact Discovery Practice',
      },
      {
        appointmentRelationshipId: fixture.relationships.sibling,
        practiceName: privateSentinels.siblingPracticeName,
      },
    ],
    csrfToken: 'synthetic-discovery-csrf-token',
    idleExpiresAt: expiresAt,
    absoluteExpiresAt: expiresAt,
    renewed: false,
  };
}

const exactOnboardingSession = () =>
  patientSession({
    kind: 'appointment-onboarding',
    appointmentRelationshipId: fixture.relationships.exact,
    practiceName: 'Synthetic Exact Discovery Practice',
    tenantId: fixture.tenantId,
    organizationId: fixture.practices.exact,
  });

const exactProfileSession = () =>
  patientSession({
    kind: 'practice',
    portalProfileId: fixture.patientProfile,
    practiceName: 'Synthetic Exact Discovery Practice',
    tenantId: fixture.tenantId,
    organizationId: fixture.practices.exact,
  });

const siblingOnboardingSession = () =>
  patientSession({
    kind: 'appointment-onboarding',
    appointmentRelationshipId: fixture.relationships.sibling,
    practiceName: privateSentinels.siblingPracticeName,
    tenantId: fixture.tenantId,
    organizationId: fixture.practices.sibling,
  });

const foreignRelationshipSession = () =>
  patientSession({
    kind: 'appointment-onboarding',
    appointmentRelationshipId: fixture.relationships.foreignExact,
    practiceName: 'Synthetic Exact Discovery Practice',
    tenantId: fixture.tenantId,
    organizationId: fixture.practices.exact,
  });

function serviceView(
  appointmentServiceId: string,
): PatientAppointmentServiceView {
  const values: Record<
    string,
    Pick<
      PatientAppointmentServiceView,
      'patientFacingName' | 'durationMinutes' | 'allowsAnyPractitioner'
    > & {
      specialtyId: string;
      specialtyName: string;
      facilityId: string;
      facilityName: string;
    }
  > = {
    [fixture.services.any]: {
      patientFacingName: 'Consultation',
      durationMinutes: 30,
      allowsAnyPractitioner: true,
      specialtyId: fixture.specialties.active,
      specialtyName: 'General medicine',
      facilityId: fixture.facilities.exact,
      facilityName: 'Synthetic Exact Discovery Facility',
    },
    [fixture.services.empty]: {
      patientFacingName: 'Consultation',
      durationMinutes: 45,
      allowsAnyPractitioner: true,
      specialtyId: fixture.specialties.active,
      specialtyName: 'General medicine',
      facilityId: fixture.facilities.exact,
      facilityName: 'Synthetic Exact Discovery Facility',
    },
    [fixture.services.namedOnly]: {
      patientFacingName: 'Named consultation',
      durationMinutes: 30,
      allowsAnyPractitioner: false,
      specialtyId: fixture.specialties.active,
      specialtyName: 'General medicine',
      facilityId: fixture.facilities.exact,
      facilityName: 'Synthetic Exact Discovery Facility',
    },
    [fixture.services.sibling]: {
      patientFacingName: 'Private Sibling Service',
      durationMinutes: 30,
      allowsAnyPractitioner: true,
      specialtyId: fixture.specialties.sibling,
      specialtyName: 'Private Sibling Specialty',
      facilityId: fixture.facilities.sibling,
      facilityName: privateSentinels.siblingFacilityName,
    },
  };
  const value = values[appointmentServiceId];
  if (!value) throw new Error('Unknown expected discovery service.');
  return {
    appointmentServiceId,
    patientFacingName: value.patientFacingName,
    durationMinutes: value.durationMinutes,
    allowsAnyPractitioner: value.allowsAnyPractitioner,
    specialty: {
      specialtyId: value.specialtyId,
      name: value.specialtyName,
    },
    facility: {
      facilityId: value.facilityId,
      name: value.facilityName,
      timezone: 'Asia/Dubai',
    },
  };
}

function practitionerOptionView(
  practitionerOptionId: string,
): PatientAppointmentPractitionerOptionView {
  if (practitionerOptionId === fixture.serviceAssignments.anyTiedName) {
    return {
      practitionerOptionId,
      displayName: 'Dr Same Name',
      professionalTitle: 'Specialist physician',
    };
  }
  if (
    practitionerOptionId === fixture.serviceAssignments.anyShared ||
    practitionerOptionId === fixture.serviceAssignments.namedShared ||
    practitionerOptionId === fixture.serviceAssignments.emptyShared ||
    practitionerOptionId === fixture.serviceAssignments.siblingShared
  ) {
    return {
      practitionerOptionId,
      displayName: 'Dr Same Name',
      professionalTitle: 'Consultant physician',
    };
  }
  throw new Error('Unknown expected practitioner option.');
}

function expectedSlot(
  slotId: string,
  appointmentServiceId: string,
  practitionerOptionId: string,
): PatientAppointmentSlotView {
  const definition = slotDefinitions.find(
    (candidate) => candidate.id === slotId,
  );
  if (!definition) throw new Error('Unknown expected discovery slot.');
  return {
    slotId,
    startsAt: definition.startsAt.toISOString(),
    endsAt: new Date(definition.startsAt.getTime() + 30 * 60_000).toISOString(),
    service: serviceView(appointmentServiceId),
    practitionerOption: practitionerOptionView(practitionerOptionId),
  };
}

function expectExactServiceProjection(
  service: PatientAppointmentServiceView,
): void {
  expect(Object.keys(service).sort()).toEqual([
    'allowsAnyPractitioner',
    'appointmentServiceId',
    'durationMinutes',
    'facility',
    'patientFacingName',
    'specialty',
  ]);
  expect(Object.keys(service.specialty).sort()).toEqual([
    'name',
    'specialtyId',
  ]);
  expect(Object.keys(service.facility).sort()).toEqual([
    'facilityId',
    'name',
    'timezone',
  ]);
}

function expectExactOptionProjection(
  option: PatientAppointmentPractitionerOptionView,
): void {
  expect(Object.keys(option).sort()).toEqual([
    'displayName',
    'practitionerOptionId',
    'professionalTitle',
  ]);
}

function expectExactSlotProjection(slot: PatientAppointmentSlotView): void {
  expect(Object.keys(slot).sort()).toEqual([
    'endsAt',
    'practitionerOption',
    'service',
    'slotId',
    'startsAt',
  ]);
  expectExactServiceProjection(slot.service);
  expectExactOptionProjection(slot.practitionerOption);
}

async function rejectionMessage(
  promise: Promise<unknown>,
  expectedType: typeof BadRequestException | typeof NotFoundException,
): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(expectedType);
    return (error as Error).message;
  }
  throw new Error('Expected discovery request to be rejected.');
}

describeWithDatabase('patient appointment discovery integration', () => {
  const schemaName = `patient_discovery_${process.pid}_${Date.now()}`;
  let adminDatabase: Kysely<unknown>;
  let database: Kysely<DatabaseSchema>;
  let appointments: PatientAppointmentsService;

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
    await insertCatalogueFixture(database);
    await insertSlotFixture(database);
    appointments = new PatientAppointmentsService({
      client: database,
    } as DatabaseService);
  });

  afterAll(async () => {
    if (database) await database.destroy();
    if (adminDatabase) {
      await sql`drop schema if exists ${sql.id(schemaName)} cascade`.execute(
        adminDatabase,
      );
      await adminDatabase.destroy();
    }
  });

  it('returns exact safe service and local practitioner-option projections in both patient context kinds', async () => {
    const expectedServices = [
      serviceView(fixture.services.any),
      serviceView(fixture.services.empty),
      serviceView(fixture.services.namedOnly),
    ];
    const onboarding = await appointments.listServices(
      exactOnboardingSession(),
      { page: 1, pageSize: 100 },
    );
    const profile = await appointments.listServices(exactProfileSession(), {
      page: 1,
      pageSize: 100,
    });

    expect(onboarding).toEqual({
      practiceName: 'Synthetic Exact Discovery Practice',
      timezone: 'Asia/Dubai',
      page: 1,
      pageSize: 100,
      total: 3,
      services: expectedServices,
    });
    expect(profile).toEqual(onboarding);
    expect(Object.keys(onboarding).sort()).toEqual([
      'page',
      'pageSize',
      'practiceName',
      'services',
      'timezone',
      'total',
    ]);
    onboarding.services.forEach(expectExactServiceProjection);

    const options = await appointments.listPractitionerOptions(
      exactOnboardingSession(),
      {
        appointmentServiceId: fixture.services.any,
        page: 1,
        pageSize: 100,
      },
    );
    expect(options).toEqual({
      practiceName: 'Synthetic Exact Discovery Practice',
      timezone: 'Asia/Dubai',
      page: 1,
      pageSize: 100,
      total: 2,
      practitionerOptions: [
        practitionerOptionView(fixture.serviceAssignments.anyShared),
        practitionerOptionView(fixture.serviceAssignments.anyTiedName),
      ],
    });
    expect(Object.keys(options).sort()).toEqual([
      'page',
      'pageSize',
      'practiceName',
      'practitionerOptions',
      'timezone',
      'total',
    ]);
    options.practitionerOptions.forEach(expectExactOptionProjection);
    expect(
      options.practitionerOptions.map(
        ({ practitionerOptionId }) => practitionerOptionId,
      ),
    ).toEqual([
      fixture.serviceAssignments.anyShared,
      fixture.serviceAssignments.anyTiedName,
    ]);
    expect(
      options.practitionerOptions.map(
        ({ practitionerOptionId }) => practitionerOptionId,
      ),
    ).not.toContain(fixture.practitioners.shared);

    await expect(
      appointments.listPractitionerOptions(exactOnboardingSession(), {
        appointmentServiceId: fixture.services.empty,
        page: 1,
        pageSize: 25,
      }),
    ).resolves.toMatchObject({
      total: 1,
      practitionerOptions: [
        practitionerOptionView(fixture.serviceAssignments.emptyShared),
      ],
    });

    const siblingServices = await appointments.listServices(
      siblingOnboardingSession(),
      { page: 1, pageSize: 25 },
    );
    expect(siblingServices.services).toEqual([
      serviceView(fixture.services.sibling),
    ]);
    const siblingOptions = await appointments.listPractitionerOptions(
      siblingOnboardingSession(),
      {
        appointmentServiceId: fixture.services.sibling,
        page: 1,
        pageSize: 25,
      },
    );
    expect(siblingOptions.practitionerOptions).toEqual([
      practitionerOptionView(fixture.serviceAssignments.siblingShared),
    ]);
  });

  it('returns concrete named and any-doctor slots while preserving the bounded legacy overview', async () => {
    const legacy = await appointments.listAvailability(
      exactOnboardingSession(),
    );
    expect(legacy).toEqual({
      practiceName: 'Synthetic Exact Discovery Practice',
      timezone: 'Asia/Dubai',
      page: 1,
      pageSize: 25,
      total: 6,
      slots: [
        expectedSlot(
          fixture.slots.tiedShared,
          fixture.services.any,
          fixture.serviceAssignments.anyShared,
        ),
        expectedSlot(
          fixture.slots.tiedOther,
          fixture.services.any,
          fixture.serviceAssignments.anyTiedName,
        ),
        expectedSlot(
          fixture.slots.declined,
          fixture.services.any,
          fixture.serviceAssignments.anyShared,
        ),
        expectedSlot(
          fixture.slots.cancelled,
          fixture.services.any,
          fixture.serviceAssignments.anyShared,
        ),
        expectedSlot(
          fixture.slots.laterVisible,
          fixture.services.any,
          fixture.serviceAssignments.anyShared,
        ),
        expectedSlot(
          fixture.slots.named,
          fixture.services.namedOnly,
          fixture.serviceAssignments.namedShared,
        ),
      ],
    });
    legacy.slots.forEach(expectExactSlotProjection);
    await expect(
      appointments.listAvailability(exactProfileSession()),
    ).resolves.toEqual(legacy);

    const any = await appointments.listAvailability(exactOnboardingSession(), {
      appointmentServiceId: fixture.services.any,
      selectionMode: 'any',
      page: 1,
      pageSize: 100,
    });
    expect(any.total).toBe(5);
    expect(any.slots).toEqual(legacy.slots.slice(0, 5));
    expect(
      new Set(
        any.slots.map(
          ({ practitionerOption }) => practitionerOption.practitionerOptionId,
        ),
      ),
    ).toEqual(
      new Set([
        fixture.serviceAssignments.anyShared,
        fixture.serviceAssignments.anyTiedName,
      ]),
    );

    const named = await appointments.listAvailability(
      exactOnboardingSession(),
      {
        appointmentServiceId: fixture.services.any,
        selectionMode: 'named',
        practitionerOptionId: fixture.serviceAssignments.anyShared,
        page: 1,
        pageSize: 100,
      },
    );
    expect(named.total).toBe(4);
    expect(named.slots.map(({ slotId }) => slotId)).toEqual([
      fixture.slots.tiedShared,
      fixture.slots.declined,
      fixture.slots.cancelled,
      fixture.slots.laterVisible,
    ]);
    expect(
      named.slots.every(
        ({ practitionerOption }) =>
          practitionerOption.practitionerOptionId ===
          fixture.serviceAssignments.anyShared,
      ),
    ).toBe(true);

    await expect(
      appointments.listAvailability(exactOnboardingSession(), {
        appointmentServiceId: fixture.services.namedOnly,
        selectionMode: 'named',
        practitionerOptionId: fixture.serviceAssignments.namedShared,
        page: 1,
        pageSize: 25,
      }),
    ).resolves.toMatchObject({
      total: 1,
      slots: [
        expectedSlot(
          fixture.slots.named,
          fixture.services.namedOnly,
          fixture.serviceAssignments.namedShared,
        ),
      ],
    });
    await expect(
      appointments.listAvailability(exactOnboardingSession(), {
        appointmentServiceId: fixture.services.empty,
        selectionMode: 'any',
        page: 1,
        pageSize: 25,
      }),
    ).resolves.toMatchObject({ total: 0, slots: [] });
    await expect(
      appointments.listAvailability(exactOnboardingSession(), {
        appointmentServiceId: fixture.services.empty,
        selectionMode: 'named',
        practitionerOptionId: fixture.serviceAssignments.emptyShared,
        page: 1,
        pageSize: 25,
      }),
    ).resolves.toMatchObject({ total: 0, slots: [] });

    const hiddenSlotIds = [
      fixture.slots.withdrawalPending,
      fixture.slots.withdrawn,
      fixture.slots.requested,
      fixture.slots.confirmed,
      fixture.slots.past,
      fixture.slots.beyondPublicationHorizon,
      fixture.slots.inactiveService,
      fixture.slots.retiredSpecialty,
      fixture.slots.inactivePractitioner,
      fixture.slots.inactiveAffiliation,
      fixture.slots.inactiveEligibility,
      fixture.slots.nonSynthetic,
      fixture.slots.sibling,
    ];
    expect(legacy.slots.map(({ slotId }) => slotId)).toEqual(
      expect.not.arrayContaining(hiddenSlotIds),
    );
    expect(any.slots.map(({ slotId }) => slotId)).toEqual(
      expect.not.arrayContaining(hiddenSlotIds),
    );
    expect(legacy.slots.map(({ slotId }) => slotId)).toEqual(
      expect.arrayContaining([fixture.slots.declined, fixture.slots.cancelled]),
    );
  });

  it('never projects provider login data, patient bookings, private assignments, or sibling-practice evidence', async () => {
    const [services, options, availability] = await Promise.all([
      appointments.listServices(exactOnboardingSession(), {
        page: 1,
        pageSize: 100,
      }),
      appointments.listPractitionerOptions(exactOnboardingSession(), {
        appointmentServiceId: fixture.services.any,
        page: 1,
        pageSize: 100,
      }),
      appointments.listAvailability(exactOnboardingSession(), {
        page: 1,
        pageSize: 100,
      }),
    ]);
    const serialized = JSON.stringify({ services, options, availability });
    const forbiddenValues = [
      fixture.practices.exact,
      fixture.practices.sibling,
      fixture.bookablePractices.exact,
      fixture.bookablePractices.sibling,
      fixture.users.linkedPractitioner,
      fixture.userIdentities.linkedPractitioner,
      fixture.memberships.linkedPractitionerSibling,
      fixture.practitioners.shared,
      fixture.facilityAssignments.sharedExact,
      fixture.facilityAssignments.sharedSibling,
      fixture.serviceAssignments.siblingShared,
      fixture.services.sibling,
      fixture.specialties.sibling,
      fixture.facilities.sibling,
      fixture.slots.sibling,
      fixture.appointments.siblingPrivate,
      fixture.appointments.requested,
      fixture.patientIdentities.foreignPatient,
      fixture.relationships.foreignExact,
      fixture.patientProfile,
      privateSentinels.providerEmail,
      privateSentinels.providerSubject,
      privateSentinels.patientEmail,
      privateSentinels.siblingPracticeName,
      privateSentinels.siblingFacilityName,
      privateSentinels.serviceCode,
      privateSentinels.specialtyCode,
      'private.foreign-patient@example.invalid',
      'private-foreign-discovery-patient',
      'private-shared-doctor-membership',
    ];
    forbiddenValues.forEach((value) => expect(serialized).not.toContain(value));

    services.services.forEach(expectExactServiceProjection);
    options.practitionerOptions.forEach(expectExactOptionProjection);
    availability.slots.forEach(expectExactSlotProjection);
  });

  it('fails closed with one anti-enumerating response for foreign contexts and unavailable service or option targets', async () => {
    const unavailableMessages = await Promise.all([
      rejectionMessage(
        appointments.listServices(foreignRelationshipSession(), {
          page: 1,
          pageSize: 25,
        }),
        NotFoundException,
      ),
      rejectionMessage(
        appointments.listPractitionerOptions(exactOnboardingSession(), {
          appointmentServiceId: fixtureUuid(999_001),
          page: 1,
          pageSize: 25,
        }),
        NotFoundException,
      ),
      rejectionMessage(
        appointments.listPractitionerOptions(exactOnboardingSession(), {
          appointmentServiceId: fixture.services.sibling,
          page: 1,
          pageSize: 25,
        }),
        NotFoundException,
      ),
      rejectionMessage(
        appointments.listPractitionerOptions(exactOnboardingSession(), {
          appointmentServiceId: fixture.services.inactive,
          page: 1,
          pageSize: 25,
        }),
        NotFoundException,
      ),
      rejectionMessage(
        appointments.listAvailability(exactOnboardingSession(), {
          appointmentServiceId: fixture.services.any,
          selectionMode: 'named',
          practitionerOptionId: fixtureUuid(999_002),
          page: 1,
          pageSize: 25,
        }),
        NotFoundException,
      ),
      rejectionMessage(
        appointments.listAvailability(exactOnboardingSession(), {
          appointmentServiceId: fixture.services.any,
          selectionMode: 'named',
          practitionerOptionId: fixture.serviceAssignments.siblingShared,
          page: 1,
          pageSize: 25,
        }),
        NotFoundException,
      ),
      rejectionMessage(
        appointments.listAvailability(exactOnboardingSession(), {
          appointmentServiceId: fixture.services.any,
          selectionMode: 'named',
          practitionerOptionId: fixture.serviceAssignments.namedShared,
          page: 1,
          pageSize: 25,
        }),
        NotFoundException,
      ),
      rejectionMessage(
        appointments.listAvailability(exactOnboardingSession(), {
          appointmentServiceId: fixture.services.any,
          selectionMode: 'named',
          practitionerOptionId:
            fixture.serviceAssignments.anyInactiveEligibility,
          page: 1,
          pageSize: 25,
        }),
        NotFoundException,
      ),
      rejectionMessage(
        appointments.listAvailability(exactOnboardingSession(), {
          appointmentServiceId: fixture.services.any,
          selectionMode: 'named',
          practitionerOptionId: fixture.practitioners.shared,
          page: 1,
          pageSize: 25,
        }),
        NotFoundException,
      ),
      rejectionMessage(
        appointments.listAvailability(exactOnboardingSession(), {
          appointmentServiceId: fixture.services.namedOnly,
          selectionMode: 'any',
          page: 1,
          pageSize: 25,
        }),
        NotFoundException,
      ),
    ]);
    expect(new Set(unavailableMessages)).toEqual(
      new Set(['Appointment discovery is unavailable.']),
    );
  });

  it('rejects incomplete or contradictory selection syntax and invalid pagination before querying targets', async () => {
    const invalidSelectionQueries = [
      {
        appointmentServiceId: fixture.services.any,
        page: 1,
        pageSize: 25,
      },
      { selectionMode: 'any' as const, page: 1, pageSize: 25 },
      {
        appointmentServiceId: fixture.services.any,
        selectionMode: 'named' as const,
        page: 1,
        pageSize: 25,
      },
      {
        appointmentServiceId: fixture.services.any,
        selectionMode: 'any' as const,
        practitionerOptionId: fixture.serviceAssignments.anyShared,
        page: 1,
        pageSize: 25,
      },
    ];
    for (const query of invalidSelectionQueries) {
      await expect(
        appointments.listAvailability(exactOnboardingSession(), query),
      ).rejects.toMatchObject({
        message:
          'Choose a valid appointment service and practitioner selection.',
      });
    }

    for (const query of [
      { page: 0, pageSize: 25 },
      { page: 1, pageSize: 0 },
      { page: 1, pageSize: 101 },
      { page: 1.5, pageSize: 25 },
      { page: Number.MAX_SAFE_INTEGER, pageSize: 100 },
    ]) {
      await expect(
        appointments.listServices(exactOnboardingSession(), query),
      ).rejects.toMatchObject({
        message: 'Appointment discovery pagination is invalid.',
      });
    }
  });

  it('paginates services, tied practitioner labels, and tied slot starts deterministically after exact-scope filtering', async () => {
    const servicePages = await Promise.all(
      [1, 2, 3, 4].map((page) =>
        appointments.listServices(exactOnboardingSession(), {
          page,
          pageSize: 1,
        }),
      ),
    );
    expect(servicePages.map(({ total }) => total)).toEqual([3, 3, 3, 3]);
    expect(
      servicePages.map(({ services }) =>
        services.map(({ appointmentServiceId }) => appointmentServiceId),
      ),
    ).toEqual([
      [fixture.services.any],
      [fixture.services.empty],
      [fixture.services.namedOnly],
      [],
    ]);

    const optionPages = await Promise.all(
      [1, 2, 3].map((page) =>
        appointments.listPractitionerOptions(exactOnboardingSession(), {
          appointmentServiceId: fixture.services.any,
          page,
          pageSize: 1,
        }),
      ),
    );
    expect(optionPages.map(({ total }) => total)).toEqual([2, 2, 2]);
    expect(
      optionPages.map(({ practitionerOptions }) =>
        practitionerOptions.map(
          ({ practitionerOptionId }) => practitionerOptionId,
        ),
      ),
    ).toEqual([
      [fixture.serviceAssignments.anyShared],
      [fixture.serviceAssignments.anyTiedName],
      [],
    ]);

    const slotPages = await Promise.all(
      [1, 2, 3, 4].map((page) =>
        appointments.listAvailability(exactOnboardingSession(), {
          appointmentServiceId: fixture.services.any,
          selectionMode: 'any',
          page,
          pageSize: 2,
        }),
      ),
    );
    expect(slotPages.map(({ total }) => total)).toEqual([5, 5, 5, 5]);
    expect(
      slotPages.map(({ slots }) => slots.map(({ slotId }) => slotId)),
    ).toEqual([
      [fixture.slots.tiedShared, fixture.slots.tiedOther],
      [fixture.slots.declined, fixture.slots.cancelled],
      [fixture.slots.laterVisible],
      [],
    ]);
    const flattenedSlotIds = slotPages
      .flatMap(({ slots }) => slots)
      .map(({ slotId }) => slotId);
    expect(new Set(flattenedSlotIds).size).toBe(flattenedSlotIds.length);
  });

  it('revalidates every active and synthetic publication-chain component', async () => {
    const namedQuery = {
      appointmentServiceId: fixture.services.any,
      selectionMode: 'named' as const,
      practitionerOptionId: fixture.serviceAssignments.anyShared,
      page: 1,
      pageSize: 25,
    };
    const gates: Array<{
      label: string;
      disable: () => Promise<unknown>;
      restore: () => Promise<unknown>;
    }> = [
      {
        label: 'service status',
        disable: () =>
          database
            .updateTable('appointment_services')
            .set({ status: 'inactive' })
            .where('id', '=', fixture.services.any)
            .execute(),
        restore: () =>
          database
            .updateTable('appointment_services')
            .set({ status: 'active' })
            .where('id', '=', fixture.services.any)
            .execute(),
      },
      {
        label: 'service synthetic flag',
        disable: () =>
          database
            .updateTable('appointment_services')
            .set({ is_synthetic: false })
            .where('id', '=', fixture.services.any)
            .execute(),
        restore: () =>
          database
            .updateTable('appointment_services')
            .set({ is_synthetic: true })
            .where('id', '=', fixture.services.any)
            .execute(),
      },
      {
        label: 'specialty status',
        disable: () =>
          database
            .updateTable('specialties')
            .set({ status: 'retired' })
            .where('id', '=', fixture.specialties.active)
            .execute(),
        restore: () =>
          database
            .updateTable('specialties')
            .set({ status: 'active' })
            .where('id', '=', fixture.specialties.active)
            .execute(),
      },
      {
        label: 'specialty synthetic flag',
        disable: () =>
          database
            .updateTable('specialties')
            .set({ is_synthetic: false })
            .where('id', '=', fixture.specialties.active)
            .execute(),
        restore: () =>
          database
            .updateTable('specialties')
            .set({ is_synthetic: true })
            .where('id', '=', fixture.specialties.active)
            .execute(),
      },
      {
        label: 'facility synthetic flag',
        disable: () =>
          database
            .updateTable('facilities')
            .set({ is_synthetic: false })
            .where('id', '=', fixture.facilities.exact)
            .execute(),
        restore: () =>
          database
            .updateTable('facilities')
            .set({ is_synthetic: true })
            .where('id', '=', fixture.facilities.exact)
            .execute(),
      },
      {
        label: 'practitioner status',
        disable: () =>
          database
            .updateTable('practitioners')
            .set({ status: 'inactive' })
            .where('id', '=', fixture.practitioners.shared)
            .execute(),
        restore: () =>
          database
            .updateTable('practitioners')
            .set({ status: 'active' })
            .where('id', '=', fixture.practitioners.shared)
            .execute(),
      },
      {
        label: 'practitioner synthetic flag',
        disable: () =>
          database
            .updateTable('practitioners')
            .set({ is_synthetic: false })
            .where('id', '=', fixture.practitioners.shared)
            .execute(),
        restore: () =>
          database
            .updateTable('practitioners')
            .set({ is_synthetic: true })
            .where('id', '=', fixture.practitioners.shared)
            .execute(),
      },
      {
        label: 'facility assignment status',
        disable: () =>
          database
            .updateTable('practitioner_facility_assignments')
            .set({ status: 'inactive' })
            .where('id', '=', fixture.facilityAssignments.sharedExact)
            .execute(),
        restore: () =>
          database
            .updateTable('practitioner_facility_assignments')
            .set({ status: 'active' })
            .where('id', '=', fixture.facilityAssignments.sharedExact)
            .execute(),
      },
      {
        label: 'facility assignment synthetic flag',
        disable: () =>
          database
            .updateTable('practitioner_facility_assignments')
            .set({ is_synthetic: false })
            .where('id', '=', fixture.facilityAssignments.sharedExact)
            .execute(),
        restore: () =>
          database
            .updateTable('practitioner_facility_assignments')
            .set({ is_synthetic: true })
            .where('id', '=', fixture.facilityAssignments.sharedExact)
            .execute(),
      },
      {
        label: 'service assignment status',
        disable: () =>
          database
            .updateTable('practitioner_service_assignments')
            .set({ status: 'inactive' })
            .where('id', '=', fixture.serviceAssignments.anyShared)
            .execute(),
        restore: () =>
          database
            .updateTable('practitioner_service_assignments')
            .set({ status: 'active' })
            .where('id', '=', fixture.serviceAssignments.anyShared)
            .execute(),
      },
      {
        label: 'service assignment synthetic flag',
        disable: () =>
          database
            .updateTable('practitioner_service_assignments')
            .set({ is_synthetic: false })
            .where('id', '=', fixture.serviceAssignments.anyShared)
            .execute(),
        restore: () =>
          database
            .updateTable('practitioner_service_assignments')
            .set({ is_synthetic: true })
            .where('id', '=', fixture.serviceAssignments.anyShared)
            .execute(),
      },
    ];

    for (const gate of gates) {
      await gate.disable();
      try {
        await expect(
          appointments.listAvailability(exactOnboardingSession(), namedQuery),
        ).rejects.toMatchObject({
          message: 'Appointment discovery is unavailable.',
        });
      } catch (error) {
        throw new Error(`Publication gate failed: ${gate.label}`, {
          cause: error,
        });
      } finally {
        await gate.restore();
      }
    }

    await expect(
      appointments.listAvailability(exactOnboardingSession(), namedQuery),
    ).resolves.toMatchObject({ total: 4 });
  });

  it('fails closed when the server-selected practice publication context becomes inactive or non-synthetic', async () => {
    const gates: Array<{
      disable: () => Promise<unknown>;
      restore: () => Promise<unknown>;
    }> = [
      {
        disable: () =>
          database
            .updateTable('tenants')
            .set({ status: 'suspended' })
            .where('id', '=', fixture.tenantId)
            .execute(),
        restore: () =>
          database
            .updateTable('tenants')
            .set({ status: 'active' })
            .where('id', '=', fixture.tenantId)
            .execute(),
      },
      {
        disable: () =>
          database
            .updateTable('tenants')
            .set({ is_synthetic: false })
            .where('id', '=', fixture.tenantId)
            .execute(),
        restore: () =>
          database
            .updateTable('tenants')
            .set({ is_synthetic: true })
            .where('id', '=', fixture.tenantId)
            .execute(),
      },
      {
        disable: () =>
          database
            .updateTable('organizations')
            .set({ is_synthetic: false })
            .where('id', '=', fixture.practices.exact)
            .execute(),
        restore: () =>
          database
            .updateTable('organizations')
            .set({ is_synthetic: true })
            .where('id', '=', fixture.practices.exact)
            .execute(),
      },
      {
        disable: () =>
          database
            .updateTable('patient_portal_bookable_practices')
            .set({ status: 'unavailable' })
            .where('id', '=', fixture.bookablePractices.exact)
            .execute(),
        restore: () =>
          database
            .updateTable('patient_portal_bookable_practices')
            .set({ status: 'active' })
            .where('id', '=', fixture.bookablePractices.exact)
            .execute(),
      },
      {
        disable: () =>
          database
            .updateTable('patient_portal_bookable_practices')
            .set({ is_synthetic: false })
            .where('id', '=', fixture.bookablePractices.exact)
            .execute(),
        restore: () =>
          database
            .updateTable('patient_portal_bookable_practices')
            .set({ is_synthetic: true })
            .where('id', '=', fixture.bookablePractices.exact)
            .execute(),
      },
    ];

    for (const gate of gates) {
      await gate.disable();
      try {
        await expect(
          appointments.listServices(exactOnboardingSession(), {
            page: 1,
            pageSize: 25,
          }),
        ).rejects.toMatchObject({
          message: 'Appointment discovery is unavailable.',
        });
      } finally {
        await gate.restore();
      }
    }
  });
});
