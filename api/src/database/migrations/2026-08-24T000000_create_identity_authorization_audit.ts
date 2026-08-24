import { Kysely, sql } from 'kysely';

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    create table tenants (
      id uuid primary key default gen_random_uuid(),
      code varchar(32) not null unique,
      name varchar(200) not null,
      status varchar(16) not null default 'active',
      is_synthetic boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint tenants_code_format_check
        check (code ~ '^[A-Z0-9][A-Z0-9-]{1,31}$'),
      constraint tenants_status_check
        check (status in ('active', 'suspended', 'closed'))
    )
  `.execute(database);

  await sql`
    create table organizations (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants(id) on delete restrict,
      parent_organization_id uuid,
      kind varchar(16) not null,
      code varchar(32) not null,
      name varchar(200) not null,
      is_synthetic boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint organizations_kind_check
        check (kind in ('group', 'practice')),
      constraint organizations_code_format_check
        check (code ~ '^[A-Z0-9][A-Z0-9-]{1,31}$'),
      constraint organizations_not_own_parent_check
        check (parent_organization_id is null or parent_organization_id <> id),
      constraint organizations_tenant_code_unique unique (tenant_id, code),
      constraint organizations_tenant_id_id_unique unique (tenant_id, id),
      constraint organizations_parent_same_tenant_fk
        foreign key (tenant_id, parent_organization_id)
        references organizations(tenant_id, id) on delete restrict
    )
  `.execute(database);

  await sql`
    alter table facilities
      add column tenant_id uuid,
      add column organization_id uuid
  `.execute(database);

  await sql`
    insert into tenants (id, code, name, is_synthetic, created_at, updated_at)
    select id, code, name, is_synthetic, created_at, updated_at
    from facilities
  `.execute(database);

  await sql`
    insert into organizations (
      id,
      tenant_id,
      kind,
      code,
      name,
      is_synthetic,
      created_at,
      updated_at
    )
    select
      id,
      id,
      'practice',
      code,
      name,
      is_synthetic,
      created_at,
      updated_at
    from facilities
  `.execute(database);

  await sql`
    update facilities
    set tenant_id = id,
        organization_id = id
    where tenant_id is null
       or organization_id is null
  `.execute(database);

  await sql`
    alter table facilities
      alter column tenant_id set not null,
      alter column organization_id set not null,
      add constraint facilities_tenant_fk
        foreign key (tenant_id) references tenants(id) on delete restrict,
      add constraint facilities_tenant_id_id_unique unique (tenant_id, id),
      add constraint facilities_organization_same_tenant_fk
        foreign key (tenant_id, organization_id)
        references organizations(tenant_id, id) on delete restrict
  `.execute(database);

  await sql`
    create index organizations_parent_idx
      on organizations (tenant_id, parent_organization_id)
      where parent_organization_id is not null
  `.execute(database);

  await sql`
    create function prevent_organization_cycle()
    returns trigger
    language plpgsql
    as $function$
    begin
      if new.parent_organization_id is null then
        return new;
      end if;

      if exists (
        with recursive ancestors as (
          select id, parent_organization_id
          from organizations
          where id = new.parent_organization_id

          union all

          select organization.id, organization.parent_organization_id
          from organizations organization
          join ancestors on organization.id = ancestors.parent_organization_id
        )
        select 1 from ancestors where id = new.id
      ) then
        raise exception 'Organization hierarchy cannot contain a cycle.'
          using errcode = '23514';
      end if;

      return new;
    end;
    $function$
  `.execute(database);

  await sql`
    create trigger organizations_no_cycle
    before insert or update of parent_organization_id on organizations
    for each row execute function prevent_organization_cycle()
  `.execute(database);

  await sql`
    create index facilities_organization_idx
      on facilities (tenant_id, organization_id)
  `.execute(database);

  await sql`
    create table application_users (
      id uuid primary key default gen_random_uuid(),
      display_name varchar(200) not null,
      primary_email varchar(320),
      status varchar(16) not null default 'active',
      is_synthetic boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint application_users_status_check
        check (status in ('active', 'suspended', 'closed')),
      constraint application_users_email_check
        check (primary_email is null or position('@' in primary_email) > 1)
    )
  `.execute(database);

  await sql`
    create table identity_connections (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants(id) on delete restrict,
      code varchar(64) not null,
      name varchar(200) not null,
      protocol varchar(16) not null,
      issuer varchar(500) not null,
      status varchar(16) not null default 'active',
      jit_provisioning_enabled boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint identity_connections_protocol_check
        check (protocol in ('cognito', 'oidc', 'saml')),
      constraint identity_connections_status_check
        check (status in ('active', 'suspended')),
      constraint identity_connections_code_check
        check (code ~ '^[a-z][a-z0-9-]{1,63}$'),
      constraint identity_connections_tenant_code_unique
        unique (tenant_id, code)
    )
  `.execute(database);

  await sql`
    create table user_identities (
      id uuid primary key default gen_random_uuid(),
      application_user_id uuid not null
        references application_users(id) on delete restrict,
      identity_connection_id uuid not null
        references identity_connections(id) on delete restrict,
      subject varchar(500) not null,
      status varchar(16) not null default 'active',
      last_authenticated_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint user_identities_status_check
        check (status in ('active', 'suspended')),
      constraint user_identities_connection_subject_unique
        unique (identity_connection_id, subject),
      constraint user_identities_user_connection_unique
        unique (application_user_id, identity_connection_id)
    )
  `.execute(database);

  await sql`
    create index user_identities_user_idx
      on user_identities (application_user_id)
  `.execute(database);

  await sql`
    create table organization_memberships (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants(id) on delete restrict,
      organization_id uuid not null,
      application_user_id uuid not null
        references application_users(id) on delete restrict,
      status varchar(16) not null default 'pending',
      provisioning_method varchar(24) not null,
      external_id varchar(500),
      valid_from timestamptz not null default now(),
      valid_until timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint organization_memberships_status_check
        check (status in ('pending', 'active', 'suspended', 'revoked')),
      constraint organization_memberships_provisioning_check
        check (provisioning_method in ('admin_invite', 'jit', 'scim')),
      constraint organization_memberships_validity_check
        check (valid_until is null or valid_until > valid_from),
      constraint organization_memberships_user_org_unique
        unique (application_user_id, organization_id),
      constraint organization_memberships_tenant_id_id_unique
        unique (tenant_id, id),
      constraint organization_memberships_organization_same_tenant_fk
        foreign key (tenant_id, organization_id)
        references organizations(tenant_id, id) on delete restrict
    )
  `.execute(database);

  await sql`
    create index organization_memberships_user_status_idx
      on organization_memberships (application_user_id, status)
  `.execute(database);

  await sql`
    create table membership_facilities (
      tenant_id uuid not null,
      membership_id uuid not null,
      facility_id uuid not null,
      created_at timestamptz not null default now(),
      primary key (membership_id, facility_id),
      constraint membership_facilities_membership_same_tenant_fk
        foreign key (tenant_id, membership_id)
        references organization_memberships(tenant_id, id) on delete cascade,
      constraint membership_facilities_facility_same_tenant_fk
        foreign key (tenant_id, facility_id)
        references facilities(tenant_id, id) on delete restrict
    )
  `.execute(database);

  await sql`
    create index membership_facilities_facility_idx
      on membership_facilities (tenant_id, facility_id)
  `.execute(database);

  await sql`
    create table permissions (
      id uuid primary key default gen_random_uuid(),
      code varchar(100) not null unique,
      name varchar(200) not null,
      description text not null,
      is_delegable boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint permissions_code_format_check
        check (code ~ '^[a-z][a-z0-9_.-]{2,99}$')
    )
  `.execute(database);

  await sql`
    create table roles (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid references tenants(id) on delete restrict,
      code varchar(64) not null,
      name varchar(200) not null,
      description text not null,
      is_system_template boolean not null default false,
      request_policy varchar(24) not null default 'approval_required',
      cloned_from_role_id uuid references roles(id) on delete restrict,
      status varchar(16) not null default 'active',
      created_by_user_id uuid references application_users(id) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint roles_code_format_check
        check (code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
      constraint roles_request_policy_check
        check (request_policy in ('admin_only', 'approval_required')),
      constraint roles_status_check
        check (status in ('active', 'retired')),
      constraint roles_system_template_scope_check
        check (not is_system_template or tenant_id is null),
      constraint roles_clone_check
        check (cloned_from_role_id is null or cloned_from_role_id <> id),
      constraint roles_tenant_id_id_unique unique (tenant_id, id)
    )
  `.execute(database);

  await sql`
    create unique index roles_global_code_unique
      on roles (code)
      where tenant_id is null
  `.execute(database);

  await sql`
    create unique index roles_tenant_code_unique
      on roles (tenant_id, code)
      where tenant_id is not null
  `.execute(database);

  await sql`
    create table role_permissions (
      role_id uuid not null references roles(id) on delete cascade,
      permission_id uuid not null references permissions(id) on delete restrict,
      granted_by_user_id uuid references application_users(id) on delete restrict,
      created_at timestamptz not null default now(),
      primary key (role_id, permission_id)
    )
  `.execute(database);

  await sql`
    create table role_requests (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants(id) on delete restrict,
      membership_id uuid not null,
      role_id uuid not null references roles(id) on delete restrict,
      scope_organization_id uuid not null,
      facility_id uuid,
      include_descendants boolean not null default false,
      requested_by_user_id uuid not null
        references application_users(id) on delete restrict,
      request_reason text not null,
      status varchar(16) not null default 'pending',
      decided_by_user_id uuid references application_users(id) on delete restrict,
      decision_reason text,
      decided_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint role_requests_status_check
        check (status in ('pending', 'approved', 'rejected', 'cancelled')),
      constraint role_requests_reason_check
        check (length(btrim(request_reason)) > 0),
      constraint role_requests_decision_check check (
        (status = 'pending' and decided_by_user_id is null and
          decision_reason is null and decided_at is null)
        or
        (status in ('approved', 'rejected') and
          decided_by_user_id is not null and
          decision_reason is not null and
          length(btrim(decision_reason)) > 0 and
          decided_at is not null)
        or
        (status = 'cancelled' and decided_at is not null)
      ),
      constraint role_requests_no_self_decision_check
        check (decided_by_user_id is null or
          decided_by_user_id <> requested_by_user_id),
      constraint role_requests_descendant_facility_check
        check (not include_descendants or facility_id is null),
      constraint role_requests_membership_same_tenant_fk
        foreign key (tenant_id, membership_id)
        references organization_memberships(tenant_id, id) on delete restrict,
      constraint role_requests_organization_same_tenant_fk
        foreign key (tenant_id, scope_organization_id)
        references organizations(tenant_id, id) on delete restrict,
      constraint role_requests_facility_same_tenant_fk
        foreign key (tenant_id, facility_id)
        references facilities(tenant_id, id) on delete restrict
    )
  `.execute(database);

  await sql`
    create unique index role_requests_one_pending_idx
      on role_requests (
        membership_id,
        role_id,
        scope_organization_id,
        coalesce(facility_id, '00000000-0000-0000-0000-000000000000'::uuid)
      )
      where status = 'pending'
  `.execute(database);

  await sql`
    create table role_assignments (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants(id) on delete restrict,
      membership_id uuid not null,
      role_id uuid not null references roles(id) on delete restrict,
      scope_organization_id uuid not null,
      facility_id uuid,
      include_descendants boolean not null default false,
      assignment_source varchar(24) not null,
      assigned_by_user_id uuid references application_users(id) on delete restrict,
      source_role_request_id uuid references role_requests(id) on delete restrict,
      valid_from timestamptz not null default now(),
      valid_until timestamptz,
      revoked_at timestamptz,
      revoked_by_user_id uuid references application_users(id) on delete restrict,
      revocation_reason text,
      created_at timestamptz not null default now(),
      constraint role_assignments_source_check
        check (assignment_source in ('admin', 'approved_request', 'system_bootstrap')),
      constraint role_assignments_validity_check
        check (valid_until is null or valid_until > valid_from),
      constraint role_assignments_revocation_check check (
        (revoked_at is null and revoked_by_user_id is null and revocation_reason is null)
        or
        (revoked_at is not null and revocation_reason is not null and
          length(btrim(revocation_reason)) > 0)
      ),
      constraint role_assignments_request_source_check check (
        (assignment_source = 'approved_request' and
          source_role_request_id is not null)
        or
        (assignment_source <> 'approved_request' and
          source_role_request_id is null)
      ),
      constraint role_assignments_actor_check check (
        assignment_source = 'system_bootstrap' or assigned_by_user_id is not null
      ),
      constraint role_assignments_descendant_facility_check
        check (not include_descendants or facility_id is null),
      constraint role_assignments_membership_same_tenant_fk
        foreign key (tenant_id, membership_id)
        references organization_memberships(tenant_id, id) on delete restrict,
      constraint role_assignments_organization_same_tenant_fk
        foreign key (tenant_id, scope_organization_id)
        references organizations(tenant_id, id) on delete restrict,
      constraint role_assignments_facility_same_tenant_fk
        foreign key (tenant_id, facility_id)
        references facilities(tenant_id, id) on delete restrict
    )
  `.execute(database);

  await sql`
    create unique index role_assignments_one_active_idx
      on role_assignments (
        membership_id,
        role_id,
        scope_organization_id,
        coalesce(facility_id, '00000000-0000-0000-0000-000000000000'::uuid),
        include_descendants
      )
      where revoked_at is null
  `.execute(database);

  await sql`
    create table approval_limits (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants(id) on delete restrict,
      role_id uuid references roles(id) on delete cascade,
      membership_id uuid,
      operation_code varchar(100) not null,
      currency char(3) not null,
      maximum_amount numeric(19, 4) not null,
      created_by_user_id uuid references application_users(id) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint approval_limits_subject_check
        check ((role_id is null) <> (membership_id is null)),
      constraint approval_limits_operation_code_check
        check (operation_code ~ '^[a-z][a-z0-9_.-]{2,99}$'),
      constraint approval_limits_currency_check
        check (currency ~ '^[A-Z]{3}$'),
      constraint approval_limits_amount_check
        check (maximum_amount >= 0),
      constraint approval_limits_membership_same_tenant_fk
        foreign key (tenant_id, membership_id)
        references organization_memberships(tenant_id, id) on delete cascade
    )
  `.execute(database);

  await sql`
    create unique index approval_limits_role_operation_unique
      on approval_limits (tenant_id, role_id, operation_code, currency)
      where role_id is not null
  `.execute(database);

  await sql`
    create unique index approval_limits_membership_operation_unique
      on approval_limits (tenant_id, membership_id, operation_code, currency)
      where membership_id is not null
  `.execute(database);

  await sql`
    create function enforce_tenant_role_scope()
    returns trigger
    language plpgsql
    as $function$
    declare
      role_tenant_id uuid;
      role_request_policy varchar(24);
    begin
      select tenant_id, request_policy
      into role_tenant_id, role_request_policy
      from roles
      where id = new.role_id;

      if role_tenant_id is not null and role_tenant_id <> new.tenant_id then
        raise exception 'Tenant-local role cannot be used outside its tenant.'
          using errcode = '23514';
      end if;

      if tg_table_name = 'role_requests' and
        role_request_policy <> 'approval_required' then
        raise exception 'This role is restricted to administrator assignment.'
          using errcode = '23514';
      end if;

      return new;
    end;
    $function$
  `.execute(database);

  await sql`
    create trigger role_requests_tenant_role_scope
    before insert or update on role_requests
    for each row execute function enforce_tenant_role_scope()
  `.execute(database);

  await sql`
    create trigger role_assignments_tenant_role_scope
    before insert or update on role_assignments
    for each row execute function enforce_tenant_role_scope()
  `.execute(database);

  await sql`
    create trigger approval_limits_tenant_role_scope
    before insert or update on approval_limits
    for each row
    when (new.role_id is not null)
    execute function enforce_tenant_role_scope()
  `.execute(database);

  await sql`
    create function enforce_role_membership_scope()
    returns trigger
    language plpgsql
    as $function$
    declare
      membership_organization_id uuid;
      request_matches boolean;
    begin
      select organization_id into membership_organization_id
      from organization_memberships
      where tenant_id = new.tenant_id and id = new.membership_id;

      if membership_organization_id is null or not exists (
        with recursive ancestors as (
          select id, parent_organization_id
          from organizations
          where tenant_id = new.tenant_id and id = new.scope_organization_id

          union all

          select organization.id, organization.parent_organization_id
          from organizations organization
          join ancestors on organization.id = ancestors.parent_organization_id
          where organization.tenant_id = new.tenant_id
        )
        select 1 from ancestors where id = membership_organization_id
      ) then
        raise exception 'Role scope must be the membership organization or one of its descendants.'
          using errcode = '23514';
      end if;

      if new.facility_id is not null and not exists (
        select 1
        from facilities
        where tenant_id = new.tenant_id
          and id = new.facility_id
          and organization_id = new.scope_organization_id
      ) then
        raise exception 'Facility scope must belong to the selected organization.'
          using errcode = '23514';
      end if;

      if tg_table_name = 'role_assignments' then
        if new.assignment_source = 'approved_request' then
          select exists (
            select 1
            from role_requests
            where id = new.source_role_request_id
              and tenant_id = new.tenant_id
              and membership_id = new.membership_id
              and role_id = new.role_id
              and scope_organization_id = new.scope_organization_id
              and facility_id is not distinct from new.facility_id
              and include_descendants = new.include_descendants
              and status = 'approved'
          ) into request_matches;

          if not request_matches then
            raise exception 'Approved-request assignment must match an approved role request.'
              using errcode = '23514';
          end if;
        end if;
      end if;

      return new;
    end;
    $function$
  `.execute(database);

  await sql`
    create trigger role_requests_membership_scope
    before insert or update on role_requests
    for each row execute function enforce_role_membership_scope()
  `.execute(database);

  await sql`
    create trigger role_assignments_membership_scope
    before insert or update on role_assignments
    for each row execute function enforce_role_membership_scope()
  `.execute(database);

  await sql`
    create table audit_events (
      id uuid primary key default gen_random_uuid(),
      actor_type varchar(16) not null,
      actor_identifier varchar(200) not null,
      actor_user_id uuid references application_users(id) on delete restrict,
      effective_user_id uuid references application_users(id) on delete restrict,
      tenant_id uuid references tenants(id) on delete restrict,
      organization_id uuid,
      facility_id uuid,
      action varchar(120) not null,
      target_entity_type varchar(120) not null,
      target_entity_id varchar(200) not null,
      outcome varchar(16) not null,
      correlation_id uuid not null,
      reason text not null,
      before_data jsonb,
      after_data jsonb,
      occurred_at timestamptz not null default now(),
      constraint audit_events_actor_type_check
        check (actor_type in ('user', 'service', 'system')),
      constraint audit_events_actor_identifier_check
        check (length(btrim(actor_identifier)) > 0),
      constraint audit_events_user_actor_check
        check (actor_type <> 'user' or actor_user_id is not null),
      constraint audit_events_organization_scope_check
        check (organization_id is null or tenant_id is not null),
      constraint audit_events_facility_scope_check
        check (facility_id is null or tenant_id is not null),
      constraint audit_events_organization_same_tenant_fk
        foreign key (tenant_id, organization_id)
        references organizations(tenant_id, id) on delete restrict,
      constraint audit_events_facility_same_tenant_fk
        foreign key (tenant_id, facility_id)
        references facilities(tenant_id, id) on delete restrict,
      constraint audit_events_outcome_check
        check (outcome in ('success', 'denied', 'failure')),
      constraint audit_events_action_check
        check (length(btrim(action)) > 0),
      constraint audit_events_target_check
        check (length(btrim(target_entity_type)) > 0 and
          length(btrim(target_entity_id)) > 0),
      constraint audit_events_reason_check
        check (length(btrim(reason)) > 0),
      constraint audit_events_before_object_check
        check (before_data is null or jsonb_typeof(before_data) = 'object'),
      constraint audit_events_after_object_check
        check (after_data is null or jsonb_typeof(after_data) = 'object')
    )
  `.execute(database);

  await sql`
    create index audit_events_tenant_time_idx
      on audit_events (tenant_id, occurred_at desc)
  `.execute(database);

  await sql`
    create index audit_events_target_idx
      on audit_events (target_entity_type, target_entity_id, occurred_at desc)
  `.execute(database);

  await sql`
    create index audit_events_actor_idx
      on audit_events (actor_user_id, occurred_at desc)
      where actor_user_id is not null
  `.execute(database);

  await sql`
    create function prevent_audit_event_mutation()
    returns trigger
    language plpgsql
    as $function$
    begin
      raise exception 'Committed audit events are append-only.'
        using errcode = '55000';
    end;
    $function$
  `.execute(database);

  await sql`
    create trigger audit_events_no_update_or_delete
    before update or delete on audit_events
    for each row execute function prevent_audit_event_mutation()
  `.execute(database);

  await sql`
    create trigger audit_events_no_truncate
    before truncate on audit_events
    for each statement execute function prevent_audit_event_mutation()
  `.execute(database);

  await sql`
    insert into permissions (code, name, description, is_delegable)
    values
      ('site.roles.manage', 'Manage global roles', 'Manage the global permission catalogue and role templates.', false),
      ('tenant.memberships.manage', 'Manage memberships', 'Invite, suspend, and restore memberships within the assigned tenant scope.', true),
      ('tenant.memberships.manage_descendants', 'Manage descendant memberships', 'Manage memberships in explicitly delegated descendant organizations.', true),
      ('tenant.roles.manage', 'Manage local roles', 'Create and update tenant-local roles from delegable permissions.', true),
      ('tenant.roles.approve', 'Approve role requests', 'Approve or reject role requests within the assigned tenant scope.', true),
      ('patients.read', 'Read patient records', 'Read non-confidential patient records in the assigned scope.', true),
      ('patients.write', 'Update patient records', 'Create and update patient records in the assigned scope.', true),
      ('confidential-records.read', 'Read confidential records', 'Read confidential patient records in the assigned scope.', false),
      ('break-glass.use', 'Use break glass', 'Request emergency access with a mandatory reason and audit trail.', false),
      ('scheduling.manage', 'Manage scheduling', 'Create and update appointments and resource schedules.', true),
      ('billing.read', 'Read billing', 'Read billing and payment records in the assigned scope.', true),
      ('billing.manage', 'Manage billing', 'Create and update permitted billing records and transactions.', true),
      ('billing.approve', 'Approve billing', 'Approve configured financial operations within effective limits.', false),
      ('audit.read', 'Read audit events', 'Search approved audit-event fields in the assigned scope.', false)
  `.execute(database);

  await sql`
    insert into roles (
      code,
      name,
      description,
      is_system_template,
      request_policy
    )
    values
      ('SITE_ADMIN', 'Site administrator', 'Platform-level administration of global permissions and role templates.', true, 'admin_only'),
      ('PRACTICE_ADMIN', 'Practice administrator', 'Practice membership, local-role, and operational administration.', true, 'admin_only'),
      ('ACCESS_ADMIN', 'Access administrator', 'Scoped membership administration and role-request decisions.', true, 'admin_only'),
      ('RECEPTION', 'Reception and registration', 'Patient registration and front-desk workflows.', true, 'approval_required'),
      ('SCHEDULER', 'Scheduler', 'Appointment and resource scheduling workflows.', true, 'approval_required'),
      ('PHYSICIAN', 'Physician', 'Licensed physician clinical workflows.', true, 'approval_required'),
      ('NURSE', 'Nurse or clinical assistant', 'Nursing and delegated clinical workflows.', true, 'approval_required'),
      ('BILLING_OFFICER', 'Billing officer', 'Billing preparation and payment-recording workflows.', true, 'approval_required'),
      ('BILLING_APPROVER', 'Billing approver', 'Financial approval workflows subject to configured limits.', true, 'admin_only'),
      ('AUDITOR', 'Auditor or compliance reviewer', 'Read-only approved audit and compliance workflows.', true, 'admin_only')
  `.execute(database);

  await sql`
    insert into role_permissions (role_id, permission_id)
    select roles.id, permissions.id
    from (
      values
        ('SITE_ADMIN', 'site.roles.manage'),
        ('PRACTICE_ADMIN', 'tenant.memberships.manage'),
        ('PRACTICE_ADMIN', 'tenant.memberships.manage_descendants'),
        ('PRACTICE_ADMIN', 'tenant.roles.manage'),
        ('PRACTICE_ADMIN', 'tenant.roles.approve'),
        ('ACCESS_ADMIN', 'tenant.memberships.manage'),
        ('ACCESS_ADMIN', 'tenant.roles.approve'),
        ('RECEPTION', 'patients.read'),
        ('RECEPTION', 'patients.write'),
        ('SCHEDULER', 'patients.read'),
        ('SCHEDULER', 'scheduling.manage'),
        ('PHYSICIAN', 'patients.read'),
        ('PHYSICIAN', 'patients.write'),
        ('NURSE', 'patients.read'),
        ('NURSE', 'patients.write'),
        ('BILLING_OFFICER', 'billing.read'),
        ('BILLING_OFFICER', 'billing.manage'),
        ('BILLING_APPROVER', 'billing.read'),
        ('BILLING_APPROVER', 'billing.approve'),
        ('AUDITOR', 'audit.read')
    ) as defaults(role_code, permission_code)
    join roles on roles.code = defaults.role_code and roles.tenant_id is null
    join permissions on permissions.code = defaults.permission_code
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`drop trigger if exists audit_events_no_truncate on audit_events`.execute(
    database,
  );
  await sql`drop trigger if exists audit_events_no_update_or_delete on audit_events`.execute(
    database,
  );
  await sql`drop table audit_events`.execute(database);
  await sql`drop function if exists prevent_audit_event_mutation()`.execute(
    database,
  );

  await sql`drop trigger if exists approval_limits_tenant_role_scope on approval_limits`.execute(
    database,
  );
  await sql`drop trigger if exists role_assignments_tenant_role_scope on role_assignments`.execute(
    database,
  );
  await sql`drop trigger if exists role_requests_tenant_role_scope on role_requests`.execute(
    database,
  );
  await sql`drop trigger if exists role_assignments_membership_scope on role_assignments`.execute(
    database,
  );
  await sql`drop trigger if exists role_requests_membership_scope on role_requests`.execute(
    database,
  );
  await sql`drop table approval_limits`.execute(database);
  await sql`drop table role_assignments`.execute(database);
  await sql`drop table role_requests`.execute(database);
  await sql`drop function if exists enforce_role_membership_scope()`.execute(
    database,
  );
  await sql`drop function if exists enforce_tenant_role_scope()`.execute(
    database,
  );
  await sql`drop table role_permissions`.execute(database);
  await sql`drop table roles`.execute(database);
  await sql`drop table permissions`.execute(database);
  await sql`drop table membership_facilities`.execute(database);
  await sql`drop table organization_memberships`.execute(database);
  await sql`drop table user_identities`.execute(database);
  await sql`drop table identity_connections`.execute(database);
  await sql`drop table application_users`.execute(database);

  await sql`
    alter table facilities
      drop constraint facilities_organization_same_tenant_fk,
      drop constraint facilities_tenant_id_id_unique,
      drop constraint facilities_tenant_fk,
      drop column organization_id,
      drop column tenant_id
  `.execute(database);

  await sql`drop trigger if exists organizations_no_cycle on organizations`.execute(
    database,
  );
  await sql`drop function if exists prevent_organization_cycle()`.execute(
    database,
  );
  await sql`drop table organizations`.execute(database);
  await sql`drop table tenants`.execute(database);
}
