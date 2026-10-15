-- =====================================================================
-- SolidPro Cost Centre Portal — core schema
-- All objects live in schema "ccp" (not exposed through Supabase's
-- PostgREST API, which only publishes "public" by default).
-- =====================================================================

create schema if not exists ccp;

-- ---------------------------------------------------------------------
-- Cost centre master (single source of truth). Never hard-deleted.
-- ---------------------------------------------------------------------
create table ccp.cost_centres (
  cc_code      text primary key
               check (cc_code ~ '^[A-Z]{2}-[A-Z0-9]{2,6}-[0-9]{3,4}$'),
  cc_alias     text not null check (length(trim(cc_alias)) between 2 and 80),
  entity       text not null check (entity in ('IN', 'US', 'UK')),
  bu           text not null check (length(trim(bu)) > 0),
  department   text not null check (length(trim(department)) > 0),
  type         text not null check (type in ('Direct', 'Shared', 'Allocated')),
  keywords     text not null default '',
  status       text not null default 'Active' check (status in ('Active', 'Inactive')),
  start_date   date not null,
  close_date   date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   text,
  constraint cc_prefix_matches_entity check (split_part(cc_code, '-', 1) = entity),
  constraint cc_close_after_start check (close_date is null or close_date >= start_date),
  constraint cc_inactive_needs_close check (status = 'Active' or close_date is not null)
);
create unique index cost_centres_alias_uk on ccp.cost_centres (lower(cc_alias));
create index cost_centres_bu_idx on ccp.cost_centres (bu);

-- ---------------------------------------------------------------------
-- Owner mapping (one row per cost centre)
-- ---------------------------------------------------------------------
create table ccp.cc_owners (
  cc_code            text primary key references ccp.cost_centres (cc_code),
  owner_name         text not null check (length(trim(owner_name)) > 0),
  owner_email        text not null check (owner_email = lower(owner_email) and owner_email like '%_@_%.__%'),
  backup_owner_email text not null check (backup_owner_email = lower(backup_owner_email) and backup_owner_email like '%_@_%.__%'),
  bu_head_email      text check (bu_head_email is null or (bu_head_email = lower(bu_head_email) and bu_head_email like '%_@_%.__%')),
  updated_at         timestamptz not null default now(),
  updated_by         text,
  constraint owner_ne_backup check (owner_email <> backup_owner_email)
);
create index cc_owners_owner_idx on ccp.cc_owners (owner_email);
create index cc_owners_backup_idx on ccp.cc_owners (backup_owner_email);
create index cc_owners_buhead_idx on ccp.cc_owners (bu_head_email);

-- ---------------------------------------------------------------------
-- Explicit access grants. Owner/Backup/BU head access is ALSO derived
-- from cc_owners, so the owner mapping upload is the normal way to grant
-- access; this table holds Finance/Mgmt roles, BU-wide grants and any
-- exceptional per-CC grants.
--   Finance / Mgmt : global (cc_code and bu both null)
--   BU_Head        : bu set (BU wildcard)
--   Owner / Backup : cc_code set
-- ---------------------------------------------------------------------
create table ccp.cc_access (
  id          bigint generated always as identity primary key,
  user_email  text not null check (user_email = lower(user_email) and user_email like '%_@_%.__%'),
  cc_code     text references ccp.cost_centres (cc_code),
  bu          text,
  role        text not null check (role in ('Owner', 'Backup', 'BU_Head', 'Finance', 'Mgmt')),
  created_at  timestamptz not null default now(),
  created_by  text,
  constraint access_scope_shape check (
    (role in ('Finance', 'Mgmt') and cc_code is null and bu is null) or
    (role = 'BU_Head' and bu is not null and cc_code is null) or
    (role in ('Owner', 'Backup') and cc_code is not null and bu is null)
  )
);
create unique index cc_access_uk on ccp.cc_access (user_email, role, coalesce(cc_code, ''), coalesce(bu, ''));

-- ---------------------------------------------------------------------
-- Financials, allocations, comments (UI arrives in Phase 2/3; the tables
-- and their row-level security exist from day one).
-- ---------------------------------------------------------------------
create table ccp.financials (
  cc_code   text not null references ccp.cost_centres (cc_code),
  period    text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  gl_group  text not null,
  budget    numeric(18, 2) not null default 0,
  actual    numeric(18, 2) not null default 0,
  primary key (cc_code, period, gl_group)
);

create table ccp.allocations (
  id         bigint generated always as identity primary key,
  cc_code    text not null references ccp.cost_centres (cc_code),
  period     text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  source_cc  text not null references ccp.cost_centres (cc_code),
  amount     numeric(18, 2) not null,
  basis      text not null
);
create index allocations_cc_idx on ccp.allocations (cc_code, period);

create table ccp.comments (
  id          bigint generated always as identity primary key,
  cc_code     text not null references ccp.cost_centres (cc_code),
  period      text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  gl_group    text not null,
  user_email  text not null,
  comment     text not null check (length(comment) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index comments_cc_idx on ccp.comments (cc_code, period);

-- ---------------------------------------------------------------------
-- Audit log — append-only (see 002_security.sql for the guard trigger)
-- ---------------------------------------------------------------------
create table ccp.audit_log (
  id          bigint generated always as identity primary key,
  ts          timestamptz not null default now(),
  user_email  text not null,
  action      text not null,
  entity      text not null,
  entity_id   text,
  old_value   jsonb,
  new_value   jsonb,
  batch_id    uuid
);
create index audit_log_ts_idx on ccp.audit_log (ts desc);
create index audit_log_entity_idx on ccp.audit_log (entity, entity_id);

-- Searches that returned nothing (feeds the keyword-maintenance report)
create table ccp.failed_searches (
  id          bigint generated always as identity primary key,
  ts          timestamptz not null default now(),
  user_email  text not null,
  term        text not null
);
create index failed_searches_ts_idx on ccp.failed_searches (ts desc);

-- ---------------------------------------------------------------------
-- Upload staging: validate -> review -> publish (publish re-validates).
-- ---------------------------------------------------------------------
create table ccp.upload_batches (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('master', 'owners')),
  file_name     text not null,
  file_sha256   text not null,
  uploaded_by   text not null,
  uploaded_at   timestamptz not null default now(),
  status        text not null check (status in ('Validated', 'Rejected', 'Published', 'Discarded')),
  row_count     integer not null,
  error_count   integer not null,
  payload       jsonb not null,
  errors        jsonb not null default '[]'::jsonb,
  summary       jsonb not null default '{}'::jsonb,
  published_at  timestamptz,
  published_by  text
);
create index upload_batches_ts_idx on ccp.upload_batches (uploaded_at desc);
