import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseService } from '../database/database.service.js';
import { WORKFORCE_IDENTITY_PROVIDER } from '../identity-provider/identity-provider.constants.js';
import type { WorkforceIdentityProviderPort } from '../identity-provider/identity-provider.types.js';
import type {
  AuthorizationDatabaseExecutor,
  AuthorizationRepositoryPort,
  AuthorizationRequest,
  AuthorizedAccess,
} from './authorization.types.js';

interface AuthorizedAccessRow {
  application_user_id: string;
  membership_id: string;
}

@Injectable()
export class AuthorizationRepository implements AuthorizationRepositoryPort {
  private readonly providerIssuer: string;

  constructor(
    private readonly database: DatabaseService,
    @Inject(WORKFORCE_IDENTITY_PROVIDER)
    identityProvider: WorkforceIdentityProviderPort,
  ) {
    this.providerIssuer = identityProvider.issuer;
  }

  async findAuthorizedAccess(
    request: AuthorizationRequest,
    executor: AuthorizationDatabaseExecutor = this.database.client,
  ): Promise<AuthorizedAccess | null> {
    const result = await sql<AuthorizedAccessRow>`
      with resolved_actors as (
        select distinct identity.application_user_id
        from user_identities identity
        join identity_connections connection
          on connection.id = identity.identity_connection_id
        join application_users actor
          on actor.id = identity.application_user_id
        where identity.subject = ${request.principal.subject}
          and identity.status = 'active'
          and connection.issuer = ${this.providerIssuer}
          and connection.tenant_id = ${request.tenantId}
          and connection.status = 'active'
          and actor.status = 'active'
      )
      select distinct
        actor.application_user_id,
        membership.id as membership_id
      from resolved_actors actor
      join tenants tenant
        on tenant.id = ${request.tenantId}
       and tenant.status = 'active'
      join organizations organization
        on organization.id = ${request.organizationId}
       and organization.tenant_id = tenant.id
       and organization.kind = 'practice'
      join organization_memberships membership
        on membership.application_user_id = actor.application_user_id
      where (select count(*) from resolved_actors) = 1
        and membership.tenant_id = tenant.id
        and membership.organization_id = ${request.organizationId}
        and membership.status = 'active'
        and membership.valid_from <= now()
        and (membership.valid_until is null or membership.valid_until > now())
        and (
          ${request.facilityId ?? null}::uuid is null
          or exists (
            select 1
            from membership_facilities membership_facility
            join facilities facility
              on facility.id = membership_facility.facility_id
             and facility.tenant_id = membership_facility.tenant_id
            where membership_facility.membership_id = membership.id
              and membership_facility.tenant_id = membership.tenant_id
              and membership_facility.facility_id = ${request.facilityId ?? null}::uuid
              and facility.organization_id = ${request.organizationId}
          )
        )
        and exists (
          select 1
          from role_assignments assignment
          join roles role
            on role.id = assignment.role_id
          join role_permissions role_permission
            on role_permission.role_id = role.id
          join permissions permission
            on permission.id = role_permission.permission_id
          where assignment.membership_id = membership.id
            and assignment.tenant_id = membership.tenant_id
            and assignment.scope_organization_id = ${request.organizationId}
            and assignment.revoked_at is null
            and assignment.valid_from <= now()
            and (assignment.valid_until is null or assignment.valid_until > now())
            and role.status = 'active'
            and (role.tenant_id is null or role.tenant_id = membership.tenant_id)
            and permission.code = ${request.permissionCode}
            and (
              (${request.facilityId ?? null}::uuid is null and assignment.facility_id is null)
              or (
                ${request.facilityId ?? null}::uuid is not null
                and (assignment.facility_id is null or assignment.facility_id = ${request.facilityId ?? null}::uuid)
              )
            )
        )
        and (
          ${request.confidential} = false
          or exists (
            select 1
            from role_assignments confidential_assignment
            join roles confidential_role
              on confidential_role.id = confidential_assignment.role_id
            join role_permissions confidential_role_permission
              on confidential_role_permission.role_id = confidential_role.id
            join permissions confidential_permission
              on confidential_permission.id = confidential_role_permission.permission_id
            where confidential_assignment.membership_id = membership.id
              and confidential_assignment.tenant_id = membership.tenant_id
              and confidential_assignment.scope_organization_id = ${request.organizationId}
              and confidential_assignment.revoked_at is null
              and confidential_assignment.valid_from <= now()
              and (
                confidential_assignment.valid_until is null
                or confidential_assignment.valid_until > now()
              )
              and confidential_role.status = 'active'
              and (
                confidential_role.tenant_id is null
                or confidential_role.tenant_id = membership.tenant_id
              )
              and confidential_permission.code = 'confidential-records.read'
              and (
                (${request.facilityId ?? null}::uuid is null and confidential_assignment.facility_id is null)
                or (
                  ${request.facilityId ?? null}::uuid is not null
                  and (
                    confidential_assignment.facility_id is null
                    or confidential_assignment.facility_id = ${request.facilityId ?? null}::uuid
                  )
                )
              )
          )
        )
      limit 1
    `.execute(executor);

    const row = result.rows[0];

    return row
      ? {
          applicationUserId: row.application_user_id,
          membershipId: row.membership_id,
        }
      : null;
  }

  async recordDeniedAccess(
    request: AuthorizationRequest,
    executor: AuthorizationDatabaseExecutor = this.database.client,
  ): Promise<void> {
    const actorUserId = await this.findActiveActorUserId(request, executor);

    await executor
      .insertInto('audit_events')
      .values({
        actor_type: actorUserId ? 'user' : 'system',
        actor_identifier: request.principal.subject,
        actor_user_id: actorUserId,
        effective_user_id: actorUserId,
        tenant_id: request.tenantId,
        organization_id: request.organizationId,
        facility_id: request.facilityId ?? null,
        action: request.action,
        target_entity_type: request.targetEntityType,
        target_entity_id: request.targetEntityId,
        outcome: 'denied',
        correlation_id: request.correlationId,
        reason: request.reason,
        before_data: null,
        after_data: {
          permissionCode: request.permissionCode,
          confidential: request.confidential,
        },
      })
      .execute();
  }

  private async findActiveActorUserId(
    request: AuthorizationRequest,
    executor: AuthorizationDatabaseExecutor,
  ): Promise<string | null> {
    const result = await sql<{ application_user_id: string }>`
      with resolved_actors as (
        select distinct identity.application_user_id
        from user_identities identity
        join identity_connections connection
          on connection.id = identity.identity_connection_id
        join application_users actor
          on actor.id = identity.application_user_id
        where identity.subject = ${request.principal.subject}
          and identity.status = 'active'
          and connection.issuer = ${this.providerIssuer}
          and connection.tenant_id = ${request.tenantId}
          and connection.status = 'active'
          and actor.status = 'active'
      )
      select actor.application_user_id
      from resolved_actors actor
      join tenants tenant
        on tenant.id = ${request.tenantId}
       and tenant.status = 'active'
      join organizations organization
        on organization.id = ${request.organizationId}
       and organization.tenant_id = tenant.id
       and organization.kind = 'practice'
      where (select count(*) from resolved_actors) = 1
    `.execute(executor);

    return result.rows[0]?.application_user_id ?? null;
  }
}
