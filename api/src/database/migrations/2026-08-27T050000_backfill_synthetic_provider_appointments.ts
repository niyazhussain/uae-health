import { Kysely, sql } from 'kysely';

const fixtureNamespace = 'uae-health:synthetic-provider-scheduling:v1';
const slotNamespace = 'uae-health:synthetic-provider-slot:v1';

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    create table provider_scheduling_backfill_runs (
      id smallint primary key,
      started_at timestamptz not null,
      constraint provider_scheduling_backfill_runs_singleton_check
        check (id = 1)
    )
  `.execute(database);

  await sql`
    insert into provider_scheduling_backfill_runs (id, started_at)
    values (1, statement_timestamp())
  `.execute(database);

  await sql`
    create table provider_scheduling_backfill_practices (
      bookable_practice_id uuid primary key
        references patient_portal_bookable_practices(id) on delete restrict,
      tenant_id uuid not null,
      organization_id uuid not null,
      facility_id uuid not null,
      facility_created boolean not null,
      practitioner_id uuid not null,
      specialty_id uuid not null,
      practitioner_facility_assignment_id uuid not null,
      appointment_service_id uuid not null,
      practitioner_service_assignment_id uuid not null,
      source_timezone varchar(64) not null,
      duration_minutes integer not null,
      constraint provider_scheduling_backfill_practices_duration_check
        check (duration_minutes > 0),
      constraint provider_scheduling_backfill_practices_scope_unique
        unique (bookable_practice_id, tenant_id, organization_id)
    )
  `.execute(database);

  await sql`
    create table provider_scheduling_backfill_templates (
      availability_template_id uuid primary key,
      bookable_practice_id uuid not null
        references provider_scheduling_backfill_practices(bookable_practice_id)
        on delete restrict,
      iso_weekday smallint not null,
      local_start_minute smallint not null,
      local_end_minute smallint not null,
      source_timezone varchar(64) not null,
      constraint provider_scheduling_backfill_templates_definition_unique
        unique (
          bookable_practice_id,
          iso_weekday,
          local_start_minute,
          local_end_minute,
          source_timezone
        )
    )
  `.execute(database);

  await sql`
    create table provider_scheduling_backfill_slots (
      slot_id uuid primary key
        references patient_portal_appointment_slots(id) on delete restrict,
      bookable_practice_id uuid not null,
      starts_at timestamptz not null,
      ends_at timestamptz not null,
      status varchar(16) not null,
      is_synthetic boolean not null,
      updated_at timestamptz not null,
      constraint provider_scheduling_backfill_slots_practice_fk
        foreign key (bookable_practice_id)
        references provider_scheduling_backfill_practices(bookable_practice_id)
        on delete restrict
    )
  `.execute(database);

  await sql`
    create table provider_scheduling_backfill_appointments (
      appointment_id uuid primary key
        references patient_portal_appointments(id) on delete restrict,
      appointment_slot_id uuid not null
        references provider_scheduling_backfill_slots(slot_id) on delete restrict,
      status varchar(16) not null,
      version integer not null,
      cancelled_at timestamptz,
      updated_at timestamptz not null
    )
  `.execute(database);

  await sql`
    lock table
      organizations,
      patient_portal_bookable_practices,
      facilities,
      patient_portal_appointment_slots,
      patient_portal_appointments
    in share row exclusive mode
  `.execute(database);

  await sql`
    do $function$
    begin
      if exists (
        select 1
        from patient_portal_appointment_slots slot
        where slot.practitioner_service_assignment_id is not null
      ) then
        raise exception 'Provider backfill requires an untouched generic slot set.'
          using errcode = '55000';
      end if;

      if exists (
        select 1
        from patient_portal_appointments appointment
        where appointment.practitioner_service_assignment_id is not null
      ) then
        raise exception 'Provider backfill requires an untouched generic appointment set.'
          using errcode = '55000';
      end if;

      if exists (
        select 1
        from patient_portal_appointment_slots slot
        join patient_portal_bookable_practices bookable
          on bookable.id = slot.bookable_practice_id
        join organizations practice
          on practice.tenant_id = bookable.tenant_id
         and practice.id = bookable.organization_id
        where not slot.is_synthetic
           or not bookable.is_synthetic
           or not practice.is_synthetic
           or practice.kind <> 'practice'
      ) then
        raise exception 'Provider backfill accepts only synthetic practice slots.'
          using errcode = '55000';
      end if;

      if exists (
        select 1
        from patient_portal_bookable_practices bookable
        join organizations practice
          on practice.tenant_id = bookable.tenant_id
         and practice.id = bookable.organization_id
        where bookable.is_synthetic
          and (not practice.is_synthetic or practice.kind <> 'practice')
      ) then
        raise exception 'Synthetic bookable practices require synthetic practice ownership.'
          using errcode = '55000';
      end if;
    end;
    $function$
  `.execute(database);

  await sql`
    do $function$
    declare
      bookable record;
      deterministic_facility_id uuid;
      selected_facility_id uuid;
      selected_facility_timezone varchar(64);
      selected_facility_created boolean;
      existing_facility record;
      synthetic_facility_count integer;
      non_synthetic_facility_count integer;
      distinct_slot_duration_count integer;
      slot_duration_seconds numeric;
      service_duration_minutes integer;
    begin
      for bookable in
        select
          candidate.id,
          candidate.tenant_id,
          candidate.organization_id,
          candidate.timezone
        from patient_portal_bookable_practices candidate
        where candidate.is_synthetic
        order by candidate.id
        for update
      loop
        deterministic_facility_id := md5(
          ${sql.lit(fixtureNamespace)} || ':facility:' || bookable.id::text
        )::uuid;
        selected_facility_id := null;
        selected_facility_timezone := null;
        selected_facility_created := false;

        select
          count(distinct extract(epoch from slot.ends_at - slot.starts_at)),
          min(extract(epoch from slot.ends_at - slot.starts_at))
        into distinct_slot_duration_count, slot_duration_seconds
        from patient_portal_appointment_slots slot
        where slot.bookable_practice_id = bookable.id;

        if distinct_slot_duration_count > 1 then
          raise exception 'Synthetic provider backfill requires one slot duration per practice.'
            using errcode = '55000';
        elsif distinct_slot_duration_count = 0 then
          service_duration_minutes := 30;
        elsif slot_duration_seconds <= 0
           or mod(slot_duration_seconds, 60) <> 0 then
          raise exception 'Synthetic provider backfill requires whole-minute slot durations.'
            using errcode = '55000';
        else
          service_duration_minutes := (slot_duration_seconds / 60)::integer;
        end if;

        select
          facility.id,
          facility.tenant_id,
          facility.organization_id,
          facility.timezone,
          facility.is_synthetic
        into existing_facility
        from facilities facility
        where facility.id = deterministic_facility_id;

        if found then
          if existing_facility.tenant_id <> bookable.tenant_id
             or existing_facility.organization_id <> bookable.organization_id
             or not existing_facility.is_synthetic then
            raise exception 'Deterministic synthetic facility ownership is unavailable.'
              using errcode = '55000';
          end if;
          selected_facility_id := deterministic_facility_id;
          selected_facility_timezone := existing_facility.timezone;
        else
          select
            count(*) filter (where facility.is_synthetic),
            count(*) filter (where not facility.is_synthetic)
          into synthetic_facility_count, non_synthetic_facility_count
          from facilities facility
          where facility.tenant_id = bookable.tenant_id
            and facility.organization_id = bookable.organization_id;

          if non_synthetic_facility_count > 0 then
            raise exception 'Synthetic provider backfill cannot select a non-synthetic facility.'
              using errcode = '55000';
          elsif synthetic_facility_count = 1 then
            select facility.id, facility.timezone
            into selected_facility_id, selected_facility_timezone
            from facilities facility
            where facility.tenant_id = bookable.tenant_id
              and facility.organization_id = bookable.organization_id
              and facility.is_synthetic;
          elsif synthetic_facility_count > 1 then
            raise exception 'Synthetic provider backfill facility ownership is ambiguous.'
              using errcode = '55000';
          else
            insert into facilities (
              id,
              tenant_id,
              organization_id,
              code,
              name,
              timezone,
              is_synthetic
            ) values (
              deterministic_facility_id,
              bookable.tenant_id,
              bookable.organization_id,
              'SYN-' || upper(
                right(replace(deterministic_facility_id::text, '-', ''), 28)
              ),
              'Synthetic Appointment Centre',
              bookable.timezone,
              true
            );
            selected_facility_id := deterministic_facility_id;
            selected_facility_timezone := bookable.timezone;
            selected_facility_created := true;
          end if;
        end if;

        if selected_facility_timezone is distinct from bookable.timezone then
          raise exception 'Synthetic provider backfill requires matching facility and bookable timezones.'
            using errcode = '55000';
        end if;

        insert into provider_scheduling_backfill_practices (
          bookable_practice_id,
          tenant_id,
          organization_id,
          facility_id,
          facility_created,
          practitioner_id,
          specialty_id,
          practitioner_facility_assignment_id,
          appointment_service_id,
          practitioner_service_assignment_id,
          source_timezone,
          duration_minutes
        ) values (
          bookable.id,
          bookable.tenant_id,
          bookable.organization_id,
          selected_facility_id,
          selected_facility_created,
          md5(${sql.lit(fixtureNamespace)} || ':practitioner:' || bookable.id::text)::uuid,
          md5(${sql.lit(fixtureNamespace)} || ':specialty:' || bookable.id::text)::uuid,
          md5(
            ${sql.lit(fixtureNamespace)} || ':practitioner-facility-assignment:' || bookable.id::text
          )::uuid,
          md5(${sql.lit(fixtureNamespace)} || ':appointment-service:' || bookable.id::text)::uuid,
          md5(
            ${sql.lit(fixtureNamespace)} || ':practitioner-service-assignment:' || bookable.id::text
          )::uuid,
          selected_facility_timezone,
          service_duration_minutes
        );
      end loop;
    end;
    $function$
  `.execute(database);

  await sql`
    do $function$
    begin
      if exists (
        select 1
        from provider_scheduling_backfill_practices fixture
        join practitioners practitioner on practitioner.id = fixture.practitioner_id
      ) or exists (
        select 1
        from provider_scheduling_backfill_practices fixture
        join specialties specialty on specialty.id = fixture.specialty_id
      ) or exists (
        select 1
        from provider_scheduling_backfill_practices fixture
        join practitioner_facility_assignments assignment
          on assignment.id = fixture.practitioner_facility_assignment_id
      ) or exists (
        select 1
        from provider_scheduling_backfill_practices fixture
        join appointment_services service
          on service.id = fixture.appointment_service_id
      ) or exists (
        select 1
        from provider_scheduling_backfill_practices fixture
        join practitioner_service_assignments assignment
          on assignment.id = fixture.practitioner_service_assignment_id
      ) then
        raise exception 'Deterministic synthetic provider fixture identifiers already exist.'
          using errcode = '55000';
      end if;
    end;
    $function$
  `.execute(database);

  await sql`
    insert into practitioners (
      id,
      tenant_id,
      application_user_id,
      display_name,
      professional_title,
      status,
      is_synthetic
    )
    select
      fixture.practitioner_id,
      fixture.tenant_id,
      null,
      'Synthetic Physician',
      'General physician',
      'active',
      true
    from provider_scheduling_backfill_practices fixture
  `.execute(database);

  await sql`
    insert into specialties (
      id,
      tenant_id,
      organization_id,
      organization_kind,
      code,
      name,
      status,
      is_synthetic
    )
    select
      fixture.specialty_id,
      fixture.tenant_id,
      fixture.organization_id,
      'practice',
      'GENERAL-MEDICINE',
      'General medicine',
      'active',
      true
    from provider_scheduling_backfill_practices fixture
  `.execute(database);

  await sql`
    insert into practitioner_facility_assignments (
      id,
      tenant_id,
      organization_id,
      organization_kind,
      facility_id,
      practitioner_id,
      status,
      is_synthetic
    )
    select
      fixture.practitioner_facility_assignment_id,
      fixture.tenant_id,
      fixture.organization_id,
      'practice',
      fixture.facility_id,
      fixture.practitioner_id,
      'active',
      true
    from provider_scheduling_backfill_practices fixture
  `.execute(database);

  await sql`
    insert into appointment_services (
      id,
      tenant_id,
      organization_id,
      organization_kind,
      facility_id,
      specialty_id,
      code,
      patient_facing_name,
      duration_minutes,
      allows_any_practitioner,
      status,
      is_synthetic
    )
    select
      fixture.appointment_service_id,
      fixture.tenant_id,
      fixture.organization_id,
      'practice',
      fixture.facility_id,
      fixture.specialty_id,
      'GENERAL-CONSULTATION',
      'General consultation',
      fixture.duration_minutes,
      true,
      'active',
      true
    from provider_scheduling_backfill_practices fixture
  `.execute(database);

  await sql`
    insert into practitioner_service_assignments (
      id,
      tenant_id,
      organization_id,
      facility_id,
      practitioner_facility_assignment_id,
      practitioner_id,
      appointment_service_id,
      status,
      is_synthetic
    )
    select
      fixture.practitioner_service_assignment_id,
      fixture.tenant_id,
      fixture.organization_id,
      fixture.facility_id,
      fixture.practitioner_facility_assignment_id,
      fixture.practitioner_id,
      fixture.appointment_service_id,
      'active',
      true
    from provider_scheduling_backfill_practices fixture
  `.execute(database);

  await sql`
    do $function$
    begin
      if exists (
        select 1
        from patient_portal_appointment_slots slot
        join provider_scheduling_backfill_practices fixture
          on fixture.bookable_practice_id = slot.bookable_practice_id
        where date_trunc(
                'minute',
                slot.starts_at at time zone fixture.source_timezone
              ) <> slot.starts_at at time zone fixture.source_timezone
           or date_trunc(
                'minute',
                slot.ends_at at time zone fixture.source_timezone
              ) <> slot.ends_at at time zone fixture.source_timezone
           or (
             (slot.ends_at at time zone fixture.source_timezone)::date
               = (slot.starts_at at time zone fixture.source_timezone)::date
             and (slot.ends_at at time zone fixture.source_timezone)::time
               <= (slot.starts_at at time zone fixture.source_timezone)::time
           )
           or (
             (slot.ends_at at time zone fixture.source_timezone)::date
               = (slot.starts_at at time zone fixture.source_timezone)::date + 1
             and (slot.ends_at at time zone fixture.source_timezone)::time
               <> time '00:00:00'
           )
           or (slot.ends_at at time zone fixture.source_timezone)::date
              not in (
                (slot.starts_at at time zone fixture.source_timezone)::date,
                (slot.starts_at at time zone fixture.source_timezone)::date + 1
              )
      ) then
        raise exception 'Synthetic provider backfill requires minute-aligned same-day slots.'
          using errcode = '55000';
      end if;
    end;
    $function$
  `.execute(database);

  await sql`
    with slot_definitions as (
      select distinct
        slot.bookable_practice_id,
        extract(
          isodow from slot.starts_at at time zone fixture.source_timezone
        )::smallint as iso_weekday,
        (
          extract(hour from slot.starts_at at time zone fixture.source_timezone)::integer * 60
          + extract(minute from slot.starts_at at time zone fixture.source_timezone)::integer
        )::smallint as local_start_minute,
        case
          when (slot.ends_at at time zone fixture.source_timezone)::date
                 = (slot.starts_at at time zone fixture.source_timezone)::date + 1
            then 1440
          else (
            extract(hour from slot.ends_at at time zone fixture.source_timezone)::integer * 60
            + extract(minute from slot.ends_at at time zone fixture.source_timezone)::integer
          )
        end::smallint as local_end_minute,
        fixture.source_timezone
      from patient_portal_appointment_slots slot
      join provider_scheduling_backfill_practices fixture
        on fixture.bookable_practice_id = slot.bookable_practice_id
    )
    insert into provider_scheduling_backfill_templates (
      availability_template_id,
      bookable_practice_id,
      iso_weekday,
      local_start_minute,
      local_end_minute,
      source_timezone
    )
    select
      md5(
        ${sql.lit(fixtureNamespace)}
        || ':availability-template:'
        || definition.bookable_practice_id::text
        || '|' || definition.iso_weekday::text
        || '|' || definition.local_start_minute::text
        || '|' || definition.local_end_minute::text
        || '|' || definition.source_timezone
      )::uuid,
      definition.bookable_practice_id,
      definition.iso_weekday,
      definition.local_start_minute,
      definition.local_end_minute,
      definition.source_timezone
    from slot_definitions definition
  `.execute(database);

  await sql`
    do $function$
    begin
      if exists (
        select 1
        from provider_scheduling_backfill_templates fixture
        join practitioner_availability_templates template
          on template.id = fixture.availability_template_id
      ) then
        raise exception 'Deterministic synthetic availability template identifiers already exist.'
          using errcode = '55000';
      end if;
    end;
    $function$
  `.execute(database);

  await sql`
    insert into practitioner_availability_templates (
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
      source_timezone,
      status,
      is_synthetic
    )
    select
      definition.availability_template_id,
      fixture.tenant_id,
      fixture.organization_id,
      fixture.facility_id,
      fixture.practitioner_facility_assignment_id,
      fixture.practitioner_service_assignment_id,
      fixture.practitioner_id,
      fixture.appointment_service_id,
      definition.iso_weekday,
      definition.local_start_minute,
      definition.local_end_minute,
      date '2020-01-01',
      null,
      definition.source_timezone,
      'active',
      true
    from provider_scheduling_backfill_templates definition
    join provider_scheduling_backfill_practices fixture
      on fixture.bookable_practice_id = definition.bookable_practice_id
  `.execute(database);

  await sql`
    insert into provider_scheduling_backfill_slots (
      slot_id,
      bookable_practice_id,
      starts_at,
      ends_at,
      status,
      is_synthetic,
      updated_at
    )
    select
      slot.id,
      slot.bookable_practice_id,
      slot.starts_at,
      slot.ends_at,
      slot.status,
      slot.is_synthetic,
      slot.updated_at
    from patient_portal_appointment_slots slot
  `.execute(database);

  await sql`
    insert into provider_scheduling_backfill_appointments (
      appointment_id,
      appointment_slot_id,
      status,
      version,
      cancelled_at,
      updated_at
    )
    select
      appointment.id,
      appointment.appointment_slot_id,
      appointment.status,
      appointment.version,
      appointment.cancelled_at,
      appointment.updated_at
    from patient_portal_appointments appointment
  `.execute(database);

  await sql`
    with scoped_slots as (
      select
        slot.id,
        fixture.facility_id,
        fixture.practitioner_facility_assignment_id,
        fixture.practitioner_service_assignment_id,
        fixture.practitioner_id,
        fixture.appointment_service_id,
        definition.availability_template_id,
        (slot.starts_at at time zone fixture.source_timezone)::date
          as source_local_date,
        fixture.source_timezone,
        encode(
          digest(
            ${sql.lit(slotNamespace)}
            || '|' || definition.availability_template_id::text
            || '|' || (
              slot.starts_at at time zone fixture.source_timezone
            )::date::text
            || '|' || trunc(extract(epoch from slot.starts_at))::bigint::text
            || '|' || trunc(extract(epoch from slot.ends_at))::bigint::text,
            'sha256'
          ),
          'hex'
        ) as generation_key_hash
      from patient_portal_appointment_slots slot
      join provider_scheduling_backfill_practices fixture
        on fixture.bookable_practice_id = slot.bookable_practice_id
      join provider_scheduling_backfill_templates definition
        on definition.bookable_practice_id = slot.bookable_practice_id
       and definition.iso_weekday = extract(
         isodow from slot.starts_at at time zone fixture.source_timezone
       )::smallint
       and definition.local_start_minute = (
         extract(hour from slot.starts_at at time zone fixture.source_timezone)::integer * 60
         + extract(minute from slot.starts_at at time zone fixture.source_timezone)::integer
       )::smallint
       and definition.local_end_minute = case
         when (slot.ends_at at time zone fixture.source_timezone)::date
                = (slot.starts_at at time zone fixture.source_timezone)::date + 1
           then 1440
         else (
           extract(hour from slot.ends_at at time zone fixture.source_timezone)::integer * 60
           + extract(minute from slot.ends_at at time zone fixture.source_timezone)::integer
         )
       end::smallint
       and definition.source_timezone = fixture.source_timezone
    )
    update patient_portal_appointment_slots slot
    set
      facility_id = scoped.facility_id,
      practitioner_facility_assignment_id =
        scoped.practitioner_facility_assignment_id,
      practitioner_service_assignment_id =
        scoped.practitioner_service_assignment_id,
      practitioner_id = scoped.practitioner_id,
      appointment_service_id = scoped.appointment_service_id,
      availability_template_id = scoped.availability_template_id,
      generation_key_hash = scoped.generation_key_hash,
      source_local_date = scoped.source_local_date,
      source_timezone = scoped.source_timezone
    from scoped_slots scoped
    where slot.id = scoped.id
  `.execute(database);

  await sql`
    update patient_portal_appointments appointment
    set
      facility_id = slot.facility_id,
      practitioner_facility_assignment_id =
        slot.practitioner_facility_assignment_id,
      practitioner_service_assignment_id =
        slot.practitioner_service_assignment_id,
      practitioner_id = slot.practitioner_id,
      appointment_service_id = slot.appointment_service_id
    from patient_portal_appointment_slots slot
    where slot.id = appointment.appointment_slot_id
  `.execute(database);

  await sql`
    do $function$
    begin
      if exists (
        select 1
        from patient_portal_appointment_slots slot
        where num_nonnulls(
          slot.facility_id,
          slot.practitioner_facility_assignment_id,
          slot.practitioner_service_assignment_id,
          slot.practitioner_id,
          slot.appointment_service_id,
          slot.availability_template_id,
          slot.generation_key_hash,
          slot.source_local_date,
          slot.source_timezone
        ) <> 9
      ) or exists (
        select 1
        from patient_portal_appointments appointment
        where num_nonnulls(
          appointment.facility_id,
          appointment.practitioner_facility_assignment_id,
          appointment.practitioner_service_assignment_id,
          appointment.practitioner_id,
          appointment.appointment_service_id
        ) <> 5
      ) then
        raise exception 'Provider backfill did not resolve every scheduling row.'
          using errcode = '55000';
      end if;
    end;
    $function$
  `.execute(database);

  await sql`
    drop index pp_appointment_slots_generic_practice_start_unique
  `.execute(database);

  await sql`
    alter table patient_portal_appointment_slots
      alter column facility_id set not null,
      alter column practitioner_facility_assignment_id set not null,
      alter column practitioner_service_assignment_id set not null,
      alter column practitioner_id set not null,
      alter column appointment_service_id set not null,
      alter column availability_template_id set not null,
      alter column generation_key_hash set not null,
      alter column source_local_date set not null,
      alter column source_timezone set not null
  `.execute(database);

  await sql`
    alter table patient_portal_appointments
      alter column facility_id set not null,
      alter column practitioner_facility_assignment_id set not null,
      alter column practitioner_service_assignment_id set not null,
      alter column practitioner_id set not null,
      alter column appointment_service_id set not null
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`
    lock table
      organizations,
      patient_portal_bookable_practices,
      facilities,
      patient_portal_appointment_slots,
      patient_portal_appointments,
      practitioners,
      specialties,
      practitioner_facility_assignments,
      appointment_services,
      practitioner_service_assignments,
      practitioner_availability_templates,
      provider_availability_exceptions
    in share row exclusive mode
  `.execute(database);

  await sql`
    do $function$
    declare
      backfill_started_at timestamptz;
    begin
      select run.started_at
      into backfill_started_at
      from provider_scheduling_backfill_runs run
      where run.id = 1;

      if backfill_started_at is null then
        raise exception 'Provider backfill rollback manifest is unavailable.'
          using errcode = '55000';
      end if;

      if exists (
        select 1
        from patient_portal_appointment_slots slot
        where not exists (
          select 1
          from provider_scheduling_backfill_slots manifest
          where manifest.slot_id = slot.id
        )
      ) or exists (
        select 1
        from patient_portal_appointments appointment
        where not exists (
          select 1
          from provider_scheduling_backfill_appointments manifest
          where manifest.appointment_id = appointment.id
        )
      ) then
        raise exception 'Provider-aware scheduling writes make this rollback forward-only.'
          using errcode = '55000';
      end if;

      if exists (
        select 1
        from provider_scheduling_backfill_practices manifest
        left join practitioners practitioner
          on practitioner.id = manifest.practitioner_id
        where practitioner.id is null
           or practitioner.tenant_id <> manifest.tenant_id
           or practitioner.application_user_id is not null
           or practitioner.display_name <> 'Synthetic Physician'
           or practitioner.professional_title <> 'General physician'
           or practitioner.status <> 'active'
           or not practitioner.is_synthetic
           or practitioner.updated_at >= backfill_started_at
      ) or exists (
        select 1
        from provider_scheduling_backfill_practices manifest
        left join specialties specialty on specialty.id = manifest.specialty_id
        where specialty.id is null
           or specialty.tenant_id <> manifest.tenant_id
           or specialty.organization_id <> manifest.organization_id
           or specialty.organization_kind <> 'practice'
           or specialty.code <> 'GENERAL-MEDICINE'
           or specialty.name <> 'General medicine'
           or specialty.status <> 'active'
           or not specialty.is_synthetic
           or specialty.updated_at >= backfill_started_at
      ) or exists (
        select 1
        from provider_scheduling_backfill_practices manifest
        left join practitioner_facility_assignments assignment
          on assignment.id = manifest.practitioner_facility_assignment_id
        where assignment.id is null
           or assignment.tenant_id <> manifest.tenant_id
           or assignment.organization_id <> manifest.organization_id
           or assignment.organization_kind <> 'practice'
           or assignment.facility_id <> manifest.facility_id
           or assignment.practitioner_id <> manifest.practitioner_id
           or assignment.status <> 'active'
           or not assignment.is_synthetic
           or assignment.updated_at >= backfill_started_at
      ) or exists (
        select 1
        from provider_scheduling_backfill_practices manifest
        left join appointment_services service
          on service.id = manifest.appointment_service_id
        where service.id is null
           or service.tenant_id <> manifest.tenant_id
           or service.organization_id <> manifest.organization_id
           or service.organization_kind <> 'practice'
           or service.facility_id <> manifest.facility_id
           or service.specialty_id <> manifest.specialty_id
           or service.code <> 'GENERAL-CONSULTATION'
           or service.patient_facing_name <> 'General consultation'
           or service.duration_minutes <> manifest.duration_minutes
           or not service.allows_any_practitioner
           or service.status <> 'active'
           or not service.is_synthetic
           or service.updated_at >= backfill_started_at
      ) or exists (
        select 1
        from provider_scheduling_backfill_practices manifest
        left join practitioner_service_assignments assignment
          on assignment.id = manifest.practitioner_service_assignment_id
        where assignment.id is null
           or assignment.tenant_id <> manifest.tenant_id
           or assignment.organization_id <> manifest.organization_id
           or assignment.facility_id <> manifest.facility_id
           or assignment.practitioner_facility_assignment_id
                <> manifest.practitioner_facility_assignment_id
           or assignment.practitioner_id <> manifest.practitioner_id
           or assignment.appointment_service_id <> manifest.appointment_service_id
           or assignment.status <> 'active'
           or not assignment.is_synthetic
           or assignment.updated_at >= backfill_started_at
      ) or exists (
        select 1
        from provider_scheduling_backfill_templates definition
        join provider_scheduling_backfill_practices manifest
          on manifest.bookable_practice_id = definition.bookable_practice_id
        left join practitioner_availability_templates template
          on template.id = definition.availability_template_id
        where template.id is null
           or template.tenant_id <> manifest.tenant_id
           or template.organization_id <> manifest.organization_id
           or template.facility_id <> manifest.facility_id
           or template.practitioner_facility_assignment_id
                <> manifest.practitioner_facility_assignment_id
           or template.practitioner_service_assignment_id
                <> manifest.practitioner_service_assignment_id
           or template.practitioner_id <> manifest.practitioner_id
           or template.appointment_service_id <> manifest.appointment_service_id
           or template.iso_weekday <> definition.iso_weekday
           or template.local_start_minute <> definition.local_start_minute
           or template.local_end_minute <> definition.local_end_minute
           or template.effective_from <> date '2020-01-01'
           or template.effective_until is not null
           or template.source_timezone <> definition.source_timezone
           or template.status <> 'active'
           or not template.is_synthetic
           or template.updated_at >= backfill_started_at
      ) or exists (
        select 1
        from provider_scheduling_backfill_practices manifest
        left join facilities facility on facility.id = manifest.facility_id
        where manifest.facility_created
          and (
            facility.id is null
            or facility.tenant_id <> manifest.tenant_id
            or facility.organization_id <> manifest.organization_id
            or facility.code <> 'SYN-' || upper(
              right(replace(manifest.facility_id::text, '-', ''), 28)
            )
            or facility.name <> 'Synthetic Appointment Centre'
            or facility.timezone <> manifest.source_timezone
            or not facility.is_synthetic
            or facility.updated_at >= backfill_started_at
          )
      ) then
        raise exception 'Changed synthetic provider fixtures make this rollback forward-only.'
          using errcode = '55000';
      end if;

      if exists (
        select 1
        from provider_availability_exceptions exception
        where exception.created_at >= backfill_started_at
      ) or exists (
        select 1
        from practitioner_availability_templates template
        where template.created_at >= backfill_started_at
          and not exists (
            select 1
            from provider_scheduling_backfill_templates manifest
            where manifest.availability_template_id = template.id
          )
      ) or exists (
        select 1
        from practitioners practitioner
        where practitioner.created_at >= backfill_started_at
          and not exists (
            select 1
            from provider_scheduling_backfill_practices manifest
            where manifest.practitioner_id = practitioner.id
          )
      ) or exists (
        select 1
        from specialties specialty
        where specialty.created_at >= backfill_started_at
          and not exists (
            select 1
            from provider_scheduling_backfill_practices manifest
            where manifest.specialty_id = specialty.id
          )
      ) or exists (
        select 1
        from appointment_services service
        where service.created_at >= backfill_started_at
          and not exists (
            select 1
            from provider_scheduling_backfill_practices manifest
            where manifest.appointment_service_id = service.id
          )
      ) or exists (
        select 1
        from practitioner_facility_assignments assignment
        where assignment.created_at >= backfill_started_at
          and not exists (
            select 1
            from provider_scheduling_backfill_practices manifest
            where manifest.practitioner_facility_assignment_id = assignment.id
          )
      ) or exists (
        select 1
        from practitioner_service_assignments assignment
        where assignment.created_at >= backfill_started_at
          and not exists (
            select 1
            from provider_scheduling_backfill_practices manifest
            where manifest.practitioner_service_assignment_id = assignment.id
          )
      ) then
        raise exception 'Provider-aware catalogue writes make this rollback forward-only.'
          using errcode = '55000';
      end if;

      if exists (
        select 1
        from provider_scheduling_backfill_slots manifest
        left join patient_portal_appointment_slots slot on slot.id = manifest.slot_id
        where slot.id is null
           or slot.bookable_practice_id <> manifest.bookable_practice_id
           or slot.starts_at <> manifest.starts_at
           or slot.ends_at <> manifest.ends_at
           or slot.status <> manifest.status
           or slot.is_synthetic <> manifest.is_synthetic
           or slot.updated_at <> manifest.updated_at
      ) or exists (
        select 1
        from provider_scheduling_backfill_appointments manifest
        left join patient_portal_appointments appointment
          on appointment.id = manifest.appointment_id
        where appointment.id is null
           or appointment.appointment_slot_id <> manifest.appointment_slot_id
           or appointment.status <> manifest.status
           or appointment.version <> manifest.version
           or appointment.cancelled_at is distinct from manifest.cancelled_at
           or appointment.updated_at <> manifest.updated_at
      ) then
        raise exception 'Changed provider-aware scheduling evidence makes rollback unsafe.'
          using errcode = '55000';
      end if;
    end;
    $function$
  `.execute(database);

  await sql`
    alter table patient_portal_appointments
      alter column facility_id drop not null,
      alter column practitioner_facility_assignment_id drop not null,
      alter column practitioner_service_assignment_id drop not null,
      alter column practitioner_id drop not null,
      alter column appointment_service_id drop not null
  `.execute(database);

  await sql`
    alter table patient_portal_appointment_slots
      alter column facility_id drop not null,
      alter column practitioner_facility_assignment_id drop not null,
      alter column practitioner_service_assignment_id drop not null,
      alter column practitioner_id drop not null,
      alter column appointment_service_id drop not null,
      alter column availability_template_id drop not null,
      alter column generation_key_hash drop not null,
      alter column source_local_date drop not null,
      alter column source_timezone drop not null
  `.execute(database);

  await sql`
    alter table patient_portal_appointments
      disable trigger pp_appointments_provider_slot_parity
  `.execute(database);
  await sql`
    update patient_portal_appointments appointment
    set
      facility_id = null,
      practitioner_facility_assignment_id = null,
      practitioner_service_assignment_id = null,
      practitioner_id = null,
      appointment_service_id = null
    from provider_scheduling_backfill_appointments manifest
    where manifest.appointment_id = appointment.id
  `.execute(database);
  await sql`
    alter table patient_portal_appointments
      enable trigger pp_appointments_provider_slot_parity
  `.execute(database);

  await sql`
    alter table patient_portal_appointment_slots
      disable trigger pp_appointment_slots_identity_no_retarget
  `.execute(database);
  await sql`
    update patient_portal_appointment_slots slot
    set
      facility_id = null,
      practitioner_facility_assignment_id = null,
      practitioner_service_assignment_id = null,
      practitioner_id = null,
      appointment_service_id = null,
      availability_template_id = null,
      generation_key_hash = null,
      source_local_date = null,
      source_timezone = null
    from provider_scheduling_backfill_slots manifest
    where manifest.slot_id = slot.id
  `.execute(database);
  await sql`
    alter table patient_portal_appointment_slots
      enable trigger pp_appointment_slots_identity_no_retarget
  `.execute(database);

  await sql`
    create unique index pp_appointment_slots_generic_practice_start_unique
      on patient_portal_appointment_slots (bookable_practice_id, starts_at)
      where practitioner_service_assignment_id is null
  `.execute(database);

  await sql`
    delete from practitioner_availability_templates template
    using provider_scheduling_backfill_templates manifest
    where template.id = manifest.availability_template_id
  `.execute(database);
  await sql`
    delete from practitioner_service_assignments assignment
    using provider_scheduling_backfill_practices manifest
    where assignment.id = manifest.practitioner_service_assignment_id
  `.execute(database);
  await sql`
    delete from appointment_services service
    using provider_scheduling_backfill_practices manifest
    where service.id = manifest.appointment_service_id
  `.execute(database);
  await sql`
    delete from practitioner_facility_assignments assignment
    using provider_scheduling_backfill_practices manifest
    where assignment.id = manifest.practitioner_facility_assignment_id
  `.execute(database);
  await sql`
    delete from specialties specialty
    using provider_scheduling_backfill_practices manifest
    where specialty.id = manifest.specialty_id
  `.execute(database);
  await sql`
    delete from practitioners practitioner
    using provider_scheduling_backfill_practices manifest
    where practitioner.id = manifest.practitioner_id
  `.execute(database);
  await sql`
    delete from facilities facility
    using provider_scheduling_backfill_practices manifest
    where facility.id = manifest.facility_id
      and manifest.facility_created
  `.execute(database);

  await sql`drop table provider_scheduling_backfill_appointments`.execute(
    database,
  );
  await sql`drop table provider_scheduling_backfill_slots`.execute(database);
  await sql`drop table provider_scheduling_backfill_templates`.execute(
    database,
  );
  await sql`drop table provider_scheduling_backfill_practices`.execute(
    database,
  );
  await sql`drop table provider_scheduling_backfill_runs`.execute(database);
}
