-- =====================================================================
-- Security layer: application role, row-level security, audit triggers
--
-- How identity reaches the database:
--   Every request runs in a transaction that does
--     SET LOCAL ROLE cc_app;                       -- no BYPASSRLS
--     SELECT set_config('app.user_email', <email from the SSO session>, true);
--   Every policy below derives the caller's role from app.user_email and the
--   access tables. The browser never chooses what it may see.
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'cc_app') then
    create role cc_app nologin noinherit;
  end if;
  -- the connecting (migration) user must be able to SET ROLE cc_app
  execute format('grant cc_app to %I', current_user);
end $$;

revoke all on schema ccp from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema ccp from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on schema ccp from authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Identity helpers
-- ---------------------------------------------------------------------
create or replace function ccp.app_email() returns text
language sql stable
as $$ select nullif(lower(trim(current_setting('app.user_email', true))), '') $$;

create or replace function ccp.has_role(p_role text) returns boolean
language sql stable security definer set search_path = ccp, pg_temp
as $$
  select exists (select 1 from ccp.cc_access a
                 where a.user_email = ccp.app_email() and a.role = p_role)
$$;

create or replace function ccp.is_finance() returns boolean
language sql stable security definer set search_path = ccp, pg_temp
as $$ select ccp.has_role('Finance') $$;

-- Finance and Management/CFO can read every cost centre
create or replace function ccp.sees_all() returns boolean
language sql stable security definer set search_path = ccp, pg_temp
as $$ select ccp.has_role('Finance') or ccp.has_role('Mgmt') $$;

-- Cost centres whose details/financials the caller may read
create or replace function ccp.visible_cc_codes() returns text[]
language sql stable security definer set search_path = ccp, pg_temp
as $$
  select coalesce(array_agg(distinct code), '{}'::text[]) from (
    select c.cc_code as code from ccp.cost_centres c where ccp.sees_all()
    union
    select o.cc_code from ccp.cc_owners o
     where ccp.app_email() in (o.owner_email, o.backup_owner_email, o.bu_head_email)
    union
    select a.cc_code from ccp.cc_access a
     where a.user_email = ccp.app_email() and a.cc_code is not null
    union
    select c.cc_code from ccp.cost_centres c
      join ccp.cc_access a on a.role = 'BU_Head' and a.bu = c.bu
     where a.user_email = ccp.app_email()
  ) s
$$;

-- All roles held by the caller (explicit grants + derived from owner mapping)
create or replace function ccp.my_roles() returns text[]
language sql stable security definer set search_path = ccp, pg_temp
as $$
  select coalesce(array_agg(distinct r order by r), '{}'::text[]) from (
    select a.role as r from ccp.cc_access a where a.user_email = ccp.app_email()
    union select 'Owner'   from ccp.cc_owners o where o.owner_email = ccp.app_email()
    union select 'Backup'  from ccp.cc_owners o where o.backup_owner_email = ccp.app_email()
    union select 'BU_Head' from ccp.cc_owners o where o.bu_head_email = ccp.app_email()
  ) s
$$;

-- ---------------------------------------------------------------------
-- Housekeeping triggers
-- ---------------------------------------------------------------------
create or replace function ccp.tg_stamp() returns trigger
language plpgsql set search_path = ccp, pg_temp
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(ccp.app_email(), 'system');
  return new;
end $$;

create trigger cost_centres_stamp before insert or update on ccp.cost_centres
  for each row execute function ccp.tg_stamp();
create trigger cc_owners_stamp before insert or update on ccp.cc_owners
  for each row execute function ccp.tg_stamp();

-- Never hard-delete a cost centre: deactivate it instead.
create or replace function ccp.tg_block_delete() returns trigger
language plpgsql
as $$
begin
  raise exception 'Cost centres cannot be deleted. Set status to Inactive with a close date.'
    using errcode = 'P0001';
end $$;

create trigger cost_centres_no_delete before delete on ccp.cost_centres
  for each row execute function ccp.tg_block_delete();

-- Deactivating a cost centre removes its owner mapping and per-CC grants
-- (the removal itself is audited, so history is preserved in audit_log).
create or replace function ccp.tg_cc_deactivated() returns trigger
language plpgsql security definer set search_path = ccp, pg_temp
as $$
begin
  if old.status = 'Active' and new.status = 'Inactive' then
    delete from ccp.cc_owners where cc_code = new.cc_code;
    delete from ccp.cc_access where cc_code = new.cc_code;
  end if;
  return new;
