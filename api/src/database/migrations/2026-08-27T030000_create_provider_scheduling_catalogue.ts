import { Kysely, sql } from 'kysely';

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    alter table organizations
      add constraint organizations_tenant_id_id_kind_unique
        unique (tenant_id, id, kind)
  `.execute(database);

  await sql`
    alter table facilities
      add constraint facilities_tenant_organization_id_unique
        unique (tenant_id, organization_id, id),
      add constraint facilities_name_nonblank_check
        check (length(btrim(name)) > 0),
      add constraint facilities_timezone_nonblank_check
        check (length(btrim(timezone)) > 0)
  `.execute(database);

  await sql`
    create table specialties (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants(id) on delete restrict,
      organization_id uuid not null,
      organization_kind varchar(16) not null default 'practice',
      code varchar(64) not null,
      name varchar(200) not null,
      status varchar(16) not null default 'active',
      is_synthetic boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint specialties_code_format_check
        check (code ~ '^[A-Z0-9][A-Z0-9-]{1,63}$'),
      constraint specialties_practice_kind_check
        check (organization_kind = 'practice'),
      constraint specialties_name_nonblank_check
        check (length(btrim(name)) > 0),
      constraint specialties_status_check
        check (status in ('active', 'retired')),
      constraint specialties_practice_fk
        foreign key (tenant_id, organization_id, organization_kind)
        references organizations(tenant_id, id, kind) on delete restrict,
      constraint specialties_practice_code_unique
        unique (tenant_id, organization_id, code),
      constraint specialties_scope_id_unique
        unique (tenant_id, organization_id, id)
    )
  `.execute(database);

  await sql`
    create index specialties_active_practice_name_idx
      on specialties (tenant_id, organization_id, name, id)
      where status = 'active'
  `.execute(database);

  await sql`
    create table practitioner_facility_assignments (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null,
      organization_id uuid not null,
      organization_kind varchar(16) not null default 'practice',
      facility_id uuid not null,
      practitioner_id uuid not null,
      status varchar(16) not null default 'inactive',
      is_synthetic boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint practitioner_facility_assignments_practice_kind_check
        check (organization_kind = 'practice'),
      constraint practitioner_facility_assignments_status_check
        check (status in ('active', 'inactive')),
      constraint practitioner_facility_assignments_practice_fk
        foreign key (tenant_id, organization_id, organization_kind)
        references organizations(tenant_id, id, kind) on delete restrict,
      constraint practitioner_facility_assignments_facility_scope_fk
        foreign key (tenant_id, organization_id, facility_id)
        references facilities(tenant_id, organization_id, id) on delete restrict,
      constraint practitioner_facility_assignments_practitioner_scope_fk
        foreign key (tenant_id, practitioner_id)
        references practitioners(tenant_id, id) on delete restrict,
      constraint practitioner_facility_assignments_practitioner_unique
        unique (tenant_id, organization_id, facility_id, practitioner_id),
      constraint practitioner_facility_assignments_scope_id_unique
        unique (
          id,
          tenant_id,
          organization_id,
          facility_id,
          practitioner_id
        )
    )
  `.execute(database);

  await sql`
    create index practitioner_facility_assignments_active_practice_idx
      on practitioner_facility_assignments (
        tenant_id,
        organization_id,
        practitioner_id,
        facility_id
      )
      where status = 'active'
  `.execute(database);

  await sql`
    create table appointment_services (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants(id) on delete restrict,
      organization_id uuid not null,
      organization_kind varchar(16) not null default 'practice',
      facility_id uuid not null,
      specialty_id uuid not null,
      code varchar(64) not null,
      patient_facing_name varchar(200) not null,
      duration_minutes integer not null,
      allows_any_practitioner boolean not null default false,
      status varchar(16) not null default 'inactive',
      is_synthetic boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint appointment_services_practice_kind_check
        check (organization_kind = 'practice'),
      constraint appointment_services_code_format_check
        check (code ~ '^[A-Z0-9][A-Z0-9-]{1,63}$'),
      constraint appointment_services_name_nonblank_check
        check (length(btrim(patient_facing_name)) > 0),
      constraint appointment_services_duration_check
        check (duration_minutes > 0),
      constraint appointment_services_status_check
        check (status in ('active', 'inactive')),
      constraint appointment_services_practice_fk
        foreign key (tenant_id, organization_id, organization_kind)
        references organizations(tenant_id, id, kind) on delete restrict,
      constraint appointment_services_facility_scope_fk
        foreign key (tenant_id, organization_id, facility_id)
        references facilities(tenant_id, organization_id, id) on delete restrict,
      constraint appointment_services_specialty_scope_fk
        foreign key (tenant_id, organization_id, specialty_id)
        references specialties(tenant_id, organization_id, id) on delete restrict,
      constraint appointment_services_practice_code_unique
        unique (tenant_id, organization_id, code),
      constraint appointment_services_scope_id_unique
        unique (tenant_id, organization_id, facility_id, id)
    )
  `.execute(database);

  await sql`
    create index appointment_services_active_practice_name_idx
      on appointment_services (
        tenant_id,
        organization_id,
        specialty_id,
        patient_facing_name,
        id
      )
      where status = 'active'
  `.execute(database);

  await sql`
    create table practitioner_service_assignments (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null,
      organization_id uuid not null,
      facility_id uuid not null,
      practitioner_facility_assignment_id uuid not null,
      practitioner_id uuid not null,
      appointment_service_id uuid not null,
      status varchar(16) not null default 'inactive',
      is_synthetic boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint practitioner_service_assignments_status_check
        check (status in ('active', 'inactive')),
      constraint practitioner_service_assignments_facility_assignment_scope_fk
        foreign key (
          practitioner_facility_assignment_id,
          tenant_id,
          organization_id,
          facility_id,
          practitioner_id
        ) references practitioner_facility_assignments(
          id,
          tenant_id,
          organization_id,
          facility_id,
          practitioner_id
        ) on delete restrict,
      constraint practitioner_service_assignments_service_scope_fk
        foreign key (
          tenant_id,
          organization_id,
          facility_id,
          appointment_service_id
        ) references appointment_services(
          tenant_id,
          organization_id,
          facility_id,
          id
        ) on delete restrict,
      constraint practitioner_service_assignments_eligibility_unique
        unique (
          tenant_id,
          organization_id,
          facility_id,
          practitioner_facility_assignment_id,
          appointment_service_id,
          practitioner_id
        ),
      constraint practitioner_service_assignments_scope_id_unique
        unique (
          id,
          tenant_id,
          organization_id,
          facility_id,
          practitioner_facility_assignment_id,
          appointment_service_id,
          practitioner_id
        )
    )
  `.execute(database);

  await sql`
    create index practitioner_service_assignments_active_practice_idx
      on practitioner_service_assignments (
        tenant_id,
        organization_id,
        appointment_service_id,
        practitioner_facility_assignment_id,
        practitioner_id
      )
      where status = 'active'
  `.execute(database);

  await sql`
    create index practitioner_service_assignments_active_practitioner_idx
      on practitioner_service_assignments (
        tenant_id,
        practitioner_id,
        organization_id,
        facility_id,
        appointment_service_id
      )
      where status = 'active'
  `.execute(database);

  await sql`
    create function prevent_specialty_retargeting()
    returns trigger
    language plpgsql
    as $function$
    begin
      if new.id is distinct from old.id
         or new.tenant_id is distinct from old.tenant_id
         or new.organization_id is distinct from old.organization_id
         or new.organization_kind is distinct from old.organization_kind
         or new.code is distinct from old.code then
        raise exception 'Specialty identity is immutable.'
          using errcode = '23514';
      end if;

      return new;
    end;
    $function$
  `.execute(database);

  await sql`
    create trigger specialties_identity_no_retarget
    before update of
      id,
      tenant_id,
      organization_id,
      organization_kind,
      code
    on specialties
    for each row execute function prevent_specialty_retargeting()
  `.execute(database);

  await sql`
    create function prevent_practitioner_facility_assignment_retargeting()
    returns trigger
    language plpgsql
    as $function$
    begin
      if new.id is distinct from old.id
         or new.tenant_id is distinct from old.tenant_id
         or new.organization_id is distinct from old.organization_id
         or new.organization_kind is distinct from old.organization_kind
         or new.facility_id is distinct from old.facility_id
         or new.practitioner_id is distinct from old.practitioner_id then
        raise exception 'Practitioner facility assignment identity and scope are immutable.'
          using errcode = '23514';
      end if;

      return new;
    end;
    $function$
  `.execute(database);

  await sql`
    create trigger practitioner_facility_assignments_identity_no_retarget
    before update of
      id,
      tenant_id,
      organization_id,
      organization_kind,
      facility_id,
      practitioner_id
    on practitioner_facility_assignments
    for each row execute function prevent_practitioner_facility_assignment_retargeting()
  `.execute(database);

  await sql`
    create function prevent_appointment_service_retargeting()
    returns trigger
    language plpgsql
    as $function$
    begin
      if new.id is distinct from old.id
         or new.tenant_id is distinct from old.tenant_id
         or new.organization_id is distinct from old.organization_id
         or new.organization_kind is distinct from old.organization_kind
         or new.facility_id is distinct from old.facility_id
         or new.specialty_id is distinct from old.specialty_id
         or new.code is distinct from old.code then
        raise exception 'Appointment service identity and scope are immutable.'
          using errcode = '23514';
      end if;

      return new;
    end;
    $function$
  `.execute(database);

  await sql`
    create trigger appointment_services_identity_no_retarget
    before update of
      id,
      tenant_id,
      organization_id,
      organization_kind,
      facility_id,
      specialty_id,
      code
    on appointment_services
    for each row execute function prevent_appointment_service_retargeting()
  `.execute(database);

  await sql`
    create function prevent_practitioner_service_assignment_retargeting()
    returns trigger
    language plpgsql
    as $function$
    begin
      if new.id is distinct from old.id
         or new.tenant_id is distinct from old.tenant_id
         or new.organization_id is distinct from old.organization_id
         or new.facility_id is distinct from old.facility_id
         or new.practitioner_facility_assignment_id is distinct from old.practitioner_facility_assignment_id
         or new.practitioner_id is distinct from old.practitioner_id
         or new.appointment_service_id is distinct from old.appointment_service_id then
        raise exception 'Practitioner service assignment identity and scope are immutable.'
          using errcode = '23514';
      end if;

      return new;
    end;
    $function$
  `.execute(database);

  await sql`
    create trigger practitioner_service_assignments_identity_no_retarget
    before update of
      id,
      tenant_id,
      organization_id,
      facility_id,
      practitioner_facility_assignment_id,
      practitioner_id,
      appointment_service_id
    on practitioner_service_assignments
    for each row execute function prevent_practitioner_service_assignment_retargeting()
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`
    drop trigger if exists practitioner_service_assignments_identity_no_retarget
      on practitioner_service_assignments
  `.execute(database);
  await sql`
    drop trigger if exists appointment_services_identity_no_retarget
      on appointment_services
  `.execute(database);
  await sql`
    drop trigger if exists practitioner_facility_assignments_identity_no_retarget
      on practitioner_facility_assignments
  `.execute(database);
  await sql`
    drop trigger if exists specialties_identity_no_retarget on specialties
  `.execute(database);

  await sql`drop table if exists practitioner_service_assignments`.execute(
    database,
  );
  await sql`drop table if exists appointment_services`.execute(database);
  await sql`drop table if exists practitioner_facility_assignments`.execute(
    database,
  );
  await sql`drop table if exists specialties`.execute(database);

  await sql`
    drop function if exists prevent_practitioner_service_assignment_retargeting()
  `.execute(database);
  await sql`
    drop function if exists prevent_appointment_service_retargeting()
  `.execute(database);
  await sql`
    drop function if exists prevent_practitioner_facility_assignment_retargeting()
  `.execute(database);
  await sql`drop function if exists prevent_specialty_retargeting()`.execute(
    database,
  );

  await sql`
    alter table facilities
      drop constraint if exists facilities_timezone_nonblank_check,
      drop constraint if exists facilities_name_nonblank_check,
      drop constraint if exists facilities_tenant_organization_id_unique
  `.execute(database);

  await sql`
    alter table organizations
      drop constraint if exists organizations_tenant_id_id_kind_unique
  `.execute(database);
}
