import { Kysely, sql } from 'kysely';

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    create table workforce_scheduling_commands (
      id uuid primary key default gen_random_uuid(),
      actor_user_id uuid not null,
      tenant_id uuid not null,
      organization_id uuid not null,
      organization_kind varchar(16) not null default 'practice',
      operation varchar(64) not null,
      idempotency_key_hash char(64) not null,
      request_hash char(64) not null,
      response_data jsonb not null,
      target_entity_type varchar(120) not null,
      target_entity_id uuid not null,
      created_at timestamptz not null default now(),
      constraint workforce_scheduling_commands_practice_kind_check
        check (organization_kind = 'practice'),
      constraint workforce_scheduling_commands_operation_check check (
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
      ),
      constraint workforce_scheduling_commands_idempotency_hash_check
        check (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
      constraint workforce_scheduling_commands_request_hash_check
        check (request_hash ~ '^[0-9a-f]{64}$'),
      constraint workforce_scheduling_commands_response_object_check
        check (jsonb_typeof(response_data) = 'object'),
      constraint workforce_scheduling_commands_target_type_check
        check (
          length(btrim(target_entity_type)) > 0
          and length(target_entity_type) = length(btrim(target_entity_type))
        ),
      constraint workforce_scheduling_commands_actor_fk
        foreign key (actor_user_id)
        references application_users(id) on delete restrict,
      constraint workforce_scheduling_commands_tenant_fk
        foreign key (tenant_id)
        references tenants(id) on delete restrict,
      constraint workforce_scheduling_commands_practice_fk
        foreign key (tenant_id, organization_id, organization_kind)
        references organizations(tenant_id, id, kind) on delete restrict,
      constraint workforce_scheduling_commands_actor_operation_key_unique
        unique (
          actor_user_id,
          tenant_id,
          organization_id,
          operation,
          idempotency_key_hash
        )
    )
  `.execute(database);

  await sql`
    create index workforce_scheduling_commands_practice_created_idx
      on workforce_scheduling_commands (
        tenant_id,
        organization_id,
        created_at desc,
        id
      )
  `.execute(database);

  await sql`
    create index workforce_scheduling_commands_target_idx
      on workforce_scheduling_commands (
        target_entity_type,
        target_entity_id,
        created_at desc,
        id
      )
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists workforce_scheduling_commands`.execute(
    database,
  );
}
