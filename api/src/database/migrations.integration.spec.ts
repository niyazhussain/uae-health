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
import { PatientPortalProfileLinkService } from '../patient-portal-auth/patient-portal-profile-link.service.js';
import { PatientPortalRegistrationService } from '../patient-portal-auth/patient-portal-registration.service.js';
import { PatientPortalSessionService } from '../patient-portal-auth/patient-portal-session.service.js';

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

describeWithDatabase('identity, authorization, and audit migrations', () => {
  const schemaName = `identity_schema_test_${process.pid}_${Date.now()}`;
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
  });

  afterAll(async () => {
    if (database) {
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
