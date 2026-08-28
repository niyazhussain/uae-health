import { Kysely, sql } from 'kysely';

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`create extension if not exists btree_gist with schema public`.execute(
    database,
  );

  await sql`
    create table practitioner_availability_templates (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null,
      organization_id uuid not null,
      facility_id uuid not null,
      practitioner_facility_assignment_id uuid not null,
      practitioner_service_assignment_id uuid not null,
      practitioner_id uuid not null,
      appointment_service_id uuid not null,
      iso_weekday smallint not null,
      local_start_minute smallint not null,
      local_end_minute smallint not null,
      effective_from date not null,
      effective_until date,
      source_timezone varchar(64) not null,
      status varchar(16) not null default 'inactive',
      is_synthetic boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint practitioner_availability_templates_weekday_check
        check (iso_weekday between 1 and 7),
      constraint practitioner_availability_templates_minutes_check
        check (
          local_start_minute between 0 and 1439
          and local_end_minute between 1 and 1440
          and local_end_minute > local_start_minute
        ),
      constraint practitioner_availability_templates_dates_check
        check (effective_until is null or effective_until >= effective_from),
      constraint practitioner_availability_templates_timezone_check
        check (length(btrim(source_timezone)) > 0),
      constraint practitioner_availability_templates_status_check
        check (status in ('active', 'inactive')),
      constraint practitioner_availability_templates_assignment_scope_fk
        foreign key (
          practitioner_service_assignment_id,
          tenant_id,
          organization_id,
          facility_id,
          practitioner_facility_assignment_id,
          appointment_service_id,
          practitioner_id
        ) references practitioner_service_assignments(
          id,
          tenant_id,
          organization_id,
          facility_id,
          practitioner_facility_assignment_id,
          appointment_service_id,
          practitioner_id
        ) on delete restrict,
      constraint practitioner_availability_templates_definition_unique
        unique nulls not distinct (
          practitioner_service_assignment_id,
          iso_weekday,
          local_start_minute,
          local_end_minute,
          effective_from,
          effective_until,
          source_timezone
        ),
      constraint practitioner_availability_templates_scope_id_unique
        unique (
          id,
          tenant_id,
          organization_id,
          facility_id,
          practitioner_facility_assignment_id,
          practitioner_service_assignment_id,
          appointment_service_id,
          practitioner_id,
          source_timezone
        ),
      constraint practitioner_availability_templates_active_overlap
        exclude using gist (
          tenant_id with =,
          practitioner_id with =,
          source_timezone with =,
          (
            int4range(
              ((iso_weekday - 1) * 1440) + local_start_minute,
              ((iso_weekday - 1) * 1440) + local_end_minute,
              '[)'
            )
          ) with &&,
          (
            daterange(
              effective_from,
              case
                when effective_until is null then 'infinity'::date
                else effective_until + 1
              end,
              '[)'
            )
          ) with &&
        ) where (status = 'active')
    )
  `.execute(database);

  await sql`
    create index practitioner_availability_templates_active_scope_idx
      on practitioner_availability_templates (
        tenant_id,
        organization_id,
        practitioner_service_assignment_id,
        effective_from,
        effective_until,
        iso_weekday
      )
      where status = 'active'
  `.execute(database);

  await sql`
    create function prevent_practitioner_availability_template_retargeting()
    returns trigger
    language plpgsql
    as $function$
    begin
      if new.id is distinct from old.id
         or new.tenant_id is distinct from old.tenant_id
         or new.organization_id is distinct from old.organization_id
         or new.facility_id is distinct from old.facility_id
         or new.practitioner_facility_assignment_id
            is distinct from old.practitioner_facility_assignment_id
         or new.practitioner_service_assignment_id
            is distinct from old.practitioner_service_assignment_id
         or new.practitioner_id is distinct from old.practitioner_id
         or new.appointment_service_id
            is distinct from old.appointment_service_id
         or new.iso_weekday is distinct from old.iso_weekday
         or new.local_start_minute is distinct from old.local_start_minute
         or new.local_end_minute is distinct from old.local_end_minute
         or new.effective_from is distinct from old.effective_from
         or new.effective_until is distinct from old.effective_until
         or new.source_timezone is distinct from old.source_timezone then
        raise exception 'Practitioner availability template definition and scope are immutable.'
          using errcode = '23514';
      end if;

      return new;
    end;
    $function$
  `.execute(database);

  await sql`
    create trigger practitioner_availability_templates_identity_no_retarget
    before update of
      id,
      tenant_id,
      organization_id,
      facility_id,
      practitioner_facility_assignment_id,
      practitioner_service_assignment_id,
      practitioner_id,
      appointment_service_id,
      iso_weekday,
      local_start_minute,
      local_end_minute,
      effective_from,
      effective_until,
      source_timezone
    on practitioner_availability_templates
    for each row
    execute function prevent_practitioner_availability_template_retargeting()
  `.execute(database);

  await sql`
    create table provider_availability_exceptions (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null,
      organization_id uuid not null,
      organization_kind varchar(16) not null default 'practice',
      facility_id uuid not null,
      practitioner_facility_assignment_id uuid,
      practitioner_id uuid,
      kind varchar(32) not null,
      is_all_day boolean not null default false,
      local_starts_at timestamp without time zone not null,
      local_ends_at timestamp without time zone not null,
      starts_at timestamptz not null,
      ends_at timestamptz not null,
      source_timezone varchar(64) not null,
      status varchar(16) not null default 'active',
      is_synthetic boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint provider_availability_exceptions_practice_kind_check
        check (organization_kind = 'practice'),
      constraint provider_availability_exceptions_kind_check
        check (kind in ('facility_closed', 'practitioner_unavailable')),
      constraint provider_availability_exceptions_scope_shape_check
        check (
          (
            kind = 'facility_closed'
            and practitioner_facility_assignment_id is null
            and practitioner_id is null
          )
          or
          (
            kind = 'practitioner_unavailable'
            and practitioner_facility_assignment_id is not null
            and practitioner_id is not null
          )
        ),
      constraint provider_availability_exceptions_local_time_check
        check (local_ends_at > local_starts_at),
      constraint provider_availability_exceptions_all_day_check
        check (
          not is_all_day
          or (
            local_starts_at::time = time '00:00:00'
            and local_ends_at::time = time '00:00:00'
            and local_ends_at::date = local_starts_at::date + 1
          )
        ),
      constraint provider_availability_exceptions_utc_time_check
        check (ends_at > starts_at),
      constraint provider_availability_exceptions_timezone_check
        check (length(btrim(source_timezone)) > 0),
      constraint provider_availability_exceptions_status_check
        check (status in ('active', 'cancelled')),
      constraint provider_availability_exceptions_practice_fk
        foreign key (tenant_id, organization_id, organization_kind)
        references organizations(tenant_id, id, kind) on delete restrict,
      constraint provider_availability_exceptions_facility_scope_fk
        foreign key (tenant_id, organization_id, facility_id)
        references facilities(tenant_id, organization_id, id) on delete restrict,
      constraint provider_availability_exceptions_assignment_scope_fk
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
        ) on delete restrict
    )
  `.execute(database);

  await sql`
    create unique index provider_availability_exceptions_facility_unique
      on provider_availability_exceptions (
        tenant_id,
        organization_id,
        facility_id,
        starts_at,
        ends_at
      )
      where status = 'active'
        and kind = 'facility_closed'
  `.execute(database);

  await sql`
    create unique index provider_availability_exceptions_practitioner_unique
      on provider_availability_exceptions (
        practitioner_facility_assignment_id,
        starts_at,
        ends_at
      )
      where status = 'active'
        and kind = 'practitioner_unavailable'
  `.execute(database);

  await sql`
    create index provider_availability_exceptions_active_facility_idx
      on provider_availability_exceptions using gist (
        tenant_id,
        organization_id,
        facility_id,
        (tstzrange(starts_at, ends_at, '[)'))
      )
      where status = 'active'
  `.execute(database);

  await sql`
    create index provider_availability_exceptions_active_practitioner_idx
      on provider_availability_exceptions using gist (
        tenant_id,
        practitioner_id,
        (tstzrange(starts_at, ends_at, '[)'))
      )
      where status = 'active'
        and practitioner_id is not null
  `.execute(database);

  await sql`
    create function prevent_provider_availability_exception_retargeting()
    returns trigger
    language plpgsql
    as $function$
    begin
      if new.id is distinct from old.id
         or new.tenant_id is distinct from old.tenant_id
         or new.organization_id is distinct from old.organization_id
         or new.organization_kind is distinct from old.organization_kind
         or new.facility_id is distinct from old.facility_id
         or new.practitioner_facility_assignment_id
            is distinct from old.practitioner_facility_assignment_id
         or new.practitioner_id is distinct from old.practitioner_id
         or new.kind is distinct from old.kind
         or new.is_all_day is distinct from old.is_all_day
         or new.local_starts_at is distinct from old.local_starts_at
         or new.local_ends_at is distinct from old.local_ends_at
         or new.starts_at is distinct from old.starts_at
         or new.ends_at is distinct from old.ends_at
         or new.source_timezone is distinct from old.source_timezone then
        raise exception 'Provider availability exception definition and scope are immutable.'
          using errcode = '23514';
      end if;

      return new;
    end;
    $function$
  `.execute(database);

  await sql`
    create trigger provider_availability_exceptions_identity_no_retarget
    before update of
      id,
      tenant_id,
      organization_id,
      organization_kind,
      facility_id,
      practitioner_facility_assignment_id,
      practitioner_id,
      kind,
      is_all_day,
      local_starts_at,
      local_ends_at,
      starts_at,
      ends_at,
      source_timezone
    on provider_availability_exceptions
    for each row
    execute function prevent_provider_availability_exception_retargeting()
  `.execute(database);

  await sql`
    alter table patient_portal_appointment_slots
      drop constraint pp_appointment_slots_practice_start_unique,
      add column facility_id uuid,
      add column practitioner_facility_assignment_id uuid,
      add column practitioner_service_assignment_id uuid,
      add column practitioner_id uuid,
      add column appointment_service_id uuid,
      add column availability_template_id uuid,
      add column generation_key_hash char(64),
      add column source_local_date date,
      add column source_timezone varchar(64),
      add constraint pp_appointment_slots_provider_bundle_check
        check (
          num_nonnulls(
            facility_id,
            practitioner_facility_assignment_id,
            practitioner_service_assignment_id,
            practitioner_id,
            appointment_service_id,
            availability_template_id,
            generation_key_hash,
            source_local_date,
            source_timezone
          ) in (0, 9)
        ),
      add constraint pp_appointment_slots_generation_hash_check
        check (
          generation_key_hash is null
          or generation_key_hash ~ '^[0-9a-f]{64}$'
        ),
      add constraint pp_appointment_slots_source_timezone_check
        check (
          source_timezone is null
          or length(btrim(source_timezone)) > 0
        ),
      add constraint pp_appointment_slots_assignment_scope_fk
        foreign key (
          practitioner_service_assignment_id,
          tenant_id,
          organization_id,
          facility_id,
          practitioner_facility_assignment_id,
          appointment_service_id,
          practitioner_id
        ) references practitioner_service_assignments(
          id,
          tenant_id,
          organization_id,
          facility_id,
          practitioner_facility_assignment_id,
          appointment_service_id,
          practitioner_id
        ) on delete restrict,
      add constraint pp_appointment_slots_template_scope_fk
        foreign key (
          availability_template_id,
          tenant_id,
          organization_id,
          facility_id,
          practitioner_facility_assignment_id,
          practitioner_service_assignment_id,
          appointment_service_id,
          practitioner_id,
          source_timezone
        ) references practitioner_availability_templates(
          id,
          tenant_id,
          organization_id,
          facility_id,
          practitioner_facility_assignment_id,
          practitioner_service_assignment_id,
          appointment_service_id,
          practitioner_id,
          source_timezone
        ) on delete restrict,
      add constraint pp_appointment_slots_provider_scope_id_unique
        unique (
          id,
          tenant_id,
          organization_id,
          facility_id,
          practitioner_facility_assignment_id,
          practitioner_service_assignment_id,
          appointment_service_id,
          practitioner_id
        ),
      add constraint pp_appointment_slots_practitioner_time_no_overlap
        exclude using gist (
          tenant_id with =,
          practitioner_id with =,
          (tstzrange(starts_at, ends_at, '[)')) with &&
        ) where (status = 'available' and practitioner_id is not null)
  `.execute(database);

  await sql`
    create unique index pp_appointment_slots_generic_practice_start_unique
      on patient_portal_appointment_slots (bookable_practice_id, starts_at)
      where practitioner_service_assignment_id is null
  `.execute(database);

  await sql`
    create unique index pp_appointment_slots_provider_generation_unique
      on patient_portal_appointment_slots (
        availability_template_id,
        generation_key_hash
      )
      where availability_template_id is not null
  `.execute(database);

  await sql`
    create index pp_appointment_slots_provider_discovery_idx
      on patient_portal_appointment_slots (
        tenant_id,
        organization_id,
        appointment_service_id,
        facility_id,
        practitioner_id,
        starts_at
      )
      where status = 'available'
        and practitioner_service_assignment_id is not null
  `.execute(database);

  await sql`
    create function prevent_provider_appointment_slot_retargeting()
    returns trigger
    language plpgsql
    as $function$
    begin
      if new.id is distinct from old.id
         or new.bookable_practice_id is distinct from old.bookable_practice_id
         or new.tenant_id is distinct from old.tenant_id
         or new.organization_id is distinct from old.organization_id
         or new.starts_at is distinct from old.starts_at
         or new.ends_at is distinct from old.ends_at then
        raise exception 'Appointment slot identity, scope, and time are immutable.'
          using errcode = '23514';
      end if;

      if old.practitioner_service_assignment_id is not null
         and (
           new.facility_id is distinct from old.facility_id
           or new.practitioner_facility_assignment_id
              is distinct from old.practitioner_facility_assignment_id
           or new.practitioner_service_assignment_id
              is distinct from old.practitioner_service_assignment_id
           or new.practitioner_id is distinct from old.practitioner_id
           or new.appointment_service_id
              is distinct from old.appointment_service_id
           or new.availability_template_id
              is distinct from old.availability_template_id
           or new.generation_key_hash is distinct from old.generation_key_hash
           or new.source_local_date is distinct from old.source_local_date
           or new.source_timezone is distinct from old.source_timezone
         ) then
        raise exception 'Appointment slot provider binding is immutable.'
          using errcode = '23514';
      end if;

      return new;
    end;
    $function$
  `.execute(database);

  await sql`
    create trigger pp_appointment_slots_identity_no_retarget
    before update of
      id,
      bookable_practice_id,
      tenant_id,
      organization_id,
      starts_at,
      ends_at,
      facility_id,
      practitioner_facility_assignment_id,
      practitioner_service_assignment_id,
      practitioner_id,
      appointment_service_id,
      availability_template_id,
      generation_key_hash,
      source_local_date,
      source_timezone
    on patient_portal_appointment_slots
    for each row execute function prevent_provider_appointment_slot_retargeting()
  `.execute(database);

  await sql`
    create function prevent_live_appointment_slot_withdrawal()
    returns trigger
    language plpgsql
    as $function$
    begin
      if old.status = 'available'
         and new.status = 'withdrawn'
         and exists (
           select 1
           from patient_portal_appointments appointment
           where appointment.appointment_slot_id = old.id
             and appointment.status in ('requested', 'confirmed')
         ) then
        raise exception 'A slot with a live appointment cannot be withdrawn.'
          using errcode = '23514';
      end if;

      return new;
    end;
    $function$
  `.execute(database);

  await sql`
    create trigger pp_appointment_slots_live_no_withdrawal
    before update of status on patient_portal_appointment_slots
    for each row execute function prevent_live_appointment_slot_withdrawal()
  `.execute(database);

  await sql`
    alter table patient_portal_appointments
      add column facility_id uuid,
      add column practitioner_facility_assignment_id uuid,
      add column practitioner_service_assignment_id uuid,
      add column practitioner_id uuid,
      add column appointment_service_id uuid,
      add constraint pp_appointments_provider_bundle_check
        check (
          num_nonnulls(
            facility_id,
            practitioner_facility_assignment_id,
            practitioner_service_assignment_id,
            practitioner_id,
            appointment_service_id
          ) in (0, 5)
        ),
      add constraint pp_appointments_provider_slot_scope_fk
        foreign key (
          appointment_slot_id,
          tenant_id,
          organization_id,
          facility_id,
          practitioner_facility_assignment_id,
          practitioner_service_assignment_id,
          appointment_service_id,
          practitioner_id
        ) references patient_portal_appointment_slots(
          id,
          tenant_id,
          organization_id,
          facility_id,
          practitioner_facility_assignment_id,
          practitioner_service_assignment_id,
          appointment_service_id,
          practitioner_id
        ) on delete restrict
  `.execute(database);

  await sql`
    create function enforce_appointment_provider_slot_parity()
    returns trigger
    language plpgsql
    as $function$
    declare
      slot_practitioner_service_assignment_id uuid;
    begin
      select slot.practitioner_service_assignment_id
        into slot_practitioner_service_assignment_id
      from patient_portal_appointment_slots slot
      where slot.id = new.appointment_slot_id
        and slot.tenant_id = new.tenant_id
        and slot.organization_id = new.organization_id
      for share;

      if found and (
        (slot_practitioner_service_assignment_id is null)
        is distinct from
        (new.practitioner_service_assignment_id is null)
      ) then
        raise exception 'Appointment provider scope must match its selected slot.'
          using errcode = '23514';
      end if;

      return new;
    end;
    $function$
  `.execute(database);

  await sql`
    create trigger pp_appointments_provider_slot_parity
    before insert or update of
      appointment_slot_id,
      tenant_id,
      organization_id,
      facility_id,
      practitioner_facility_assignment_id,
      practitioner_service_assignment_id,
      practitioner_id,
      appointment_service_id
    on patient_portal_appointments
    for each row execute function enforce_appointment_provider_slot_parity()
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`
    drop trigger if exists pp_appointments_provider_slot_parity
      on patient_portal_appointments
  `.execute(database);

  await sql`
    alter table patient_portal_appointments
      drop constraint if exists pp_appointments_provider_slot_scope_fk,
      drop constraint if exists pp_appointments_provider_bundle_check,
      drop column if exists appointment_service_id,
      drop column if exists practitioner_id,
      drop column if exists practitioner_service_assignment_id,
      drop column if exists practitioner_facility_assignment_id,
      drop column if exists facility_id
  `.execute(database);

  await sql`
    drop trigger if exists pp_appointment_slots_live_no_withdrawal
      on patient_portal_appointment_slots
  `.execute(database);
  await sql`
    drop trigger if exists pp_appointment_slots_identity_no_retarget
      on patient_portal_appointment_slots
  `.execute(database);

  await sql`
    drop index if exists pp_appointment_slots_provider_discovery_idx
  `.execute(database);
  await sql`
    drop index if exists pp_appointment_slots_provider_generation_unique
  `.execute(database);
  await sql`
    drop index if exists pp_appointment_slots_generic_practice_start_unique
  `.execute(database);

  await sql`
    alter table patient_portal_appointment_slots
      drop constraint if exists pp_appointment_slots_practitioner_time_no_overlap,
      drop constraint if exists pp_appointment_slots_provider_scope_id_unique,
      drop constraint if exists pp_appointment_slots_template_scope_fk,
      drop constraint if exists pp_appointment_slots_assignment_scope_fk,
      drop constraint if exists pp_appointment_slots_source_timezone_check,
      drop constraint if exists pp_appointment_slots_generation_hash_check,
      drop constraint if exists pp_appointment_slots_provider_bundle_check,
      drop column if exists source_timezone,
      drop column if exists source_local_date,
      drop column if exists generation_key_hash,
      drop column if exists availability_template_id,
      drop column if exists appointment_service_id,
      drop column if exists practitioner_id,
      drop column if exists practitioner_service_assignment_id,
      drop column if exists practitioner_facility_assignment_id,
      drop column if exists facility_id,
      add constraint pp_appointment_slots_practice_start_unique
        unique (bookable_practice_id, starts_at)
  `.execute(database);

  await sql`
    drop trigger if exists provider_availability_exceptions_identity_no_retarget
      on provider_availability_exceptions
  `.execute(database);
  await sql`
    drop trigger if exists practitioner_availability_templates_identity_no_retarget
      on practitioner_availability_templates
  `.execute(database);

  await sql`drop table if exists provider_availability_exceptions`.execute(
    database,
  );
  await sql`drop table if exists practitioner_availability_templates`.execute(
    database,
  );

  await sql`
    drop function if exists prevent_live_appointment_slot_withdrawal()
  `.execute(database);
  await sql`
    drop function if exists prevent_provider_appointment_slot_retargeting()
  `.execute(database);
  await sql`
    drop function if exists prevent_provider_availability_exception_retargeting()
  `.execute(database);
  await sql`
    drop function if exists prevent_practitioner_availability_template_retargeting()
  `.execute(database);
  await sql`
    drop function if exists enforce_appointment_provider_slot_parity()
  `.execute(database);
}
