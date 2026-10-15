-- =====================================================================
-- Phase 2: financials publishing, trial-balance reconciliation,
-- maker-checker on uploads.
-- =====================================================================

-- A blank Actual means "no actual yet" (future, budget-only month) — not zero.
alter table ccp.financials alter column actual drop not null;
alter table ccp.financials alter column actual drop default;
create index if not exists financials_period_idx on ccp.financials (period);

-- Financials uploads go through the same staging table
alter table ccp.upload_batches drop constraint if exists upload_batches_kind_check;
alter table ccp.upload_batches add constraint upload_batches_kind_check
  check (kind in ('master', 'owners', 'financials'));

-- Trial-balance totals entered by Finance (the preparer) for each period of
-- a financials upload. Publishing is blocked unless the uploaded CC actuals
-- for every period equal these totals.
create table ccp.trial_balances (
  batch_id    uuid not null references ccp.upload_batches (id),
  period      text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  tb_total    numeric(18, 2) not null,
  entered_by  text not null,
  entered_at  timestamptz not null default now(),
  primary key (batch_id, period)
);

-- Period register: which periods have published actuals, reconciled to what.
create table ccp.periods (
  period        text primary key check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  actual_total  numeric(18, 2) not null,
  tb_total      numeric(18, 2) not null,
  batch_id      uuid not null references ccp.upload_batches (id),
  published_at  timestamptz not null default now(),
  published_by  text not null
);

grant select, insert, update on ccp.trial_balances, ccp.periods to cc_app;
alter table ccp.trial_balances enable row level security;
alter table ccp.periods enable row level security;

create policy tb_finance on ccp.trial_balances for all to cc_app
  using ((select ccp.is_finance())) with check ((select ccp.is_finance()) and entered_by = ccp.app_email());
-- Company-wide totals: Finance and Management only
create policy periods_read on ccp.periods for select to cc_app
  using ((select ccp.sees_all()));
create policy periods_write on ccp.periods for all to cc_app
  using ((select ccp.is_finance())) with check ((select ccp.is_finance()));

-- Maker-checker evidence on the batch itself
alter table ccp.upload_batches add column if not exists approved_by text;

-- Extend the event whitelist (reconciliation + approvals)
create or replace function ccp.log_event(p_action text, p_entity text,
                                         p_entity_id text default null,
                                         p_detail jsonb default null) returns void
language plpgsql security definer set search_path = ccp, pg_temp
as $$
begin
  if p_action not in ('LOGIN', 'LOGIN_DENIED', 'LOGOUT', 'ACCESS_DENIED',
                      'TEMPLATE_DOWNLOAD', 'UPLOAD_VALIDATED', 'UPLOAD_REJECTED',
                      'UPLOAD_PUBLISHED', 'UPLOAD_DISCARDED', 'EXPORT',
                      'TB_ENTERED', 'RECON_PASSED', 'RECON_FAILED', 'VIEW_FINANCIALS') then
    raise exception 'log_event: action % is not allowed', p_action;
  end if;
  if ccp.app_email() is null then
    raise exception 'log_event: no user context';
  end if;
  insert into ccp.audit_log (user_email, action, entity, entity_id, new_value, batch_id)
  values (ccp.app_email(), p_action, p_entity, p_entity_id, p_detail,
          nullif(current_setting('app.batch_id', true), '')::uuid);
end $$;

revoke execute on all functions in schema ccp from public;
grant execute on all functions in schema ccp to cc_app;
