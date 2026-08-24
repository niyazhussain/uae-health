import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'kysely';
import { DatabaseService } from '../database/database.service.js';
import type {
  WorkforceDirectoryContext,
  WorkforceDirectoryMember,
  WorkforceDirectoryRepositoryPort,
} from './workforce-directory.types.js';

interface ContextRow {
  tenant_id: string;
  tenant_name: string;
  organization_id: string;
  organization_name: string;
}

interface MemberRow {
  application_user_id: string;
  display_name: string;
  primary_email: string | null;
  membership_status: WorkforceDirectoryMember['membershipStatus'];
  identity_status: WorkforceDirectoryMember['identityStatus'];
  cognito_subject: string | null;
  is_synthetic: boolean;
}

@Injectable()
export class WorkforceDirectoryRepository implements WorkforceDirectoryRepositoryPort {
  private readonly cognitoIssuer: string;

  constructor(
    private readonly database: DatabaseService,
    config: ConfigService,
  ) {
    const region = config.getOrThrow<string>('COGNITO_REGION');
    const userPoolId = config.getOrThrow<string>('COGNITO_USER_POOL_ID');
    this.cognitoIssuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
  }

  async listManageableContexts(
    cognitoSubject: string,
  ): Promise<WorkforceDirectoryContext[]> {
    const result = await sql<ContextRow>`
      with recursive resolved_actors as (
        select distinct identity.application_user_id
        from user_identities identity
        join identity_connections connection
          on connection.id = identity.identity_connection_id
        join application_users actor
          on actor.id = identity.application_user_id
        where identity.subject = ${cognitoSubject}
          and identity.status = 'active'
          and connection.issuer = ${this.cognitoIssuer}
          and connection.status = 'active'
          and actor.status = 'active'
      ),
      authorized_organizations as (
        select
          assignment.tenant_id,
          assignment.scope_organization_id as organization_id,
          assignment.include_descendants
        from resolved_actors actor
        join organization_memberships membership
          on membership.application_user_id = actor.application_user_id
        join role_assignments assignment
          on assignment.membership_id = membership.id
         and assignment.tenant_id = membership.tenant_id
        join role_permissions role_permission
          on role_permission.role_id = assignment.role_id
        join permissions permission
          on permission.id = role_permission.permission_id
        where membership.status = 'active'
          and (select count(*) from resolved_actors) = 1
          and assignment.revoked_at is null
          and assignment.valid_from <= now()
          and (assignment.valid_until is null or assignment.valid_until > now())
          and permission.code = 'tenant.memberships.manage'

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
        application_user.id as application_user_id,
        application_user.display_name,
        application_user.primary_email,
        membership.status as membership_status,
        identity.status as identity_status,
        identity.subject as cognito_subject,
        application_user.is_synthetic
      from organization_memberships membership
      join application_users application_user
        on application_user.id = membership.application_user_id
      left join identity_connections connection
        on connection.tenant_id = membership.tenant_id
       and connection.issuer = ${this.cognitoIssuer}
      left join user_identities identity
        on identity.application_user_id = application_user.id
       and identity.identity_connection_id = connection.id
      where membership.tenant_id = ${tenantId}
        and membership.organization_id = ${organizationId}
      order by application_user.display_name, application_user.id
    `.execute(this.database.client);

    return result.rows.map((row) => ({
      applicationUserId: row.application_user_id,
      displayName: row.display_name,
      email: row.primary_email,
      membershipStatus: row.membership_status,
      identityStatus: row.identity_status,
      cognitoSubject: row.cognito_subject,
      isSynthetic: row.is_synthetic,
    }));
  }
}
