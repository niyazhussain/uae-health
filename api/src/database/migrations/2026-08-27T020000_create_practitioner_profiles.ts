import { Kysely, sql } from 'kysely';

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    create table practitioners (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants(id) on delete restrict,
      application_user_id uuid
        references application_users(id) on delete restrict,
      display_name varchar(200) not null,
      professional_title varchar(200) not null,
      status varchar(16) not null default 'active',
      is_synthetic boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint practitioners_display_name_check
        check (length(btrim(display_name)) > 0),
      constraint practitioners_professional_title_check
        check (length(btrim(professional_title)) > 0),
      constraint practitioners_status_check
        check (status in ('active', 'inactive')),
      constraint practitioners_tenant_id_id_unique
        unique (tenant_id, id)
    )
  `.execute(database);

  await sql`
    create unique index practitioners_tenant_application_user_unique
      on practitioners (tenant_id, application_user_id)
      where application_user_id is not null
  `.execute(database);

  await sql`
    create index practitioners_active_tenant_name_idx
      on practitioners (tenant_id, display_name, id)
      where status = 'active'
  `.execute(database);

  await sql`
    create function prevent_practitioner_identity_retargeting()
    returns trigger
    language plpgsql
    as $function$
    begin
      if new.id is distinct from old.id
         or new.tenant_id is distinct from old.tenant_id then
        raise exception 'Practitioner ownership is immutable.'
          using errcode = '23514';
      end if;

      if old.application_user_id is not null
         and new.application_user_id is distinct from old.application_user_id then
        raise exception 'Practitioner application-user link is immutable.'
          using errcode = '23514';
      end if;

      return new;
    end;
    $function$
  `.execute(database);

  await sql`
    create trigger practitioners_identity_no_retarget
    before update of id, tenant_id, application_user_id on practitioners
    for each row execute function prevent_practitioner_identity_retargeting()
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`
    drop trigger if exists practitioners_identity_no_retarget on practitioners
  `.execute(database);
  await sql`drop table if exists practitioners`.execute(database);
  await sql`
    drop function if exists prevent_practitioner_identity_retargeting()
  `.execute(database);
}
