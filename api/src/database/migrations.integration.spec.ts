import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { Kysely, sql } from 'kysely';
import { WorkforceSessionService } from '../auth/workforce-session.service.js';
import type { WorkforceIdentityProviderPort } from '../identity-provider/identity-provider.types.js';
import type { PatientIdentityProviderPort } from '../patient-identity-provider/patient-identity-provider.types.js';
import type { PatientPortalSessionContext } from '../patient-portal-auth/patient-portal-auth.types.js';
import { PatientPortalInvitationRepository } from '../patient-portal-auth/patient-portal-invitation.repository.js';
import { PatientPortalInvitationService } from '../patient-portal-auth/patient-portal-invitation.service.js';
import { WorkforceDirectoryRepository } from '../workforce-directory/workforce-directory.repository.js';
import { createDatabaseClient } from './create-database-client.js';
import type { DatabaseService } from './database.service.js';
import type { DatabaseSchema } from './database.types.js';
import * as createFacilities from './migrations/2026-08-23T000000_create_facilities.js';
import * as createIdentityAuthorizationAudit from './migrations/2026-08-24T000000_create_identity_authorization_audit.js';
import * as createWorkforceSessions from './migrations/2026-08-24T010000_create_workforce_sessions.js';
import * as addTenantLocalRoleNameUniqueness from './migrations/2026-08-26T000000_add_tenant_local_role_name_uniqueness.js';
import * as addIdentityProviderSyncStatus from './migrations/2026-08-26T010000_add_identity_provider_sync_status.js';
import * as createPatientPortalIdentity from './migrations/2026-08-26T020000_create_patient_portal_identity.js';
import * as createPatientRegistrationAndInvitations from './migrations/2026-08-27T000000_create_patient_registration_and_invitations.js';
import * as createPatientPortalAppointments from './migrations/2026-08-27T010000_create_patient_portal_appointments.js';
import * as createPractitionerProfiles from './migrations/2026-08-27T020000_create_practitioner_profiles.js';
import * as createProviderSchedulingCatalogue from './migrations/2026-08-27T030000_create_provider_scheduling_catalogue.js';
import * as createProviderAvailability from './migrations/2026-08-27T040000_create_provider_availability.js';
import * as backfillSyntheticProviderAppointments from './migrations/2026-08-27T050000_backfill_synthetic_provider_appointments.js';
import { PatientPortalProfileLinkService } from '../patient-portal-auth/patient-portal-profile-link.service.js';
import { PatientPortalRegistrationService } from '../patient-portal-auth/patient-portal-registration.service.js';
import { PatientPortalSessionService } from '../patient-portal-auth/patient-portal-session.service.js';
import { PatientAppointmentsService } from '../patient-appointments/patient-appointments.service.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

function workforceIdentityProvider(
  issuer: string,
): WorkforceIdentityProviderPort {
  return {
    issuer,
    protocol: 'cognito',
    provisionAccount: () =>
      Promise.reject(new Error('Not used by migration integration tests.')),
    deleteAccount: () =>
      Promise.reject(new Error('Not used by migration integration tests.')),
  };
}

interface IsolatedMigrationDatabase {
  adminDatabase: Kysely<unknown>;
  database: Kysely<DatabaseSchema>;
  schemaName: string;
}

let isolatedProviderBackfillSchemaSequence = 0;

async function createProviderBackfillTestDatabase(
  label: string,
): Promise<IsolatedMigrationDatabase> {
  isolatedProviderBackfillSchemaSequence += 1;
  const schemaName = `provider_backfill_${label}_${process.pid}_${Date.now()}_${isolatedProviderBackfillSchemaSequence}`;
  const adminDatabase = createDatabaseClient<unknown>({
    connectionString: databaseUrl!,
    maxConnections: 1,
    ssl: false,
  });
  const database = createDatabaseClient<DatabaseSchema>({
    connectionString: databaseUrl!,
    maxConnections: 1,
    ssl: false,
  });

  try {
    await sql`create schema ${sql.id(schemaName)}`.execute(adminDatabase);
    await sql`set search_path to ${sql.id(schemaName)}, public`.execute(
      database,
    );
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

    return { adminDatabase, database, schemaName };
  } catch (error) {
    await database.destroy();
    await sql`drop schema if exists ${sql.id(schemaName)} cascade`.execute(
      adminDatabase,
    );
    await adminDatabase.destroy();
    throw error;
  }
}

async function destroyProviderBackfillTestDatabase({
  adminDatabase,
  database,
  schemaName,
}: IsolatedMigrationDatabase): Promise<void> {
  await database.destroy();
  await sql`drop schema if exists ${sql.id(schemaName)} cascade`.execute(
    adminDatabase,
  );
  await adminDatabase.destroy();
}

function syntheticProviderFixtureId(kind: string, identity: string): string {
  const digest = createHash('md5')
    .update(`uae-health:synthetic-provider-scheduling:v1:${kind}:${identity}`)
    .digest('hex');

  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    digest.slice(12, 16),
    digest.slice(16, 20),
    digest.slice(20, 32),
  ].join('-');
}

const providerBackfillFixture = {
  tenantId: 'ba000000-0000-4000-8000-000000000001',
  applicationUserId: 'ba000000-0000-4000-8000-000000000002',
  patientIdentityId: 'ba000000-0000-4000-8000-000000000003',
  practices: {
    missingFacility: 'ba100000-0000-4000-8000-000000000001',
    singleFacility: 'ba100000-0000-4000-8000-000000000002',
    deterministicFacility: 'ba100000-0000-4000-8000-000000000003',
    noSlots: 'ba100000-0000-4000-8000-000000000004',
  },
  bookablePractices: {
    missingFacility: 'ba200000-0000-4000-8000-000000000001',
    singleFacility: 'ba200000-0000-4000-8000-000000000002',
    deterministicFacility: 'ba200000-0000-4000-8000-000000000003',
    noSlots: 'ba200000-0000-4000-8000-000000000004',
  },
  facilities: {
    single: 'ba300000-0000-4000-8000-000000000001',
    additional: 'ba300000-0000-4000-8000-000000000002',
    noSlots: 'ba300000-0000-4000-8000-000000000003',
  },
  relationships: {
    missingFacility: 'ba400000-0000-4000-8000-000000000001',
    singleFacility: 'ba400000-0000-4000-8000-000000000002',
  },
  slots: {
    referenced: 'ba500000-0000-4000-8000-000000000001',
    repeatedWindow: 'ba500000-0000-4000-8000-000000000002',
    cancelledAppointment: 'ba500000-0000-4000-8000-000000000003',
    deterministicFacility: 'ba500000-0000-4000-8000-000000000004',
  },
  appointments: {
    requested: 'ba600000-0000-4000-8000-000000000001',
    cancelled: 'ba600000-0000-4000-8000-000000000002',
  },
} as const;

async function insertSyntheticProviderBackfillFixture(
  database: Kysely<DatabaseSchema>,
): Promise<void> {
  const fixture = providerBackfillFixture;
  const deterministicFacilityId = syntheticProviderFixtureId(
    'facility',
    fixture.bookablePractices.deterministicFacility,
  );

  await database
    .insertInto('tenants')
    .values({
      id: fixture.tenantId,
      code: 'PROVIDER-BACKFILL',
      name: 'Synthetic Provider Backfill Tenant',
      is_synthetic: true,
    })
    .execute();
  await database
    .insertInto('organizations')
    .values([
      {
        id: fixture.practices.missingFacility,
        tenant_id: fixture.tenantId,
        parent_organization_id: null,
        kind: 'practice',
        code: 'BACKFILL-MISSING-FACILITY',
        name: 'Synthetic Missing Facility Practice',
        is_synthetic: true,
      },
      {
        id: fixture.practices.singleFacility,
        tenant_id: fixture.tenantId,
        parent_organization_id: null,
        kind: 'practice',
        code: 'BACKFILL-SINGLE-FACILITY',
        name: 'Synthetic Single Facility Practice',
        is_synthetic: true,
      },
      {
        id: fixture.practices.deterministicFacility,
        tenant_id: fixture.tenantId,
        parent_organization_id: null,
        kind: 'practice',
        code: 'BACKFILL-DETERMINISTIC-FACILITY',
        name: 'Synthetic Deterministic Facility Practice',
        is_synthetic: true,
      },
      {
        id: fixture.practices.noSlots,
        tenant_id: fixture.tenantId,
        parent_organization_id: null,
        kind: 'practice',
        code: 'BACKFILL-NO-SLOTS',
        name: 'Synthetic No Slots Practice',
        is_synthetic: true,
      },
    ])
    .execute();
  await database
    .insertInto('facilities')
    .values([
      {
        id: fixture.facilities.single,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.singleFacility,
        code: 'BACKFILL-FACILITY-SINGLE',
        name: 'Synthetic Existing Backfill Facility',
        timezone: 'Asia/Dubai',
        is_synthetic: true,
      },
      {
        id: deterministicFacilityId,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.deterministicFacility,
        code: 'BACKFILL-FACILITY-DETERMINISTIC',
        name: 'Synthetic Deterministic Backfill Facility',
        timezone: 'Asia/Dubai',
        is_synthetic: true,
      },
      {
        id: fixture.facilities.additional,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.deterministicFacility,
        code: 'BACKFILL-FACILITY-ADDITIONAL',
        name: 'Synthetic Additional Backfill Facility',
        timezone: 'Asia/Dubai',
        is_synthetic: true,
      },
      {
        id: fixture.facilities.noSlots,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.noSlots,
        code: 'BACKFILL-FACILITY-NO-SLOTS',
        name: 'Synthetic No Slots Backfill Facility',
        timezone: 'Asia/Dubai',
        is_synthetic: true,
      },
    ])
    .execute();
  await database
    .insertInto('application_users')
    .values({
      id: fixture.applicationUserId,
      display_name: 'Synthetic Provider Backfill Patient',
      primary_email: 'provider-backfill-patient@example.invalid',
      is_synthetic: true,
    })
    .execute();
  await database
    .insertInto('patient_portal_identities')
    .values({
      id: fixture.patientIdentityId,
      application_user_id: fixture.applicationUserId,
      issuer: 'https://patient-idp.example.invalid/provider-backfill',
      subject: 'synthetic-provider-backfill-patient',
      client_id: 'synthetic-provider-backfill-client',
      username: 'provider-backfill-patient@example.invalid',
      status: 'active',
      last_authenticated_at: null,
    })
    .execute();
  await database
    .insertInto('patient_portal_bookable_practices')
    .values([
      {
        id: fixture.bookablePractices.missingFacility,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.missingFacility,
        timezone: 'Asia/Dubai',
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.bookablePractices.singleFacility,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.singleFacility,
        timezone: 'Asia/Dubai',
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.bookablePractices.deterministicFacility,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.deterministicFacility,
        timezone: 'Asia/Dubai',
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.bookablePractices.noSlots,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.noSlots,
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
        id: fixture.relationships.missingFacility,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.missingFacility,
        patient_portal_identity_id: fixture.patientIdentityId,
        status: 'pending',
      },
      {
        id: fixture.relationships.singleFacility,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.singleFacility,
        patient_portal_identity_id: fixture.patientIdentityId,
        status: 'pending',
      },
    ])
    .execute();
  await database
    .insertInto('patient_portal_appointment_slots')
    .values([
      {
        id: fixture.slots.referenced,
        bookable_practice_id: fixture.bookablePractices.missingFacility,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.missingFacility,
        starts_at: new Date('2035-01-08T05:00:00.000Z'),
        ends_at: new Date('2035-01-08T05:30:00.000Z'),
        status: 'available',
        is_synthetic: true,
      },
      {
        id: fixture.slots.repeatedWindow,
        bookable_practice_id: fixture.bookablePractices.missingFacility,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.missingFacility,
        starts_at: new Date('2035-01-15T05:00:00.000Z'),
        ends_at: new Date('2035-01-15T05:30:00.000Z'),
        status: 'withdrawn',
        is_synthetic: true,
      },
      {
        id: fixture.slots.cancelledAppointment,
        bookable_practice_id: fixture.bookablePractices.singleFacility,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.singleFacility,
        starts_at: new Date('2035-01-09T06:00:00.000Z'),
        ends_at: new Date('2035-01-09T06:45:00.000Z'),
        status: 'available',
        is_synthetic: true,
      },
      {
        id: fixture.slots.deterministicFacility,
        bookable_practice_id: fixture.bookablePractices.deterministicFacility,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.deterministicFacility,
        starts_at: new Date('2035-01-10T19:30:00.000Z'),
        ends_at: new Date('2035-01-10T20:00:00.000Z'),
        status: 'available',
        is_synthetic: true,
      },
    ])
    .execute();
  await database
    .insertInto('patient_portal_appointments')
    .values([
      {
        id: fixture.appointments.requested,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.missingFacility,
        patient_portal_identity_id: fixture.patientIdentityId,
        patient_portal_profile_id: null,
        patient_portal_appointment_relationship_id:
          fixture.relationships.missingFacility,
        appointment_slot_id: fixture.slots.referenced,
        status: 'requested',
        version: 1,
        cancelled_at: null,
      },
      {
        id: fixture.appointments.cancelled,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practices.singleFacility,
        patient_portal_identity_id: fixture.patientIdentityId,
        patient_portal_profile_id: null,
        patient_portal_appointment_relationship_id:
          fixture.relationships.singleFacility,
        appointment_slot_id: fixture.slots.cancelledAppointment,
        status: 'cancelled',
        version: 2,
        cancelled_at: new Date('2034-12-01T10:00:00.000Z'),
      },
    ])
    .execute();
}

interface SyntheticProviderTestScope {
  facilityId: string;
  practitionerFacilityAssignmentId: string;
  practitionerServiceAssignmentId: string;
  practitionerId: string;
  appointmentServiceId: string;
  availabilityTemplateId: string;
  sourceTimezone: string;
}

