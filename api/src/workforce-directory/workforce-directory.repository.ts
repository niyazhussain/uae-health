import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import { DatabaseService } from '../database/database.service.js';
import { WORKFORCE_IDENTITY_PROVIDER } from '../identity-provider/identity-provider.constants.js';
import type { WorkforceIdentityProviderPort } from '../identity-provider/identity-provider.types.js';
import type { DatabaseSchema } from '../database/database.types.js';
import type {
  AssignWorkforceGlobalRoleRepositoryInput,
  AssignWorkforceTenantLocalRoleRepositoryInput,
  ChangeWorkforceMembershipStatusRepositoryInput,
  CreateWorkforceTenantLocalRoleRepositoryInput,
  PersistWorkforceInvitationInput,
  RevokeWorkforceRoleAssignmentRepositoryInput,
  WorkforceAssignableGlobalRole,
  WorkforceDirectoryContext,
  WorkforceDirectoryMember,
  WorkforceDelegablePermission,
  WorkforceDirectoryRepositoryPort,
  WorkforceInvitationAuthorization,
  WorkforceInvitationResponse,
  WorkforceMembershipStatusResponse,
  WorkforceRoleAssignment,
  WorkforceRoleCataloguePermission,
  WorkforceRoleCatalogueRole,
  WorkforceTenantLocalRole,
} from './workforce-directory.types.js';
import {
  WorkforceIdentityConflictError,
  WorkforceInvitationAuthorizationLostError,
  WorkforceMembershipConflictError,
  WorkforceMembershipManagementAuthorizationLostError,
  WorkforceRoleAssignmentConflictError,
  WorkforceRoleManagementAuthorizationLostError,
  WorkforceMembershipStateConflictError,
  WorkforceTenantLocalRoleConflictError,
} from './workforce-directory.types.js';

interface ContextRow {
  tenant_id: string;
  tenant_name: string;
  organization_id: string;
  organization_name: string;
}

interface MemberRow {
  membership_id: string;
  application_user_id: string;
  display_name: string;
  primary_email: string | null;
  membership_status: WorkforceDirectoryMember['membershipStatus'];
  account_status: WorkforceDirectoryMember['accountStatus'];
  identity_status: WorkforceDirectoryMember['identityStatus'];
  identity_subject: string | null;
  provider_sync_status: WorkforceDirectoryMember['providerSyncStatus'];
  is_synthetic: boolean;
}

interface InvitationAuthorizationRow {
  actor_user_id: string;
  tenant_id: string;
  tenant_name: string;
  tenant_is_synthetic: boolean;
  organization_id: string;
  organization_name: string;
}

interface RoleAssignmentRow {
  assignment_id: string;
  membership_id: string;
  role_id: string;
  role_code: string;
  role_name: string;
  role_description: string;
  organization_id: string;
}

interface AssignableGlobalRoleRow {
  role_id: string;
  code: string;
  name: string;
  description: string;
}

interface DelegablePermissionRow {
  permission_id: string;
  code: string;
  name: string;
  description: string;
}

interface TenantLocalRoleRow {
  role_id: string;
  code: string;
  name: string;
  description: string;
}

interface TenantLocalRolePermissionRow extends DelegablePermissionRow {
  role_id: string;
}

interface RoleCatalogueRoleRow {
  role_id: string;
  code: string;
  name: string;
  description: string;
  source: WorkforceRoleCatalogueRole['source'];
  assignment_count: string | number;
}

interface RoleCataloguePermissionRow {
  role_id: string;
  permission_id: string;
  code: string;
  name: string;
  description: string;
  is_delegable: boolean;
}

type AssignWorkforceRoleRepositoryInput =
  | AssignWorkforceGlobalRoleRepositoryInput
  | AssignWorkforceTenantLocalRoleRepositoryInput;

type DatabaseExecutor = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  return (error as { code?: unknown }).code === '23505';
}

@Injectable()
export class WorkforceDirectoryRepository implements WorkforceDirectoryRepositoryPort {
  private readonly providerIssuer: string;
  private readonly providerProtocol: WorkforceIdentityProviderPort['protocol'];

  constructor(
    private readonly database: DatabaseService,
    @Inject(WORKFORCE_IDENTITY_PROVIDER)
    identityProvider: WorkforceIdentityProviderPort,
  ) {
    this.providerIssuer = identityProvider.issuer;
    this.providerProtocol = identityProvider.protocol;
  }

  async listManageableContexts(
    subject: string,
  ): Promise<WorkforceDirectoryContext[]> {
    return this.listContextsWithPermission(
      subject,
      'tenant.memberships.manage',
    );
  }

  async listRoleManageableContexts(
    subject: string,
  ): Promise<WorkforceDirectoryContext[]> {
    return this.listContextsWithPermission(subject, 'tenant.roles.manage');
  }