end $$;

create trigger cost_centres_deactivated after update of status on ccp.cost_centres
  for each row execute function ccp.tg_cc_deactivated();

-- ---------------------------------------------------------------------
-- Audit trail for master data (who / what / when / old / new)
-- Only changed columns are stored for updates.
-- ---------------------------------------------------------------------
create or replace function ccp.tg_audit() returns trigger
language plpgsql security definer set search_path = ccp, pg_temp
as $$
declare
  v_old    jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new    jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  d_old    jsonb := '{}'::jsonb;
  d_new    jsonb := '{}'::jsonb;
  v_action text;
  k        text;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(v_new) loop
      continue when k in ('updated_at', 'updated_by');
      if (v_old -> k) is distinct from (v_new -> k) then
        d_old := d_old || jsonb_build_object(k, v_old -> k);
        d_new := d_new || jsonb_build_object(k, v_new -> k);
      end if;
    end loop;
    if d_new = '{}'::jsonb then
      return new;                             -- no real change, nothing to log
    end if;
    v_action := case
      when tg_table_name = 'cost_centres' and v_old ->> 'status' = 'Active'   and v_new ->> 'status' = 'Inactive' then 'DEACTIVATE'
      when tg_table_name = 'cost_centres' and v_old ->> 'status' = 'Inactive' and v_new ->> 'status' = 'Active'   then 'REACTIVATE'
      else 'UPDATE' end;
  elsif tg_op = 'INSERT' then
    v_action := 'CREATE';
    d_old := null;
    d_new := v_new - 'updated_at' - 'updated_by' - 'created_at';
  else
    v_action := 'DELETE';
    d_old := v_old - 'updated_at' - 'updated_by' - 'created_at';
    d_new := null;
  end if;

  insert into ccp.audit_log (user_email, action, entity, entity_id, old_value, new_value, batch_id)
  values (coalesce(ccp.app_email(), 'system'), v_action, tg_table_name,
          coalesce(v_new, v_old) ->> tg_argv[0], d_old, d_new,
          nullif(current_setting('app.batch_id', true), '')::uuid);
  return coalesce(new, old);
end $$;

create trigger cost_centres_audit after insert or update or delete on ccp.cost_centres
  for each row execute function ccp.tg_audit('cc_code');
create trigger cc_owners_audit after insert or update or delete on ccp.cc_owners
  for each row execute function ccp.tg_audit('cc_code');
create trigger cc_access_audit after insert or update or delete on ccp.cc_access
  for each row execute function ccp.tg_audit('user_email');

-- Audit log is append-only, even for Finance.
create or replace function ccp.tg_audit_immutable() returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only';
end $$;

create trigger audit_log_immutable before update or delete on ccp.audit_log
  for each row execute function ccp.tg_audit_immutable();
create trigger audit_log_no_truncate before truncate on ccp.audit_log
  for each statement execute function ccp.tg_audit_immutable();

-- ---------------------------------------------------------------------
-- Event logging entry points (the app cannot insert into audit_log
-- directly; it can only call these, always as the current user).
-- ---------------------------------------------------------------------
create or replace function ccp.log_event(p_action text, p_entity text,
                                         p_entity_id text default null,
                                         p_detail jsonb default null) returns void
language plpgsql security definer set search_path = ccp, pg_temp
as $$
begin
  if p_action not in ('LOGIN', 'LOGIN_DENIED', 'LOGOUT', 'ACCESS_DENIED',
                      'TEMPLATE_DOWNLOAD', 'UPLOAD_VALIDATED', 'UPLOAD_REJECTED',
                      'UPLOAD_PUBLISHED', 'UPLOAD_DISCARDED', 'EXPORT') then
    raise exception 'log_event: action % is not allowed', p_action;
  end if;
  if ccp.app_email() is null then
    raise exception 'log_event: no user context';
  end if;
  insert into ccp.audit_log (user_email, action, entity, entity_id, new_value, batch_id)
  values (ccp.app_email(), p_action, p_entity, p_entity_id, p_detail,
          nullif(current_setting('app.batch_id', true), '')::uuid);
end $$;

