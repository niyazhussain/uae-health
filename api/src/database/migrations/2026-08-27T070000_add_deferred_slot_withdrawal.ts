import { Kysely, sql } from 'kysely';

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    alter table patient_portal_appointment_slots
      add column withdrawal_pending boolean not null default false,
      add constraint pp_appointment_slots_withdrawal_pending_check
        check (
          not withdrawal_pending
          or (
            status = 'available'
            and practitioner_service_assignment_id is not null
          )
        )
  `.execute(database);

  await sql`
    drop index pp_appointment_slots_provider_discovery_idx
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
        and withdrawal_pending = false
        and practitioner_service_assignment_id is not null
  `.execute(database);

  await sql`
    alter table workforce_scheduling_commands
      drop constraint workforce_scheduling_commands_operation_check,
      add constraint workforce_scheduling_commands_operation_check check (
        operation in (
          'practitioner_create',
          'practitioner_link_application_user',
          'practitioner_facility_assignment_create',
          'practitioner_facility_assignment_status',
          'specialty_create',
          'specialty_update',
          'service_create',
          'service_update',
          'practitioner_service_assignment_create',
          'practitioner_service_assignment_status',
          'availability_template_create',
          'availability_template_replace',
          'availability_template_status',
          'availability_exception_create',
          'availability_exception_cancel',
          'availability_template_materialize',
          'service_duration_update'
        )
      )
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`
    do $block$
    begin
      if exists (
        select 1
        from workforce_scheduling_commands
        where operation in (
          'availability_template_create',
          'availability_template_replace',
          'availability_template_status',
          'availability_exception_create',
          'availability_exception_cancel',
          'availability_template_materialize',
          'service_duration_update'
        )
      ) then
        raise exception
          'Deferred-slot migration rollback is forward-only after availability command evidence is written.';
      end if;

      if exists (
        select 1
        from patient_portal_appointment_slots
        where withdrawal_pending = true
      ) then
        raise exception
          'Deferred-slot migration rollback is forward-only while slot withdrawals remain pending.';
      end if;
    end;
    $block$
  `.execute(database);

  await sql`
    alter table workforce_scheduling_commands
      drop constraint workforce_scheduling_commands_operation_check,
      add constraint workforce_scheduling_commands_operation_check check (
        operation in (
          'practitioner_create',
          'practitioner_link_application_user',
          'practitioner_facility_assignment_create',
          'practitioner_facility_assignment_status',
          'specialty_create',
          'specialty_update',
          'service_create',
          'service_update',
          'practitioner_service_assignment_create',
          'practitioner_service_assignment_status'
        )
      )
  `.execute(database);

  await sql`
    drop index pp_appointment_slots_provider_discovery_idx
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
    alter table patient_portal_appointment_slots
      drop constraint pp_appointment_slots_withdrawal_pending_check,
      drop column withdrawal_pending
  `.execute(database);
}