  private async listContextsWithPermission(
    subject: string,
    permissionCode: string,
  ): Promise<WorkforceDirectoryContext[]> {
    const result = await sql<ContextRow>`
      with recursive resolved_actors as (
        select distinct identity.application_user_id
        from user_identities identity
        join identity_connections connection
          on connection.id = identity.identity_connection_id
        join application_users actor
          on actor.id = identity.application_user_id
        where identity.subject = ${subject}
          and identity.status = 'active'
          and connection.issuer = ${this.providerIssuer}
          and connection.status = 'active'
          and actor.status = 'active'
      ),
      authorized_organizations as (
        select
          assignment.tenant_id,
          assignment.scope_organization_id as organization_id,
          assignment.include_descendants and exists (
            select 1
            from role_permissions descendant_role_permission
            join permissions descendant_permission
              on descendant_permission.id = descendant_role_permission.permission_id
            where descendant_role_permission.role_id = assignment.role_id
              and descendant_permission.code = 'tenant.memberships.manage_descendants'
          ) as include_descendants
        from resolved_actors actor
        join organization_memberships membership
          on membership.application_user_id = actor.application_user_id
        join role_assignments assignment
          on assignment.membership_id = membership.id
         and assignment.tenant_id = membership.tenant_id
        join roles role
          on role.id = assignment.role_id
        join role_permissions role_permission
          on role_permission.role_id = assignment.role_id
        join permissions permission
          on permission.id = role_permission.permission_id
        where membership.status = 'active'
          and membership.valid_from <= now()
          and (membership.valid_until is null or membership.valid_until > now())
          and (select count(*) from resolved_actors) = 1
          and role.status = 'active'
          and (role.tenant_id is null or role.tenant_id = assignment.tenant_id)
          and assignment.revoked_at is null
          and assignment.valid_from <= now()
          and (assignment.valid_until is null or assignment.valid_until > now())
          and permission.code = ${permissionCode}

        union

        select
          authorized.tenant_id,
          child.id,
          true
        from authorized_organizations authorized
        join organizations child
          on child.tenant_id = authorized.tenant_id
         and child.parent_organization_id = authorized.organization_id
        where authorized.include_descendants
      )
      select distinct
        tenant.id as tenant_id,
        tenant.name as tenant_name,
        organization.id as organization_id,
        organization.name as organization_name
      from authorized_organizations authorized
      join tenants tenant
        on tenant.id = authorized.tenant_id
       and tenant.status = 'active'
      join organizations organization
        on organization.id = authorized.organization_id
       and organization.tenant_id = authorized.tenant_id
      order by tenant.name, organization.name
    `.execute(this.database.client);

    return result.rows.map((row) => ({
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      organizationId: row.organization_id,
      organizationName: row.organization_name,
    }));
  }

  async listMembers(
    tenantId: string,
    organizationId: string,
  ): Promise<WorkforceDirectoryMember[]> {
    const result = await sql<MemberRow>`
      select
        membership.id as membership_id,
        application_user.id as application_user_id,
        application_user.display_name,
        application_user.primary_email,
        membership.status as membership_status,
        application_user.status as account_status,
        identity.status as identity_status,
        identity.subject as identity_subject,
        identity.provider_sync_status,
        application_user.is_synthetic
      from organization_memberships membership
      join application_users application_user
        on application_user.id = membership.application_user_id
      left join identity_connections connection
        on connection.tenant_id = membership.tenant_id
       and connection.issuer = ${this.providerIssuer}
      left join user_identities identity
        on identity.application_user_id = application_user.id
       and identity.identity_connection_id = connection.id
      where membership.tenant_id = ${tenantId}
        and membership.organization_id = ${organizationId}
      order by application_user.display_name, application_user.id
    `.execute(this.database.client);

    return result.rows.map((row) => ({
      membershipId: row.membership_id,
      applicationUserId: row.application_user_id,
      displayName: row.display_name,
      email: row.primary_email,
      membershipStatus: row.membership_status,
      accountStatus: row.account_status,
      identityStatus: row.identity_status,
      identitySubject: row.identity_subject,
      providerSyncStatus: row.provider_sync_status,
      isSynthetic: row.is_synthetic,
    }));
  }

  async listRoleAssignments(
    tenantId: string,
    organizationId: string,
  ): Promise<WorkforceRoleAssignment[]> {
    const result = await sql<RoleAssignmentRow>`
      select
        assignment.id as assignment_id,
        assignment.membership_id,
        assignment.role_id,
        role.code as role_code,
        role.name as role_name,
        role.description as role_description,
        assignment.scope_organization_id as organization_id
      from role_assignments assignment
      join organization_memberships membership
        on membership.id = assignment.membership_id
       and membership.tenant_id = assignment.tenant_id
      join roles role
        on role.id = assignment.role_id
      where membership.tenant_id = ${tenantId}
        and membership.organization_id = ${organizationId}
        and assignment.scope_organization_id = ${organizationId}
        and assignment.facility_id is null
        and assignment.include_descendants = false
        and assignment.revoked_at is null
        and assignment.valid_from <= now()
        and (assignment.valid_until is null or assignment.valid_until > now())
        and role.status = 'active'
      order by role.name, assignment.id
    `.execute(this.database.client);

    return result.rows.map((row) => ({
      assignmentId: row.assignment_id,
      membershipId: row.membership_id,
      roleId: row.role_id,
      roleCode: row.role_code,
      roleName: row.role_name,
      roleDescription: row.role_description,
      organizationId: row.organization_id,
    }));
  }

  async listAssignableGlobalRoles(): Promise<WorkforceAssignableGlobalRole[]> {
    const result = await sql<AssignableGlobalRoleRow>`
      select
        role.id as role_id,
        role.code,
        role.name,
        role.description
      from roles role
      where role.tenant_id is null
        and role.status = 'active'
        and not exists (
          select 1
          from role_permissions role_permission
          join permissions permission
            on permission.id = role_permission.permission_id
          where role_permission.role_id = role.id
            and permission.is_delegable = false
        )
      order by role.name, role.id
    `.execute(this.database.client);

    return result.rows.map((row) => ({
      roleId: row.role_id,
      code: row.code,
      name: row.name,
      description: row.description,
    }));
  }

