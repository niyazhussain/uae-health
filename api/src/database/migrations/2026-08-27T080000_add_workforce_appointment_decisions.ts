import { Kysely, sql } from 'kysely';

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    alter table patient_portal_appointments
      drop constraint pp_appointments_status_check,
      drop constraint pp_appointments_cancellation_check,
      add constraint pp_appointments_status_check
        check (status in ('requested', 'confirmed', 'declined', 'cancelled')),
      add constraint pp_appointments_cancellation_check check (
        (status = 'cancelled' and cancelled_at is not null)
        or
        (status <> 'cancelled' and cancelled_at is null)
      )
  `.execute(database);

  await sql`drop index pp_appointments_live_slot_unique`.execute(database);

  await sql`
    create unique index pp_appointments_live_slot_unique
      on patient_portal_appointments (appointment_slot_id)
      where status in ('requested', 'confirmed')
  `.execute(database);

  await sql`
    create index pp_appointments_workforce_facility_queue_idx
      on patient_portal_appointments (
        tenant_id,
        organization_id,
        facility_id,
        status,
        appointment_slot_id,
        id
      )
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
          'service_duration_update',
          'appointment_request_decision'
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
        from patient_portal_appointments
        where status in ('confirmed', 'declined')
      ) then
        raise exception
          'Workforce appointment-decision rollback is forward-only after appointment decisions are recorded.'
          using errcode = '55000';
      end if;

      if exists (
        select 1
        from workforce_scheduling_commands
        where operation = 'appointment_request_decision'
      ) then
        raise exception
          'Workforce appointment-decision rollback is forward-only after decision command evidence is written.'
          using errcode = '55000';
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

  await sql`
    drop index pp_appointments_workforce_facility_queue_idx
  `.execute(database);

  await sql`drop index pp_appointments_live_slot_unique`.execute(database);

  await sql`
    create unique index pp_appointments_live_slot_unique
      on patient_portal_appointments (appointment_slot_id)
      where status = 'requested'
  `.execute(database);

  await sql`
    alter table patient_portal_appointments
      drop constraint pp_appointments_status_check,
      drop constraint pp_appointments_cancellation_check,
      add constraint pp_appointments_status_check
        check (status in ('requested', 'cancelled')),
      add constraint pp_appointments_cancellation_check check (
        (status = 'requested' and cancelled_at is null)
        or
        (status = 'cancelled' and cancelled_at is not null)
      )
  `.execute(database);
}