-- Live search fires as the user types, so "chen", "chen d", "chen de"...
-- are collapsed into one row per user within a 2-minute window.
create or replace function ccp.log_failed_search(p_term text) returns void
language plpgsql security definer set search_path = ccp, pg_temp
as $$
declare
  v_term text := left(lower(regexp_replace(trim(coalesce(p_term, '')), '\s+', ' ', 'g')), 100);
  v_id   bigint;
  v_prev text;
begin
  if ccp.app_email() is null or length(v_term) < 2 then
    return;
  end if;
  select id, term into v_id, v_prev
    from ccp.failed_searches
   where user_email = ccp.app_email()
     and ts > now() - interval '2 minutes'
     and (starts_with(v_term, term) or starts_with(term, v_term))
   order by ts desc
   limit 1;
  if v_id is null then
    insert into ccp.failed_searches (user_email, term) values (ccp.app_email(), v_term);
  else
    update ccp.failed_searches
       set term = case when length(v_term) >= length(v_prev) then v_term else v_prev end,
           ts = now()
     where id = v_id;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Grants (least privilege) and row-level security
-- ---------------------------------------------------------------------
grant usage on schema ccp to cc_app;
grant select on all tables in schema ccp to cc_app;
grant insert, update on ccp.cost_centres to cc_app;           -- no DELETE, ever
grant insert, update, delete on ccp.cc_owners to cc_app;
grant insert, update, delete on ccp.cc_access to cc_app;
grant insert, update, delete on ccp.financials, ccp.allocations to cc_app;
grant insert on ccp.comments to cc_app;
grant insert, update on ccp.upload_batches to cc_app;
-- audit_log / failed_searches: no direct write grants (use the functions)

revoke execute on all functions in schema ccp from public;
grant execute on all functions in schema ccp to cc_app;

alter table ccp.cost_centres    enable row level security;
alter table ccp.cc_owners       enable row level security;
alter table ccp.cc_access       enable row level security;
alter table ccp.financials      enable row level security;
alter table ccp.allocations     enable row level security;
alter table ccp.comments        enable row level security;
alter table ccp.audit_log       enable row level security;
alter table ccp.failed_searches enable row level security;
alter table ccp.upload_batches  enable row level security;

-- Directory data (code, alias, BU, department, owner name) is visible to
-- every signed-in employee. Financial tables are not.
create policy cc_read on ccp.cost_centres for select to cc_app
  using (ccp.app_email() is not null);
create policy cc_insert on ccp.cost_centres for insert to cc_app
  with check ((select ccp.is_finance()));
create policy cc_update on ccp.cost_centres for update to cc_app
  using ((select ccp.is_finance())) with check ((select ccp.is_finance()));

create policy owners_read on ccp.cc_owners for select to cc_app
  using (ccp.app_email() is not null);
create policy owners_write on ccp.cc_owners for all to cc_app
  using ((select ccp.is_finance())) with check ((select ccp.is_finance()));

create policy access_read on ccp.cc_access for select to cc_app
  using (user_email = ccp.app_email() or (select ccp.is_finance()));
create policy access_write on ccp.cc_access for all to cc_app
  using ((select ccp.is_finance())) with check ((select ccp.is_finance()));

create policy fin_read on ccp.financials for select to cc_app
  using (cc_code = any ((select ccp.visible_cc_codes())::text[]));
create policy fin_write on ccp.financials for all to cc_app
  using ((select ccp.is_finance())) with check ((select ccp.is_finance()));

create policy alloc_read on ccp.allocations for select to cc_app
  using (cc_code = any ((select ccp.visible_cc_codes())::text[]));
create policy alloc_write on ccp.allocations for all to cc_app
  using ((select ccp.is_finance())) with check ((select ccp.is_finance()));

create policy comments_read on ccp.comments for select to cc_app
  using (cc_code = any ((select ccp.visible_cc_codes())::text[]));
create policy comments_insert on ccp.comments for insert to cc_app
  with check (user_email = ccp.app_email() and cc_code = any ((select ccp.visible_cc_codes())::text[]));

create policy audit_read on ccp.audit_log for select to cc_app
  using ((select ccp.is_finance()));
create policy failed_read on ccp.failed_searches for select to cc_app
  using ((select ccp.is_finance()));
create policy uploads_all on ccp.upload_batches for all to cc_app
  using ((select ccp.is_finance())) with check ((select ccp.is_finance()));