  async listTenantLocalRoles(
    tenantId: string,
  ): Promise<WorkforceTenantLocalRole[]> {
    const [roles, permissionRows] = await Promise.all([
      sql<TenantLocalRoleRow>`
        select role.id as role_id, role.code, role.name, role.description
        from roles role
        where role.tenant_id = ${tenantId}
          and role.status = 'active'
          and exists (
            select 1
            from role_permissions role_permission
            where role_permission.role_id = role.id
          )
          and not exists (
            select 1
            from role_permissions role_permission
            join permissions permission
              on permission.id = role_permission.permission_id
            where role_permission.role_id = role.id
              and permission.is_delegable = false
          )
        order by role.name, role.id
      `.execute(this.database.client),
      sql<TenantLocalRolePermissionRow>`
        select
          role.id as role_id,
          permission.id as permission_id,
          permission.code,
          permission.name,
          permission.description
        from roles role
        join role_permissions role_permission
          on role_permission.role_id = role.id
        join permissions permission
          on permission.id = role_permission.permission_id
        where role.tenant_id = ${tenantId}
          and role.status = 'active'
          and permission.is_delegable = true
        order by permission.name, permission.id
      `.execute(this.database.client),
    ]);
    const permissionsByRole = new Map<string, WorkforceDelegablePermission[]>();

    for (const permission of permissionRows.rows) {
      const rolePermissions = permissionsByRole.get(permission.role_id) ?? [];
      rolePermissions.push({
        permissionId: permission.permission_id,
        code: permission.code,
        name: permission.name,
        description: permission.description,
      });
      permissionsByRole.set(permission.role_id, rolePermissions);
    }

    return roles.rows.map((role) => ({
      roleId: role.role_id,
      code: role.code,
      name: role.name,
      description: role.description,
      permissions: permissionsByRole.get(role.role_id) ?? [],
    }));
  }

  async listRoleCatalogue(
    tenantId: string,
    organizationId: string,
  ): Promise<WorkforceRoleCatalogueRole[]> {
    const [roles, permissionRows] = await Promise.all([
      sql<RoleCatalogueRoleRow>`
        select
          role.id as role_id,
          role.code,
          role.name,
          role.description,
          case
            when role.tenant_id is null then 'global'
            else 'tenant-local'
          end as source,
          coalesce(assignment_counts.assignment_count, 0) as assignment_count
        from roles role
        left join lateral (
          select count(*) as assignment_count
          from role_assignments assignment
          join organization_memberships membership
            on membership.id = assignment.membership_id
           and membership.tenant_id = assignment.tenant_id
          where assignment.role_id = role.id
            and assignment.tenant_id = ${tenantId}
            and membership.organization_id = ${organizationId}
            and membership.status = 'active'
            and membership.valid_from <= now()
            and (membership.valid_until is null or membership.valid_until > now())
            and assignment.scope_organization_id = ${organizationId}
            and assignment.facility_id is null
            and assignment.include_descendants = false
            and assignment.revoked_at is null
            and assignment.valid_from <= now()
            and (assignment.valid_until is null or assignment.valid_until > now())
        ) assignment_counts on true
        where role.status = 'active'
          and (
            (role.tenant_id is null and role.is_system_template = true)
            or role.tenant_id = ${tenantId}
          )
        order by
          case when role.tenant_id is null then 0 else 1 end,
          role.name,
          role.id
      `.execute(this.database.client),
      sql<RoleCataloguePermissionRow>`
        select
          role.id as role_id,
          permission.id as permission_id,
          permission.code,
          permission.name,
          permission.description,
          permission.is_delegable
        from roles role
        join role_permissions role_permission
          on role_permission.role_id = role.id
        join permissions permission
          on permission.id = role_permission.permission_id
        where role.status = 'active'
          and (
            (role.tenant_id is null and role.is_system_template = true)
            or role.tenant_id = ${tenantId}
          )
        order by permission.name, permission.id
      `.execute(this.database.client),
    ]);
    const permissionsByRole = new Map<
      string,
      WorkforceRoleCataloguePermission[]
    >();

    for (const permission of permissionRows.rows) {
      const rolePermissions = permissionsByRole.get(permission.role_id) ?? [];
      rolePermissions.push({
        permissionId: permission.permission_id,
        code: permission.code,
        name: permission.name,
        description: permission.description,
        isDelegable: permission.is_delegable,
      });
      permissionsByRole.set(permission.role_id, rolePermissions);
    }

    return roles.rows.map((role) => {
      const permissions = permissionsByRole.get(role.role_id) ?? [];

      return {
        roleId: role.role_id,
        code: role.code,
        name: role.name,
        description: role.description,
        source: role.source,
        isDelegable:
          permissions.length > 0 &&
          permissions.every((permission) => permission.isDelegable),
        assignmentCount: Number(role.assignment_count),
        permissions,
      };
    });
  }

  async listDelegablePermissions(): Promise<WorkforceDelegablePermission[]> {
    const result = await sql<DelegablePermissionRow>`
      select permission.id as permission_id,
        permission.code,
        permission.name,
        permission.description
      from permissions permission
      where permission.is_delegable = true
      order by permission.name, permission.id
    `.execute(this.database.client);

    return result.rows.map((permission) => ({
      permissionId: permission.permission_id,
      code: permission.code,
      name: permission.name,
      description: permission.description,
    }));
  }

  authorizeInvitation(
    subject: string,
    organizationId: string,
  ): Promise<WorkforceInvitationAuthorization | null> {
    return this.findOrganizationPermissionAuthorization(
      this.database.client,
      subject,
      organizationId,
      'tenant.memberships.manage',
    );
  }