async function insertSyntheticProviderTestScope(
  database: Kysely<DatabaseSchema>,
  input: {
    tenantId: string;
    organizationId: string;
    suffix: string;
  },
): Promise<SyntheticProviderTestScope> {
  const sourceTimezone = 'Asia/Dubai';
  const facility = await database
    .insertInto('facilities')
    .values({
      tenant_id: input.tenantId,
      organization_id: input.organizationId,
      code: `APPT-${input.suffix}-FACILITY`,
      name: `Synthetic Appointment Facility ${input.suffix}`,
      timezone: sourceTimezone,
      is_synthetic: true,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const practitioner = await database
    .insertInto('practitioners')
    .values({
      tenant_id: input.tenantId,
      application_user_id: null,
      display_name: `Dr Synthetic Appointment ${input.suffix}`,
      professional_title: 'Synthetic physician',
      status: 'active',
      is_synthetic: true,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const specialty = await database
    .insertInto('specialties')
    .values({
      tenant_id: input.tenantId,
      organization_id: input.organizationId,
      code: `APPT-${input.suffix}-SPECIALTY`,
      name: `Synthetic Appointment Specialty ${input.suffix}`,
      status: 'active',
      is_synthetic: true,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const facilityAssignment = await database
    .insertInto('practitioner_facility_assignments')
    .values({
      tenant_id: input.tenantId,
      organization_id: input.organizationId,
      facility_id: facility.id,
      practitioner_id: practitioner.id,
      status: 'active',
      is_synthetic: true,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const service = await database
    .insertInto('appointment_services')
    .values({
      tenant_id: input.tenantId,
      organization_id: input.organizationId,
      facility_id: facility.id,
      specialty_id: specialty.id,
      code: `APPT-${input.suffix}-CONSULT`,
      patient_facing_name: `Synthetic Consultation ${input.suffix}`,
      duration_minutes: 30,
      allows_any_practitioner: false,
      status: 'active',
      is_synthetic: true,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const serviceAssignment = await database
    .insertInto('practitioner_service_assignments')
    .values({
      tenant_id: input.tenantId,
      organization_id: input.organizationId,
      facility_id: facility.id,
      practitioner_facility_assignment_id: facilityAssignment.id,
      practitioner_id: practitioner.id,
      appointment_service_id: service.id,
      status: 'active',
      is_synthetic: true,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const availabilityTemplate = await database
    .insertInto('practitioner_availability_templates')
    .values({
      tenant_id: input.tenantId,
      organization_id: input.organizationId,
      facility_id: facility.id,
      practitioner_facility_assignment_id: facilityAssignment.id,
      practitioner_service_assignment_id: serviceAssignment.id,
      practitioner_id: practitioner.id,
      appointment_service_id: service.id,
      iso_weekday: 4,
      local_start_minute: 540,
      local_end_minute: 570,
      effective_from: '2035-01-01',
      effective_until: null,
      source_timezone: sourceTimezone,
      status: 'active',
      is_synthetic: true,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  return {
    facilityId: facility.id,
    practitionerFacilityAssignmentId: facilityAssignment.id,
    practitionerServiceAssignmentId: serviceAssignment.id,
    practitionerId: practitioner.id,
    appointmentServiceId: service.id,
    availabilityTemplateId: availabilityTemplate.id,
    sourceTimezone,
  };
}

describeWithDatabase('identity, authorization, and audit migrations', () => {
  const schemaName = `identity_schema_test_${process.pid}_${Date.now()}`;
  const legacyAvailabilityFixture = {
    tenantId: 'f1000000-0000-4000-8000-000000000001',
    organizationId: 'f2000000-0000-4000-8000-000000000001',
    applicationUserId: 'f3000000-0000-4000-8000-000000000001',
    patientIdentityId: 'f4000000-0000-4000-8000-000000000001',
    relationshipId: 'f5000000-0000-4000-8000-000000000001',
    bookablePracticeId: 'f6000000-0000-4000-8000-000000000001',
    slotId: 'f7000000-0000-4000-8000-000000000001',
    appointmentId: 'f8000000-0000-4000-8000-000000000001',
  } as const;
  let adminDatabase: Kysely<unknown>;
  let database: Kysely<DatabaseSchema>;

  beforeAll(async () => {
    adminDatabase = createDatabaseClient<unknown>({
      connectionString: databaseUrl!,
      maxConnections: 1,
      ssl: false,
    });
    await sql`create schema ${sql.id(schemaName)}`.execute(adminDatabase);

    database = createDatabaseClient<DatabaseSchema>({
      connectionString: databaseUrl!,
      maxConnections: 1,
      ssl: false,
    });
    await sql`set search_path to ${sql.id(schemaName)}, public`.execute(
      database,
    );
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

    await database
      .insertInto('tenants')
      .values({
        id: legacyAvailabilityFixture.tenantId,
        code: 'AVAIL-LEGACY',
        name: 'Synthetic Legacy Availability Tenant',
        is_synthetic: true,
      })
      .execute();
    await database
      .insertInto('organizations')
      .values({
        id: legacyAvailabilityFixture.organizationId,
        tenant_id: legacyAvailabilityFixture.tenantId,
        parent_organization_id: null,
        kind: 'practice',
        code: 'AVAIL-LEGACY-PRACTICE',
        name: 'Synthetic Legacy Availability Practice',
        is_synthetic: true,
      })
      .execute();
    await database
      .insertInto('application_users')
      .values({
        id: legacyAvailabilityFixture.applicationUserId,
        display_name: 'Synthetic Legacy Availability Patient',
        primary_email: 'legacy-availability-patient@example.invalid',
        is_synthetic: true,
      })
      .execute();
    await database
      .insertInto('patient_portal_identities')
      .values({
        id: legacyAvailabilityFixture.patientIdentityId,
        application_user_id: legacyAvailabilityFixture.applicationUserId,
        issuer: 'https://patient-idp.example.invalid/legacy-availability',
        subject: 'synthetic-legacy-availability-patient',
        client_id: 'synthetic-legacy-availability-client',
        username: 'legacy-availability-patient@example.invalid',
        status: 'active',
        last_authenticated_at: null,
      })
      .execute();
    await database
      .insertInto('patient_portal_appointment_relationships')
      .values({
        id: legacyAvailabilityFixture.relationshipId,
        tenant_id: legacyAvailabilityFixture.tenantId,
        organization_id: legacyAvailabilityFixture.organizationId,
        patient_portal_identity_id: legacyAvailabilityFixture.patientIdentityId,
        status: 'pending',
      })
      .execute();
    await database
      .insertInto('patient_portal_bookable_practices')
      .values({
        id: legacyAvailabilityFixture.bookablePracticeId,
        tenant_id: legacyAvailabilityFixture.tenantId,
        organization_id: legacyAvailabilityFixture.organizationId,
        timezone: 'Asia/Dubai',
        status: 'active',
        is_synthetic: true,
      })
      .execute();
    await database
      .insertInto('patient_portal_appointment_slots')
      .values({
        id: legacyAvailabilityFixture.slotId,
        bookable_practice_id: legacyAvailabilityFixture.bookablePracticeId,
        tenant_id: legacyAvailabilityFixture.tenantId,
        organization_id: legacyAvailabilityFixture.organizationId,
        starts_at: new Date('2035-01-08T09:00:00.000Z'),
        ends_at: new Date('2035-01-08T09:30:00.000Z'),
        status: 'available',
        is_synthetic: true,
      })
      .execute();
    await database
      .insertInto('patient_portal_appointments')
      .values({
        id: legacyAvailabilityFixture.appointmentId,
        tenant_id: legacyAvailabilityFixture.tenantId,
        organization_id: legacyAvailabilityFixture.organizationId,
        patient_portal_identity_id: legacyAvailabilityFixture.patientIdentityId,
        patient_portal_profile_id: null,
        patient_portal_appointment_relationship_id:
          legacyAvailabilityFixture.relationshipId,
        appointment_slot_id: legacyAvailabilityFixture.slotId,
        status: 'requested',
        version: 1,
        cancelled_at: null,
      })
      .execute();

    await createProviderAvailability.up(database);
  });

  afterAll(async () => {
    if (database) {
      await sql`
        delete from patient_portal_appointment_commands command
        using patient_portal_appointments appointment
        where command.patient_portal_appointment_id = appointment.id
          and appointment.practitioner_id is not null
      `.execute(database);
      await database
        .deleteFrom('patient_portal_appointments')
        .where('practitioner_id', 'is not', null)
        .execute();
      await database
        .deleteFrom('patient_portal_appointment_slots')
        .where('availability_template_id', 'is not', null)
        .execute();
      await database.deleteFrom('provider_availability_exceptions').execute();
      await database
        .deleteFrom('practitioner_availability_templates')
        .execute();

      await createProviderAvailability.down(database);

      const rolledBackAvailabilityTables = await sql<{ count: number }>`
        select count(*)::integer as count
        from pg_class
        where relnamespace = current_schema()::regnamespace
          and relname in (
            'practitioner_availability_templates',
            'provider_availability_exceptions'
          )
      `.execute(database);
      expect(rolledBackAvailabilityTables.rows[0]?.count).toBe(0);

      const rolledBackAvailabilityFunctions = await sql<{ count: number }>`
        select count(*)::integer as count
        from pg_proc
        where pronamespace = current_schema()::regnamespace
          and proname in (
            'prevent_practitioner_availability_template_retargeting',
            'prevent_provider_availability_exception_retargeting',
            'prevent_provider_appointment_slot_retargeting',
            'prevent_live_appointment_slot_withdrawal',
            'enforce_appointment_provider_slot_parity'
          )
      `.execute(database);
      expect(rolledBackAvailabilityFunctions.rows[0]?.count).toBe(0);

      const rolledBackAvailabilityTriggers = await sql<{ count: number }>`
        select count(*)::integer as count
        from pg_trigger trigger
        inner join pg_class relation on relation.oid = trigger.tgrelid
        where relation.relnamespace = current_schema()::regnamespace
          and not trigger.tgisinternal
          and trigger.tgname in (
            'practitioner_availability_templates_identity_no_retarget',
            'provider_availability_exceptions_identity_no_retarget',
            'pp_appointment_slots_identity_no_retarget',
            'pp_appointment_slots_live_no_withdrawal',
            'pp_appointments_provider_slot_parity'
          )
      `.execute(database);
      expect(rolledBackAvailabilityTriggers.rows[0]?.count).toBe(0);

      const rolledBackAvailabilityColumns = await sql<{
        count: number;
      }>`
        select count(*)::integer as count
        from information_schema.columns
        where table_schema = current_schema()
          and (
            (table_name = 'patient_portal_appointment_slots'
              and column_name in (
                'facility_id',
                'practitioner_facility_assignment_id',
                'practitioner_service_assignment_id',
                'practitioner_id',
                'appointment_service_id',
                'availability_template_id',
                'generation_key_hash',
                'source_local_date',
                'source_timezone'
              ))
            or
            (table_name = 'patient_portal_appointments'
              and column_name in (
                'facility_id',
                'practitioner_facility_assignment_id',
                'practitioner_service_assignment_id',
                'practitioner_id',
                'appointment_service_id'
              ))
          )
      `.execute(database);
      expect(rolledBackAvailabilityColumns.rows[0]?.count).toBe(0);

      const restoredLegacySlotConstraint = await sql<{ count: number }>`
        select count(*)::integer as count
        from pg_constraint
        where connamespace = current_schema()::regnamespace
          and conrelid = 'patient_portal_appointment_slots'::regclass
          and conname = 'pp_appointment_slots_practice_start_unique'
      `.execute(database);
      expect(restoredLegacySlotConstraint.rows[0]?.count).toBe(1);

      const preservedLegacyAvailability = await database
        .selectFrom('patient_portal_appointments as appointment')
        .innerJoin(
          'patient_portal_appointment_slots as slot',
          'slot.id',
          'appointment.appointment_slot_id',
        )
        .select([
          'appointment.id as appointment_id',
          'slot.id as slot_id',
          'appointment.status',
        ])
        .where('appointment.id', '=', legacyAvailabilityFixture.appointmentId)
        .executeTakeFirstOrThrow();
      expect(preservedLegacyAvailability).toEqual({
        appointment_id: legacyAvailabilityFixture.appointmentId,
        slot_id: legacyAvailabilityFixture.slotId,
        status: 'requested',
      });

      await createProviderSchedulingCatalogue.down(database);

      const rolledBackCatalogue = await sql<{ count: number }>`
        select count(*)::integer as count
        from pg_class
        where relnamespace = current_schema()::regnamespace
          and relname in (
            'specialties',
            'practitioner_facility_assignments',
            'appointment_services',
            'practitioner_service_assignments'
          )
      `.execute(database);
      expect(rolledBackCatalogue.rows[0]?.count).toBe(0);

      const rolledBackFunctions = await sql<{ count: number }>`
        select count(*)::integer as count
        from pg_proc
        where pronamespace = current_schema()::regnamespace
          and proname in (
            'prevent_specialty_retargeting',
            'prevent_practitioner_facility_assignment_retargeting',
            'prevent_appointment_service_retargeting',
            'prevent_practitioner_service_assignment_retargeting'
          )
      `.execute(database);
      expect(rolledBackFunctions.rows[0]?.count).toBe(0);

      const rolledBackConstraints = await sql<{ count: number }>`
        select count(*)::integer as count
        from pg_constraint
        where connamespace = current_schema()::regnamespace
          and conname in (
            'organizations_tenant_id_id_kind_unique',
            'facilities_tenant_organization_id_unique',
            'facilities_name_nonblank_check',
            'facilities_timezone_nonblank_check'
          )
      `.execute(database);
      expect(rolledBackConstraints.rows[0]?.count).toBe(0);

      const preservedPrerequisites = await sql<{
        facilities: string | null;
        practitioners: string | null;
        roles: string | null;
      }>`
        select
          to_regclass('facilities')::text as facilities,
          to_regclass('practitioners')::text as practitioners,
          to_regclass('roles')::text as roles
      `.execute(database);
      expect(preservedPrerequisites.rows[0]).toEqual({
        facilities: 'facilities',
        practitioners: 'practitioners',
        roles: 'roles',
      });

      await createPractitionerProfiles.down(database);
      await createPatientPortalAppointments.down(database);
      await createPatientRegistrationAndInvitations.down(database);
      await createPatientPortalIdentity.down(database);
      await addIdentityProviderSyncStatus.down(database);
      await addTenantLocalRoleNameUniqueness.down(database);
      await createWorkforceSessions.down(database);
      await createIdentityAuthorizationAudit.down(database);
      await createFacilities.down(database);
      await database.destroy();
    }

    if (adminDatabase) {
      await sql`drop schema ${sql.id(schemaName)} cascade`.execute(
        adminDatabase,
      );
      await adminDatabase.destroy();
    }
  });

  it('creates global role templates and supports one user across tenants', async () => {
    const globalRoles = await database
      .selectFrom('roles')
      .select(['code', 'is_system_template'])
      .where('tenant_id', 'is', null)
      .execute();

    expect(globalRoles).toHaveLength(10);
    expect(globalRoles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PRACTICE_ADMIN',
          is_system_template: true,
        }),
        expect.objectContaining({
          code: 'BILLING_APPROVER',
          is_system_template: true,
        }),
      ]),
    );

    const user = await database
      .insertInto('application_users')
      .values({
        display_name: 'Synthetic Multi Practice User',
        primary_email: 'multi-practice@example.invalid',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    for (const [tenantCode, organizationCode] of [
      ['TENANT-A', 'PRACTICE-A'],
      ['TENANT-B', 'PRACTICE-B'],
    ] as const) {
      const tenant = await database
        .insertInto('tenants')
        .values({
          code: tenantCode,
          name: `Synthetic ${tenantCode}`,
          is_synthetic: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const organization = await database
        .insertInto('organizations')
        .values({
          tenant_id: tenant.id,
          parent_organization_id: null,
          kind: 'practice',
          code: organizationCode,
          name: `Synthetic ${organizationCode}`,
          is_synthetic: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await database
        .insertInto('organization_memberships')
        .values({
          tenant_id: tenant.id,
          organization_id: organization.id,
          application_user_id: user.id,
          status: 'active',
          provisioning_method: 'jit',
          external_id: null,
          valid_until: null,
        })
        .execute();
    }

    const memberships = await database
      .selectFrom('organization_memberships')
      .select('tenant_id')
      .where('application_user_id', '=', user.id)
      .execute();

    expect(memberships).toHaveLength(2);
    expect(new Set(memberships.map(({ tenant_id }) => tenant_id)).size).toBe(2);
  });

  it('stores tenant practitioners without requiring workforce access', async () => {
    const firstTenant = await database
      .insertInto('tenants')
      .values({
        code: 'PRACTITIONER-A',
        name: 'Synthetic Practitioner Tenant A',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const secondTenant = await database
      .insertInto('tenants')
      .values({
        code: 'PRACTITIONER-B',
        name: 'Synthetic Practitioner Tenant B',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const applicationUser = await database
      .insertInto('application_users')
      .values({
        display_name: 'Synthetic Linked Practitioner',
        primary_email: 'linked-practitioner@example.invalid',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const unlinkedPractitioner = await database
      .insertInto('practitioners')
      .values({
        tenant_id: firstTenant.id,
        application_user_id: null,
        display_name: 'Synthetic Doctor Without Login',
        professional_title: 'General practitioner',
        is_synthetic: true,
      })
      .returning(['id', 'application_user_id', 'status'])
      .executeTakeFirstOrThrow();

    expect(unlinkedPractitioner).toMatchObject({
      application_user_id: null,
      status: 'active',
    });

    const secondUnlinkedPractitioner = await database
      .insertInto('practitioners')
      .values({
        tenant_id: firstTenant.id,
        application_user_id: null,
        display_name: 'Synthetic Second Doctor Without Login',
        professional_title: 'Consultant physician',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await database
      .updateTable('practitioners')
      .set({ application_user_id: applicationUser.id })
      .where('id', '=', unlinkedPractitioner.id)
      .executeTakeFirstOrThrow();

    await expect(
      database
        .updateTable('practitioners')
        .set({ application_user_id: null })
        .where('id', '=', unlinkedPractitioner.id)
        .execute(),
    ).rejects.toThrow('Practitioner application-user link is immutable.');

    const anotherApplicationUser = await database
      .insertInto('application_users')
      .values({
        display_name: 'Synthetic Different Practitioner User',
        primary_email: 'different-practitioner@example.invalid',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await expect(
      database
        .updateTable('practitioners')
        .set({ application_user_id: anotherApplicationUser.id })
        .where('id', '=', unlinkedPractitioner.id)
        .execute(),
    ).rejects.toThrow('Practitioner application-user link is immutable.');

    await expect(
      database
        .updateTable('practitioners')
        .set({ tenant_id: secondTenant.id })
        .where('id', '=', unlinkedPractitioner.id)
        .execute(),
    ).rejects.toThrow('Practitioner ownership is immutable.');

    await expect(
      database
        .updateTable('practitioners')
        .set({ application_user_id: applicationUser.id })
        .where('id', '=', secondUnlinkedPractitioner.id)
        .execute(),
    ).rejects.toThrow();

    const secondTenantPractitioner = await database
      .insertInto('practitioners')
      .values({
        tenant_id: secondTenant.id,
        application_user_id: applicationUser.id,
        display_name: 'Synthetic Cross-Tenant Doctor',
        professional_title: 'General practitioner',
        is_synthetic: true,
      })
      .returning(['tenant_id', 'application_user_id'])
      .executeTakeFirstOrThrow();

    expect(secondTenantPractitioner).toEqual({
      tenant_id: secondTenant.id,
      application_user_id: applicationUser.id,
    });

    await expect(
      database
        .insertInto('practitioners')
        .values({
          tenant_id: firstTenant.id,
          application_user_id: null,
          display_name: '   ',
          professional_title: 'General practitioner',
          is_synthetic: true,
        })
        .execute(),
    ).rejects.toThrow();

    const [identities, patientIdentities, memberships, assignments] =
      await Promise.all([
        database
          .selectFrom('user_identities')
          .select('id')
          .where('application_user_id', '=', applicationUser.id)
          .execute(),
        database
          .selectFrom('patient_portal_identities')
          .select('id')
          .where('application_user_id', '=', applicationUser.id)
          .execute(),
        database
          .selectFrom('organization_memberships')
          .select('id')
          .where('application_user_id', '=', applicationUser.id)
          .execute(),
        database
          .selectFrom('role_assignments')
          .innerJoin(
            'organization_memberships',
            'organization_memberships.id',
            'role_assignments.membership_id',
          )
          .select('role_assignments.id')
          .where(
            'organization_memberships.application_user_id',
            '=',
            applicationUser.id,
          )
          .execute(),
      ]);

    expect(identities).toHaveLength(0);
    expect(patientIdentities).toHaveLength(0);
    expect(memberships).toHaveLength(0);
    expect(assignments).toHaveLength(0);
  });

  it('keeps practitioner affiliation and service eligibility in one exact practice and facility scope', async () => {
    const firstTenant = await database
      .insertInto('tenants')
      .values({
        code: 'SCHEDULING-A',
        name: 'Synthetic Scheduling Tenant A',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const secondTenant = await database
      .insertInto('tenants')
      .values({
        code: 'SCHEDULING-B',
        name: 'Synthetic Scheduling Tenant B',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const firstPractice = await database
      .insertInto('organizations')
      .values({
        tenant_id: firstTenant.id,
        parent_organization_id: null,
        kind: 'practice',
        code: 'SCHED-PRACTICE-A',
        name: 'Synthetic Scheduling Practice A',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const secondPractice = await database
      .insertInto('organizations')
      .values({
        tenant_id: firstTenant.id,
        parent_organization_id: null,
        kind: 'practice',
        code: 'SCHED-PRACTICE-B',
        name: 'Synthetic Scheduling Practice B',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const firstTenantGroup = await database
      .insertInto('organizations')
      .values({
        tenant_id: firstTenant.id,
        parent_organization_id: null,
        kind: 'group',
        code: 'SCHED-GROUP-A',
        name: 'Synthetic Scheduling Group A',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const foreignPractice = await database
      .insertInto('organizations')
      .values({
        tenant_id: secondTenant.id,
        parent_organization_id: null,
        kind: 'practice',
        code: 'SCHED-PRACTICE-C',
        name: 'Synthetic Scheduling Practice C',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const firstFacility = await database
      .insertInto('facilities')
      .values({
        tenant_id: firstTenant.id,
        organization_id: firstPractice.id,
        code: 'SCHED-FACILITY-A',
        name: 'Synthetic Scheduling Facility A',
        timezone: 'Asia/Dubai',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const alternateFirstPracticeFacility = await database
      .insertInto('facilities')
      .values({
        tenant_id: firstTenant.id,
        organization_id: firstPractice.id,
        code: 'SCHED-FACILITY-A2',
        name: 'Synthetic Scheduling Facility A2',
        timezone: 'Asia/Dubai',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const secondFacility = await database
      .insertInto('facilities')
      .values({
        tenant_id: firstTenant.id,
        organization_id: secondPractice.id,
        code: 'SCHED-FACILITY-B',
        name: 'Synthetic Scheduling Facility B',
        timezone: 'Asia/Dubai',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const groupFacility = await database
      .insertInto('facilities')
      .values({
        tenant_id: firstTenant.id,
        organization_id: firstTenantGroup.id,
        code: 'SCHED-FACILITY-GROUP',
        name: 'Synthetic Scheduling Group Facility',
        timezone: 'Asia/Dubai',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const foreignFacility = await database
      .insertInto('facilities')
      .values({
        tenant_id: secondTenant.id,
        organization_id: foreignPractice.id,
        code: 'SCHED-FACILITY-C',
        name: 'Synthetic Scheduling Facility C',
        timezone: 'Asia/Dubai',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const practitionerUser = await database
      .insertInto('application_users')
      .values({
        display_name: 'Synthetic Scheduling Physician',
        primary_email: 'scheduling-physician@example.invalid',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const practitioner = await database
      .insertInto('practitioners')
      .values({
        tenant_id: firstTenant.id,
        application_user_id: practitionerUser.id,
        display_name: 'Dr Synthetic Scheduling',
        professional_title: 'Consultant physician',
        status: 'active',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const foreignPractitioner = await database
      .insertInto('practitioners')
      .values({
        tenant_id: secondTenant.id,
        application_user_id: null,
        display_name: 'Dr Synthetic Foreign Scope',
        professional_title: 'Consultant physician',
        status: 'active',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const physicianMembership = await database
      .insertInto('organization_memberships')
      .values({
        tenant_id: firstTenant.id,
        organization_id: firstPractice.id,
        application_user_id: practitionerUser.id,
        status: 'active',
        provisioning_method: 'admin_invite',
        external_id: null,
        valid_until: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const physicianRole = await database
      .selectFrom('roles')
      .select('id')
      .where('tenant_id', 'is', null)
      .where('code', '=', 'PHYSICIAN')
      .executeTakeFirstOrThrow();
    await database
      .insertInto('role_assignments')
      .values({
        tenant_id: firstTenant.id,
        membership_id: physicianMembership.id,
        role_id: physicianRole.id,
        scope_organization_id: firstPractice.id,
        facility_id: null,
        include_descendants: false,
        assignment_source: 'system_bootstrap',
        assigned_by_user_id: null,
        source_role_request_id: null,
        valid_until: null,
        revoked_at: null,
        revoked_by_user_id: null,
        revocation_reason: null,
      })
      .execute();

    const facilityAssignmentsFromRole = await database
      .selectFrom('practitioner_facility_assignments')
      .select('id')
      .where('practitioner_id', '=', practitioner.id)
      .execute();
    const serviceEligibilityFromRole = await database
      .selectFrom('practitioner_service_assignments')
      .select('id')
      .where('practitioner_id', '=', practitioner.id)
      .execute();
    expect(facilityAssignmentsFromRole).toHaveLength(0);
    expect(serviceEligibilityFromRole).toHaveLength(0);

    const firstFacilityAssignment = await database
      .insertInto('practitioner_facility_assignments')
      .values({
        tenant_id: firstTenant.id,
        organization_id: firstPractice.id,
        facility_id: firstFacility.id,
        practitioner_id: practitioner.id,
        status: 'active',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const alternateFirstPracticeFacilityAssignment = await database
      .insertInto('practitioner_facility_assignments')
      .values({
        tenant_id: firstTenant.id,
        organization_id: firstPractice.id,
        facility_id: alternateFirstPracticeFacility.id,
        practitioner_id: practitioner.id,
        status: 'active',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const secondFacilityAssignment = await database
      .insertInto('practitioner_facility_assignments')
      .values({
        tenant_id: firstTenant.id,
        organization_id: secondPractice.id,
        facility_id: secondFacility.id,
        practitioner_id: practitioner.id,
        status: 'active',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await expect(
      database
        .insertInto('practitioner_facility_assignments')
        .values({
          tenant_id: firstTenant.id,
          organization_id: firstPractice.id,
          facility_id: firstFacility.id,
          practitioner_id: practitioner.id,
          status: 'inactive',
          is_synthetic: true,
        })
        .execute(),
    ).rejects.toMatchObject({
      code: '23505',
      constraint: 'practitioner_facility_assignments_practitioner_unique',
    });

    await expect(
      database
        .insertInto('practitioner_facility_assignments')
        .values({
          tenant_id: firstTenant.id,
          organization_id: firstTenantGroup.id,
          facility_id: groupFacility.id,
          practitioner_id: practitioner.id,
          status: 'active',
          is_synthetic: true,
        })
        .execute(),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'practitioner_facility_assignments_practice_fk',
    });

    await expect(
      database
        .insertInto('practitioner_facility_assignments')
        .values({
          tenant_id: firstTenant.id,
          organization_id: firstPractice.id,
          facility_id: firstFacility.id,
          practitioner_id: foreignPractitioner.id,
          status: 'active',
          is_synthetic: true,
        })
        .execute(),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'practitioner_facility_assignments_practitioner_scope_fk',
    });

    await expect(
      database
        .insertInto('practitioner_facility_assignments')
        .values({
          tenant_id: firstTenant.id,
          organization_id: firstPractice.id,
          facility_id: secondFacility.id,
          practitioner_id: practitioner.id,
          status: 'active',
          is_synthetic: true,
        })
        .execute(),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'practitioner_facility_assignments_facility_scope_fk',
    });

    await expect(
      database
        .updateTable('practitioner_facility_assignments')
        .set({ facility_id: alternateFirstPracticeFacility.id })
        .where('id', '=', firstFacilityAssignment.id)
        .execute(),
    ).rejects.toThrow(
      'Practitioner facility assignment identity and scope are immutable.',
    );

    const firstSpecialty = await database
      .insertInto('specialties')
      .values({
        tenant_id: firstTenant.id,
        organization_id: firstPractice.id,
        code: 'GENERAL-MEDICINE',
        name: 'General medicine',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const secondSpecialty = await database
      .insertInto('specialties')
      .values({
        tenant_id: firstTenant.id,
        organization_id: secondPractice.id,
        code: 'GENERAL-MEDICINE',
        name: 'General medicine',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const foreignSpecialty = await database
      .insertInto('specialties')
      .values({
        tenant_id: secondTenant.id,
        organization_id: foreignPractice.id,
        code: 'GENERAL-MEDICINE',
        name: 'General medicine',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await expect(
      database
        .insertInto('specialties')
        .values({
          tenant_id: firstTenant.id,
          organization_id: firstTenantGroup.id,
          code: 'GROUP-SPECIALTY',
          name: 'Invalid group specialty',
          is_synthetic: true,
        })
        .execute(),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'specialties_practice_fk',
    });

    const firstService = await database
      .insertInto('appointment_services')
      .values({
        tenant_id: firstTenant.id,
        organization_id: firstPractice.id,
        facility_id: firstFacility.id,
        specialty_id: firstSpecialty.id,
        code: 'GENERAL-CONSULT',
        patient_facing_name: 'General consultation',
        duration_minutes: 30,
        allows_any_practitioner: true,
        status: 'inactive',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const secondService = await database
      .insertInto('appointment_services')
      .values({
        tenant_id: firstTenant.id,
        organization_id: secondPractice.id,
        facility_id: secondFacility.id,
        specialty_id: secondSpecialty.id,
        code: 'GENERAL-CONSULT',
        patient_facing_name: 'General consultation',
        duration_minutes: 30,
        allows_any_practitioner: false,
        status: 'inactive',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await expect(
      database
        .insertInto('appointment_services')
        .values({
          tenant_id: firstTenant.id,
          organization_id: firstTenantGroup.id,
          facility_id: groupFacility.id,
          specialty_id: secondSpecialty.id,
          code: 'GROUP-CONSULT',
          patient_facing_name: 'Invalid group consultation',
          duration_minutes: 30,
          status: 'active',
          is_synthetic: true,
        })
        .execute(),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'appointment_services_practice_fk',
    });

    await expect(
      database
        .insertInto('appointment_services')
        .values({
          tenant_id: firstTenant.id,
          organization_id: firstPractice.id,
          facility_id: secondFacility.id,
          specialty_id: firstSpecialty.id,
          code: 'WRONG-FACILITY',
          patient_facing_name: 'Invalid facility consultation',
          duration_minutes: 30,
          status: 'active',
          is_synthetic: true,
        })
        .execute(),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'appointment_services_facility_scope_fk',
    });

    await expect(
      database
        .insertInto('appointment_services')
        .values({
          tenant_id: firstTenant.id,
          organization_id: firstPractice.id,
          facility_id: foreignFacility.id,
          specialty_id: firstSpecialty.id,
          code: 'FOREIGN-FACILITY',
          patient_facing_name: 'Invalid cross-tenant consultation',
          duration_minutes: 30,
          status: 'active',
          is_synthetic: true,
        })
        .execute(),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'appointment_services_facility_scope_fk',
    });

    await expect(
      database
        .insertInto('appointment_services')
        .values({
          tenant_id: firstTenant.id,
          organization_id: firstPractice.id,
          facility_id: firstFacility.id,
          specialty_id: foreignSpecialty.id,
          code: 'WRONG-SPECIALTY',
          patient_facing_name: 'Invalid specialty consultation',
          duration_minutes: 30,
          status: 'active',
          is_synthetic: true,
        })
        .execute(),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'appointment_services_specialty_scope_fk',
    });

    await expect(
      database
        .insertInto('appointment_services')
        .values({
          tenant_id: firstTenant.id,
          organization_id: firstPractice.id,
          facility_id: firstFacility.id,
          specialty_id: secondSpecialty.id,
          code: 'SIBLING-SPECIALTY',
          patient_facing_name: 'Invalid sibling specialty consultation',
          duration_minutes: 30,
          status: 'inactive',
          is_synthetic: true,
        })
        .execute(),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'appointment_services_specialty_scope_fk',
    });

    const eligibilityAfterRoleAndFacilityAssignment = await database
      .selectFrom('appointment_services as service')
      .innerJoin(
        'practitioner_facility_assignments as facilityAssignment',
        (join) =>
          join
            .onRef('facilityAssignment.tenant_id', '=', 'service.tenant_id')
            .onRef(
              'facilityAssignment.organization_id',
              '=',
              'service.organization_id',
            )
            .onRef(
              'facilityAssignment.facility_id',
              '=',
              'service.facility_id',
            ),
      )
      .innerJoin('practitioners as practitioner', (join) =>
        join
          .onRef('practitioner.id', '=', 'facilityAssignment.practitioner_id')
          .onRef('practitioner.tenant_id', '=', 'service.tenant_id'),
      )
      .leftJoin('practitioner_service_assignments as eligibility', (join) =>
        join
          .onRef('eligibility.appointment_service_id', '=', 'service.id')
          .onRef(
            'eligibility.practitioner_facility_assignment_id',
            '=',
            'facilityAssignment.id',
          ),
      )
      .select('eligibility.id')
      .where('service.id', '=', firstService.id)
      .where('practitioner.id', '=', practitioner.id)
      .where('eligibility.id', 'is not', null)
      .execute();
    expect(eligibilityAfterRoleAndFacilityAssignment).toHaveLength(0);

    const firstAssignment = await database
      .insertInto('practitioner_service_assignments')
      .values({
        tenant_id: firstTenant.id,
        organization_id: firstPractice.id,
        facility_id: firstFacility.id,
        practitioner_facility_assignment_id: firstFacilityAssignment.id,
        practitioner_id: practitioner.id,
        appointment_service_id: firstService.id,
        status: 'active',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await database
      .insertInto('practitioner_service_assignments')
      .values({
        tenant_id: firstTenant.id,
        organization_id: secondPractice.id,
        facility_id: secondFacility.id,
        practitioner_facility_assignment_id: secondFacilityAssignment.id,
        practitioner_id: practitioner.id,
        appointment_service_id: secondService.id,
        status: 'active',
        is_synthetic: true,
      })
      .execute();

    await expect(
      database
        .insertInto('practitioner_service_assignments')
        .values({
          tenant_id: firstTenant.id,
          organization_id: firstPractice.id,
          facility_id: firstFacility.id,
          practitioner_facility_assignment_id:
            alternateFirstPracticeFacilityAssignment.id,
          practitioner_id: practitioner.id,
          appointment_service_id: firstService.id,
          status: 'active',
          is_synthetic: true,
        })
        .execute(),
    ).rejects.toMatchObject({
      code: '23503',
      constraint:
        'practitioner_service_assignments_facility_assignment_scope_fk',
    });

    await expect(
      database
        .insertInto('practitioner_service_assignments')
        .values({
          tenant_id: firstTenant.id,
          organization_id: secondPractice.id,
          facility_id: secondFacility.id,
          practitioner_facility_assignment_id: secondFacilityAssignment.id,
          practitioner_id: practitioner.id,
          appointment_service_id: firstService.id,
          status: 'active',
          is_synthetic: true,
        })
        .execute(),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'practitioner_service_assignments_service_scope_fk',
    });

    await expect(
      database
        .insertInto('practitioner_service_assignments')
        .values({
          tenant_id: firstTenant.id,
          organization_id: firstPractice.id,
          facility_id: alternateFirstPracticeFacility.id,
          practitioner_facility_assignment_id:
            alternateFirstPracticeFacilityAssignment.id,
          practitioner_id: practitioner.id,
          appointment_service_id: firstService.id,
          status: 'active',
          is_synthetic: true,
        })
        .execute(),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'practitioner_service_assignments_service_scope_fk',
    });

    await expect(
      database
        .insertInto('practitioner_service_assignments')
        .values({
          tenant_id: firstTenant.id,
          organization_id: firstPractice.id,
          facility_id: firstFacility.id,
          practitioner_facility_assignment_id: firstFacilityAssignment.id,
          practitioner_id: practitioner.id,
          appointment_service_id: firstService.id,
          status: 'inactive',
          is_synthetic: true,
        })
        .execute(),
    ).rejects.toMatchObject({
      code: '23505',
      constraint: 'practitioner_service_assignments_eligibility_unique',
    });

    await database
      .updateTable('appointment_services')
      .set({ status: 'active' })
      .where('id', 'in', [firstService.id, secondService.id])
      .execute();

    await expect(
      database
        .updateTable('specialties')
        .set({ organization_id: secondPractice.id })
        .where('id', '=', firstSpecialty.id)
        .execute(),
    ).rejects.toThrow('Specialty identity is immutable.');
    await expect(
      database
        .updateTable('appointment_services')
        .set({ facility_id: secondFacility.id })
        .where('id', '=', firstService.id)
        .execute(),
    ).rejects.toThrow('Appointment service identity and scope are immutable.');
    await expect(
      database
        .updateTable('practitioner_service_assignments')
        .set({ appointment_service_id: secondService.id })
        .where('id', '=', firstAssignment.id)
        .execute(),
    ).rejects.toThrow(
      'Practitioner service assignment identity and scope are immutable.',
    );

    const patientSafeProjection = await database
      .selectFrom('practitioner_service_assignments as assignment')
      .innerJoin(
        'practitioner_facility_assignments as facilityAssignment',
        'facilityAssignment.id',
        'assignment.practitioner_facility_assignment_id',
      )
      .innerJoin(
        'practitioners as practitioner',
        'practitioner.id',
        'assignment.practitioner_id',
      )
      .innerJoin(
        'appointment_services as service',
        'service.id',
        'assignment.appointment_service_id',
      )
      .innerJoin(
        'specialties as specialty',
        'specialty.id',
        'service.specialty_id',
      )
      .innerJoin(
        'facilities as facility',
        'facility.id',
        'assignment.facility_id',
      )
      .select([
        'assignment.id as practitionerAssignmentId',
        'practitioner.id as practitionerId',
        'practitioner.display_name as practitionerName',
        'practitioner.professional_title as professionalTitle',
        'specialty.id as specialtyId',
        'specialty.name as specialtyName',
        'service.id as serviceId',
        'service.patient_facing_name as serviceName',
        'service.duration_minutes as durationMinutes',
        'service.allows_any_practitioner as allowsAnyPractitioner',
        'facility.id as facilityId',
        'facility.name as facilityName',
        'facility.timezone as facilityTimezone',
      ])
      .where('assignment.id', '=', firstAssignment.id)
      .where('assignment.status', '=', 'active')
      .where('assignment.is_synthetic', '=', true)
      .where('facilityAssignment.status', '=', 'active')
      .where('facilityAssignment.is_synthetic', '=', true)
      .where('service.status', '=', 'active')
      .where('service.is_synthetic', '=', true)
      .where('practitioner.status', '=', 'active')
      .where('practitioner.is_synthetic', '=', true)
      .where('specialty.status', '=', 'active')
      .where('specialty.is_synthetic', '=', true)
      .where('facility.is_synthetic', '=', true)
      .executeTakeFirstOrThrow();

    expect(patientSafeProjection).toEqual({
      practitionerAssignmentId: firstAssignment.id,
      practitionerId: practitioner.id,
      practitionerName: 'Dr Synthetic Scheduling',
      professionalTitle: 'Consultant physician',
      specialtyId: firstSpecialty.id,
      specialtyName: 'General medicine',
      serviceId: firstService.id,
      serviceName: 'General consultation',
      durationMinutes: 30,
      allowsAnyPractitioner: true,
      facilityId: firstFacility.id,
      facilityName: 'Synthetic Scheduling Facility A',
      facilityTimezone: 'Asia/Dubai',
    });
    expect(JSON.stringify(patientSafeProjection)).not.toContain(
      'scheduling-physician@example.invalid',
    );
  });

  it('preserves legacy appointment rows with no inferred provider scope', async () => {
    const legacySlot = await database
      .selectFrom('patient_portal_appointment_slots')
      .select([
        'id',
        'facility_id',
        'practitioner_facility_assignment_id',
        'practitioner_service_assignment_id',
        'practitioner_id',
        'appointment_service_id',
        'availability_template_id',
        'generation_key_hash',
        'source_local_date',
        'source_timezone',
      ])
      .where('id', '=', legacyAvailabilityFixture.slotId)
      .executeTakeFirstOrThrow();
    const legacyAppointment = await database
      .selectFrom('patient_portal_appointments')
      .select([
        'id',
        'facility_id',
        'practitioner_facility_assignment_id',
        'practitioner_service_assignment_id',
        'practitioner_id',
        'appointment_service_id',
      ])
      .where('id', '=', legacyAvailabilityFixture.appointmentId)
      .executeTakeFirstOrThrow();

    expect(legacySlot).toEqual({
      id: legacyAvailabilityFixture.slotId,
      facility_id: null,
      practitioner_facility_assignment_id: null,
      practitioner_service_assignment_id: null,
      practitioner_id: null,
      appointment_service_id: null,
      availability_template_id: null,
      generation_key_hash: null,
      source_local_date: null,
      source_timezone: null,
    });
    expect(legacyAppointment).toEqual({
      id: legacyAvailabilityFixture.appointmentId,
      facility_id: null,
      practitioner_facility_assignment_id: null,
      practitioner_service_assignment_id: null,
      practitioner_id: null,
      appointment_service_id: null,
    });
  });

  it('enforces provider availability scope, overlap, lifecycle, and booking invariants', async () => {
    const fixture = {
      tenant: 'a1000000-0000-4000-8000-000000000001',
      practiceA: 'a2000000-0000-4000-8000-000000000001',
      practiceB: 'a2000000-0000-4000-8000-000000000002',
      facilityA: 'a3000000-0000-4000-8000-000000000001',
      facilityB: 'a3000000-0000-4000-8000-000000000002',
      practitionerA: 'a4000000-0000-4000-8000-000000000001',
      practitionerB: 'a4000000-0000-4000-8000-000000000002',
      specialtyA: 'a5000000-0000-4000-8000-000000000001',
      specialtyB: 'a5000000-0000-4000-8000-000000000002',
      serviceA: 'a6000000-0000-4000-8000-000000000001',
      serviceA2: 'a6000000-0000-4000-8000-000000000002',
      serviceB: 'a6000000-0000-4000-8000-000000000003',
      facilityAssignmentA: 'a7000000-0000-4000-8000-000000000001',
      facilityAssignmentB: 'a7000000-0000-4000-8000-000000000002',
      facilityAssignmentA2: 'a7000000-0000-4000-8000-000000000003',
      serviceAssignmentA: 'a8000000-0000-4000-8000-000000000001',
      serviceAssignmentA2: 'a8000000-0000-4000-8000-000000000002',
      serviceAssignmentB: 'a8000000-0000-4000-8000-000000000003',
      serviceAssignmentAOtherPractitioner:
        'a8000000-0000-4000-8000-000000000004',
      bookableA: 'a9000000-0000-4000-8000-000000000001',
      bookableB: 'a9000000-0000-4000-8000-000000000002',
      patientUser: 'aa000000-0000-4000-8000-000000000001',
      patientIdentity: 'ab000000-0000-4000-8000-000000000001',
      relationship: 'ac000000-0000-4000-8000-000000000001',
      templateA: 'ad000000-0000-4000-8000-000000000001',
      templateA2: 'ad000000-0000-4000-8000-000000000002',
      templateB: 'ad000000-0000-4000-8000-000000000003',
      templateAOtherPractitioner: 'ad000000-0000-4000-8000-000000000004',
      slotBooked: 'ae000000-0000-4000-8000-000000000001',
      slotAdjacent: 'ae000000-0000-4000-8000-000000000002',
      slotOtherPractitioner: 'ae000000-0000-4000-8000-000000000003',
      appointment: 'af000000-0000-4000-8000-000000000001',
    } as const;

    await database
      .insertInto('tenants')
      .values({
        id: fixture.tenant,
        code: 'AVAILABILITY-A',
        name: 'Synthetic Provider Availability Tenant',
        is_synthetic: true,
      })
      .execute();
    await database
      .insertInto('organizations')
      .values([
        {
          id: fixture.practiceA,
          tenant_id: fixture.tenant,
          parent_organization_id: null,
          kind: 'practice',
          code: 'AVAIL-PRACTICE-A',
          name: 'Synthetic Availability Practice A',
          is_synthetic: true,
        },
        {
          id: fixture.practiceB,
          tenant_id: fixture.tenant,
          parent_organization_id: null,
          kind: 'practice',
          code: 'AVAIL-PRACTICE-B',
          name: 'Synthetic Availability Practice B',
          is_synthetic: true,
        },
      ])
      .execute();
    await database
      .insertInto('facilities')
      .values([
        {
          id: fixture.facilityA,
          tenant_id: fixture.tenant,
          organization_id: fixture.practiceA,
          code: 'AVAIL-FACILITY-A',
          name: 'Synthetic Availability Facility A',
          timezone: 'Asia/Dubai',
          is_synthetic: true,
        },
        {
          id: fixture.facilityB,
          tenant_id: fixture.tenant,
          organization_id: fixture.practiceB,
          code: 'AVAIL-FACILITY-B',
          name: 'Synthetic Availability Facility B',
          timezone: 'Asia/Dubai',
          is_synthetic: true,
        },
      ])
      .execute();
    await database
      .insertInto('practitioners')
      .values([
        {
          id: fixture.practitionerA,
          tenant_id: fixture.tenant,
          application_user_id: null,
          display_name: 'Dr Synthetic Availability A',
          professional_title: 'Consultant physician',
          status: 'active',
          is_synthetic: true,
        },
        {
          id: fixture.practitionerB,
          tenant_id: fixture.tenant,
          application_user_id: null,
          display_name: 'Dr Synthetic Availability B',
          professional_title: 'Consultant physician',
          status: 'active',
          is_synthetic: true,
        },
      ])
      .execute();
    await database
      .insertInto('specialties')
      .values([
        {
          id: fixture.specialtyA,
          tenant_id: fixture.tenant,
          organization_id: fixture.practiceA,
          code: 'AVAIL-GENERAL-A',
          name: 'Synthetic General Medicine A',
          status: 'active',
          is_synthetic: true,
        },
        {
          id: fixture.specialtyB,
          tenant_id: fixture.tenant,
          organization_id: fixture.practiceB,
          code: 'AVAIL-GENERAL-B',
          name: 'Synthetic General Medicine B',
          status: 'active',
          is_synthetic: true,
        },
      ])
      .execute();
    await database
      .insertInto('appointment_services')
      .values([
        {
          id: fixture.serviceA,
          tenant_id: fixture.tenant,
          organization_id: fixture.practiceA,
          facility_id: fixture.facilityA,
          specialty_id: fixture.specialtyA,
          code: 'AVAIL-CONSULT-A',
          patient_facing_name: 'Synthetic Consultation A',
          duration_minutes: 30,
          status: 'active',
          is_synthetic: true,
        },
        {
          id: fixture.serviceA2,
          tenant_id: fixture.tenant,
          organization_id: fixture.practiceA,
          facility_id: fixture.facilityA,
          specialty_id: fixture.specialtyA,
          code: 'AVAIL-FOLLOWUP-A',
          patient_facing_name: 'Synthetic Follow-up A',
          duration_minutes: 30,
          status: 'active',
          is_synthetic: true,
        },
        {
          id: fixture.serviceB,
          tenant_id: fixture.tenant,
          organization_id: fixture.practiceB,
          facility_id: fixture.facilityB,
          specialty_id: fixture.specialtyB,
          code: 'AVAIL-CONSULT-B',
          patient_facing_name: 'Synthetic Consultation B',
          duration_minutes: 30,
          status: 'active',
          is_synthetic: true,
        },
      ])
      .execute();
    await database
      .insertInto('practitioner_facility_assignments')
      .values([
        {
          id: fixture.facilityAssignmentA,
          tenant_id: fixture.tenant,
          organization_id: fixture.practiceA,
          facility_id: fixture.facilityA,
          practitioner_id: fixture.practitionerA,
          status: 'active',
          is_synthetic: true,
        },
        {
          id: fixture.facilityAssignmentB,
          tenant_id: fixture.tenant,
          organization_id: fixture.practiceB,
          facility_id: fixture.facilityB,
          practitioner_id: fixture.practitionerA,
          status: 'active',
          is_synthetic: true,
        },
        {
          id: fixture.facilityAssignmentA2,
          tenant_id: fixture.tenant,
          organization_id: fixture.practiceA,
          facility_id: fixture.facilityA,
          practitioner_id: fixture.practitionerB,
          status: 'active',
          is_synthetic: true,
        },
      ])
      .execute();
    await database
      .insertInto('practitioner_service_assignments')
      .values([
        {
          id: fixture.serviceAssignmentA,
          tenant_id: fixture.tenant,
          organization_id: fixture.practiceA,
          facility_id: fixture.facilityA,
          practitioner_facility_assignment_id: fixture.facilityAssignmentA,
          practitioner_id: fixture.practitionerA,
          appointment_service_id: fixture.serviceA,
          status: 'active',
          is_synthetic: true,
        },
        {
          id: fixture.serviceAssignmentA2,
          tenant_id: fixture.tenant,
          organization_id: fixture.practiceA,
          facility_id: fixture.facilityA,
          practitioner_facility_assignment_id: fixture.facilityAssignmentA,
          practitioner_id: fixture.practitionerA,
          appointment_service_id: fixture.serviceA2,
          status: 'active',
          is_synthetic: true,
        },
        {
          id: fixture.serviceAssignmentB,
          tenant_id: fixture.tenant,
          organization_id: fixture.practiceB,
          facility_id: fixture.facilityB,
          practitioner_facility_assignment_id: fixture.facilityAssignmentB,
          practitioner_id: fixture.practitionerA,
          appointment_service_id: fixture.serviceB,
          status: 'active',
          is_synthetic: true,
        },
        {
          id: fixture.serviceAssignmentAOtherPractitioner,
          tenant_id: fixture.tenant,
          organization_id: fixture.practiceA,
          facility_id: fixture.facilityA,
          practitioner_facility_assignment_id: fixture.facilityAssignmentA2,
          practitioner_id: fixture.practitionerB,
          appointment_service_id: fixture.serviceA,
          status: 'active',
          is_synthetic: true,
        },
      ])
      .execute();
    await database
      .insertInto('patient_portal_bookable_practices')
      .values([
        {
          id: fixture.bookableA,
          tenant_id: fixture.tenant,
          organization_id: fixture.practiceA,
          timezone: 'Asia/Dubai',
          status: 'active',
          is_synthetic: true,
        },
        {
          id: fixture.bookableB,
          tenant_id: fixture.tenant,
          organization_id: fixture.practiceB,
          timezone: 'Asia/Dubai',
          status: 'active',
          is_synthetic: true,
        },
      ])
      .execute();
    await database
      .insertInto('application_users')
      .values({
        id: fixture.patientUser,
        display_name: 'Synthetic Availability Patient',
        primary_email: 'availability-patient@example.invalid',
        is_synthetic: true,
      })
      .execute();
    await database
      .insertInto('patient_portal_identities')
      .values({
        id: fixture.patientIdentity,
        application_user_id: fixture.patientUser,
        issuer: 'https://patient-idp.example.invalid/provider-availability',
        subject: 'synthetic-provider-availability-patient',
        client_id: 'synthetic-provider-availability-client',
        username: 'availability-patient@example.invalid',
        status: 'active',
        last_authenticated_at: null,
      })
      .execute();
    await database
      .insertInto('patient_portal_appointment_relationships')
      .values({
        id: fixture.relationship,
        tenant_id: fixture.tenant,
        organization_id: fixture.practiceA,
        patient_portal_identity_id: fixture.patientIdentity,
        status: 'pending',
      })
      .execute();

    const templateScopeA = {
      tenant_id: fixture.tenant,
      organization_id: fixture.practiceA,
      facility_id: fixture.facilityA,
      practitioner_facility_assignment_id: fixture.facilityAssignmentA,
      practitioner_service_assignment_id: fixture.serviceAssignmentA,
      practitioner_id: fixture.practitionerA,
      appointment_service_id: fixture.serviceA,
      source_timezone: 'Asia/Dubai',
    } as const;
    await database
      .insertInto('practitioner_availability_templates')
      .values([
        {
          id: fixture.templateA,
          ...templateScopeA,
          iso_weekday: 1,
          local_start_minute: 540,
          local_end_minute: 600,
          effective_from: '2035-01-01',
          effective_until: null,
          status: 'active',
          is_synthetic: true,
        },
        {
          id: fixture.templateA2,
          tenant_id: fixture.tenant,
          organization_id: fixture.practiceA,
          facility_id: fixture.facilityA,
          practitioner_facility_assignment_id: fixture.facilityAssignmentA,
          practitioner_service_assignment_id: fixture.serviceAssignmentA2,
          practitioner_id: fixture.practitionerA,
          appointment_service_id: fixture.serviceA2,
          iso_weekday: 1,
          local_start_minute: 600,
          local_end_minute: 660,
          effective_from: '2035-01-01',
          effective_until: null,
          source_timezone: 'Asia/Dubai',
          status: 'active',
          is_synthetic: true,
        },
        {
          id: fixture.templateB,
          tenant_id: fixture.tenant,
          organization_id: fixture.practiceB,
          facility_id: fixture.facilityB,
          practitioner_facility_assignment_id: fixture.facilityAssignmentB,
          practitioner_service_assignment_id: fixture.serviceAssignmentB,
          practitioner_id: fixture.practitionerA,
          appointment_service_id: fixture.serviceB,
          iso_weekday: 1,
          local_start_minute: 660,
          local_end_minute: 720,
          effective_from: '2035-01-01',
          effective_until: null,
          source_timezone: 'Asia/Dubai',
          status: 'inactive',
          is_synthetic: true,
        },
        {
          id: fixture.templateAOtherPractitioner,
          tenant_id: fixture.tenant,
          organization_id: fixture.practiceA,
          facility_id: fixture.facilityA,
          practitioner_facility_assignment_id: fixture.facilityAssignmentA2,
          practitioner_service_assignment_id:
            fixture.serviceAssignmentAOtherPractitioner,
          practitioner_id: fixture.practitionerB,
          appointment_service_id: fixture.serviceA,
          iso_weekday: 1,
          local_start_minute: 540,
          local_end_minute: 600,
          effective_from: '2035-01-01',
          effective_until: null,
          source_timezone: 'Asia/Dubai',
          status: 'active',
          is_synthetic: true,
        },
      ])
      .execute();

    await expect(
      database
        .insertInto('practitioner_availability_templates')
        .values({
          ...templateScopeA,
          practitioner_service_assignment_id: fixture.serviceAssignmentB,
          iso_weekday: 2,
          local_start_minute: 540,
          local_end_minute: 600,
          effective_from: '2035-01-01',
          effective_until: null,
          status: 'inactive',
          is_synthetic: true,
        })
        .execute(),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'practitioner_availability_templates_assignment_scope_fk',
    });
    await expect(
      database
        .insertInto('practitioner_availability_templates')
        .values({
          tenant_id: fixture.tenant,
          organization_id: fixture.practiceA,
          facility_id: fixture.facilityA,
          practitioner_facility_assignment_id: fixture.facilityAssignmentA,
          practitioner_service_assignment_id: fixture.serviceAssignmentA2,
          practitioner_id: fixture.practitionerA,
          appointment_service_id: fixture.serviceA2,
          iso_weekday: 1,
          local_start_minute: 570,
          local_end_minute: 630,
          effective_from: '2035-01-01',
          effective_until: null,
          source_timezone: 'Asia/Dubai',
          status: 'active',
          is_synthetic: true,
        })
        .execute(),
    ).rejects.toMatchObject({
      code: '23P01',
      constraint: 'practitioner_availability_templates_active_overlap',
    });
    const allowedActiveTemplates = await database
      .selectFrom('practitioner_availability_templates')
      .select('id')
      .where('id', 'in', [
        fixture.templateA,
        fixture.templateA2,
        fixture.templateAOtherPractitioner,
      ])
      .where('status', '=', 'active')
      .execute();
    expect(allowedActiveTemplates).toHaveLength(3);
    await expect(
      database
        .updateTable('practitioner_availability_templates')
        .set({ local_end_minute: 630 })
        .where('id', '=', fixture.templateA)
        .execute(),
    ).rejects.toThrow(
      'Practitioner availability template definition and scope are immutable.',
    );

    const facilityClosure = await database
      .insertInto('provider_availability_exceptions')
      .values({
        tenant_id: fixture.tenant,
        organization_id: fixture.practiceA,
        facility_id: fixture.facilityA,
        practitioner_facility_assignment_id: null,
        practitioner_id: null,
        kind: 'facility_closed',
        is_all_day: true,
        local_starts_at: sql<Date>`timestamp '2035-01-08 00:00:00'`,
        local_ends_at: sql<Date>`timestamp '2035-01-09 00:00:00'`,
        starts_at: new Date('2035-01-07T20:00:00.000Z'),
        ends_at: new Date('2035-01-08T20:00:00.000Z'),
        source_timezone: 'Asia/Dubai',
        status: 'active',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const practitionerException = await database
      .insertInto('provider_availability_exceptions')
      .values({
        tenant_id: fixture.tenant,
        organization_id: fixture.practiceA,
        facility_id: fixture.facilityA,
        practitioner_facility_assignment_id: fixture.facilityAssignmentA,
        practitioner_id: fixture.practitionerA,
        kind: 'practitioner_unavailable',
        is_all_day: false,
        local_starts_at: sql<Date>`timestamp '2035-01-10 13:00:00'`,
        local_ends_at: sql<Date>`timestamp '2035-01-10 14:00:00'`,
        starts_at: new Date('2035-01-10T09:00:00.000Z'),
        ends_at: new Date('2035-01-10T10:00:00.000Z'),
        source_timezone: 'Asia/Dubai',
        status: 'active',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await expect(
      database
        .insertInto('provider_availability_exceptions')
        .values({
          tenant_id: fixture.tenant,
          organization_id: fixture.practiceA,
          facility_id: fixture.facilityA,
          practitioner_facility_assignment_id: null,
          practitioner_id: null,
          kind: 'facility_closed',
          is_all_day: true,
          local_starts_at: sql<Date>`timestamp '2035-01-11 01:00:00'`,
          local_ends_at: sql<Date>`timestamp '2035-01-12 00:00:00'`,
          starts_at: new Date('2035-01-10T21:00:00.000Z'),
          ends_at: new Date('2035-01-11T20:00:00.000Z'),
          source_timezone: 'Asia/Dubai',
          status: 'active',
          is_synthetic: true,
        })
        .execute(),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'provider_availability_exceptions_all_day_check',
    });
    await expect(
      database
        .insertInto('provider_availability_exceptions')
        .values({
          tenant_id: fixture.tenant,
          organization_id: fixture.practiceA,
          facility_id: fixture.facilityA,
          practitioner_facility_assignment_id: null,
          practitioner_id: null,
          kind: 'facility_closed',
          is_all_day: true,
          local_starts_at: sql<Date>`timestamp '2035-01-14 00:00:00'`,
          local_ends_at: sql<Date>`timestamp '2035-01-16 00:00:00'`,
          starts_at: new Date('2035-01-13T20:00:00.000Z'),
          ends_at: new Date('2035-01-15T20:00:00.000Z'),
          source_timezone: 'Asia/Dubai',
          status: 'active',
          is_synthetic: true,
        })
        .execute(),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'provider_availability_exceptions_all_day_check',
    });
    await expect(
      database
        .insertInto('provider_availability_exceptions')
        .values({
          tenant_id: fixture.tenant,
          organization_id: fixture.practiceA,
          facility_id: fixture.facilityA,
          practitioner_facility_assignment_id: null,
          practitioner_id: fixture.practitionerA,
          kind: 'practitioner_unavailable',
          is_all_day: false,
          local_starts_at: sql<Date>`timestamp '2035-01-12 13:00:00'`,
          local_ends_at: sql<Date>`timestamp '2035-01-12 14:00:00'`,
          starts_at: new Date('2035-01-12T09:00:00.000Z'),
          ends_at: new Date('2035-01-12T10:00:00.000Z'),
          source_timezone: 'Asia/Dubai',
          status: 'active',
          is_synthetic: true,
        })
        .execute(),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'provider_availability_exceptions_scope_shape_check',
    });
    await expect(
      database
        .insertInto('provider_availability_exceptions')
        .values({
          tenant_id: fixture.tenant,
          organization_id: fixture.practiceA,
          facility_id: fixture.facilityA,
          practitioner_facility_assignment_id: fixture.facilityAssignmentB,
          practitioner_id: fixture.practitionerA,
          kind: 'practitioner_unavailable',
          is_all_day: false,
          local_starts_at: sql<Date>`timestamp '2035-01-13 13:00:00'`,
          local_ends_at: sql<Date>`timestamp '2035-01-13 14:00:00'`,
          starts_at: new Date('2035-01-13T09:00:00.000Z'),
          ends_at: new Date('2035-01-13T10:00:00.000Z'),
          source_timezone: 'Asia/Dubai',
          status: 'active',
          is_synthetic: true,
        })
        .execute(),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'provider_availability_exceptions_assignment_scope_fk',
    });
    await expect(
      database
        .updateTable('provider_availability_exceptions')
        .set({ starts_at: new Date('2035-01-07T21:00:00.000Z') })
        .where('id', '=', facilityClosure.id)
        .execute(),
    ).rejects.toThrow(
      'Provider availability exception definition and scope are immutable.',
    );
    await database
      .updateTable('provider_availability_exceptions')
      .set({ status: 'cancelled' })
      .where('id', '=', practitionerException.id)
      .execute();

    const providerScopeA = {
      bookable_practice_id: fixture.bookableA,
      tenant_id: fixture.tenant,
      organization_id: fixture.practiceA,
      facility_id: fixture.facilityA,
      practitioner_facility_assignment_id: fixture.facilityAssignmentA,
      practitioner_service_assignment_id: fixture.serviceAssignmentA,
      practitioner_id: fixture.practitionerA,
      appointment_service_id: fixture.serviceA,
      availability_template_id: fixture.templateA,
      source_local_date: '2035-01-08',
      source_timezone: 'Asia/Dubai',
      status: 'available',
      is_synthetic: true,
    } as const;
    const providerScopeA2 = {
      ...providerScopeA,
      practitioner_service_assignment_id: fixture.serviceAssignmentA2,
      appointment_service_id: fixture.serviceA2,
      availability_template_id: fixture.templateA2,
    } as const;
    const providerScopeB = {
      ...providerScopeA,
      bookable_practice_id: fixture.bookableB,
      organization_id: fixture.practiceB,
      facility_id: fixture.facilityB,
      practitioner_facility_assignment_id: fixture.facilityAssignmentB,
      practitioner_service_assignment_id: fixture.serviceAssignmentB,
      appointment_service_id: fixture.serviceB,
      availability_template_id: fixture.templateB,
    } as const;
    const otherPractitionerScope = {
      ...providerScopeA,
      practitioner_facility_assignment_id: fixture.facilityAssignmentA2,
      practitioner_service_assignment_id:
        fixture.serviceAssignmentAOtherPractitioner,
      practitioner_id: fixture.practitionerB,
      availability_template_id: fixture.templateAOtherPractitioner,
    } as const;

    await database
      .insertInto('patient_portal_appointment_slots')
      .values({
        id: fixture.slotBooked,
        ...providerScopeA,
        generation_key_hash: createHash('sha256')
          .update('provider-slot-booked')
          .digest('hex'),
        starts_at: new Date('2035-01-08T09:00:00.000Z'),
        ends_at: new Date('2035-01-08T09:30:00.000Z'),
      })
      .execute();

    for (const overlappingSlot of [
      {
        ...providerScopeA2,
        generation_key_hash: createHash('sha256')
          .update('provider-slot-overlap-service')
          .digest('hex'),
      },
      {
        ...providerScopeB,
        generation_key_hash: createHash('sha256')
          .update('provider-slot-overlap-facility')
          .digest('hex'),
      },
    ]) {
      await expect(
        database
          .insertInto('patient_portal_appointment_slots')
          .values({
            ...overlappingSlot,
            starts_at: new Date('2035-01-08T09:15:00.000Z'),
            ends_at: new Date('2035-01-08T09:45:00.000Z'),
          })
          .execute(),
      ).rejects.toMatchObject({
        code: '23P01',
        constraint: 'pp_appointment_slots_practitioner_time_no_overlap',
      });
    }

    await database
      .insertInto('patient_portal_appointment_slots')
      .values([
        {
          id: fixture.slotAdjacent,
          ...providerScopeA,
          generation_key_hash: createHash('sha256')
            .update('provider-slot-adjacent')
            .digest('hex'),
          starts_at: new Date('2035-01-08T09:30:00.000Z'),
          ends_at: new Date('2035-01-08T10:00:00.000Z'),
        },
        {
          id: fixture.slotOtherPractitioner,
          ...otherPractitionerScope,
          generation_key_hash: createHash('sha256')
            .update('provider-slot-other-practitioner')
            .digest('hex'),
          starts_at: new Date('2035-01-08T09:15:00.000Z'),
          ends_at: new Date('2035-01-08T09:45:00.000Z'),
        },
      ])
      .execute();

    await expect(
      database
        .insertInto('patient_portal_appointment_slots')
        .values({
          ...providerScopeA,
          generation_key_hash: createHash('sha256')
            .update('provider-slot-booked')
            .digest('hex'),
          starts_at: new Date('2035-01-08T11:00:00.000Z'),
          ends_at: new Date('2035-01-08T11:30:00.000Z'),
        })
        .execute(),
    ).rejects.toMatchObject({
      code: '23505',
      constraint: 'pp_appointment_slots_provider_generation_unique',
    });
    await expect(
      database
        .insertInto('patient_portal_appointment_slots')
        .values({
          bookable_practice_id: fixture.bookableA,
          tenant_id: fixture.tenant,
          organization_id: fixture.practiceA,
          facility_id: fixture.facilityA,
          starts_at: new Date('2035-01-08T12:00:00.000Z'),
          ends_at: new Date('2035-01-08T12:30:00.000Z'),
          status: 'available',
          is_synthetic: true,
        })
        .execute(),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'pp_appointment_slots_provider_bundle_check',
    });
    await expect(
      database
        .insertInto('patient_portal_appointment_slots')
        .values({
          ...providerScopeA,
          practitioner_service_assignment_id: fixture.serviceAssignmentB,
          generation_key_hash: createHash('sha256')
            .update('provider-slot-wrong-scope')
            .digest('hex'),
          starts_at: new Date('2035-01-08T12:30:00.000Z'),
          ends_at: new Date('2035-01-08T13:00:00.000Z'),
        })
        .execute(),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'pp_appointment_slots_assignment_scope_fk',
    });
    await expect(
      database
        .updateTable('patient_portal_appointment_slots')
        .set({ appointment_service_id: fixture.serviceA2 })
        .where('id', '=', fixture.slotBooked)
        .execute(),
    ).rejects.toThrow('Appointment slot provider binding is immutable.');

    await expect(
      database
        .insertInto('patient_portal_appointments')
        .values({
          tenant_id: fixture.tenant,
          organization_id: fixture.practiceA,
          patient_portal_identity_id: fixture.patientIdentity,
          patient_portal_profile_id: null,
          patient_portal_appointment_relationship_id: fixture.relationship,
          appointment_slot_id: fixture.slotAdjacent,
          status: 'requested',
          version: 1,
          cancelled_at: null,
        })
        .execute(),
    ).rejects.toMatchObject({
      code: '23514',
    });
    await expect(
      database
        .insertInto('patient_portal_appointments')
        .values({
          tenant_id: fixture.tenant,
          organization_id: fixture.practiceA,
          patient_portal_identity_id: fixture.patientIdentity,
          patient_portal_profile_id: null,
          patient_portal_appointment_relationship_id: fixture.relationship,
          appointment_slot_id: fixture.slotAdjacent,
          facility_id: fixture.facilityA,
          practitioner_service_assignment_id: fixture.serviceAssignmentA,
          status: 'requested',
          version: 1,
          cancelled_at: null,
        })
        .execute(),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'pp_appointments_provider_bundle_check',
    });
    await expect(
      database
        .insertInto('patient_portal_appointments')
        .values({
          tenant_id: fixture.tenant,
          organization_id: fixture.practiceA,
          patient_portal_identity_id: fixture.patientIdentity,
          patient_portal_profile_id: null,
          patient_portal_appointment_relationship_id: fixture.relationship,
          appointment_slot_id: fixture.slotAdjacent,
          facility_id: fixture.facilityA,
          practitioner_facility_assignment_id: fixture.facilityAssignmentA2,
          practitioner_service_assignment_id:
            fixture.serviceAssignmentAOtherPractitioner,
          practitioner_id: fixture.practitionerB,
          appointment_service_id: fixture.serviceA,
          status: 'requested',
          version: 1,
          cancelled_at: null,
        })
        .execute(),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'pp_appointments_provider_slot_scope_fk',
    });

    await database
      .insertInto('patient_portal_appointments')
      .values({
        id: fixture.appointment,
        tenant_id: fixture.tenant,
        organization_id: fixture.practiceA,
        patient_portal_identity_id: fixture.patientIdentity,
        patient_portal_profile_id: null,
        patient_portal_appointment_relationship_id: fixture.relationship,
        appointment_slot_id: fixture.slotBooked,
        facility_id: fixture.facilityA,
        practitioner_facility_assignment_id: fixture.facilityAssignmentA,
        practitioner_service_assignment_id: fixture.serviceAssignmentA,
        practitioner_id: fixture.practitionerA,
        appointment_service_id: fixture.serviceA,
        status: 'requested',
        version: 1,
        cancelled_at: null,
      })
      .execute();
    await expect(
      database
        .updateTable('patient_portal_appointment_slots')
        .set({ status: 'withdrawn' })
        .where('id', '=', fixture.slotBooked)
        .execute(),
    ).rejects.toThrow('A slot with a live appointment cannot be withdrawn.');
    await database
      .updateTable('patient_portal_appointment_slots')
      .set({ status: 'withdrawn' })
      .where('id', '=', fixture.slotAdjacent)
      .execute();
    const adjacentSlot = await database
      .selectFrom('patient_portal_appointment_slots')
      .select('status')
      .where('id', '=', fixture.slotAdjacent)
      .executeTakeFirstOrThrow();
    expect(adjacentSlot.status).toBe('withdrawn');

    const firstConcurrentDatabase = createDatabaseClient<DatabaseSchema>({
      connectionString: databaseUrl!,
      maxConnections: 1,
      ssl: false,
    });
    const secondConcurrentDatabase = createDatabaseClient<DatabaseSchema>({
      connectionString: databaseUrl!,
      maxConnections: 1,
      ssl: false,
    });
    try {
      await Promise.all([
        sql`set search_path to ${sql.id(schemaName)}, public`.execute(
          firstConcurrentDatabase,
        ),
        sql`set search_path to ${sql.id(schemaName)}, public`.execute(
          secondConcurrentDatabase,
        ),
      ]);
      const concurrentResults = await Promise.allSettled([
        firstConcurrentDatabase
          .insertInto('patient_portal_appointment_slots')
          .values({
            ...providerScopeA,
            generation_key_hash: createHash('sha256')
              .update('provider-slot-concurrent-a')
              .digest('hex'),
            starts_at: new Date('2035-01-08T13:00:00.000Z'),
            ends_at: new Date('2035-01-08T13:30:00.000Z'),
          })
          .execute(),
        secondConcurrentDatabase
          .insertInto('patient_portal_appointment_slots')
          .values({
            ...providerScopeA2,
            generation_key_hash: createHash('sha256')
              .update('provider-slot-concurrent-b')
              .digest('hex'),
            starts_at: new Date('2035-01-08T13:15:00.000Z'),
            ends_at: new Date('2035-01-08T13:45:00.000Z'),
          })
          .execute(),
      ]);
      expect(
        concurrentResults.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      const rejectedConcurrentResult = concurrentResults.find(
        (result) => result.status === 'rejected',
      );
      expect(rejectedConcurrentResult?.status).toBe('rejected');
      if (rejectedConcurrentResult?.status === 'rejected') {
        const rejection = rejectedConcurrentResult.reason as {
          code?: unknown;
          constraint?: unknown;
        };
        expect(['23P01', '40P01']).toContain(rejection.code);
        if (rejection.code === '23P01') {
          expect(rejection.constraint).toBe(
            'pp_appointment_slots_practitioner_time_no_overlap',
          );
        }
      }
      const storedConcurrentSlots = await database
        .selectFrom('patient_portal_appointment_slots')
        .select('id')
        .where('tenant_id', '=', fixture.tenant)
        .where('practitioner_id', '=', fixture.practitionerA)
        .where('starts_at', '>=', new Date('2035-01-08T13:00:00.000Z'))
        .where('starts_at', '<', new Date('2035-01-08T14:00:00.000Z'))
        .execute();
      expect(storedConcurrentSlots).toHaveLength(1);
    } finally {
      await Promise.all([
        firstConcurrentDatabase.destroy(),
        secondConcurrentDatabase.destroy(),
      ]);
    }
  });

  it('stores only hashed browser session values with bounded expiry', async () => {
    const now = new Date();
    const idleExpiry = new Date(now.getTime() + 30 * 60_000);
    const absoluteExpiry = new Date(now.getTime() + 8 * 60 * 60_000);
    const session = await database
      .insertInto('workforce_sessions')
      .values({
        session_token_hash: 'a'.repeat(64),
        csrf_token_hash: 'b'.repeat(64),
        cognito_subject: 'synthetic-session-subject',
        cognito_client_id: 'synthetic-client',
        cognito_username: 'synthetic-user',
        idle_expires_at: idleExpiry,
        absolute_expires_at: absoluteExpiry,
        revoked_at: null,
      })
      .returning([
        'session_token_hash',
        'csrf_token_hash',
        'idle_expires_at',
        'absolute_expires_at',
      ])
      .executeTakeFirstOrThrow();

    expect(session).toMatchObject({
      session_token_hash: 'a'.repeat(64),
      csrf_token_hash: 'b'.repeat(64),
      idle_expires_at: idleExpiry,
      absolute_expires_at: absoluteExpiry,
    });
  });

  it('creates, restores, slides, and revokes an opaque workforce session', async () => {
    const configValues: Record<string, string | number> = {
      SESSION_IDLE_MINUTES: 30,
      SESSION_ABSOLUTE_MINUTES: 480,
      SESSION_RENEWAL_MINUTES: 5,
      COGNITO_REGION: 'ap-south-1',
      COGNITO_USER_POOL_ID: 'ap-south-1_synthetic',
    };
    const config = {
      getOrThrow: (name: string) => configValues[name],
    } as ConfigService;
    const sessions = new WorkforceSessionService(
      { client: database } as DatabaseService,
      config,
    );
    const created = await sessions.create({
      subject: 'synthetic-opaque-session-subject',
      clientId: 'synthetic-client',
      username: 'synthetic-user',
      providerExpiresAt: new Date(Date.now() + 10 * 60_000),
    });
    const stored = await database
      .selectFrom('workforce_sessions')
      .select([
        'session_token_hash',
        'csrf_token_hash',
        'last_seen_at',
        'idle_expires_at',
      ])
      .where('id', '=', created.sessionId)
      .executeTakeFirstOrThrow();

    expect(stored.session_token_hash).not.toContain(created.sessionToken);
    expect(stored.csrf_token_hash).not.toContain(created.csrfToken);

    await database
      .updateTable('workforce_sessions')
      .set({ last_seen_at: new Date(Date.now() - 6 * 60_000) })
      .where('id', '=', created.sessionId)
      .execute();

    const restored = await sessions.authenticate(created.sessionToken);
    expect(restored).toMatchObject({
      sessionId: created.sessionId,
      csrfToken: created.csrfToken,
      renewed: true,
    });
    expect(restored!.idleExpiresAt.getTime()).toBeGreaterThan(
      stored.idle_expires_at.getTime(),
    );

    await sessions.revoke(restored!);
    await expect(
      sessions.authenticate(created.sessionToken),
    ).resolves.toBeNull();
    await expect(
      database
        .selectFrom('audit_events')
        .select('action')
        .where('target_entity_id', '=', created.sessionId)
        .orderBy('occurred_at')
        .execute(),
    ).resolves.toEqual([
      { action: 'identity.session_created' },
      { action: 'identity.session_revoked' },
    ]);
  });

  it('creates restricted patient onboarding and rotates one explicit cross-tenant practice context at a time', async () => {
    const issuer =
      'https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_patient';
    const user = await database
      .insertInto('application_users')
      .values({
        display_name: 'Synthetic Portal Patient',
        primary_email: 'patient@example.invalid',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const identity = await database
      .insertInto('patient_portal_identities')
      .values({
        application_user_id: user.id,
        issuer,
        subject: 'synthetic-patient-subject',
        client_id: 'synthetic-patient-client',
        username: 'patient@example.invalid',
        status: 'active',
        last_authenticated_at: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const practices: Array<{
      tenantId: string;
      organizationId: string;
      profileId: string;
      practiceName: string;
    }> = [];

    for (const suffix of ['A', 'B'] as const) {
      const tenant = await database
        .insertInto('tenants')
        .values({
          code: `PATIENT-PORTAL-${suffix}`,
          name: `Synthetic Patient Portal Tenant ${suffix}`,
          is_synthetic: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const practiceName = `Synthetic Patient Portal Practice ${suffix}`;
      const organization = await database
        .insertInto('organizations')
        .values({
          tenant_id: tenant.id,
          parent_organization_id: null,
          kind: 'practice',
          code: `PATIENT-PORTAL-PRACTICE-${suffix}`,
          name: practiceName,
          is_synthetic: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const profile = await database
        .insertInto('patient_portal_profiles')
        .values({
          tenant_id: tenant.id,
          organization_id: organization.id,
          application_user_id: user.id,
          status: 'active',
          is_synthetic: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      practices.push({
        tenantId: tenant.id,
        organizationId: organization.id,
        profileId: profile.id,
        practiceName,
      });
    }

    const config = {
      getOrThrow: (name: string) =>
        ({
          SESSION_IDLE_MINUTES: 30,
          SESSION_ABSOLUTE_MINUTES: 480,
          SESSION_RENEWAL_MINUTES: 5,
        })[name],
    } as ConfigService;
    const sessions = new PatientPortalSessionService(
      { client: database } as DatabaseService,
      config,
    );
    const principal = {
      issuer,
      subject: 'synthetic-patient-subject',
      clientId: 'synthetic-patient-client',
      username: 'patient@example.invalid',
      providerExpiresAt: new Date(Date.now() + 10 * 60_000),
    };

    await expect(
      sessions.create({
        ...principal,
        subject: 'unregistered-patient-subject',
      }),
    ).rejects.toMatchObject({
      message: 'An active patient portal account is required.',
    });

    const onboarding = await sessions.create(principal);
    const stored = await database
      .selectFrom('patient_portal_sessions')
      .select([
        'session_token_hash',
        'csrf_token_hash',
        'patient_portal_profile_id',
      ])
      .where('id', '=', onboarding.sessionId)
      .executeTakeFirstOrThrow();

    expect(stored.session_token_hash).not.toContain(onboarding.sessionToken);
    expect(stored.csrf_token_hash).not.toContain(onboarding.csrfToken);
    expect(stored.patient_portal_profile_id).toBeNull();
    expect(onboarding).toMatchObject({
      applicationUserId: user.id,
      context: { kind: 'onboarding' },
      availablePractices: [],
    });

    const links = new PatientPortalProfileLinkService({
      client: database,
    } as DatabaseService);

    for (const [index, practice] of practices.entries()) {
      await links.createApprovedLink({
        patientPortalProfileId: practice.profileId,
        patientPortalIdentityId: identity.id,
        actorUserId: null,
        reason: `Link deterministic synthetic patient portal practice ${index + 1}.`,
        correlationId: `10000000-0000-4000-8000-00000000010${index}`,
      });
    }

    const restoredOnboarding = await sessions.authenticate(
      onboarding.sessionToken,
    );
    expect(restoredOnboarding).toMatchObject({
      context: { kind: 'onboarding' },
      availablePractices: practices.map((practice) => ({
        portalProfileId: practice.profileId,
        practiceName: practice.practiceName,
      })),
    });

    const firstPracticeSession = await sessions.rotateContext(
      restoredOnboarding!,
      practices[0].profileId,
    );
    expect(firstPracticeSession.sessionToken).not.toBe(onboarding.sessionToken);
    expect(firstPracticeSession.csrfToken).not.toBe(onboarding.csrfToken);
    expect(firstPracticeSession.absoluteExpiresAt).toEqual(
      onboarding.absoluteExpiresAt,
    );
    expect(firstPracticeSession.context).toEqual({
      kind: 'practice',
      portalProfileId: practices[0].profileId,
      practiceName: practices[0].practiceName,
      tenantId: practices[0].tenantId,
      organizationId: practices[0].organizationId,
    });
    await expect(
      sessions.authenticate(onboarding.sessionToken),
    ).resolves.toBeNull();

    const secondPracticeSession = await sessions.rotateContext(
      firstPracticeSession,
      practices[1].profileId,
    );
    expect(secondPracticeSession.context).toMatchObject({
      kind: 'practice',
      portalProfileId: practices[1].profileId,
      practiceName: practices[1].practiceName,
    });
    expect(secondPracticeSession.absoluteExpiresAt).toEqual(
      onboarding.absoluteExpiresAt,
    );
    await expect(
      sessions.authenticate(firstPracticeSession.sessionToken),
    ).resolves.toBeNull();

    const unlinkedOrganization = await database
      .insertInto('organizations')
      .values({
        tenant_id: practices[0].tenantId,
        parent_organization_id: null,
        kind: 'practice',
        code: 'PATIENT-PORTAL-UNLINKED',
        name: 'Synthetic Unlinked Patient Portal Practice',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const unlinkedProfile = await database
      .insertInto('patient_portal_profiles')
      .values({
        tenant_id: practices[0].tenantId,
        organization_id: unlinkedOrganization.id,
        application_user_id: user.id,
        status: 'active',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await expect(
      sessions.rotateContext(secondPracticeSession, unlinkedProfile.id),
    ).rejects.toMatchObject({
      message: 'The selected practice is unavailable.',
    });
    await expect(
      sessions.authenticate(secondPracticeSession.sessionToken),
    ).resolves.toMatchObject({
      context: { kind: 'practice', portalProfileId: practices[1].profileId },
    });

    const returnedToOnboarding = await sessions.rotateContext(
      secondPracticeSession,
      null,
    );
    expect(returnedToOnboarding.context).toEqual({ kind: 'onboarding' });
    await expect(
      sessions.authenticate(secondPracticeSession.sessionToken),
    ).resolves.toBeNull();
    await sessions.revoke(returnedToOnboarding);
    await expect(
      sessions.authenticate(returnedToOnboarding.sessionToken),
    ).resolves.toBeNull();
    const contextAudits = await database
      .selectFrom('audit_events')
      .select(['action', 'outcome'])
      .where('actor_user_id', '=', user.id)
      .where('action', 'in', [
        'identity.patient_portal_session_context_changed',
        'identity.patient_portal_context_change_denied',
      ])
      .execute();

    expect(
      contextAudits.filter(({ outcome }) => outcome === 'success'),
    ).toHaveLength(3);
    expect(
      contextAudits.filter(({ outcome }) => outcome === 'denied'),
    ).toHaveLength(1);
  });

  it('keeps synthetic appointments in one pending relationship context with idempotent commands', async () => {
    const sessionConfig = {
      getOrThrow: (name: string) => {
        const values: Record<string, number> = {
          SESSION_IDLE_MINUTES: 30,
          SESSION_ABSOLUTE_MINUTES: 480,
          SESSION_RENEWAL_MINUTES: 5,
        };
        return values[name];
      },
    } as ConfigService;
    const sessions = new PatientPortalSessionService(
      { client: database } as DatabaseService,
      sessionConfig,
    );
    const appointments = new PatientAppointmentsService({
      client: database,
    } as DatabaseService);
    const tenant = await database
      .insertInto('tenants')
      .values({
        code: 'PATIENT-APPOINTMENTS',
        name: 'Synthetic Patient Appointment Tenant',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const [firstPractice, secondPractice] = await database
      .insertInto('organizations')
      .values([
        {
          tenant_id: tenant.id,
          parent_organization_id: null,
          kind: 'practice',
          code: 'PATIENT-APPOINTMENTS-A',
          name: 'Synthetic Appointment Practice A',
          is_synthetic: true,
        },
        {
          tenant_id: tenant.id,
          parent_organization_id: null,
          kind: 'practice',
          code: 'PATIENT-APPOINTMENTS-B',
          name: 'Synthetic Appointment Practice B',
          is_synthetic: true,
        },
      ])
      .returning(['id', 'name'])
      .execute();
    const [firstBookablePractice, secondBookablePractice] = await database
      .insertInto('patient_portal_bookable_practices')
      .values([
        {
          tenant_id: tenant.id,
          organization_id: firstPractice.id,
          timezone: 'Asia/Dubai',
          status: 'active',
          is_synthetic: true,
        },
        {
          tenant_id: tenant.id,
          organization_id: secondPractice.id,
          timezone: 'Asia/Dubai',
          status: 'active',
          is_synthetic: true,
        },
      ])
      .returning('id')
      .execute();
    const firstProviderScope = await insertSyntheticProviderTestScope(
      database,
      {
        tenantId: tenant.id,
        organizationId: firstPractice.id,
        suffix: 'A',
      },
    );
    const rescheduleProviderScope = await insertSyntheticProviderTestScope(
      database,
      {
        tenantId: tenant.id,
        organizationId: firstPractice.id,
        suffix: 'A2',
      },
    );
    const secondProviderScope = await insertSyntheticProviderTestScope(
      database,
      {
        tenantId: tenant.id,
        organizationId: secondPractice.id,
        suffix: 'B',
      },
    );
    const providerSlotBundle = (
      provider: SyntheticProviderTestScope,
      generationIdentity: string,
    ) => ({
      facility_id: provider.facilityId,
      practitioner_facility_assignment_id:
        provider.practitionerFacilityAssignmentId,
      practitioner_service_assignment_id:
        provider.practitionerServiceAssignmentId,
      practitioner_id: provider.practitionerId,
      appointment_service_id: provider.appointmentServiceId,
      availability_template_id: provider.availabilityTemplateId,
      generation_key_hash: createHash('sha256')
        .update(generationIdentity)
        .digest('hex'),
      source_local_date: '2035-02-01',
      source_timezone: provider.sourceTimezone,
    });
    const slotStart = new Date('2035-02-01T05:00:00.000Z');
    const [firstSlot, rescheduleSlot] = await database
      .insertInto('patient_portal_appointment_slots')
      .values([
        {
          bookable_practice_id: firstBookablePractice.id,
          tenant_id: tenant.id,
          organization_id: firstPractice.id,
          ...providerSlotBundle(
            firstProviderScope,
            'appointment-provider-slot-a',
          ),
          starts_at: slotStart,
          ends_at: new Date(slotStart.getTime() + 30 * 60_000),
          status: 'available',
          is_synthetic: true,
        },
        {
          bookable_practice_id: firstBookablePractice.id,
          tenant_id: tenant.id,
          organization_id: firstPractice.id,
          ...providerSlotBundle(
            rescheduleProviderScope,
            'appointment-provider-slot-a2',
          ),
          starts_at: new Date(slotStart.getTime() + 60 * 60_000),
          ends_at: new Date(slotStart.getTime() + 90 * 60_000),
          status: 'available',
          is_synthetic: true,
        },
      ])
      .returning('id')
      .execute();
    const secondSlot = await database
      .insertInto('patient_portal_appointment_slots')
      .values({
        bookable_practice_id: secondBookablePractice.id,
        tenant_id: tenant.id,
        organization_id: secondPractice.id,
        ...providerSlotBundle(
          secondProviderScope,
          'appointment-provider-slot-b',
        ),
        starts_at: new Date(slotStart.getTime() + 2 * 60 * 60_000),
        ends_at: new Date(slotStart.getTime() + 150 * 60_000),
        status: 'available',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const createPatientSession = async (suffix: string) => {
      const user = await database
        .insertInto('application_users')
        .values({
          display_name: `Synthetic Appointment Patient ${suffix}`,
          primary_email: `appointment.${suffix}@example.invalid`,
          is_synthetic: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const identity = await database
        .insertInto('patient_portal_identities')
        .values({
          application_user_id: user.id,
          issuer: 'https://identity.example.invalid/patient-appointments',
          subject: `synthetic-appointment-patient-${suffix}`,
          client_id: 'synthetic-appointment-patient-client',
          username: `appointment.${suffix}@example.invalid`,
          status: 'active',
          provider_sync_status: 'synchronized',
          provider_sync_attempted_at: null,
          provider_sync_completed_at: null,
          provider_sync_error_code: null,
          last_authenticated_at: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const onboarding = await sessions.create({
        issuer: 'https://identity.example.invalid/patient-appointments',
        subject: `synthetic-appointment-patient-${suffix}`,
        clientId: 'synthetic-appointment-patient-client',
        username: `appointment.${suffix}@example.invalid`,
        providerExpiresAt: new Date(Date.now() + 10 * 60_000),
      });

      return { user, identity, onboarding };
    };

    const firstPatient = await createPatientSession('one');
    const discoveredPractices = await appointments.listBookablePractices(
      firstPatient.onboarding,
    );
    expect(
      discoveredPractices.bookablePractices.some(
        (practice) =>
          practice.bookablePracticeId === firstBookablePractice.id &&
          practice.practiceName === firstPractice.name &&
          practice.timezone === 'Asia/Dubai',
      ),
    ).toBe(true);
    expect(
      discoveredPractices.bookablePractices.some(
        (practice) =>
          practice.bookablePracticeId === secondBookablePractice.id &&
          practice.practiceName === secondPractice.name &&
          practice.timezone === 'Asia/Dubai',
      ),
    ).toBe(true);

    const withConcurrentAppointments = async <T>(
      work: (
        first: PatientAppointmentsService,
        second: PatientAppointmentsService,
      ) => Promise<T>,
    ): Promise<T> => {
      const firstDatabase = createDatabaseClient<DatabaseSchema>({
        connectionString: databaseUrl!,
        maxConnections: 1,
        ssl: false,
      });
      const secondDatabase = createDatabaseClient<DatabaseSchema>({
        connectionString: databaseUrl!,
        maxConnections: 1,
        ssl: false,
      });
      try {
        await sql`set search_path to ${sql.id(schemaName)}, public`.execute(
          firstDatabase,
        );
        await sql`set search_path to ${sql.id(schemaName)}, public`.execute(
          secondDatabase,
        );
        return await work(
          new PatientAppointmentsService({
            client: firstDatabase,
          } as DatabaseService),
          new PatientAppointmentsService({
            client: secondDatabase,
          } as DatabaseService),
        );
      } finally {
        await firstDatabase.destroy();
        await secondDatabase.destroy();
      }
    };
    const [firstRelationship, reusedRelationship] =
      await withConcurrentAppointments((first, second) =>
        Promise.all([
          first.createRelationship(
            firstPatient.onboarding,
            'appointment-relationship-key-0001',
            firstBookablePractice.id,
          ),
          second.createRelationship(
            firstPatient.onboarding,
            'appointment-relationship-key-0002',
            firstBookablePractice.id,
          ),
        ]),
      );
    expect(reusedRelationship).toEqual(firstRelationship);
    await expect(
      database
        .selectFrom('patient_portal_appointment_relationships')
        .select('id')
        .where('patient_portal_identity_id', '=', firstPatient.identity.id)
        .where('organization_id', '=', firstPractice.id)
        .execute(),
    ).resolves.toHaveLength(1);
    await expect(
      database
        .selectFrom('patient_portal_appointment_commands')
        .select('id')
        .where('patient_portal_identity_id', '=', firstPatient.identity.id)
        .where('operation', '=', 'relationship_create')
        .execute(),
    ).resolves.toHaveLength(2);
    await expect(
      database
        .selectFrom('audit_events')
        .select('id')
        .where('action', '=', 'patient.appointment_relationship_requested')
        .where(
          'target_entity_id',
          '=',
          firstRelationship.appointmentRelationshipId,
        )
        .where('outcome', '=', 'success')
        .execute(),
    ).resolves.toHaveLength(1);
    await expect(
      database
        .selectFrom('patient_portal_profile_links')
        .select('id')
        .where('patient_portal_identity_id', '=', firstPatient.identity.id)
        .execute(),
    ).resolves.toHaveLength(0);

    const firstAppointmentContext = await sessions.rotateAppointmentContext(
      firstPatient.onboarding,
      firstRelationship.appointmentRelationshipId,
    );
    expect(firstAppointmentContext.context).toMatchObject({
      kind: 'appointment-onboarding',
      appointmentRelationshipId: firstRelationship.appointmentRelationshipId,
      practiceName: firstPractice.name,
    });
    const availability = await appointments.listAvailability(
      firstAppointmentContext,
    );
    expect(availability.practiceName).toBe(firstPractice.name);
    expect(
      availability.slots.some((slot) => slot.slotId === firstSlot.id),
    ).toBe(true);

    const [requested, replayedRequested] = await withConcurrentAppointments(
      (first, second) =>
        Promise.all([
          first.createAppointment(
            firstAppointmentContext,
            'appointment-create-key-0001',
            firstSlot.id,
          ),
          second.createAppointment(
            firstAppointmentContext,
            'appointment-create-key-0001',
            firstSlot.id,
          ),
        ]),
    );
    expect(replayedRequested).toEqual(requested);
    await expect(
      database
        .selectFrom('patient_portal_appointment_commands')
        .select('id')
        .where('patient_portal_identity_id', '=', firstPatient.identity.id)
        .where('operation', '=', 'appointment_create')
        .execute(),
    ).resolves.toHaveLength(1);
    await expect(
      appointments.createAppointment(
        firstAppointmentContext,
        'appointment-create-key-0001',
        firstSlot.id,
      ),
    ).resolves.toEqual(requested);
    await expect(
      database
        .selectFrom('patient_portal_appointments')
        .select([
          'facility_id',
          'practitioner_facility_assignment_id',
          'practitioner_service_assignment_id',
          'practitioner_id',
          'appointment_service_id',
        ])
        .where('id', '=', requested.appointment.appointmentId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      facility_id: firstProviderScope.facilityId,
      practitioner_facility_assignment_id:
        firstProviderScope.practitionerFacilityAssignmentId,
      practitioner_service_assignment_id:
        firstProviderScope.practitionerServiceAssignmentId,
      practitioner_id: firstProviderScope.practitionerId,
      appointment_service_id: firstProviderScope.appointmentServiceId,
    });

    const secondPatient = await createPatientSession('two');
    const secondRelationship = await appointments.createRelationship(
      secondPatient.onboarding,
      'appointment-relationship-key-0003',
      firstBookablePractice.id,
    );
    const secondAppointmentContext = await sessions.rotateAppointmentContext(
      secondPatient.onboarding,
      secondRelationship.appointmentRelationshipId,
    );
    await expect(
      appointments.createAppointment(
        secondAppointmentContext,
        'appointment-create-key-0002',
        firstSlot.id,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    const otherPracticeRelationship = await appointments.createRelationship(
      firstAppointmentContext,
      'appointment-relationship-key-0004',
      secondBookablePractice.id,
    );
    const otherPracticeContext = await sessions.rotateAppointmentContext(
      firstAppointmentContext,
      otherPracticeRelationship.appointmentRelationshipId,
    );
    await expect(
      appointments.listAppointments(otherPracticeContext),
    ).resolves.toMatchObject({
      practiceName: secondPractice.name,
      appointments: [],
    });
    await expect(
      appointments.cancelAppointment(
        otherPracticeContext,
        'appointment-cancellation-key-0001',
        requested.appointment.appointmentId,
        requested.appointment.version,
      ),
    ).rejects.toMatchObject({ message: 'Appointment is unavailable.' });

    const firstContextAgain = await sessions.rotateAppointmentContext(
      otherPracticeContext,
      firstRelationship.appointmentRelationshipId,
    );
    const [rescheduled, replayedRescheduled] = await withConcurrentAppointments(
      (first, second) =>
        Promise.all([
          first.rescheduleAppointment(
            firstContextAgain,
            'appointment-reschedule-key-0001',
            requested.appointment.appointmentId,
            rescheduleSlot.id,
            requested.appointment.version,
          ),
          second.rescheduleAppointment(
            firstContextAgain,
            'appointment-reschedule-key-0001',
            requested.appointment.appointmentId,
            rescheduleSlot.id,
            requested.appointment.version,
          ),
        ]),
    );
    expect(replayedRescheduled).toEqual(rescheduled);
    await expect(
      database
        .selectFrom('patient_portal_appointment_commands')
        .select('id')
        .where('patient_portal_identity_id', '=', firstPatient.identity.id)
        .where('operation', '=', 'appointment_reschedule')
        .execute(),
    ).resolves.toHaveLength(1);
    expect(rescheduled.appointment).toMatchObject({
      status: 'requested',
      version: requested.appointment.version + 1,
    });
    await expect(
      database
        .selectFrom('patient_portal_appointments')
        .select([
          'facility_id',
          'practitioner_facility_assignment_id',
          'practitioner_service_assignment_id',
          'practitioner_id',
          'appointment_service_id',
        ])
        .where('id', '=', requested.appointment.appointmentId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      facility_id: rescheduleProviderScope.facilityId,
      practitioner_facility_assignment_id:
        rescheduleProviderScope.practitionerFacilityAssignmentId,
      practitioner_service_assignment_id:
        rescheduleProviderScope.practitionerServiceAssignmentId,
      practitioner_id: rescheduleProviderScope.practitionerId,
      appointment_service_id: rescheduleProviderScope.appointmentServiceId,
    });
    const [cancelled, replayedCancelled] = await withConcurrentAppointments(
      (first, second) =>
        Promise.all([
          first.cancelAppointment(
            firstContextAgain,
            'appointment-cancellation-key-0002',
            requested.appointment.appointmentId,
            rescheduled.appointment.version,
          ),
          second.cancelAppointment(
            firstContextAgain,
            'appointment-cancellation-key-0002',
            requested.appointment.appointmentId,
            rescheduled.appointment.version,
          ),
        ]),
    );
    expect(replayedCancelled).toEqual(cancelled);
    await expect(
      database
        .selectFrom('patient_portal_appointment_commands')
        .select('id')
        .where('patient_portal_identity_id', '=', firstPatient.identity.id)
        .where('operation', '=', 'appointment_cancellation')
        .execute(),
    ).resolves.toHaveLength(1);
    expect(cancelled.appointment).toMatchObject({
      status: 'cancelled',
      version: rescheduled.appointment.version + 1,
      canCancel: false,
      canReschedule: false,
    });
    await expect(
      appointments.cancelAppointment(
        firstContextAgain,
        'appointment-cancellation-key-0002',
        requested.appointment.appointmentId,
        rescheduled.appointment.version,
      ),
    ).resolves.toEqual(cancelled);

    const secondPracticeRelationshipForSecondPatient =
      await appointments.createRelationship(
        secondAppointmentContext,
        'appointment-relationship-key-0006',
        secondBookablePractice.id,
      );
    const secondPatientSecondPracticeContext =
      await sessions.rotateAppointmentContext(
        secondAppointmentContext,
        secondPracticeRelationshipForSecondPatient.appointmentRelationshipId,
      );
    const firstPatientSecondPracticeContext =
      await sessions.rotateAppointmentContext(
        firstContextAgain,
        otherPracticeRelationship.appointmentRelationshipId,
      );
    const competingBookings = await withConcurrentAppointments(
      (first, second) =>
        Promise.allSettled([
          first.createAppointment(
            firstPatientSecondPracticeContext,
            'appointment-create-key-race-0001',
            secondSlot.id,
          ),
          second.createAppointment(
            secondPatientSecondPracticeContext,
            'appointment-create-key-race-0002',
            secondSlot.id,
          ),
        ]),
    );
    const successfulBookings = competingBookings.filter(
      (result) => result.status === 'fulfilled',
    );
    const rejectedBookings = competingBookings.filter(
      (result) => result.status === 'rejected',
    );
    expect(successfulBookings).toHaveLength(1);
    expect(rejectedBookings).toHaveLength(1);
    const rejectedBooking = rejectedBookings[0];
    expect(rejectedBooking?.status).toBe('rejected');
    if (rejectedBooking?.status === 'rejected') {
      expect(rejectedBooking.reason as unknown).toBeInstanceOf(
        ConflictException,
      );
    }
    await expect(
      database
        .selectFrom('patient_portal_appointments')
        .select('id')
        .where('appointment_slot_id', '=', secondSlot.id)
        .where('status', '=', 'requested')
        .execute(),
    ).resolves.toHaveLength(1);

    await expect(
      database
        .selectFrom('patient_portal_appointments')
        .select([
          'patient_portal_profile_id',
          'patient_portal_appointment_relationship_id',
          'status',
        ])
        .where('id', '=', requested.appointment.appointmentId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      patient_portal_profile_id: null,
      patient_portal_appointment_relationship_id:
        firstRelationship.appointmentRelationshipId,
      status: 'cancelled',
    });

    // These direct writes deliberately bypass the service. The migration must
    // reject cross-identity and cross-practice combinations even if a future
    // endpoint accidentally supplies forged scope values.
    const firstProfile = await database
      .insertInto('patient_portal_profiles')
      .values({
        tenant_id: tenant.id,
        organization_id: firstPractice.id,
        application_user_id: firstPatient.user.id,
        status: 'active',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await database
      .insertInto('patient_portal_profile_links')
      .values({
        patient_portal_profile_id: firstProfile.id,
        patient_portal_identity_id: firstPatient.identity.id,
        status: 'active',
        linked_by_user_id: null,
        link_reason: 'Synthetic appointment schema integrity verification.',
        revoked_at: null,
        revoked_by_user_id: null,
        revocation_reason: null,
      })
      .execute();

    const linkedPracticeSession = await sessions.rotateContext(
      firstPatientSecondPracticeContext,
      firstProfile.id,
    );
    const linkedDiscovery = await appointments.listBookablePractices(
      linkedPracticeSession,
    );
    expect(
      linkedDiscovery.bookablePractices.some(
        (practice) => practice.bookablePracticeId === firstBookablePractice.id,
      ),
    ).toBe(false);
    await expect(
      appointments.createRelationship(
        linkedPracticeSession,
        'appointment-relationship-key-0005',
        firstBookablePractice.id,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    const linkedAppointment = await appointments.createAppointment(
      linkedPracticeSession,
      'appointment-create-key-linked-0001',
      firstSlot.id,
    );
    expect(linkedAppointment.appointment.status).toBe('requested');

    await database
      .updateTable('patient_portal_profile_links')
      .set({
        status: 'revoked',
        revoked_at: new Date(),
        revoked_by_user_id: firstPatient.user.id,
        revocation_reason: 'Synthetic appointment revocation verification.',
        updated_at: new Date(),
      })
      .where('patient_portal_profile_id', '=', firstProfile.id)
      .executeTakeFirstOrThrow();
    await expect(
      appointments.createAppointment(
        linkedPracticeSession,
        'appointment-create-key-linked-0001',
        firstSlot.id,
      ),
    ).rejects.toMatchObject({ message: 'Appointment is unavailable.' });
    await expect(
      appointments.cancelAppointment(
        linkedPracticeSession,
        'appointment-cancellation-key-linked-0001',
        linkedAppointment.appointment.appointmentId,
        linkedAppointment.appointment.version,
      ),
    ).rejects.toMatchObject({ message: 'Appointment is unavailable.' });

    const invalidCancelledAppointment = {
      tenant_id: tenant.id,
      organization_id: firstPractice.id,
      appointment_slot_id: firstSlot.id,
      status: 'cancelled' as const,
      version: 1,
      cancelled_at: new Date(),
    };
    await expect(
      database
        .insertInto('patient_portal_appointments')
        .values({
          ...invalidCancelledAppointment,
          patient_portal_identity_id: secondPatient.identity.id,
          patient_portal_profile_id: firstProfile.id,
          patient_portal_appointment_relationship_id: null,
        })
        .execute(),
    ).rejects.toThrow();
    await expect(
      database
        .insertInto('patient_portal_appointments')
        .values({
          ...invalidCancelledAppointment,
          patient_portal_identity_id: secondPatient.identity.id,
          patient_portal_profile_id: null,
          patient_portal_appointment_relationship_id:
            firstRelationship.appointmentRelationshipId,
        })
        .execute(),
    ).rejects.toThrow();
    await expect(
      database
        .insertInto('patient_portal_appointments')
        .values({
          ...invalidCancelledAppointment,
          appointment_slot_id: secondSlot.id,
          patient_portal_identity_id: firstPatient.identity.id,
          patient_portal_profile_id: null,
          patient_portal_appointment_relationship_id:
            firstRelationship.appointmentRelationshipId,
        })
        .execute(),
    ).rejects.toThrow();
    await expect(
      database
        .insertInto('patient_portal_appointment_commands')
        .values({
          patient_portal_identity_id: secondPatient.identity.id,
          operation: 'appointment_cancellation',
          idempotency_key_hash: 'a'.repeat(64),
          request_hash: 'b'.repeat(64),
          response_data: {},
          patient_portal_appointment_relationship_id: null,
          patient_portal_appointment_id: requested.appointment.appointmentId,
        })
        .execute(),
    ).rejects.toThrow();
  });

  it('keeps public registration idempotent, rate data short-lived, and activates only an exact verified patient binding', async () => {
    const issuer =
      'https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_public_registration';
    const clientId = 'synthetic-public-registration-client';
    let provisionCalls = 0;
    const patientIdentityProvider: PatientIdentityProviderPort = {
      issuer,
      clientId,
      protocol: 'cognito',
      provisionAccount: () => {
        provisionCalls += 1;
        return Promise.resolve({
          kind: 'created',
          subject: `synthetic-public-registration-subject-${provisionCalls}`,
          externalAccountId: `synthetic-public-registration-provider-${provisionCalls}`,
        });
      },
      deleteAccount: () => Promise.resolve(),
    };
    const registrationConfig = {
      getOrThrow: (name: string) => {
        const values: Record<string, string | number> = {
          PATIENT_PUBLIC_REGISTRATION_ENABLED: 'true',
          PATIENT_REGISTRATION_EMAIL_HMAC_SECRET:
            'synthetic-registration-hmac-secret-with-at-least-32-characters',
          PATIENT_PUBLIC_REGISTRATION_WINDOW_SECONDS: 900,
          PATIENT_PUBLIC_REGISTRATION_IP_LIMIT: 20,
          PATIENT_PUBLIC_REGISTRATION_EMAIL_LIMIT: 1,
          DEPLOYMENT_ENVIRONMENT: 'local',
        };
        return values[name];
      },
    } as ConfigService;
    const registrations = new PatientPortalRegistrationService(
      { client: database } as DatabaseService,
      patientIdentityProvider,
      registrationConfig,
    );
    const firstInput = {
      displayName: 'Synthetic Public Registration Patient',
      email: 'public.registration.patient@example.invalid',
      idempotencyKey: 'synthetic-public-registration-key-0001',
      clientIp: '203.0.113.41',
    };

    await expect(registrations.register(firstInput)).resolves.toEqual({
      accepted: true,
    });
    await expect(registrations.register(firstInput)).resolves.toEqual({
      accepted: true,
    });
    expect(provisionCalls).toBe(1);
    await expect(
      registrations.register({
        ...firstInput,
        displayName: 'Different payload for the same idempotency key',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const pendingIdentity = await database
      .selectFrom('patient_portal_identities')
      .select(['id', 'application_user_id', 'status', 'client_id'])
      .where('issuer', '=', issuer)
      .where('subject', '=', 'synthetic-public-registration-subject-1')
      .executeTakeFirstOrThrow();
    expect(pendingIdentity).toMatchObject({
      status: 'pending_verification',
      client_id: clientId,
    });

    const sessionConfig = {
      getOrThrow: (name: string) => {
        const values: Record<string, number> = {
          SESSION_IDLE_MINUTES: 30,
          SESSION_ABSOLUTE_MINUTES: 480,
          SESSION_RENEWAL_MINUTES: 5,
        };
        return values[name];
      },
    } as ConfigService;
    const patientSessions = new PatientPortalSessionService(
      { client: database } as DatabaseService,
      sessionConfig,
    );
    const exactPrincipal = {
      issuer,
      subject: 'synthetic-public-registration-subject-1',
      clientId,
      username: firstInput.email,
      providerExpiresAt: new Date(Date.now() + 10 * 60_000),
    };

    await expect(
      patientSessions.create({ ...exactPrincipal, clientId: 'wrong-client' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      patientSessions.create({
        ...exactPrincipal,
        issuer: 'https://identity.example.invalid/wrong-patient-issuer',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      patientSessions.create({
        ...exactPrincipal,
        subject: 'unknown-verified-subject',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(patientSessions.create(exactPrincipal)).resolves.toMatchObject(
      {
        patientPortalIdentityId: pendingIdentity.id,
        applicationUserId: pendingIdentity.application_user_id,
        context: { kind: 'onboarding' },
      },
    );
    await expect(
      database
        .selectFrom('patient_portal_identities')
        .select('status')
        .where('id', '=', pendingIdentity.id)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ status: 'active' });

    const rateLimitedInput = {
      ...firstInput,
      idempotencyKey: 'synthetic-public-registration-key-0002',
    };
    await expect(registrations.register(rateLimitedInput)).resolves.toEqual({
      accepted: true,
    });
    expect(provisionCalls).toBe(1);

    const requestsToExpire = await database
      .selectFrom('patient_portal_registration_requests')
      .select('id')
      .where('provider_subject', '=', 'synthetic-public-registration-subject-1')
      .unionAll(
        database
          .selectFrom('patient_portal_registration_requests')
          .select('id')
          .where('status', '=', 'rate_limited'),
      )
      .execute();
    const createdAt = new Date(Date.now() - 10 * 60_000);
    const expiresAt = new Date(Date.now() - 60_000);
    await database
      .updateTable('patient_portal_registration_requests')
      .set({ created_at: createdAt, expires_at: expiresAt })
      .where(
        'id',
        'in',
        requestsToExpire.map((request) => request.id),
      )
      .execute();

    await expect(
      registrations.register({
        ...firstInput,
        displayName: 'Synthetic Public Registration Patient Retry',
      }),
    ).resolves.toEqual({ accepted: true });
    expect(provisionCalls).toBe(2);

    const registrationAudit = await database
      .selectFrom('audit_events')
      .select(['reason', 'after_data'])
      .where('target_entity_id', '=', pendingIdentity.id)
      .where('action', '=', 'identity.patient_portal_registration_started')
      .executeTakeFirstOrThrow();
    expect(JSON.stringify(registrationAudit)).not.toContain(firstInput.email);
  });

  it('rechecks exact-practice invitation authority in its transaction and keeps acceptance opaque and idempotent', async () => {
    const workforceIssuer =
      'https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_invitation_workforce';
    const patientIssuer =
      'https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_invitation_patient';
    const patientClientId = 'synthetic-invitation-patient-client';
    const tenant = await database
      .insertInto('tenants')
      .values({
        code: 'PORTAL-INVITE-TXN',
        name: 'Synthetic Portal Invitation Transaction Tenant',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const authorizedPractice = await database
      .insertInto('organizations')
      .values({
        tenant_id: tenant.id,
        parent_organization_id: null,
        kind: 'practice',
        code: 'PORTAL-INVITE-A',
        name: 'Synthetic Authorized Portal Practice',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const otherPractice = await database
      .insertInto('organizations')
      .values({
        tenant_id: tenant.id,
        parent_organization_id: null,
        kind: 'practice',
        code: 'PORTAL-INVITE-B',
        name: 'Synthetic Other Portal Practice',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const connection = await database
      .insertInto('identity_connections')
      .values({
        tenant_id: tenant.id,
        code: 'portal-invitation-workforce',
        name: 'Synthetic Portal Invitation Workforce',
        protocol: 'cognito',
        issuer: workforceIssuer,
        jit_provisioning_enabled: false,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const administrator = await database
      .insertInto('application_users')
      .values({
        display_name: 'Synthetic Portal Invitation Administrator',
        primary_email: 'portal.invitation.admin@example.invalid',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const acceptingPatient = await database
      .insertInto('application_users')
      .values({
        display_name: 'Synthetic Invitation Accepting Patient',
        primary_email: 'portal.invitation.patient.a@example.invalid',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const otherPatient = await database
      .insertInto('application_users')
      .values({
        display_name: 'Synthetic Invitation Other Patient',
        primary_email: 'portal.invitation.patient.b@example.invalid',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const administratorSubject = 'synthetic-portal-invitation-admin-subject';
    await database
      .insertInto('user_identities')
      .values({
        application_user_id: administrator.id,
        identity_connection_id: connection.id,
        subject: administratorSubject,
        last_authenticated_at: null,
      })
      .execute();
    const administratorMembership = await database
      .insertInto('organization_memberships')
      .values({
        tenant_id: tenant.id,
        organization_id: authorizedPractice.id,
        application_user_id: administrator.id,
        status: 'active',
        provisioning_method: 'admin_invite',
        external_id: null,
        valid_until: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const practiceAdminRole = await database
      .selectFrom('roles')
      .select('id')
      .where('tenant_id', 'is', null)
      .where('code', '=', 'PRACTICE_ADMIN')
      .executeTakeFirstOrThrow();
    await database
      .insertInto('role_assignments')
      .values({
        tenant_id: tenant.id,
        membership_id: administratorMembership.id,
        role_id: practiceAdminRole.id,
        scope_organization_id: authorizedPractice.id,
        facility_id: null,
        include_descendants: false,
        assignment_source: 'admin',
        assigned_by_user_id: administrator.id,
        source_role_request_id: null,
        valid_until: null,
        revoked_at: null,
        revoked_by_user_id: null,
        revocation_reason: null,
      })
      .execute();
    const [acceptingIdentity, otherIdentity] = await database
      .insertInto('patient_portal_identities')
      .values([
        {
          application_user_id: acceptingPatient.id,
          issuer: patientIssuer,
          subject: 'synthetic-portal-invitation-patient-a',
          client_id: patientClientId,
          username: 'portal.invitation.patient.a@example.invalid',
          status: 'active',
          provider_sync_status: 'synchronized',
          provider_sync_attempted_at: null,
          provider_sync_completed_at: null,
          provider_sync_error_code: null,
          last_authenticated_at: null,
        },
        {
          application_user_id: otherPatient.id,
          issuer: patientIssuer,
          subject: 'synthetic-portal-invitation-patient-b',
          client_id: patientClientId,
          username: 'portal.invitation.patient.b@example.invalid',
          status: 'active',
          provider_sync_status: 'synchronized',
          provider_sync_attempted_at: null,
          provider_sync_completed_at: null,
          provider_sync_error_code: null,
          last_authenticated_at: null,
        },
      ])
      .returning(['id', 'application_user_id', 'subject'])
      .execute();
    const links = new PatientPortalProfileLinkService({
      client: database,
    } as DatabaseService);
    const repository = new PatientPortalInvitationRepository(
      { client: database } as DatabaseService,
      links,
      workforceIdentityProvider(workforceIssuer),
    );
    const invitationConfig = {
      getOrThrow: (name: string) => {
        const values: Record<string, string | number> = {
          PATIENT_PORTAL_PUBLIC_URL:
            'https://patient.uae-health.example/patient-portal',
          PATIENT_PORTAL_INVITATION_TTL_MINUTES: 10_080,
        };
        return values[name];
      },
    } as ConfigService;
    const invitations = new PatientPortalInvitationService(
      repository,
      invitationConfig,
    );
    const administratorPrincipal = {
      subject: administratorSubject,
      clientId: 'synthetic-workforce-client',
    };

    await expect(
      invitations.listContexts(administratorPrincipal),
    ).resolves.toEqual({
      contexts: [
        {
          tenantId: tenant.id,
          tenantName: 'Synthetic Portal Invitation Transaction Tenant',
          organizationId: authorizedPractice.id,
          organizationName: 'Synthetic Authorized Portal Practice',
        },
      ],
    });
    await expect(
      invitations.issue(administratorPrincipal, {
        organizationId: otherPractice.id,
        reason: 'patient-portal-onboarding',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const issued = await invitations.issue(administratorPrincipal, {
      organizationId: authorizedPractice.id,
      reason: 'patient-portal-onboarding',
    });
    const rawToken = issued.invitationUrl.split('#')[1];
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const issuedInvitation = await database
      .selectFrom('patient_portal_invitations')
      .select(['id', 'reason', 'status'])
      .where('token_hash', '=', tokenHash)
      .executeTakeFirstOrThrow();
    expect(issuedInvitation).toMatchObject({
      reason: 'patient-portal-onboarding',
      status: 'issued',
    });

    const patientSession = (
      identity: typeof acceptingIdentity,
    ): PatientPortalSessionContext => ({
      sessionId: `synthetic-invitation-session-${identity.id}`,
      principal: {
        issuer: patientIssuer,
        subject: identity.subject,
        clientId: patientClientId,
      },
      patientPortalIdentityId: identity.id,
      applicationUserId: identity.application_user_id,
      displayName: 'Synthetic Invitation Patient',
      context: { kind: 'onboarding' },
      availablePractices: [],
      appointmentOnboardingPractices: [],
      csrfToken: 'synthetic-invitation-csrf-token',
      idleExpiresAt: new Date(Date.now() + 30 * 60_000),
      absoluteExpiresAt: new Date(Date.now() + 8 * 60 * 60_000),
      renewed: false,
    });
    const acceptingSession = patientSession(acceptingIdentity);
    const firstAcceptance = await invitations.accept(
      acceptingSession,
      rawToken,
    );
    const replayAcceptance = await invitations.accept(
      acceptingSession,
      rawToken,
    );
    expect(replayAcceptance).toEqual(firstAcceptance);
    await expect(
      invitations.accept(patientSession(otherIdentity), rawToken),
    ).rejects.toMatchObject({ message: 'This invitation is unavailable.' });

    const secondIssued = await invitations.issue(administratorPrincipal, {
      organizationId: authorizedPractice.id,
      reason: 'patient-requested-access',
    });
    const secondToken = secondIssued.invitationUrl.split('#')[1];
    await expect(
      invitations.accept(acceptingSession, secondToken),
    ).resolves.toMatchObject({
      portalProfileId: firstAcceptance.portalProfileId,
    });
    await expect(
      database
        .selectFrom('patient_portal_profiles')
        .select('id')
        .where('application_user_id', '=', acceptingPatient.id)
        .where('organization_id', '=', authorizedPractice.id)
        .execute(),
    ).resolves.toHaveLength(1);

    const expiredIssued = await invitations.issue(administratorPrincipal, {
      organizationId: authorizedPractice.id,
      reason: 'staff-assisted-enrolment',
    });
    const expiredToken = expiredIssued.invitationUrl.split('#')[1];
    const expiredTokenHash = createHash('sha256')
      .update(expiredToken)
      .digest('hex');
    const oldCreatedAt = new Date(Date.now() - 10 * 60_000);
    const expiredAt = new Date(Date.now() - 60_000);
    await database
      .updateTable('patient_portal_invitations')
      .set({ created_at: oldCreatedAt, expires_at: expiredAt })
      .where('token_hash', '=', expiredTokenHash)
      .execute();
    await expect(
      invitations.accept(acceptingSession, expiredToken),
    ).rejects.toMatchObject({ message: 'This invitation is unavailable.' });
    await expect(
      database
        .selectFrom('patient_portal_invitations')
        .select('status')
        .where('token_hash', '=', expiredTokenHash)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ status: 'expired' });

    const revokedIssued = await invitations.issue(administratorPrincipal, {
      organizationId: authorizedPractice.id,
      reason: 'patient-portal-onboarding',
    });
    const revokedToken = revokedIssued.invitationUrl.split('#')[1];
    const revokedTokenHash = createHash('sha256')
      .update(revokedToken)
      .digest('hex');
    await database
      .updateTable('patient_portal_invitations')
      .set({
        status: 'revoked',
        revoked_at: new Date(),
        revoked_by_user_id: administrator.id,
        revocation_reason: 'system-revocation',
      })
      .where('token_hash', '=', revokedTokenHash)
      .execute();
    await expect(
      invitations.accept(acceptingSession, revokedToken),
    ).rejects.toMatchObject({ message: 'This invitation is unavailable.' });

    const invitationAudits = await database
      .selectFrom('audit_events')
      .select(['reason', 'after_data'])
      .where('target_entity_id', '=', issuedInvitation.id)
      .execute();
    const serializedAudits = JSON.stringify(invitationAudits);
    expect(serializedAudits).not.toContain(rawToken);
    expect(serializedAudits).not.toContain(
      'portal.invitation.patient.a@example.invalid',
    );
    expect(serializedAudits).not.toContain('clinical details');
  });

  it('persists an authorized invitation without merging by email or assigning a role', async () => {
    const issuer =
      'https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_synthetic';
    const tenant = await database
      .insertInto('tenants')
      .values({
        code: 'INVITE-TEST',
        name: 'Synthetic Invitation Tenant',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const organization = await database
      .insertInto('organizations')
      .values({
        tenant_id: tenant.id,
        parent_organization_id: null,
        kind: 'practice',
        code: 'INVITE-PRACTICE',
        name: 'Synthetic Invitation Practice',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const connection = await database
      .insertInto('identity_connections')
      .values({
        tenant_id: tenant.id,
        code: 'native-cognito',
        name: 'Synthetic Native Cognito',
        protocol: 'cognito',
        issuer,
        jit_provisioning_enabled: false,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const administrator = await database
      .insertInto('application_users')
      .values({
        display_name: 'Synthetic Invitation Administrator',
        primary_email: 'invite.admin@example.invalid',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const sameEmailUnboundUser = await database
      .insertInto('application_users')
      .values({
        display_name: 'Synthetic Unbound Same Email',
        primary_email: 'same.invitation@example.invalid',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await database
      .insertInto('user_identities')
      .values({
        application_user_id: administrator.id,
        identity_connection_id: connection.id,
        subject: 'synthetic-invitation-admin-subject',
        last_authenticated_at: null,
      })
      .execute();
    const administratorMembership = await database
      .insertInto('organization_memberships')
      .values({
        tenant_id: tenant.id,
        organization_id: organization.id,
        application_user_id: administrator.id,
        status: 'active',
        provisioning_method: 'admin_invite',
        external_id: null,
        valid_until: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const practiceAdminRole = await database
      .selectFrom('roles')
      .select('id')
      .where('code', '=', 'PRACTICE_ADMIN')
      .where('tenant_id', 'is', null)
      .executeTakeFirstOrThrow();

    await database
      .insertInto('role_assignments')
      .values({
        tenant_id: tenant.id,
        membership_id: administratorMembership.id,
        role_id: practiceAdminRole.id,
        scope_organization_id: organization.id,
        facility_id: null,
        include_descendants: false,
        assignment_source: 'admin',
        assigned_by_user_id: administrator.id,
        source_role_request_id: null,
        valid_until: null,
        revoked_at: null,
        revoked_by_user_id: null,
        revocation_reason: null,
      })
      .execute();

    const repository = new WorkforceDirectoryRepository(
      { client: database } as DatabaseService,
      workforceIdentityProvider(issuer),
    );
    const authorization = await repository.authorizeInvitation(
      'synthetic-invitation-admin-subject',
      organization.id,
    );

    expect(authorization).not.toBeNull();
    const invitation = await repository.persistInvitation({
      actorSubject: 'synthetic-invitation-admin-subject',
      authorization: authorization!,
      account: {
        subject: 'synthetic-new-invitation-subject',
        username: 'synthetic-cognito-username',
        enabled: true,
        status: 'FORCE_CHANGE_PASSWORD',
        created: true,
      },
      displayName: 'Synthetic Invited Clinician',
      email: 'same.invitation@example.invalid',
      reason: 'Approved synthetic invitation integration test.',
    });

    expect(invitation.applicationUserId).not.toBe(sameEmailUnboundUser.id);
    await expect(
      database
        .selectFrom('role_assignments')
        .select('id')
        .where('membership_id', '=', invitation.membershipId)
        .execute(),
    ).resolves.toHaveLength(0);
    await expect(
      database
        .selectFrom('audit_events')
        .select(['action', 'reason'])
        .where('target_entity_id', '=', invitation.membershipId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      action: 'identity.workforce_invited',
      reason: 'Approved synthetic invitation integration test.',
    });
  });

  it('requires the explicit descendant permission before managing a child practice', async () => {
    const issuer =
      'https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_synthetic';
    const tenant = await database
      .insertInto('tenants')
      .values({
        code: 'DESCENDANT-SCOPE-TEST',
        name: 'Synthetic Descendant Scope Tenant',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const parent = await database
      .insertInto('organizations')
      .values({
        tenant_id: tenant.id,
        parent_organization_id: null,
        kind: 'group',
        code: 'DESCENDANT-PARENT',
        name: 'Synthetic Parent Group',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const child = await database
      .insertInto('organizations')
      .values({
        tenant_id: tenant.id,
        parent_organization_id: parent.id,
        kind: 'practice',
        code: 'DESCENDANT-CHILD',
        name: 'Synthetic Child Practice',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const connection = await database
      .insertInto('identity_connections')
      .values({
        tenant_id: tenant.id,
        code: 'descendant-native-cognito',
        name: 'Synthetic Descendant Native Cognito',
        protocol: 'cognito',
        issuer,
        jit_provisioning_enabled: false,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const administrator = await database
      .insertInto('application_users')
      .values({
        display_name: 'Synthetic Scoped Access Administrator',
        primary_email: 'descendant.admin@example.invalid',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const administratorSubject = 'synthetic-descendant-admin-subject';
    await database
      .insertInto('user_identities')
      .values({
        application_user_id: administrator.id,
        identity_connection_id: connection.id,
        subject: administratorSubject,
        last_authenticated_at: null,
      })
      .execute();
    const membership = await database
      .insertInto('organization_memberships')
      .values({
        tenant_id: tenant.id,
        organization_id: parent.id,
        application_user_id: administrator.id,
        status: 'active',
        provisioning_method: 'admin_invite',
        external_id: null,
        valid_until: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const accessAdminRole = await database
      .selectFrom('roles')
      .select('id')
      .where('tenant_id', 'is', null)
      .where('code', '=', 'ACCESS_ADMIN')
      .executeTakeFirstOrThrow();
    await database
      .insertInto('role_assignments')
      .values({
        tenant_id: tenant.id,
        membership_id: membership.id,
        role_id: accessAdminRole.id,
        scope_organization_id: parent.id,
        facility_id: null,
        include_descendants: true,
        assignment_source: 'admin',
        assigned_by_user_id: administrator.id,
        source_role_request_id: null,
        valid_until: null,
        revoked_at: null,
        revoked_by_user_id: null,
        revocation_reason: null,
      })
      .execute();
    const repository = new WorkforceDirectoryRepository(
      { client: database } as DatabaseService,
      workforceIdentityProvider(issuer),
    );

    await expect(
      repository.listManageableContexts(administratorSubject),
    ).resolves.toEqual([
      {
        tenantId: tenant.id,
        tenantName: 'Synthetic Descendant Scope Tenant',
        organizationId: parent.id,
        organizationName: 'Synthetic Parent Group',
      },
    ]);
    await expect(
      repository.authorizeInvitation(administratorSubject, child.id),
    ).resolves.toBeNull();
  });

  it('suspends only one practice membership and revokes the target user sessions', async () => {
    const issuer =
      'https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_synthetic';
    const tenant = await database
      .insertInto('tenants')
      .values({
        code: 'SUSPEND-TEST',
        name: 'Synthetic Suspension Tenant',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const firstPractice = await database
      .insertInto('organizations')
      .values({
        tenant_id: tenant.id,
        parent_organization_id: null,
        kind: 'practice',
        code: 'SUSPEND-PRACTICE-A',
        name: 'Synthetic Suspension Practice A',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const secondPractice = await database
      .insertInto('organizations')
      .values({
        tenant_id: tenant.id,
        parent_organization_id: null,
        kind: 'practice',
        code: 'SUSPEND-PRACTICE-B',
        name: 'Synthetic Suspension Practice B',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const connection = await database
      .insertInto('identity_connections')
      .values({
        tenant_id: tenant.id,
        code: 'suspension-native-cognito',
        name: 'Synthetic Suspension Native Cognito',
        protocol: 'cognito',
        issuer,
        jit_provisioning_enabled: false,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const administrator = await database
      .insertInto('application_users')
      .values({
        display_name: 'Synthetic Suspension Administrator',
        primary_email: 'suspension.admin@example.invalid',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const target = await database
      .insertInto('application_users')
      .values({
        display_name: 'Synthetic Multi Practice Target',
        primary_email: 'suspension.target@example.invalid',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const administratorSubject = 'synthetic-suspension-admin-subject';
    const targetSubject = 'synthetic-suspension-target-subject';

    await database
      .insertInto('user_identities')
      .values([
        {
          application_user_id: administrator.id,
          identity_connection_id: connection.id,
          subject: administratorSubject,
          last_authenticated_at: null,
        },
        {
          application_user_id: target.id,
          identity_connection_id: connection.id,
          subject: targetSubject,
          last_authenticated_at: null,
        },
      ])
      .execute();
    const administratorMembership = await database
      .insertInto('organization_memberships')
      .values({
        tenant_id: tenant.id,
        organization_id: firstPractice.id,
        application_user_id: administrator.id,
        status: 'active',
        provisioning_method: 'admin_invite',
        external_id: null,
        valid_until: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const targetFirstMembership = await database
      .insertInto('organization_memberships')
      .values({
        tenant_id: tenant.id,
        organization_id: firstPractice.id,
        application_user_id: target.id,
        status: 'active',
        provisioning_method: 'admin_invite',
        external_id: null,
        valid_until: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const targetSecondMembership = await database
      .insertInto('organization_memberships')
      .values({
        tenant_id: tenant.id,
        organization_id: secondPractice.id,
        application_user_id: target.id,
        status: 'active',
        provisioning_method: 'admin_invite',
        external_id: null,
        valid_until: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const roles = await database
      .selectFrom('roles')
      .select(['id', 'code'])
      .where('tenant_id', 'is', null)
      .where('code', 'in', ['PRACTICE_ADMIN', 'RECEPTION'])
      .execute();
    const practiceAdminRole = roles.find(
      (role) => role.code === 'PRACTICE_ADMIN',
    )!;
    const receptionRole = roles.find((role) => role.code === 'RECEPTION')!;

    await database
      .insertInto('role_assignments')
      .values([
        {
          tenant_id: tenant.id,
          membership_id: administratorMembership.id,
          role_id: practiceAdminRole.id,
          scope_organization_id: firstPractice.id,
          facility_id: null,
          include_descendants: false,
          assignment_source: 'admin',
          assigned_by_user_id: administrator.id,
          source_role_request_id: null,
          valid_until: null,
          revoked_at: null,
          revoked_by_user_id: null,
          revocation_reason: null,
        },
        {
          tenant_id: tenant.id,
          membership_id: targetFirstMembership.id,
          role_id: receptionRole.id,
          scope_organization_id: firstPractice.id,
          facility_id: null,
          include_descendants: false,
          assignment_source: 'admin',
          assigned_by_user_id: administrator.id,
          source_role_request_id: null,
          valid_until: null,
          revoked_at: null,
          revoked_by_user_id: null,
          revocation_reason: null,
        },
      ])
      .execute();
    const future = new Date(Date.now() + 60 * 60_000);
    await database
      .insertInto('workforce_sessions')
      .values([
        {
          session_token_hash: `${'a'.repeat(63)}1`,
          csrf_token_hash: `${'b'.repeat(63)}1`,
          cognito_subject: targetSubject,
          cognito_client_id: 'synthetic-client',
          cognito_username: 'synthetic-target',
          idle_expires_at: future,
          absolute_expires_at: future,
          revoked_at: null,
        },
        {
          session_token_hash: `${'a'.repeat(63)}2`,
          csrf_token_hash: `${'b'.repeat(63)}2`,
          cognito_subject: targetSubject,
          cognito_client_id: 'synthetic-client',
          cognito_username: 'synthetic-target',
          idle_expires_at: future,
          absolute_expires_at: future,
          revoked_at: null,
        },
      ])
      .execute();
    const repository = new WorkforceDirectoryRepository(
      { client: database } as DatabaseService,
      workforceIdentityProvider(issuer),
    );

    await expect(
      repository.changeMembershipStatus({
        actorSubject: administratorSubject,
        membershipId: targetFirstMembership.id,
        organizationId: firstPractice.id,
        status: 'suspended',
        reason: 'Synthetic practice access suspension test.',
      }),
    ).resolves.toEqual({
      membershipId: targetFirstMembership.id,
      organizationId: firstPractice.id,
      membershipStatus: 'suspended',
      sessionsRevoked: 2,
    });
    await expect(
      database
        .selectFrom('organization_memberships')
        .select(['id', 'status'])
        .where('id', 'in', [
          targetFirstMembership.id,
          targetSecondMembership.id,
        ])
        .orderBy('id')
        .execute(),
    ).resolves.toEqual(
      [
        { id: targetFirstMembership.id, status: 'suspended' },
        { id: targetSecondMembership.id, status: 'active' },
      ].sort((first, second) => first.id.localeCompare(second.id)),
    );
    const revokedSessions = await database
      .selectFrom('workforce_sessions')
      .select('revoked_at')
      .where('cognito_subject', '=', targetSubject)
      .execute();
    expect(revokedSessions).toHaveLength(2);
    expect(
      revokedSessions.every((session) => session.revoked_at !== null),
    ).toBe(true);
    await expect(
      database
        .selectFrom('role_assignments')
        .select('id')
        .where('membership_id', '=', targetFirstMembership.id)
        .where('role_id', '=', receptionRole.id)
        .execute(),
    ).resolves.toHaveLength(1);
    await expect(
      database
        .selectFrom('audit_events')
        .select(['action', 'reason', 'after_data'])
        .where('target_entity_id', '=', targetFirstMembership.id)
        .where('action', '=', 'identity.membership_suspended')
        .executeTakeFirstOrThrow(),
    ).resolves.toMatchObject({
      action: 'identity.membership_suspended',
      reason: 'Synthetic practice access suspension test.',
      after_data: { membershipStatus: 'suspended', sessionsRevoked: 2 },
    });
    await expect(
      repository.changeMembershipStatus({
        actorSubject: administratorSubject,
        membershipId: targetSecondMembership.id,
        organizationId: firstPractice.id,
        status: 'suspended',
        reason: 'Synthetic out-of-scope suspension rejection test.',
      }),
    ).rejects.toThrow(
      'Workforce membership-management authorization is no longer active.',
    );
    await expect(
      database
        .selectFrom('application_users')
        .select('status')
        .where('id', '=', target.id)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ status: 'active' });

    await expect(
      repository.changeMembershipStatus({
        actorSubject: administratorSubject,
        membershipId: targetFirstMembership.id,
        organizationId: firstPractice.id,
        status: 'active',
        reason: 'Synthetic practice access restoration test.',
      }),
    ).resolves.toMatchObject({
      membershipStatus: 'active',
      sessionsRevoked: 0,
    });
    await expect(
      repository.changeMembershipStatus({
        actorSubject: administratorSubject,
        membershipId: administratorMembership.id,
        organizationId: firstPractice.id,
        status: 'suspended',
        reason: 'Synthetic self-suspension rejection test.',
      }),
    ).rejects.toThrow(
      'Administrators cannot change their own membership state.',
    );
    await expect(
      database
        .selectFrom('organization_memberships')
        .select('status')
        .where('id', '=', administratorMembership.id)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ status: 'active' });
  });

  it('assigns and revokes only delegable global roles within an administrator practice scope', async () => {
    const issuer =
      'https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_synthetic';
    const tenant = await database
      .insertInto('tenants')
      .values({
        code: 'ROLE-MANAGEMENT-TEST',
        name: 'Synthetic Role Management Tenant',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const organization = await database
      .insertInto('organizations')
      .values({
        tenant_id: tenant.id,
        parent_organization_id: null,
        kind: 'practice',
        code: 'ROLE-MANAGEMENT-PRACTICE',
        name: 'Synthetic Role Management Practice',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const connection = await database
      .insertInto('identity_connections')
      .values({
        tenant_id: tenant.id,
        code: 'role-management-native-cognito',
        name: 'Synthetic Role Management Native Cognito',
        protocol: 'cognito',
        issuer,
        jit_provisioning_enabled: false,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const [administrator, target, accessAdministrator] = await database
      .insertInto('application_users')
      .values([
        {
          display_name: 'Synthetic Role Administrator',
          primary_email: 'role.admin@example.invalid',
          is_synthetic: true,
        },
        {
          display_name: 'Synthetic Role Target',
          primary_email: 'role.target@example.invalid',
          is_synthetic: true,
        },
        {
          display_name: 'Synthetic Access Administrator',
          primary_email: 'access.admin@example.invalid',
          is_synthetic: true,
        },
      ])
      .returning('id')
      .execute();
    const administratorSubject = 'synthetic-role-admin-subject';
    const accessAdministratorSubject = 'synthetic-access-admin-subject';
    await database
      .insertInto('user_identities')
      .values([
        {
          application_user_id: administrator.id,
          identity_connection_id: connection.id,
          subject: administratorSubject,
          last_authenticated_at: null,
        },
        {
          application_user_id: accessAdministrator.id,
          identity_connection_id: connection.id,
          subject: accessAdministratorSubject,
          last_authenticated_at: null,
        },
      ])
      .execute();
    const [
      administratorMembership,
      targetMembership,
      accessAdministratorMembership,
    ] = await database
      .insertInto('organization_memberships')
      .values([
        {
          tenant_id: tenant.id,
          organization_id: organization.id,
          application_user_id: administrator.id,
          status: 'active',
          provisioning_method: 'admin_invite',
          external_id: null,
          valid_until: null,
        },
        {
          tenant_id: tenant.id,
          organization_id: organization.id,
          application_user_id: target.id,
          status: 'active',
          provisioning_method: 'admin_invite',
          external_id: null,
          valid_until: null,
        },
        {
          tenant_id: tenant.id,
          organization_id: organization.id,
          application_user_id: accessAdministrator.id,
          status: 'active',
          provisioning_method: 'admin_invite',
          external_id: null,
          valid_until: null,
        },
      ])
      .returning('id')
      .execute();
    const roles = await database
      .selectFrom('roles')
      .select(['id', 'code'])
      .where('tenant_id', 'is', null)
      .where('code', 'in', [
        'ACCESS_ADMIN',
        'BILLING_APPROVER',
        'PRACTICE_ADMIN',
        'RECEPTION',
      ])
      .execute();
    const practiceAdminRole = roles.find(
      (role) => role.code === 'PRACTICE_ADMIN',
    )!;
    const accessAdminRole = roles.find((role) => role.code === 'ACCESS_ADMIN')!;
    const receptionRole = roles.find((role) => role.code === 'RECEPTION')!;
    const billingApproverRole = roles.find(
      (role) => role.code === 'BILLING_APPROVER',
    )!;
    await database
      .insertInto('role_assignments')
      .values([
        {
          tenant_id: tenant.id,
          membership_id: administratorMembership.id,
          role_id: practiceAdminRole.id,
          scope_organization_id: organization.id,
          facility_id: null,
          include_descendants: false,
          assignment_source: 'admin',
          assigned_by_user_id: administrator.id,
          source_role_request_id: null,
          valid_until: null,
          revoked_at: null,
          revoked_by_user_id: null,
          revocation_reason: null,
        },
        {
          tenant_id: tenant.id,
          membership_id: accessAdministratorMembership.id,
          role_id: accessAdminRole.id,
          scope_organization_id: organization.id,
          facility_id: null,
          include_descendants: false,
          assignment_source: 'admin',
          assigned_by_user_id: administrator.id,
          source_role_request_id: null,
          valid_until: null,
          revoked_at: null,
          revoked_by_user_id: null,
          revocation_reason: null,
        },
      ])
      .execute();
    const repository = new WorkforceDirectoryRepository(
      { client: database } as DatabaseService,
      workforceIdentityProvider(issuer),
    );

    await expect(
      repository.authorizeRoleManagement(administratorSubject, organization.id),
    ).resolves.toMatchObject({
      actorUserId: administrator.id,
      organizationId: organization.id,
      tenantId: tenant.id,
    });
    await expect(
      repository.authorizeRoleManagement(
        accessAdministratorSubject,
        organization.id,
      ),
    ).resolves.toBeNull();
    await expect(repository.listAssignableGlobalRoles()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roleId: receptionRole.id,
          code: 'RECEPTION',
        }),
      ]),
    );
    await expect(repository.listAssignableGlobalRoles()).resolves.not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roleId: billingApproverRole.id,
          code: 'BILLING_APPROVER',
        }),
      ]),
    );

    const assignment = await repository.assignGlobalRole({
      actorSubject: administratorSubject,
      membershipId: targetMembership.id,
      organizationId: organization.id,
      roleId: receptionRole.id,
      reason: 'Synthetic front-desk role assignment test.',
    });
    expect(assignment).toMatchObject({
      membershipId: targetMembership.id,
      roleId: receptionRole.id,
      roleCode: 'RECEPTION',
      organizationId: organization.id,
    });
    await expect(
      repository.listRoleAssignments(tenant.id, organization.id),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assignmentId: assignment.assignmentId }),
      ]),
    );
    await expect(
      database
        .selectFrom('audit_events')
        .select(['action', 'reason', 'after_data'])
        .where('target_entity_id', '=', assignment.assignmentId)
        .executeTakeFirstOrThrow(),
    ).resolves.toMatchObject({
      action: 'identity.role_assigned',
      reason: 'Synthetic front-desk role assignment test.',
      after_data: {
        roleCode: 'RECEPTION',
        scopeOrganizationId: organization.id,
      },
    });
    await expect(
      repository.assignGlobalRole({
        actorSubject: administratorSubject,
        membershipId: targetMembership.id,
        organizationId: organization.id,
        roleId: receptionRole.id,
        reason: 'Synthetic duplicate role assignment test.',
      }),
    ).rejects.toThrow('This role is already assigned to the membership.');
    await expect(
      repository.assignGlobalRole({
        actorSubject: administratorSubject,
        membershipId: targetMembership.id,
        organizationId: organization.id,
        roleId: billingApproverRole.id,
        reason: 'Synthetic privileged role assignment rejection test.',
      }),
    ).rejects.toThrow('This global role is not available for assignment.');
    await expect(
      repository.assignGlobalRole({
        actorSubject: administratorSubject,
        membershipId: administratorMembership.id,
        organizationId: organization.id,
        roleId: receptionRole.id,
        reason: 'Synthetic self role assignment rejection test.',
      }),
    ).rejects.toThrow(
      'Administrators cannot change their own role assignments.',
    );
    await expect(
      repository.assignGlobalRole({
        actorSubject: accessAdministratorSubject,
        membershipId: targetMembership.id,
        organizationId: organization.id,
        roleId: receptionRole.id,
        reason: 'Synthetic role authority rejection test.',
      }),
    ).rejects.toThrow(
      'Workforce role-management authorization is no longer active.',
    );

    await expect(
      repository.revokeRoleAssignment({
        actorSubject: administratorSubject,
        assignmentId: assignment.assignmentId,
        organizationId: organization.id,
        reason: 'Synthetic front-desk role revocation test.',
      }),
    ).resolves.toMatchObject({
      assignmentId: assignment.assignmentId,
      roleCode: 'RECEPTION',
    });
    await expect(
      database
        .selectFrom('role_assignments')
        .select(['revoked_at', 'revoked_by_user_id', 'revocation_reason'])
        .where('id', '=', assignment.assignmentId)
        .executeTakeFirstOrThrow(),
    ).resolves.toMatchObject({
      revoked_by_user_id: administrator.id,
      revocation_reason: 'Synthetic front-desk role revocation test.',
    });
    await expect(
      database
        .selectFrom('audit_events')
        .select(['action', 'reason', 'after_data'])
        .where('target_entity_id', '=', assignment.assignmentId)
        .where('action', '=', 'identity.role_revoked')
        .executeTakeFirstOrThrow(),
    ).resolves.toMatchObject({
      action: 'identity.role_revoked',
      reason: 'Synthetic front-desk role revocation test.',
      after_data: { revoked: true },
    });
    await expect(
      repository.listRoleAssignments(tenant.id, organization.id),
    ).resolves.not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assignmentId: assignment.assignmentId }),
      ]),
    );

    const localRolePermissions = await database
      .selectFrom('permissions')
      .select(['id', 'code'])
      .where('code', 'in', ['patients.read', 'billing.approve'])
      .execute();
    const delegablePermission = localRolePermissions.find(
      (permission) => permission.code === 'patients.read',
    )!;
    const restrictedPermission = localRolePermissions.find(
      (permission) => permission.code === 'billing.approve',
    )!;
    const localRole = await repository.createTenantLocalRole({
      actorSubject: administratorSubject,
      organizationId: organization.id,
      name: 'Synthetic local registration',
      description: 'Synthetic practice-specific registration access.',
      permissionIds: [delegablePermission.id],
      reason: 'Synthetic tenant-local role creation test.',
    });
    expect(localRole).toMatchObject({
      name: 'Synthetic local registration',
      description: 'Synthetic practice-specific registration access.',
      permissions: [
        expect.objectContaining({
          permissionId: delegablePermission.id,
          code: 'patients.read',
        }),
      ],
    });
    await expect(
      database
        .selectFrom('audit_events')
        .select(['action', 'reason', 'after_data'])
        .where('target_entity_id', '=', localRole.roleId)
        .executeTakeFirstOrThrow(),
    ).resolves.toMatchObject({
      action: 'identity.tenant_local_role_created',
      reason: 'Synthetic tenant-local role creation test.',
      after_data: {
        roleName: 'Synthetic local registration',
        permissionCodes: ['patients.read'],
        requestPolicy: 'admin_only',
      },
    });
    await expect(repository.listTenantLocalRoles(tenant.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roleId: localRole.roleId,
          permissions: [
            expect.objectContaining({ permissionId: delegablePermission.id }),
          ],
        }),
      ]),
    );
    await expect(
      repository.createTenantLocalRole({
        actorSubject: administratorSubject,
        organizationId: organization.id,
        name: '  SYNTHETIC LOCAL REGISTRATION  ',
        description: 'Synthetic duplicate local role definition.',
        permissionIds: [delegablePermission.id],
        reason: 'Synthetic duplicate tenant-local role test.',
      }),
    ).rejects.toThrow('An active tenant-local role already uses this name.');
    await expect(
      repository.createTenantLocalRole({
        actorSubject: administratorSubject,
        organizationId: organization.id,
        name: 'Synthetic privileged local role',
        description: 'Synthetic restricted local role definition.',
        permissionIds: [restrictedPermission.id],
        reason: 'Synthetic restricted tenant-local role test.',
      }),
    ).rejects.toThrow(
      'Tenant-local roles can contain only active delegable permissions.',
    );
    const localAssignment = await repository.assignTenantLocalRole({
      actorSubject: administratorSubject,
      membershipId: targetMembership.id,
      organizationId: organization.id,
      roleId: localRole.roleId,
      reason: 'Synthetic tenant-local role assignment test.',
    });
    expect(localAssignment).toMatchObject({
      membershipId: targetMembership.id,
      roleId: localRole.roleId,
      roleCode: localRole.code,
    });
    await expect(
      repository.revokeRoleAssignment({
        actorSubject: administratorSubject,
        assignmentId: localAssignment.assignmentId,
        organizationId: organization.id,
        reason: 'Synthetic tenant-local role revocation test.',
      }),
    ).resolves.toMatchObject({ assignmentId: localAssignment.assignmentId });
    await expect(
      database
        .selectFrom('role_assignments')
        .select(['revoked_at', 'revocation_reason'])
        .where('id', '=', localAssignment.assignmentId)
        .executeTakeFirstOrThrow(),
    ).resolves.toMatchObject({
      revocation_reason: 'Synthetic tenant-local role revocation test.',
    });
  });

  it('prevents organization cycles', async () => {
    const tenant = await database
      .insertInto('tenants')
      .values({
        code: 'CYCLE-TEST',
        name: 'Synthetic Cycle Test',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const parent = await database
      .insertInto('organizations')
      .values({
        tenant_id: tenant.id,
        parent_organization_id: null,
        kind: 'group',
        code: 'CYCLE-PARENT',
        name: 'Synthetic Parent',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const child = await database
      .insertInto('organizations')
      .values({
        tenant_id: tenant.id,
        parent_organization_id: parent.id,
        kind: 'practice',
        code: 'CYCLE-CHILD',
        name: 'Synthetic Child',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await expect(
      database
        .updateTable('organizations')
        .set({ parent_organization_id: child.id })
        .where('id', '=', parent.id)
        .execute(),
    ).rejects.toThrow('Organization hierarchy cannot contain a cycle.');
  });

  it('binds identities by connection and subject instead of email', async () => {
    const tenant = await database
      .insertInto('tenants')
      .values({
        code: 'IDENTITY-TEST',
        name: 'Synthetic Identity Test',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const connection = await database
      .insertInto('identity_connections')
      .values({
        tenant_id: tenant.id,
        code: 'test-entra',
        name: 'Synthetic Entra',
        protocol: 'oidc',
        issuer: 'https://login.example.invalid/identity-test/v2.0',
        jit_provisioning_enabled: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const firstUser = await database
      .insertInto('application_users')
      .values({
        display_name: 'Synthetic First User',
        primary_email: 'same-email@example.invalid',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const secondUser = await database
      .insertInto('application_users')
      .values({
        display_name: 'Synthetic Second User',
        primary_email: 'same-email@example.invalid',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await database
      .insertInto('user_identities')
      .values({
        application_user_id: firstUser.id,
        identity_connection_id: connection.id,
        subject: 'immutable-subject',
        last_authenticated_at: null,
      })
      .execute();

    await expect(
      database
        .insertInto('user_identities')
        .values({
          application_user_id: secondUser.id,
          identity_connection_id: connection.id,
          subject: 'immutable-subject',
          last_authenticated_at: null,
        })
        .execute(),
    ).rejects.toThrow();
  });

  it('rejects a tenant-local role outside its tenant', async () => {
    const tenants = await database
      .selectFrom('tenants')
      .select('id')
      .where('code', 'in', ['TENANT-A', 'TENANT-B'])
      .orderBy('code')
      .execute();
    const membership = await database
      .selectFrom('organization_memberships')
      .select(['id', 'tenant_id', 'organization_id', 'application_user_id'])
      .where('tenant_id', '=', tenants[1].id)
      .executeTakeFirstOrThrow();
    const localRole = await database
      .insertInto('roles')
      .values({
        tenant_id: tenants[0].id,
        code: 'LOCAL_ROLE',
        name: 'Synthetic Local Role',
        description: 'Synthetic local-role boundary test.',
        is_system_template: false,
        request_policy: 'approval_required',
        cloned_from_role_id: null,
        created_by_user_id: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await expect(
      database
        .insertInto('role_assignments')
        .values({
          tenant_id: membership.tenant_id,
          membership_id: membership.id,
          role_id: localRole.id,
          scope_organization_id: membership.organization_id,
          facility_id: null,
          include_descendants: false,
          assignment_source: 'admin',
          assigned_by_user_id: membership.application_user_id,
          source_role_request_id: null,
          valid_until: null,
          revoked_at: null,
          revoked_by_user_id: null,
          revocation_reason: null,
        })
        .execute(),
    ).rejects.toThrow('Tenant-local role cannot be used outside its tenant.');
  });

  it('enforces requestable roles and prevents self-approval', async () => {
    const membership = await database
      .selectFrom('organization_memberships')
      .innerJoin('tenants', 'tenants.id', 'organization_memberships.tenant_id')
      .select([
        'organization_memberships.id',
        'organization_memberships.tenant_id',
        'organization_memberships.organization_id',
        'organization_memberships.application_user_id',
      ])
      .where('tenants.code', '=', 'TENANT-A')
      .executeTakeFirstOrThrow();
    const roles = await database
      .selectFrom('roles')
      .select(['id', 'code'])
      .where('code', 'in', ['PRACTICE_ADMIN', 'RECEPTION'])
      .execute();
    const practiceAdmin = roles.find(({ code }) => code === 'PRACTICE_ADMIN')!;
    const reception = roles.find(({ code }) => code === 'RECEPTION')!;

    await expect(
      database
        .insertInto('role_requests')
        .values({
          tenant_id: membership.tenant_id,
          membership_id: membership.id,
          role_id: practiceAdmin.id,
          scope_organization_id: membership.organization_id,
          facility_id: null,
          include_descendants: false,
          requested_by_user_id: membership.application_user_id,
          request_reason: 'Synthetic restricted-role request.',
          decided_by_user_id: null,
          decision_reason: null,
          decided_at: null,
        })
        .execute(),
    ).rejects.toThrow('This role is restricted to administrator assignment.');

    const request = await database
      .insertInto('role_requests')
      .values({
        tenant_id: membership.tenant_id,
        membership_id: membership.id,
        role_id: reception.id,
        scope_organization_id: membership.organization_id,
        facility_id: null,
        include_descendants: false,
        requested_by_user_id: membership.application_user_id,
        request_reason: 'Synthetic requestable-role request.',
        decided_by_user_id: null,
        decision_reason: null,
        decided_at: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await expect(
      database
        .updateTable('role_requests')
        .set({
          status: 'approved',
          decided_by_user_id: membership.application_user_id,
          decision_reason: 'Synthetic self-approval must fail.',
          decided_at: new Date(),
        })
        .where('id', '=', request.id)
        .execute(),
    ).rejects.toThrow();
  });

  it('keeps committed audit events append-only', async () => {
    const auditEvent = await database
      .insertInto('audit_events')
      .values({
        actor_type: 'system',
        actor_identifier: 'migration-integration-test',
        actor_user_id: null,
        effective_user_id: null,
        tenant_id: null,
        organization_id: null,
        facility_id: null,
        action: 'schema.append_only_verified',
        target_entity_type: 'migration',
        target_entity_id: '2026-08-24T000000',
        outcome: 'success',
        correlation_id: 'aaaaaaaa-0000-4000-8000-000000000001',
        reason: 'Verify append-only database enforcement.',
        before_data: null,
        after_data: { verified: true },
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await expect(
      database
        .updateTable('audit_events')
        .set({ reason: 'Mutation must fail.' })
        .where('id', '=', auditEvent.id)
        .execute(),
    ).rejects.toThrow('Committed audit events are append-only.');

    await expect(
      database
        .deleteFrom('audit_events')
        .where('id', '=', auditEvent.id)
        .execute(),
    ).rejects.toThrow('Committed audit events are append-only.');

    await expect(
      sql`truncate table audit_events`.execute(database),
    ).rejects.toThrow('Committed audit events are append-only.');
  });
});

describeWithDatabase(
  'synthetic provider appointment backfill migration',
  () => {
    const providerColumnNames = [
      'facility_id',
      'practitioner_facility_assignment_id',
      'practitioner_service_assignment_id',
      'practitioner_id',
      'appointment_service_id',
    ] as const;
    const slotProviderColumnNames = [
      ...providerColumnNames,
      'availability_template_id',
      'generation_key_hash',
      'source_local_date',
      'source_timezone',
    ] as const;

    const slotGenerationHash = (
      templateId: string,
      sourceLocalDate: string,
      startsAt: Date,
      endsAt: Date,
    ): string =>
      createHash('sha256')
        .update(
          [
            'uae-health:synthetic-provider-slot:v1',
            templateId,
            sourceLocalDate,
            Math.floor(startsAt.getTime() / 1_000),
            Math.floor(endsAt.getTime() / 1_000),
          ].join('|'),
        )
        .digest('hex');

    const readProviderNullability = async (
      database: Kysely<DatabaseSchema>,
    ) => {
      const result = await sql<{
        table_name: string;
        column_name: string;
        is_nullable: 'YES' | 'NO';
      }>`
      select table_name, column_name, is_nullable
      from information_schema.columns
      where table_schema = current_schema()
        and (
          (
            table_name = 'patient_portal_appointment_slots'
            and column_name in (
              'facility_id',
              'practitioner_facility_assignment_id',
              'practitioner_service_assignment_id',
              'practitioner_id',
              'appointment_service_id',
              'availability_template_id',
              'generation_key_hash',
              'source_local_date',
              'source_timezone'
            )
          )
          or (
            table_name = 'patient_portal_appointments'
            and column_name in (
              'facility_id',
              'practitioner_facility_assignment_id',
              'practitioner_service_assignment_id',
              'practitioner_id',
              'appointment_service_id'
            )
          )
        )
      order by table_name, column_name
    `.execute(database);

      return result.rows;
    };

    const readLegacySchedulingState = async (
      database: Kysely<DatabaseSchema>,
    ) => ({
      slots: await database
        .selectFrom('patient_portal_appointment_slots')
        .select([
          'id',
          'bookable_practice_id',
          'tenant_id',
          'organization_id',
          'starts_at',
          'ends_at',
          'status',
          'is_synthetic',
        ])
        .orderBy('id')
        .execute(),
      appointments: await database
        .selectFrom('patient_portal_appointments')
        .select([
          'id',
          'tenant_id',
          'organization_id',
          'patient_portal_identity_id',
          'patient_portal_profile_id',
          'patient_portal_appointment_relationship_id',
          'appointment_slot_id',
          'status',
          'version',
          'cancelled_at',
        ])
        .orderBy('id')
        .execute(),
    });

    it('backfills deterministic exact provider scope and reverses safely before later writes', async () => {
      let isolated: IsolatedMigrationDatabase | undefined;

      try {
        isolated = await createProviderBackfillTestDatabase('success');
        const { database } = isolated;
        const fixture = providerBackfillFixture;
        await insertSyntheticProviderBackfillFixture(database);
        const legacyState = await readLegacySchedulingState(database);
        const nullableBefore = await readProviderNullability(database);
        expect(nullableBefore).toHaveLength(14);
        expect(
          nullableBefore.every((column) => column.is_nullable === 'YES'),
        ).toBe(true);

        await database
          .transaction()
          .execute((transaction) =>
            backfillSyntheticProviderAppointments.up(transaction),
          );

        const deterministicMissingFacilityId = syntheticProviderFixtureId(
          'facility',
          fixture.bookablePractices.missingFacility,
        );
        const deterministicExistingFacilityId = syntheticProviderFixtureId(
          'facility',
          fixture.bookablePractices.deterministicFacility,
        );
        const expectedPractices = [
          {
            bookablePracticeId: fixture.bookablePractices.missingFacility,
            organizationId: fixture.practices.missingFacility,
            facilityId: deterministicMissingFacilityId,
            durationMinutes: 30,
          },
          {
            bookablePracticeId: fixture.bookablePractices.singleFacility,
            organizationId: fixture.practices.singleFacility,
            facilityId: fixture.facilities.single,
            durationMinutes: 45,
          },
          {
            bookablePracticeId: fixture.bookablePractices.deterministicFacility,
            organizationId: fixture.practices.deterministicFacility,
            facilityId: deterministicExistingFacilityId,
            durationMinutes: 30,
          },
          {
            bookablePracticeId: fixture.bookablePractices.noSlots,
            organizationId: fixture.practices.noSlots,
            facilityId: fixture.facilities.noSlots,
            durationMinutes: 30,
          },
        ];

        for (const expected of expectedPractices) {
          const practitionerId = syntheticProviderFixtureId(
            'practitioner',
            expected.bookablePracticeId,
          );
          const specialtyId = syntheticProviderFixtureId(
            'specialty',
            expected.bookablePracticeId,
          );
          const facilityAssignmentId = syntheticProviderFixtureId(
            'practitioner-facility-assignment',
            expected.bookablePracticeId,
          );
          const appointmentServiceId = syntheticProviderFixtureId(
            'appointment-service',
            expected.bookablePracticeId,
          );
          const serviceAssignmentId = syntheticProviderFixtureId(
            'practitioner-service-assignment',
            expected.bookablePracticeId,
          );

          await expect(
            database
              .selectFrom('practitioners')
              .select([
                'tenant_id',
                'application_user_id',
                'display_name',
                'professional_title',
                'status',
                'is_synthetic',
              ])
              .where('id', '=', practitionerId)
              .executeTakeFirstOrThrow(),
          ).resolves.toEqual({
            tenant_id: fixture.tenantId,
            application_user_id: null,
            display_name: 'Synthetic Physician',
            professional_title: 'General physician',
            status: 'active',
            is_synthetic: true,
          });
          await expect(
            database
              .selectFrom('specialties')
              .select([
                'tenant_id',
                'organization_id',
                'code',
                'name',
                'status',
                'is_synthetic',
              ])
              .where('id', '=', specialtyId)
              .executeTakeFirstOrThrow(),
          ).resolves.toEqual({
            tenant_id: fixture.tenantId,
            organization_id: expected.organizationId,
            code: 'GENERAL-MEDICINE',
            name: 'General medicine',
            status: 'active',
            is_synthetic: true,
          });
          await expect(
            database
              .selectFrom('practitioner_facility_assignments')
              .select([
                'tenant_id',
                'organization_id',
                'facility_id',
                'practitioner_id',
                'status',
                'is_synthetic',
              ])
              .where('id', '=', facilityAssignmentId)
              .executeTakeFirstOrThrow(),
          ).resolves.toEqual({
            tenant_id: fixture.tenantId,
            organization_id: expected.organizationId,
            facility_id: expected.facilityId,
            practitioner_id: practitionerId,
            status: 'active',
            is_synthetic: true,
          });
          await expect(
            database
              .selectFrom('appointment_services')
              .select([
                'tenant_id',
                'organization_id',
                'facility_id',
                'specialty_id',
                'code',
                'patient_facing_name',
                'duration_minutes',
                'allows_any_practitioner',
                'status',
                'is_synthetic',
              ])
              .where('id', '=', appointmentServiceId)
              .executeTakeFirstOrThrow(),
          ).resolves.toEqual({
            tenant_id: fixture.tenantId,
            organization_id: expected.organizationId,
            facility_id: expected.facilityId,
            specialty_id: specialtyId,
            code: 'GENERAL-CONSULTATION',
            patient_facing_name: 'General consultation',
            duration_minutes: expected.durationMinutes,
            allows_any_practitioner: true,
            status: 'active',
            is_synthetic: true,
          });
          await expect(
            database
              .selectFrom('practitioner_service_assignments')
              .select([
                'tenant_id',
                'organization_id',
                'facility_id',
                'practitioner_facility_assignment_id',
                'practitioner_id',
                'appointment_service_id',
                'status',
                'is_synthetic',
              ])
              .where('id', '=', serviceAssignmentId)
              .executeTakeFirstOrThrow(),
          ).resolves.toEqual({
            tenant_id: fixture.tenantId,
            organization_id: expected.organizationId,
            facility_id: expected.facilityId,
            practitioner_facility_assignment_id: facilityAssignmentId,
            practitioner_id: practitionerId,
            appointment_service_id: appointmentServiceId,
            status: 'active',
            is_synthetic: true,
          });
        }

        const missingFacility = await database
          .selectFrom('facilities')
          .select(['tenant_id', 'organization_id', 'code', 'name', 'timezone'])
          .where('id', '=', deterministicMissingFacilityId)
          .executeTakeFirstOrThrow();
        expect(missingFacility).toEqual({
          tenant_id: fixture.tenantId,
          organization_id: fixture.practices.missingFacility,
          code: `SYN-${deterministicMissingFacilityId
            .replaceAll('-', '')
            .slice(-28)
            .toUpperCase()}`,
          name: 'Synthetic Appointment Centre',
          timezone: 'Asia/Dubai',
        });
        await expect(
          database
            .selectFrom('practitioner_facility_assignments')
            .select('facility_id')
            .where(
              'id',
              '=',
              syntheticProviderFixtureId(
                'practitioner-facility-assignment',
                fixture.bookablePractices.deterministicFacility,
              ),
            )
            .executeTakeFirstOrThrow(),
        ).resolves.toEqual({ facility_id: deterministicExistingFacilityId });

        const expectedTemplates = [
          {
            bookablePracticeId: fixture.bookablePractices.missingFacility,
            organizationId: fixture.practices.missingFacility,
            facilityId: deterministicMissingFacilityId,
            isoWeekday: 1,
            startMinute: 540,
            endMinute: 570,
          },
          {
            bookablePracticeId: fixture.bookablePractices.singleFacility,
            organizationId: fixture.practices.singleFacility,
            facilityId: fixture.facilities.single,
            isoWeekday: 2,
            startMinute: 600,
            endMinute: 645,
          },
          {
            bookablePracticeId: fixture.bookablePractices.deterministicFacility,
            organizationId: fixture.practices.deterministicFacility,
            facilityId: deterministicExistingFacilityId,
            isoWeekday: 3,
            startMinute: 1410,
            endMinute: 1440,
          },
        ].map((template) => ({
          ...template,
          id: syntheticProviderFixtureId(
            'availability-template',
            [
              template.bookablePracticeId,
              template.isoWeekday,
              template.startMinute,
              template.endMinute,
              'Asia/Dubai',
            ].join('|'),
          ),
        }));
        const templates = await database
          .selectFrom('practitioner_availability_templates')
          .select([
            'id',
            'organization_id',
            'facility_id',
            'iso_weekday',
            'local_start_minute',
            'local_end_minute',
            'effective_until',
            'source_timezone',
            'status',
            sql<string>`effective_from::text`.as('effective_from'),
          ])
          .orderBy('id')
          .execute();
        expect(templates).toHaveLength(3);
        expect(templates).toEqual(
          expectedTemplates
            .map((template) => ({
              id: template.id,
              organization_id: template.organizationId,
              facility_id: template.facilityId,
              iso_weekday: template.isoWeekday,
              local_start_minute: template.startMinute,
              local_end_minute: template.endMinute,
              effective_from: '2020-01-01',
              effective_until: null,
              source_timezone: 'Asia/Dubai',
              status: 'active',
            }))
            .sort((left, right) => left.id.localeCompare(right.id)),
        );

        const templateByBookablePractice = new Map(
          expectedTemplates.map((template) => [
            template.bookablePracticeId,
            template.id,
          ]),
        );
        const slotsAfter = await database
          .selectFrom('patient_portal_appointment_slots')
          .selectAll()
          .select(
            sql<string>`source_local_date::text`.as('source_local_date_text'),
          )
          .orderBy('id')
          .execute();
        const sourceLocalDateBySlotId = new Map([
          [fixture.slots.referenced, '2035-01-08'],
          [fixture.slots.repeatedWindow, '2035-01-15'],
          [fixture.slots.cancelledAppointment, '2035-01-09'],
          [fixture.slots.deterministicFacility, '2035-01-10'],
        ]);
        for (const slot of slotsAfter) {
          const expectedPractice = expectedPractices.find(
            (practice) =>
              practice.bookablePracticeId === slot.bookable_practice_id,
          );
          expect(expectedPractice).toBeDefined();
          const templateId = templateByBookablePractice.get(
            slot.bookable_practice_id,
          );
          expect(templateId).toBeDefined();
          const sourceLocalDate = sourceLocalDateBySlotId.get(slot.id);
          expect(sourceLocalDate).toBeDefined();
          expect(slot).toMatchObject({
            facility_id: expectedPractice!.facilityId,
            practitioner_facility_assignment_id: syntheticProviderFixtureId(
              'practitioner-facility-assignment',
              slot.bookable_practice_id,
            ),
            practitioner_service_assignment_id: syntheticProviderFixtureId(
              'practitioner-service-assignment',
              slot.bookable_practice_id,
            ),
            practitioner_id: syntheticProviderFixtureId(
              'practitioner',
              slot.bookable_practice_id,
            ),
            appointment_service_id: syntheticProviderFixtureId(
              'appointment-service',
              slot.bookable_practice_id,
            ),
            availability_template_id: templateId,
            source_local_date_text: sourceLocalDate,
            source_timezone: 'Asia/Dubai',
            generation_key_hash: slotGenerationHash(
              templateId!,
              sourceLocalDate,
              slot.starts_at,
              slot.ends_at,
            ),
          });
        }
        expect(
          slotsAfter
            .filter(
              (slot) =>
                slot.bookable_practice_id ===
                fixture.bookablePractices.missingFacility,
            )
            .map((slot) => slot.availability_template_id),
        ).toEqual([
          templateByBookablePractice.get(
            fixture.bookablePractices.missingFacility,
          ),
          templateByBookablePractice.get(
            fixture.bookablePractices.missingFacility,
          ),
        ]);

        const appointmentsAfter = await database
          .selectFrom('patient_portal_appointments')
          .innerJoin(
            'patient_portal_appointment_slots as slot',
            'slot.id',
            'patient_portal_appointments.appointment_slot_id',
          )
          .select([
            'patient_portal_appointments.id as id',
            'patient_portal_appointments.facility_id as facility_id',
            'patient_portal_appointments.practitioner_facility_assignment_id as practitioner_facility_assignment_id',
            'patient_portal_appointments.practitioner_service_assignment_id as practitioner_service_assignment_id',
            'patient_portal_appointments.practitioner_id as practitioner_id',
            'patient_portal_appointments.appointment_service_id as appointment_service_id',
            'slot.facility_id as slot_facility_id',
            'slot.practitioner_facility_assignment_id as slot_practitioner_facility_assignment_id',
            'slot.practitioner_service_assignment_id as slot_practitioner_service_assignment_id',
            'slot.practitioner_id as slot_practitioner_id',
            'slot.appointment_service_id as slot_appointment_service_id',
          ])
          .orderBy('patient_portal_appointments.id')
          .execute();
        expect(appointmentsAfter).toHaveLength(2);
        for (const appointment of appointmentsAfter) {
          expect(appointment).toMatchObject({
            facility_id: appointment.slot_facility_id,
            practitioner_facility_assignment_id:
              appointment.slot_practitioner_facility_assignment_id,
            practitioner_service_assignment_id:
              appointment.slot_practitioner_service_assignment_id,
            practitioner_id: appointment.slot_practitioner_id,
            appointment_service_id: appointment.slot_appointment_service_id,
          });
        }
        expect(await readLegacySchedulingState(database)).toEqual(legacyState);

        const nullProviderRows = await sql<{ count: string }>`
          select count(*)::text as count
          from patient_portal_appointment_slots
          where num_nonnulls(
            facility_id,
            practitioner_facility_assignment_id,
            practitioner_service_assignment_id,
            practitioner_id,
            appointment_service_id,
            availability_template_id,
            generation_key_hash,
            source_local_date,
            source_timezone
          ) <> 9
        `.execute(database);
        expect(nullProviderRows.rows[0]?.count).toBe('0');
        const nullAppointmentProviderRows = await sql<{ count: string }>`
          select count(*)::text as count
          from patient_portal_appointments
          where num_nonnulls(
            facility_id,
            practitioner_facility_assignment_id,
            practitioner_service_assignment_id,
            practitioner_id,
            appointment_service_id
          ) <> 5
        `.execute(database);
        expect(nullAppointmentProviderRows.rows[0]?.count).toBe('0');
        const requiredAfter = await readProviderNullability(database);
        expect(requiredAfter).toHaveLength(14);
        expect(
          requiredAfter.every((column) => column.is_nullable === 'NO'),
        ).toBe(true);
        const manifestCounts = await sql<{
          practices: string;
          templates: string;
          slots: string;
          appointments: string;
          generic_index: string | null;
        }>`
          select
            (select count(*)::text from provider_scheduling_backfill_practices)
              as practices,
            (select count(*)::text from provider_scheduling_backfill_templates)
              as templates,
            (select count(*)::text from provider_scheduling_backfill_slots)
              as slots,
            (select count(*)::text from provider_scheduling_backfill_appointments)
              as appointments,
            to_regclass(
              current_schema()
              || '.pp_appointment_slots_generic_practice_start_unique'
            )::text as generic_index
        `.execute(database);
        expect(manifestCounts.rows).toEqual([
          {
            practices: '4',
            templates: '3',
            slots: '4',
            appointments: '2',
            generic_index: null,
          },
        ]);

        const firstBackfillIdentity = {
          providers: await database
            .selectFrom('practitioners')
            .select('id')
            .orderBy('id')
            .execute(),
          templates: slotsAfter.map((slot) => ({
            id: slot.availability_template_id,
            generationKey: slot.generation_key_hash,
          })),
        };
        await database
          .transaction()
          .execute((transaction) =>
            backfillSyntheticProviderAppointments.down(transaction),
          );

        expect(await readLegacySchedulingState(database)).toEqual(legacyState);
        const slotsAfterDown = await database
          .selectFrom('patient_portal_appointment_slots')
          .select(slotProviderColumnNames)
          .execute();
        expect(
          slotsAfterDown.every((slot) =>
            slotProviderColumnNames.every((column) => slot[column] === null),
          ),
        ).toBe(true);
        const appointmentsAfterDown = await database
          .selectFrom('patient_portal_appointments')
          .select(providerColumnNames)
          .execute();
        expect(
          appointmentsAfterDown.every((appointment) =>
            providerColumnNames.every((column) => appointment[column] === null),
          ),
        ).toBe(true);
        expect(
          (await readProviderNullability(database)).every(
            (column) => column.is_nullable === 'YES',
          ),
        ).toBe(true);
        const rollbackObjects = await sql<{
          manifest: string | null;
          generic_index: string | null;
        }>`
          select
            to_regclass(
              current_schema() || '.provider_scheduling_backfill_runs'
            )::text as manifest,
            to_regclass(
              current_schema()
              || '.pp_appointment_slots_generic_practice_start_unique'
            )::text as generic_index
        `.execute(database);
        expect(rollbackObjects.rows).toEqual([
          {
            manifest: null,
            generic_index: 'pp_appointment_slots_generic_practice_start_unique',
          },
        ]);
        await expect(
          database
            .selectFrom('facilities')
            .select('id')
            .where('id', '=', deterministicMissingFacilityId)
            .executeTakeFirst(),
        ).resolves.toBeUndefined();
        await expect(
          database
            .selectFrom('facilities')
            .select('id')
            .where('id', 'in', [
              fixture.facilities.single,
              deterministicExistingFacilityId,
              fixture.facilities.additional,
              fixture.facilities.noSlots,
            ])
            .execute(),
        ).resolves.toHaveLength(4);
        await expect(
          database.selectFrom('practitioners').select('id').execute(),
        ).resolves.toHaveLength(0);
        await expect(
          database
            .selectFrom('practitioner_availability_templates')
            .select('id')
            .execute(),
        ).resolves.toHaveLength(0);

        await database
          .transaction()
          .execute((transaction) =>
            backfillSyntheticProviderAppointments.up(transaction),
          );
        const rerunSlots = await database
          .selectFrom('patient_portal_appointment_slots')
          .select(['availability_template_id', 'generation_key_hash'])
          .orderBy('id')
          .execute();
        expect({
          providers: await database
            .selectFrom('practitioners')
            .select('id')
            .orderBy('id')
            .execute(),
          templates: rerunSlots.map((slot) => ({
            id: slot.availability_template_id,
            generationKey: slot.generation_key_hash,
          })),
        }).toEqual(firstBackfillIdentity);
        expect(await readLegacySchedulingState(database)).toEqual(legacyState);
      } finally {
        if (isolated) {
          await destroyProviderBackfillTestDatabase(isolated);
        }
      }
    }, 30_000);

    it('refuses rollback after a later provider-aware slot is written', async () => {
      let isolated: IsolatedMigrationDatabase | undefined;

      try {
        isolated = await createProviderBackfillTestDatabase('forward_only');
        const { database } = isolated;
        await insertSyntheticProviderBackfillFixture(database);
        await database
          .transaction()
          .execute((transaction) =>
            backfillSyntheticProviderAppointments.up(transaction),
          );
        const reference = await database
          .selectFrom('patient_portal_appointment_slots')
          .select(slotProviderColumnNames)
          .where('id', '=', providerBackfillFixture.slots.referenced)
          .executeTakeFirstOrThrow();
        const laterStartsAt = new Date('2036-01-07T05:00:00.000Z');
        const laterEndsAt = new Date('2036-01-07T05:30:00.000Z');
        const laterSourceDate = '2036-01-07';
        const laterSlot = await database
          .insertInto('patient_portal_appointment_slots')
          .values({
            bookable_practice_id:
              providerBackfillFixture.bookablePractices.missingFacility,
            tenant_id: providerBackfillFixture.tenantId,
            organization_id: providerBackfillFixture.practices.missingFacility,
            ...reference,
            generation_key_hash: slotGenerationHash(
              reference.availability_template_id!,
              laterSourceDate,
              laterStartsAt,
              laterEndsAt,
            ),
            source_local_date: laterSourceDate,
            starts_at: laterStartsAt,
            ends_at: laterEndsAt,
            status: 'available',
            is_synthetic: true,
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        await expect(
          database
            .transaction()
            .execute((transaction) =>
              backfillSyntheticProviderAppointments.down(transaction),
            ),
        ).rejects.toThrow(/forward-only|later provider-aware/i);
        await expect(
          database
            .selectFrom('patient_portal_appointment_slots')
            .select(slotProviderColumnNames)
            .select(
              sql<string>`source_local_date::text`.as('source_local_date_text'),
            )
            .where('id', '=', laterSlot.id)
            .executeTakeFirstOrThrow(),
        ).resolves.toMatchObject({
          facility_id: reference.facility_id,
          practitioner_facility_assignment_id:
            reference.practitioner_facility_assignment_id,
          practitioner_service_assignment_id:
            reference.practitioner_service_assignment_id,
          practitioner_id: reference.practitioner_id,
          appointment_service_id: reference.appointment_service_id,
          availability_template_id: reference.availability_template_id,
          generation_key_hash: slotGenerationHash(
            reference.availability_template_id!,
            laterSourceDate,
            laterStartsAt,
            laterEndsAt,
          ),
          source_local_date_text: laterSourceDate,
          source_timezone: reference.source_timezone,
        });
        expect(
          (await readProviderNullability(database)).every(
            (column) => column.is_nullable === 'NO',
          ),
        ).toBe(true);
      } finally {
        if (isolated) {
          await destroyProviderBackfillTestDatabase(isolated);
        }
      }
    }, 30_000);

    it('refuses rollback after an equivalent provider-aware seed update', async () => {
      let isolated: IsolatedMigrationDatabase | undefined;

      try {
        isolated = await createProviderBackfillTestDatabase('seed_update');
        const { database } = isolated;
        const fixture = providerBackfillFixture;
        await insertSyntheticProviderBackfillFixture(database);
        await database
          .transaction()
          .execute((transaction) =>
            backfillSyntheticProviderAppointments.up(transaction),
          );

        const updatedAt = new Date('2040-01-01T00:00:00.000Z');
        await database
          .updateTable('appointment_services')
          .set({
            patient_facing_name: 'General consultation',
            updated_at: updatedAt,
          })
          .where(
            'id',
            '=',
            syntheticProviderFixtureId(
              'appointment-service',
              fixture.bookablePractices.missingFacility,
            ),
          )
          .executeTakeFirstOrThrow();
        await database
          .updateTable('patient_portal_appointment_slots')
          .set({ is_synthetic: true, updated_at: updatedAt })
          .where('id', '=', fixture.slots.referenced)
          .executeTakeFirstOrThrow();

        await expect(
          database
            .transaction()
            .execute((transaction) =>
              backfillSyntheticProviderAppointments.down(transaction),
            ),
        ).rejects.toThrow(/forward-only|changed synthetic provider fixtures/i);
        expect(
          (await readProviderNullability(database)).every(
            (column) => column.is_nullable === 'NO',
          ),
        ).toBe(true);
      } finally {
        if (isolated) {
          await destroyProviderBackfillTestDatabase(isolated);
        }
      }
    }, 30_000);

    it('fails closed when facility ownership is ambiguous', async () => {
      let isolated: IsolatedMigrationDatabase | undefined;

      try {
        isolated = await createProviderBackfillTestDatabase('ambiguous');
        const { database } = isolated;
        const fixture = providerBackfillFixture;
        await insertSyntheticProviderBackfillFixture(database);
        const deterministicFacilityId = syntheticProviderFixtureId(
          'facility',
          fixture.bookablePractices.deterministicFacility,
        );
        await database
          .deleteFrom('facilities')
          .where('id', '=', deterministicFacilityId)
          .execute();
        await database
          .insertInto('facilities')
          .values({
            tenant_id: fixture.tenantId,
            organization_id: fixture.practices.deterministicFacility,
            code: 'BACKFILL-FACILITY-AMBIGUOUS',
            name: 'Synthetic Ambiguous Backfill Facility',
            timezone: 'Asia/Dubai',
            is_synthetic: true,
          })
          .execute();
        const legacyState = await readLegacySchedulingState(database);

        await expect(
          database
            .transaction()
            .execute((transaction) =>
              backfillSyntheticProviderAppointments.up(transaction),
            ),
        ).rejects.toThrow(/ambiguous|multiple synthetic facilities/i);
        expect(await readLegacySchedulingState(database)).toEqual(legacyState);
        await expect(
          database.selectFrom('practitioners').select('id').execute(),
        ).resolves.toHaveLength(0);
        await expect(
          database
            .selectFrom('facilities')
            .select('id')
            .where(
              'id',
              '=',
              syntheticProviderFixtureId(
                'facility',
                fixture.bookablePractices.missingFacility,
              ),
            )
            .executeTakeFirst(),
        ).resolves.toBeUndefined();
        expect(
          (await readProviderNullability(database)).every(
            (column) => column.is_nullable === 'YES',
          ),
        ).toBe(true);
      } finally {
        if (isolated) {
          await destroyProviderBackfillTestDatabase(isolated);
        }
      }
    }, 30_000);

    it('fails closed when a synthetic practice has only a non-synthetic facility', async () => {
      let isolated: IsolatedMigrationDatabase | undefined;

      try {
        isolated = await createProviderBackfillTestDatabase(
          'non_synthetic_facility',
        );
        const { database } = isolated;
        const fixture = providerBackfillFixture;
        await insertSyntheticProviderBackfillFixture(database);
        await database
          .deleteFrom('facilities')
          .where('id', '=', fixture.facilities.noSlots)
          .execute();
        await database
          .insertInto('facilities')
          .values({
            id: fixture.facilities.noSlots,
            tenant_id: fixture.tenantId,
            organization_id: fixture.practices.noSlots,
            code: 'BACKFILL-NON-SYNTHETIC-FACILITY',
            name: 'Unsupported Non-synthetic Facility',
            timezone: 'Asia/Dubai',
            is_synthetic: false,
          })
          .execute();
        const legacyState = await readLegacySchedulingState(database);

        await expect(
          database
            .transaction()
            .execute((transaction) =>
              backfillSyntheticProviderAppointments.up(transaction),
            ),
        ).rejects.toThrow(/cannot select a non-synthetic facility/i);
        expect(await readLegacySchedulingState(database)).toEqual(legacyState);
        await expect(
          database.selectFrom('practitioners').select('id').execute(),
        ).resolves.toHaveLength(0);
        await expect(
          database
            .selectFrom('facilities')
            .select('id')
            .where(
              'id',
              '=',
              syntheticProviderFixtureId(
                'facility',
                fixture.bookablePractices.missingFacility,
              ),
            )
            .executeTakeFirst(),
        ).resolves.toBeUndefined();
        expect(
          (await readProviderNullability(database)).every(
            (column) => column.is_nullable === 'YES',
          ),
        ).toBe(true);
      } finally {
        if (isolated) {
          await destroyProviderBackfillTestDatabase(isolated);
        }
      }
    }, 30_000);

    it('fails closed when the selected facility timezone differs from the bookable practice', async () => {
      let isolated: IsolatedMigrationDatabase | undefined;

      try {
        isolated = await createProviderBackfillTestDatabase(
          'facility_timezone_mismatch',
        );
        const { database } = isolated;
        const fixture = providerBackfillFixture;
        await insertSyntheticProviderBackfillFixture(database);
        await database
          .updateTable('facilities')
          .set({ timezone: 'Asia/Singapore' })
          .where('id', '=', fixture.facilities.single)
          .execute();
        const legacyState = await readLegacySchedulingState(database);

        await expect(
          database
            .transaction()
            .execute((transaction) =>
              backfillSyntheticProviderAppointments.up(transaction),
            ),
        ).rejects.toThrow(
          /matching facility and bookable timezones|facility.*bookable.*timezone/i,
        );
        expect(await readLegacySchedulingState(database)).toEqual(legacyState);
        await expect(
          database.selectFrom('practitioners').select('id').execute(),
        ).resolves.toHaveLength(0);
        await expect(
          database
            .selectFrom('facilities')
            .select('id')
            .where(
              'id',
              '=',
              syntheticProviderFixtureId(
                'facility',
                fixture.bookablePractices.missingFacility,
              ),
            )
            .executeTakeFirst(),
        ).resolves.toBeUndefined();
        expect(
          (await readProviderNullability(database)).every(
            (column) => column.is_nullable === 'YES',
          ),
        ).toBe(true);
      } finally {
        if (isolated) {
          await destroyProviderBackfillTestDatabase(isolated);
        }
      }
    }, 30_000);

    it('fails closed when one synthetic practice has mixed slot durations', async () => {
      let isolated: IsolatedMigrationDatabase | undefined;

      try {
        isolated = await createProviderBackfillTestDatabase('mixed_duration');
        const { database } = isolated;
        const fixture = providerBackfillFixture;
        await insertSyntheticProviderBackfillFixture(database);
        await database
          .insertInto('patient_portal_appointment_slots')
          .values({
            id: 'ba500000-0000-4000-8000-000000000005',
            bookable_practice_id: fixture.bookablePractices.missingFacility,
            tenant_id: fixture.tenantId,
            organization_id: fixture.practices.missingFacility,
            starts_at: new Date('2035-01-22T05:00:00.000Z'),
            ends_at: new Date('2035-01-22T05:45:00.000Z'),
            status: 'available',
            is_synthetic: true,
          })
          .execute();
        const legacyState = await readLegacySchedulingState(database);

        await expect(
          database
            .transaction()
            .execute((transaction) =>
              backfillSyntheticProviderAppointments.up(transaction),
            ),
        ).rejects.toThrow(/duration|mixed/i);
        expect(await readLegacySchedulingState(database)).toEqual(legacyState);
        await expect(
          database.selectFrom('practitioners').select('id').execute(),
        ).resolves.toHaveLength(0);
        expect(
          (await readProviderNullability(database)).every(
            (column) => column.is_nullable === 'YES',
          ),
        ).toBe(true);
      } finally {
        if (isolated) {
          await destroyProviderBackfillTestDatabase(isolated);
        }
      }
    }, 30_000);

    it('fails closed for a non-synthetic generic slot without partial backfill', async () => {
      let isolated: IsolatedMigrationDatabase | undefined;

      try {
        isolated = await createProviderBackfillTestDatabase('unsupported');
        const { database } = isolated;
        await insertSyntheticProviderBackfillFixture(database);
        await database
          .updateTable('patient_portal_appointment_slots')
          .set({ is_synthetic: false })
          .where('id', '=', providerBackfillFixture.slots.referenced)
          .execute();
        const legacyState = await readLegacySchedulingState(database);

        await expect(
          database
            .transaction()
            .execute((transaction) =>
              backfillSyntheticProviderAppointments.up(transaction),
            ),
        ).rejects.toThrow(
          /accepts only synthetic practice slots|non-synthetic|unsupported/i,
        );
        expect(await readLegacySchedulingState(database)).toEqual(legacyState);
        await expect(
          database.selectFrom('practitioners').select('id').execute(),
        ).resolves.toHaveLength(0);
        expect(
          (await readProviderNullability(database)).every(
            (column) => column.is_nullable === 'YES',
          ),
        ).toBe(true);
      } finally {
        if (isolated) {
          await destroyProviderBackfillTestDatabase(isolated);
        }
      }
    }, 30_000);
  },
);
