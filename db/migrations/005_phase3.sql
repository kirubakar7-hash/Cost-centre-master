-- =====================================================================
-- Phase 3 (back end): per-entity trial-balance reconciliation,
-- line-level history of financial figures, allocations upload.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Reconcile per legal entity. Each entity keeps its own books (own
--    Tally company, own currency), so a month is reconciled entity by
--    entity: IN actuals (INR) to the IN trial balance, US (USD) to the US one.
--    Rows created before this migration were reconciled on the combined
--    total; they keep entity 'ALL' so history is not rewritten.
-- ---------------------------------------------------------------------
alter table ccp.trial_balances add column entity text;
update ccp.trial_balances set entity = 'ALL' where entity is null;
alter table ccp.trial_balances alter column entity set not null;
alter table ccp.trial_balances add constraint trial_balances_entity_chk check (entity in ('IN', 'US', 'UK', 'ALL'));
alter table ccp.trial_balances drop constraint trial_balances_pkey;
alter table ccp.trial_balances add primary key (batch_id, period, entity);

alter table ccp.periods add column entity text;
update ccp.periods set entity = 'ALL' where entity is null;
alter table ccp.periods alter column entity set not null;
alter table ccp.periods add constraint periods_entity_chk check (entity in ('IN', 'US', 'UK', 'ALL'));
alter table ccp.periods drop constraint periods_pkey;
alter table ccp.periods add primary key (period, entity);
-- publishing a period per entity removes its legacy combined ('ALL') row
grant delete on ccp.periods to cc_app;
-- ...but that is the only delete allowed: the 003 policy covered ALL commands, which with
-- this grant would let Finance delete any per-entity register entry directly.
drop policy periods_write on ccp.periods;
create policy periods_insert on ccp.periods for insert to cc_app
  with check ((select ccp.is_finance()));
create policy periods_update on ccp.periods for update to cc_app
  using ((select ccp.is_finance())) with check ((select ccp.is_finance()));
create policy periods_delete_legacy on ccp.periods for delete to cc_app
  using ((select ccp.is_finance()) and entity = 'ALL');

-- ---------------------------------------------------------------------
-- 2. Line-level history: every financial line a publish adds, changes or
--    removes, with old and new values. Append-only, Finance-readable.
-- ---------------------------------------------------------------------
create table ccp.financials_history (
  id          bigint generated always as identity primary key,
  batch_id    uuid not null references ccp.upload_batches (id),
  cc_code     text not null,
  period      text not null,
  gl_group    text not null,
  old_budget  numeric(18, 2),
  old_actual  numeric(18, 2),
  new_budget  numeric(18, 2),
  new_actual  numeric(18, 2),
  change      text not null check (change in ('added', 'changed', 'removed')),
  changed_at  timestamptz not null default now(),
  changed_by  text not null
);
create index financials_history_batch_idx on ccp.financials_history (batch_id);
create index financials_history_line_idx on ccp.financials_history (cc_code, period, gl_group);

create trigger financials_history_immutable before update or delete on ccp.financials_history
  for each row execute function ccp.tg_audit_immutable();
create trigger financials_history_no_truncate before truncate on ccp.financials_history
  for each statement execute function ccp.tg_audit_immutable();

grant select, insert on ccp.financials_history to cc_app;
alter table ccp.financials_history enable row level security;
create policy fin_hist_read on ccp.financials_history for select to cc_app
  using ((select ccp.is_finance()));
create policy fin_hist_insert on ccp.financials_history for insert to cc_app
  with check ((select ccp.is_finance()) and changed_by = ccp.app_email());

-- ---------------------------------------------------------------------
-- 3. Allocations upload (shared-service recharges). One line per
--    receiving CC / period / source CC; changes are audited row by row.
-- ---------------------------------------------------------------------
alter table ccp.upload_batches drop constraint if exists upload_batches_kind_check;
alter table ccp.upload_batches add constraint upload_batches_kind_check
  check (kind in ('master', 'owners', 'financials', 'allocations'));

create unique index if not exists allocations_line_uk on ccp.allocations (cc_code, period, source_cc);
alter table ccp.allocations add constraint allocations_not_self check (cc_code <> source_cc);
alter table ccp.allocations add constraint allocations_basis_len check (length(trim(basis)) between 1 and 120);

create trigger allocations_audit after insert or update or delete on ccp.allocations
  for each row execute function ccp.tg_audit('cc_code');

-- ---------------------------------------------------------------------
-- 4. The period register is tamper-evident: every change is audited.
-- ---------------------------------------------------------------------
create trigger periods_audit after insert or update or delete on ccp.periods
  for each row execute function ccp.tg_audit('period');

-- Name the table in the append-only error (shared by audit_log and financials_history)
create or replace function ccp.tg_audit_immutable() returns trigger
language plpgsql
as $$
begin
  raise exception '% is append-only', tg_table_name;
end $$;

revoke execute on all functions in schema ccp from public;
grant execute on all functions in schema ccp to cc_app;