  authorizeRoleManagement(
    subject: string,
    organizationId: string,
  ): Promise<WorkforceInvitationAuthorization | null> {
    return this.findOrganizationPermissionAuthorization(
      this.database.client,
      subject,
      organizationId,
      'tenant.roles.manage',
    );
  }

  async isIdentitySubjectBound(subject: string): Promise<boolean> {
    const binding = await this.database.client
      .selectFrom('user_identities as identity')
      .innerJoin(
        'identity_connections as connection',
        'connection.id',
        'identity.identity_connection_id',
      )
      .select('identity.id')
      .where('connection.issuer', '=', this.providerIssuer)
      .where('identity.subject', '=', subject)
      .executeTakeFirst();

    return binding !== undefined;
  }

  async persistInvitation(
    input: PersistWorkforceInvitationInput,
  ): Promise<WorkforceInvitationResponse> {
    try {
      return await this.database.client
        .transaction()
        .setIsolationLevel('serializable')
        .execute(async (trx) => {
          const currentAuthorization =
            await this.findOrganizationPermissionAuthorization(
              trx,
              input.actorSubject,
              input.authorization.organizationId,
              'tenant.memberships.manage',
            );

          if (
            !currentAuthorization ||
            currentAuthorization.actorUserId !==
              input.authorization.actorUserId ||
            currentAuthorization.tenantId !== input.authorization.tenantId
          ) {
            throw new WorkforceInvitationAuthorizationLostError();
          }

          const targetConnections = await trx
            .selectFrom('identity_connections')
            .select('id')
            .where('tenant_id', '=', currentAuthorization.tenantId)
            .where('issuer', '=', this.providerIssuer)
            .where('protocol', '=', this.providerProtocol)
            .where('status', '=', 'active')
            .execute();

          if (targetConnections.length !== 1) {
            throw new Error(
              'The tenant must have exactly one active native identity connection for this issuer.',
            );
          }

          const existingIdentities = await trx
            .selectFrom('user_identities as identity')
            .innerJoin(
              'identity_connections as connection',
              'connection.id',
              'identity.identity_connection_id',
            )
            .innerJoin(
              'application_users as application_user',
              'application_user.id',
              'identity.application_user_id',
            )
            .select([
              'identity.application_user_id as application_user_id',
              'application_user.status as application_user_status',
              'identity.status as identity_status',
            ])
            .where('connection.issuer', '=', this.providerIssuer)
            .where('identity.subject', '=', input.account.subject)
            .execute();
          const existingApplicationUserIds = new Set(
            existingIdentities.map((identity) => identity.application_user_id),
          );

          if (existingApplicationUserIds.size > 1) {
            throw new Error(
              'The identity subject resolves to multiple application users.',
            );
          }

          if (
            existingIdentities.some(
              (identity) =>
                identity.identity_status !== 'active' ||
                identity.application_user_status !== 'active',
            )
          ) {
            throw new WorkforceIdentityConflictError(
              'The existing workforce identity is suspended or closed.',
            );
          }

          let applicationUserId = [...existingApplicationUserIds][0];

          if (!applicationUserId) {
            const applicationUser = await trx
              .insertInto('application_users')
              .values({
                display_name: input.displayName,
                primary_email: input.email,
                status: 'active',
                is_synthetic: currentAuthorization.tenantIsSynthetic,
              })
              .returning('id')
              .executeTakeFirstOrThrow();
            applicationUserId = applicationUser.id;
          }

          const targetConnectionId = targetConnections[0].id;
          const targetBinding = await trx
            .selectFrom('user_identities')
            .select(['id', 'subject', 'status'])
            .where('application_user_id', '=', applicationUserId)
            .where('identity_connection_id', '=', targetConnectionId)
            .executeTakeFirst();

          if (
            targetBinding &&
            (targetBinding.subject !== input.account.subject ||
              targetBinding.status !== 'active')
          ) {
            throw new WorkforceIdentityConflictError(
              'The application user already has a different or suspended identity for this tenant.',
            );
          }

          if (!targetBinding) {
            await trx
              .insertInto('user_identities')
              .values({
                application_user_id: applicationUserId,
                identity_connection_id: targetConnectionId,
                subject: input.account.subject,
                status: 'active',
                provider_sync_status: 'synchronized',
                provider_sync_attempted_at: new Date(),
                provider_sync_completed_at: new Date(),
                provider_sync_error_code: null,
                last_authenticated_at: null,
              })
              .execute();
          }

          const existingMembership = await trx
            .selectFrom('organization_memberships')
            .select(['id', 'status'])
            .where('application_user_id', '=', applicationUserId)
            .where('organization_id', '=', currentAuthorization.organizationId)
            .executeTakeFirst();

          if (existingMembership) {
            throw new WorkforceMembershipConflictError(
              `This user already has ${existingMembership.status} membership in the practice.`,
            );
          }

          const membership = await trx
            .insertInto('organization_memberships')
            .values({
              tenant_id: currentAuthorization.tenantId,
              organization_id: currentAuthorization.organizationId,
              application_user_id: applicationUserId,
              status: 'active',
              provisioning_method: 'admin_invite',
              external_id: null,
              valid_until: null,
            })
            .returning('id')
            .executeTakeFirstOrThrow();

          await trx
            .insertInto('audit_events')
            .values({
              actor_type: 'user',
              actor_identifier: input.actorSubject,
              actor_user_id: currentAuthorization.actorUserId,
              effective_user_id: currentAuthorization.actorUserId,
              tenant_id: currentAuthorization.tenantId,
              organization_id: currentAuthorization.organizationId,
              facility_id: null,
              action: 'identity.workforce_invited',
              target_entity_type: 'organization_membership',
              target_entity_id: membership.id,
              outcome: 'success',
              correlation_id: randomUUID(),
              reason: input.reason,
              before_data: null,
              after_data: {
                membershipStatus: 'active',
                providerAccountCreated: input.account.created,
                roleAssigned: false,
              },
            })
            .execute();

          return {
            applicationUserId,
            membershipId: membership.id,
            organizationId: currentAuthorization.organizationId,
            email: input.email,
            membershipStatus: 'active',
            accountCreated: input.account.created,
            delivery: input.account.created ? 'email' : 'existing-account',
          };
        });
    } catch (error) {
      if (
        error instanceof WorkforceMembershipConflictError ||
        error instanceof WorkforceInvitationAuthorizationLostError ||
        error instanceof WorkforceIdentityConflictError
      ) {
        throw error;
      }

      if (isUniqueViolation(error)) {
        throw new WorkforceMembershipConflictError(
          'The workforce account or practice membership was created by another request.',
        );
      }

      throw error;
    }
  }

