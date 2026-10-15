-- =====================================================================
-- Segregation of duties enforced in the database (defence in depth for
-- the maker-checker rule implemented in src/lib/upload/service.ts).
-- The app sets app.maker_checker = 'off' (transaction-local) only when the
-- UPLOAD_MAKER_CHECKER=false configuration switch is used.
-- =====================================================================

create or replace function ccp.maker_checker_on() returns boolean
language sql stable
as $$ select coalesce(current_setting('app.maker_checker', true), '') <> 'off' $$;

-- The uploader can never publish their own batch.
create or replace function ccp.tg_upload_sod() returns trigger
language plpgsql set search_path = ccp, pg_temp
as $$
begin
  if new.status = 'Published' and old.status is distinct from 'Published'
     and ccp.maker_checker_on() and new.published_by = new.uploaded_by then
    raise exception 'Segregation of duties: the uploader cannot publish their own upload' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger upload_batches_sod before update on ccp.upload_batches
  for each row execute function ccp.tg_upload_sod();

-- Only the preparer (uploader) may enter the trial balance for a batch.
create or replace function ccp.tg_tb_preparer() returns trigger
language plpgsql security definer set search_path = ccp, pg_temp
as $$
begin
  if ccp.maker_checker_on()
     and new.entered_by is distinct from (select uploaded_by from ccp.upload_batches where id = new.batch_id) then
    raise exception 'Only the preparer who uploaded the file can enter the trial balance' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger trial_balances_preparer before insert or update on ccp.trial_balances
  for each row execute function ccp.tg_tb_preparer();

-- An upload is always recorded under the real caller's identity.
drop policy if exists uploads_all on ccp.upload_batches;
create policy uploads_read on ccp.upload_batches for select to cc_app
  using ((select ccp.is_finance()));
create policy uploads_insert on ccp.upload_batches for insert to cc_app
  with check ((select ccp.is_finance()) and uploaded_by = ccp.app_email());
create policy uploads_update on ccp.upload_batches for update to cc_app
  using ((select ccp.is_finance())) with check ((select ccp.is_finance()));

revoke execute on all functions in schema ccp from public;
grant execute on all functions in schema ccp to cc_app;
