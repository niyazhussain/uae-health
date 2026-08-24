import { Kysely, sql } from 'kysely';
import { ConfigService } from '@nestjs/config';
import { WorkforceSessionService } from '../auth/workforce-session.service.js';
import { WorkforceDirectoryRepository } from '../workforce-directory/workforce-directory.repository.js';
import { createDatabaseClient } from './create-database-client.js';
import type { DatabaseService } from './database.service.js';
import type { DatabaseSchema } from './database.types.js';
import * as createFacilities from './migrations/2026-08-23T000000_create_facilities.js';
import * as createIdentityAuthorizationAudit from './migrations/2026-08-24T000000_create_identity_authorization_audit.js';
import * as createWorkforceSessions from './migrations/2026-08-24T010000_create_workforce_sessions.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

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
  });

  afterAll(async () => {
    if (database) {
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
    const idleExpiry = new Date(now.getTime() + 15 * 60_000);
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
      SESSION_IDLE_MINUTES: 15,
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

    const configValues: Record<string, string> = {
      COGNITO_REGION: 'ap-south-1',
      COGNITO_USER_POOL_ID: 'ap-south-1_synthetic',
    };
    const repository = new WorkforceDirectoryRepository(
      { client: database } as DatabaseService,
      {
        getOrThrow: (name: string) => configValues[name],
      } as ConfigService,
    );
    const authorization = await repository.authorizeInvitation(
      'synthetic-invitation-admin-subject',
      organization.id,
    );

    expect(authorization).not.toBeNull();
    const invitation = await repository.persistInvitation({
      actorCognitoSubject: 'synthetic-invitation-admin-subject',
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
      {
        getOrThrow: (name: string) =>
          ({
            COGNITO_REGION: 'ap-south-1',
            COGNITO_USER_POOL_ID: 'ap-south-1_synthetic',
          })[name],
      } as ConfigService,
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
      {
        getOrThrow: (name: string) =>
          ({
            COGNITO_REGION: 'ap-south-1',
            COGNITO_USER_POOL_ID: 'ap-south-1_synthetic',
          })[name],
      } as ConfigService,
    );

    await expect(
      repository.changeMembershipStatus({
        actorCognitoSubject: administratorSubject,
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
        actorCognitoSubject: administratorSubject,
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
        actorCognitoSubject: administratorSubject,
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
        actorCognitoSubject: administratorSubject,
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