  async changeMembershipStatus(
    input: ChangeWorkforceMembershipStatusRepositoryInput,
  ): Promise<WorkforceMembershipStatusResponse> {
    return this.database.client
      .transaction()
      .setIsolationLevel('serializable')
      .execute(async (trx) => {
        const authorization =
          await this.findOrganizationPermissionAuthorization(
            trx,
            input.actorSubject,
            input.organizationId,
            'tenant.memberships.manage',
          );

        if (!authorization) {
          throw new WorkforceMembershipManagementAuthorizationLostError();
        }

        const membership = await trx
          .selectFrom('organization_memberships as membership')
          .select([
            'membership.id as membership_id',
            'membership.application_user_id as application_user_id',
            'membership.tenant_id as tenant_id',
            'membership.organization_id as organization_id',
            'membership.status as membership_status',
          ])
          .where('membership.id', '=', input.membershipId)
          .forUpdate()
          .executeTakeFirst();

        if (
          !membership ||
          membership.tenant_id !== authorization.tenantId ||
          membership.organization_id !== authorization.organizationId
        ) {
          throw new WorkforceMembershipManagementAuthorizationLostError();
        }

        if (membership.application_user_id === authorization.actorUserId) {
          throw new WorkforceMembershipStateConflictError(
            'Administrators cannot change their own membership state.',
          );
        }

        if (
          membership.membership_status !== 'active' &&
          membership.membership_status !== 'suspended'
        ) {
          throw new WorkforceMembershipStateConflictError(
            'Only active or suspended memberships can be changed.',
          );
        }

        if (membership.membership_status === input.status) {
          throw new WorkforceMembershipStateConflictError(
            `This membership is already ${input.status}.`,
          );
        }

        const now = new Date();
        await trx
          .updateTable('organization_memberships')
          .set({ status: input.status, updated_at: now })
          .where('id', '=', membership.membership_id)
          .executeTakeFirstOrThrow();

        let sessionsRevoked = 0;

        if (input.status === 'suspended') {
          const identities = await trx
            .selectFrom('user_identities as identity')
            .innerJoin(
              'identity_connections as connection',
              'connection.id',
              'identity.identity_connection_id',
            )
            .select('identity.subject')
            .distinct()
            .where(
              'identity.application_user_id',
              '=',
              membership.application_user_id,
            )
            .where('connection.issuer', '=', this.providerIssuer)
            .execute();
          const subjects = identities.map((identity) => identity.subject);

          if (subjects.length > 0) {
            const revoked = await trx
              .updateTable('workforce_sessions')
              .set({ revoked_at: now, updated_at: now })
              .where('revoked_at', 'is', null)
              .where('cognito_subject', 'in', subjects)
              .executeTakeFirst();
            sessionsRevoked = Number(revoked.numUpdatedRows);
          }
        }

        await trx
          .insertInto('audit_events')
          .values({
            actor_type: 'user',
            actor_identifier: input.actorSubject,
            actor_user_id: authorization.actorUserId,
            effective_user_id: authorization.actorUserId,
            tenant_id: authorization.tenantId,
            organization_id: authorization.organizationId,
            facility_id: null,
            action:
              input.status === 'suspended'
                ? 'identity.membership_suspended'
                : 'identity.membership_restored',
            target_entity_type: 'organization_membership',
            target_entity_id: membership.membership_id,
            outcome: 'success',
            correlation_id: randomUUID(),
            reason: input.reason,
            before_data: { membershipStatus: membership.membership_status },
            after_data: {
              membershipStatus: input.status,
              sessionsRevoked,
            },
          })
          .execute();

        return {
          membershipId: membership.membership_id,
          organizationId: authorization.organizationId,
          membershipStatus: input.status,
          sessionsRevoked,
        };
      });
  }

  async createTenantLocalRole(
    input: CreateWorkforceTenantLocalRoleRepositoryInput,
  ): Promise<WorkforceTenantLocalRole> {
    try {
      return await this.database.client
        .transaction()
        .setIsolationLevel('serializable')
        .execute(async (trx) => {
          const authorization =
            await this.findOrganizationPermissionAuthorization(
              trx,
              input.actorSubject,
              input.organizationId,
              'tenant.roles.manage',
            );

          if (!authorization) {
            throw new WorkforceRoleManagementAuthorizationLostError();
          }

          const permissions = await trx
            .selectFrom('permissions')
            .select(['id', 'code', 'name', 'description'])
            .where('id', 'in', input.permissionIds)
            .where('is_delegable', '=', true)
            .orderBy('name')
            .forUpdate()
            .execute();

          if (permissions.length !== input.permissionIds.length) {
            throw new WorkforceTenantLocalRoleConflictError(
              'Tenant-local roles can contain only active delegable permissions.',
            );
          }

          const existingRole = await trx
            .selectFrom('roles')
            .select('id')
            .where('tenant_id', '=', authorization.tenantId)
            .where('status', '=', 'active')
            .where(sql<boolean>`lower(btrim(name)) = lower(${input.name})`)
            .executeTakeFirst();

          if (existingRole) {
            throw new WorkforceTenantLocalRoleConflictError(
              'An active tenant-local role already uses this name.',
            );
          }

          const role = await trx
            .insertInto('roles')
            .values({
              tenant_id: authorization.tenantId,
              code: `LOCAL_${randomUUID().replaceAll('-', '').toUpperCase()}`,
              name: input.name,
              description: input.description,
              is_system_template: false,
              request_policy: 'admin_only',
              cloned_from_role_id: null,
              status: 'active',
              created_by_user_id: authorization.actorUserId,
            })
            .returning(['id', 'code', 'name', 'description'])
            .executeTakeFirstOrThrow();

          await trx
            .insertInto('role_permissions')
            .values(
              permissions.map((permission) => ({
                role_id: role.id,
                permission_id: permission.id,
                granted_by_user_id: authorization.actorUserId,
              })),
            )
            .execute();

          await trx
            .insertInto('audit_events')
            .values({
              actor_type: 'user',
              actor_identifier: input.actorSubject,
              actor_user_id: authorization.actorUserId,
              effective_user_id: authorization.actorUserId,
              tenant_id: authorization.tenantId,
              organization_id: authorization.organizationId,
              facility_id: null,
              action: 'identity.tenant_local_role_created',
              target_entity_type: 'role',
              target_entity_id: role.id,
              outcome: 'success',
              correlation_id: randomUUID(),
              reason: input.reason,
              before_data: null,
              after_data: {
                roleCode: role.code,
                roleName: role.name,
                permissionCodes: permissions.map(
                  (permission) => permission.code,
                ),
                requestPolicy: 'admin_only',
              },
            })
            .execute();

          return {
            roleId: role.id,
            code: role.code,
            name: role.name,
            description: role.description,
            permissions: permissions.map((permission) => ({
              permissionId: permission.id,
              code: permission.code,
              name: permission.name,
              description: permission.description,
            })),
          };
        });
    } catch (error) {
      if (
        error instanceof WorkforceRoleManagementAuthorizationLostError ||
        error instanceof WorkforceTenantLocalRoleConflictError
      ) {
        throw error;
      }

      if (isUniqueViolation(error)) {
        throw new WorkforceTenantLocalRoleConflictError(
          'An active tenant-local role already uses this name.',
        );
      }

      throw error;
    }
  }

  async assignGlobalRole(
    input: AssignWorkforceGlobalRoleRepositoryInput,
  ): Promise<WorkforceRoleAssignment> {
    return this.assignRole(input, 'global');
  }

  async assignTenantLocalRole(
    input: AssignWorkforceTenantLocalRoleRepositoryInput,
  ): Promise<WorkforceRoleAssignment> {
    return this.assignRole(input, 'tenant-local');
  }

  private async assignRole(
    input: AssignWorkforceRoleRepositoryInput,
    roleScope: 'global' | 'tenant-local',
  ): Promise<WorkforceRoleAssignment> {
    try {
      return await this.database.client
        .transaction()
        .setIsolationLevel('serializable')
        .execute(async (trx) => {
          const authorization =
            await this.findOrganizationPermissionAuthorization(
              trx,
              input.actorSubject,
              input.organizationId,
              'tenant.roles.manage',
            );

          if (!authorization) {
            throw new WorkforceRoleManagementAuthorizationLostError();
          }

          const membership = await trx
            .selectFrom('organization_memberships as membership')
            .select([
              'membership.id as membership_id',
              'membership.application_user_id as application_user_id',
              'membership.tenant_id as tenant_id',
              'membership.organization_id as organization_id',
              'membership.status as membership_status',
              'membership.valid_from as valid_from',
              'membership.valid_until as valid_until',
            ])
            .where('membership.id', '=', input.membershipId)
            .forUpdate()
            .executeTakeFirst();

          if (
            !membership ||
            membership.tenant_id !== authorization.tenantId ||
            membership.organization_id !== authorization.organizationId
          ) {
            throw new WorkforceRoleManagementAuthorizationLostError();
          }

          if (membership.application_user_id === authorization.actorUserId) {
            throw new WorkforceRoleAssignmentConflictError(
              'Administrators cannot change their own role assignments.',
            );
          }

          const now = new Date();
          if (
            membership.membership_status !== 'active' ||
            membership.valid_from > now ||
            (membership.valid_until !== null && membership.valid_until <= now)
          ) {
            throw new WorkforceRoleAssignmentConflictError(
              'Roles can be assigned only to an active membership.',
            );
          }

          let roleQuery = trx
            .selectFrom('roles as role')
            .select([
              'role.id as role_id',
              'role.code as role_code',
              'role.name as role_name',
              'role.description as role_description',
            ])
            .where('role.id', '=', input.roleId)
            .where('role.status', '=', 'active')
            .forUpdate();

          roleQuery =
            roleScope === 'global'
              ? roleQuery.where('role.tenant_id', 'is', null)
              : roleQuery.where('role.tenant_id', '=', authorization.tenantId);
          const role = await roleQuery.executeTakeFirst();

          if (!role) {
            throw new WorkforceRoleAssignmentConflictError(
              roleScope === 'global'
                ? 'This global role is not available for assignment.'
                : 'This tenant-local role is not available for assignment.',
            );
          }

          const nonDelegablePermission = await trx
            .selectFrom('role_permissions as role_permission')
            .innerJoin(
              'permissions as permission',
              'permission.id',
              'role_permission.permission_id',
            )
            .select('role_permission.permission_id')
            .where('role_permission.role_id', '=', role.role_id)
            .where('permission.is_delegable', '=', false)
            .executeTakeFirst();

          if (nonDelegablePermission) {
            throw new WorkforceRoleAssignmentConflictError(
              roleScope === 'global'
                ? 'This global role is not available for assignment.'
                : 'This tenant-local role is not available for assignment.',
            );
          }

          const existingAssignment = await trx
            .selectFrom('role_assignments')
            .select('id')
            .where('membership_id', '=', membership.membership_id)
            .where('role_id', '=', role.role_id)
            .where('scope_organization_id', '=', authorization.organizationId)
            .where('facility_id', 'is', null)
            .where('include_descendants', '=', false)
            .where('revoked_at', 'is', null)
            .executeTakeFirst();

          if (existingAssignment) {
            throw new WorkforceRoleAssignmentConflictError(
              'This role is already assigned to the membership.',
            );
          }

          const assignment = await trx
            .insertInto('role_assignments')
            .values({
              tenant_id: authorization.tenantId,
              membership_id: membership.membership_id,
              role_id: role.role_id,
              scope_organization_id: authorization.organizationId,
              facility_id: null,
              include_descendants: false,
              assignment_source: 'admin',
              assigned_by_user_id: authorization.actorUserId,
              source_role_request_id: null,
              valid_until: null,
              revoked_at: null,
              revoked_by_user_id: null,
              revocation_reason: null,
            })
            .returning('id')
            .executeTakeFirstOrThrow();

          await trx
            .insertInto('audit_events')
            .values({
              actor_type: 'user',
              actor_identifier: input.actorSubject,
              actor_user_id: authorization.actorUserId,
              effective_user_id: membership.application_user_id,
              tenant_id: authorization.tenantId,
              organization_id: authorization.organizationId,
              facility_id: null,
              action: 'identity.role_assigned',
              target_entity_type: 'role_assignment',
              target_entity_id: assignment.id,
              outcome: 'success',
              correlation_id: randomUUID(),
              reason: input.reason,
              before_data: null,
              after_data: {
                roleCode: role.role_code,
                roleScope,
                scopeOrganizationId: authorization.organizationId,
                facilityScope: null,
                includeDescendants: false,
              },
            })
            .execute();

          return {
            assignmentId: assignment.id,
            membershipId: membership.membership_id,
            roleId: role.role_id,
            roleCode: role.role_code,
            roleName: role.role_name,
            roleDescription: role.role_description,
            organizationId: authorization.organizationId,
          };
        });
    } catch (error) {
      if (
        error instanceof WorkforceRoleManagementAuthorizationLostError ||
        error instanceof WorkforceRoleAssignmentConflictError
      ) {
        throw error;
      }

      if (isUniqueViolation(error)) {
        throw new WorkforceRoleAssignmentConflictError(
          'This role is already assigned to the membership.',
        );
      }

      throw error;
    }
  }

  async revokeRoleAssignment(
    input: RevokeWorkforceRoleAssignmentRepositoryInput,
  ): Promise<WorkforceRoleAssignment> {
    return this.database.client
      .transaction()
      .setIsolationLevel('serializable')
      .execute(async (trx) => {
        const authorization =
          await this.findOrganizationPermissionAuthorization(
            trx,
            input.actorSubject,
            input.organizationId,
            'tenant.roles.manage',
          );

        if (!authorization) {
          throw new WorkforceRoleManagementAuthorizationLostError();
        }

        const assignment = await trx
          .selectFrom('role_assignments as assignment')
          .innerJoin('organization_memberships as membership', (join) =>
            join
              .onRef('membership.id', '=', 'assignment.membership_id')
              .onRef('membership.tenant_id', '=', 'assignment.tenant_id'),
          )
          .innerJoin('roles as role', 'role.id', 'assignment.role_id')
          .select([
            'assignment.id as assignment_id',
            'assignment.membership_id as membership_id',
            'assignment.tenant_id as tenant_id',
            'assignment.scope_organization_id as scope_organization_id',
            'assignment.facility_id as facility_id',
            'assignment.include_descendants as include_descendants',
            'assignment.valid_from as valid_from',
            'assignment.valid_until as valid_until',
            'assignment.revoked_at as revoked_at',
            'membership.application_user_id as application_user_id',
            'membership.organization_id as organization_id',
            'membership.status as membership_status',
            'membership.valid_from as membership_valid_from',
            'membership.valid_until as membership_valid_until',
            'role.id as role_id',
            'role.tenant_id as role_tenant_id',
            'role.status as role_status',
            'role.code as role_code',
            'role.name as role_name',
            'role.description as role_description',
          ])
          .where('assignment.id', '=', input.assignmentId)
          .forUpdate()
          .executeTakeFirst();

        if (
          !assignment ||
          assignment.tenant_id !== authorization.tenantId ||
          assignment.organization_id !== authorization.organizationId ||
          assignment.scope_organization_id !== authorization.organizationId ||
          assignment.facility_id !== null ||
          assignment.include_descendants
        ) {
          throw new WorkforceRoleManagementAuthorizationLostError();
        }

        if (assignment.application_user_id === authorization.actorUserId) {
          throw new WorkforceRoleAssignmentConflictError(
            'Administrators cannot change their own role assignments.',
          );
        }

        const now = new Date();
        if (
          assignment.membership_status !== 'active' ||
          assignment.membership_valid_from > now ||
          (assignment.membership_valid_until !== null &&
            assignment.membership_valid_until <= now) ||
          (assignment.role_tenant_id !== null &&
            assignment.role_tenant_id !== authorization.tenantId) ||
          assignment.role_status !== 'active' ||
          assignment.revoked_at !== null ||
          assignment.valid_from > now ||
          (assignment.valid_until !== null && assignment.valid_until <= now)
        ) {
          throw new WorkforceRoleAssignmentConflictError(
            'This role assignment cannot be revoked.',
          );
        }

        const nonDelegablePermission = await trx
          .selectFrom('role_permissions as role_permission')
          .innerJoin(
            'permissions as permission',
            'permission.id',
            'role_permission.permission_id',
          )
          .select('role_permission.permission_id')
          .where('role_permission.role_id', '=', assignment.role_id)
          .where('permission.is_delegable', '=', false)
          .executeTakeFirst();

        if (nonDelegablePermission) {
          throw new WorkforceRoleAssignmentConflictError(
            'This role assignment cannot be revoked.',
          );
        }

        await trx
          .updateTable('role_assignments')
          .set({
            revoked_at: now,
            revoked_by_user_id: authorization.actorUserId,
            revocation_reason: input.reason,
          })
          .where('id', '=', assignment.assignment_id)
          .executeTakeFirstOrThrow();

        await trx
          .insertInto('audit_events')
          .values({
            actor_type: 'user',
            actor_identifier: input.actorSubject,
            actor_user_id: authorization.actorUserId,
            effective_user_id: assignment.application_user_id,
            tenant_id: authorization.tenantId,
            organization_id: authorization.organizationId,
            facility_id: null,
            action: 'identity.role_revoked',
            target_entity_type: 'role_assignment',
            target_entity_id: assignment.assignment_id,
            outcome: 'success',
            correlation_id: randomUUID(),
            reason: input.reason,
            before_data: {
              roleCode: assignment.role_code,
              scopeOrganizationId: assignment.scope_organization_id,
            },
            after_data: { revoked: true },
          })
          .execute();

        return {
          assignmentId: assignment.assignment_id,
          membershipId: assignment.membership_id,
          roleId: assignment.role_id,
          roleCode: assignment.role_code,
          roleName: assignment.role_name,
          roleDescription: assignment.role_description,
          organizationId: assignment.scope_organization_id,
        };
      });
  }

  private async findOrganizationPermissionAuthorization(
    executor: DatabaseExecutor,
    subject: string,
    organizationId: string,
    permissionCode: string,
  ): Promise<WorkforceInvitationAuthorization | null> {
    const result = await sql<InvitationAuthorizationRow>`
      with recursive resolved_actors as (
        select distinct identity.application_user_id
        from user_identities identity
        join identity_connections connection
          on connection.id = identity.identity_connection_id
        join application_users actor
          on actor.id = identity.application_user_id
        where identity.subject = ${subject}
          and identity.status = 'active'
          and connection.issuer = ${this.providerIssuer}
          and connection.status = 'active'
          and actor.status = 'active'
      ),
      authorized_organizations as (
        select
          assignment.tenant_id,
          assignment.scope_organization_id as organization_id,
          assignment.include_descendants and exists (
            select 1
            from role_permissions descendant_role_permission
            join permissions descendant_permission
              on descendant_permission.id = descendant_role_permission.permission_id
            where descendant_role_permission.role_id = assignment.role_id
              and descendant_permission.code = 'tenant.memberships.manage_descendants'
          ) as include_descendants
        from resolved_actors actor
        join organization_memberships membership
          on membership.application_user_id = actor.application_user_id
        join role_assignments assignment
          on assignment.membership_id = membership.id
         and assignment.tenant_id = membership.tenant_id
        join roles role
          on role.id = assignment.role_id
        join role_permissions role_permission
          on role_permission.role_id = assignment.role_id
        join permissions permission
          on permission.id = role_permission.permission_id
        where membership.status = 'active'
          and membership.valid_from <= now()
          and (membership.valid_until is null or membership.valid_until > now())
          and (select count(*) from resolved_actors) = 1
          and role.status = 'active'
          and (role.tenant_id is null or role.tenant_id = assignment.tenant_id)
          and assignment.revoked_at is null
          and assignment.valid_from <= now()
          and (assignment.valid_until is null or assignment.valid_until > now())
          and permission.code = ${permissionCode}

        union

        select
          authorized.tenant_id,
          child.id,
          true
        from authorized_organizations authorized
        join organizations child
          on child.tenant_id = authorized.tenant_id
         and child.parent_organization_id = authorized.organization_id
        where authorized.include_descendants
      )
      select distinct
        actor.application_user_id as actor_user_id,
        tenant.id as tenant_id,
        tenant.name as tenant_name,
        tenant.is_synthetic as tenant_is_synthetic,
        organization.id as organization_id,
        organization.name as organization_name
      from authorized_organizations authorized
      cross join resolved_actors actor
      join tenants tenant
        on tenant.id = authorized.tenant_id
       and tenant.status = 'active'
      join organizations organization
        on organization.id = authorized.organization_id
       and organization.tenant_id = authorized.tenant_id
      where organization.id = ${organizationId}
    `.execute(executor);

    if (result.rows.length !== 1) {
      return null;
    }

    const row = result.rows[0];

    return {
      actorUserId: row.actor_user_id,
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      tenantIsSynthetic: row.tenant_is_synthetic,
      organizationId: row.organization_id,
      organizationName: row.organization_name,
    };
  }
}
