-- =====================================================================
-- Phase 3: variance explanations (comments on budget-vs-actual lines).
--
--  * Who may explain a variance: the cost centre's owner, backup owner or
--    BU head (from the owner mapping or an explicit grant) and Finance.
--    Management/CFO and employees only read (Mgmt sees all comments).
--  * A comment needs published actuals for that CC / period / GL group.
--  * Comments are permanent: no edit, no delete (not even the table
--    owner), and every new comment is written to the audit log.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Who may comment on a cost centre (the caller, from app.user_email)
-- ---------------------------------------------------------------------
create or replace function ccp.can_comment(p_cc text) returns boolean
language sql stable security definer set search_path = ccp, pg_temp
as $$
  select ccp.app_email() is not null and (
    ccp.is_finance()
    or exists (select 1 from ccp.cc_owners o
                where o.cc_code = p_cc
                  and ccp.app_email() in (o.owner_email, o.backup_owner_email, o.bu_head_email))
    or exists (select 1 from ccp.cc_access a
                where a.user_email = ccp.app_email()
                  and a.role in ('Owner', 'Backup')
                  and a.cc_code = p_cc)
    or exists (select 1 from ccp.cc_access a
                 join ccp.cost_centres c on c.bu = a.bu
                where a.user_email = ccp.app_email()
                  and a.role = 'BU_Head'
                  and c.cc_code = p_cc)
  )
$$;

-- No whitespace-only comments (the length check alone allows '   ').
-- NOT VALID: enforced for every new row without re-checking history.
alter table ccp.comments drop constraint if exists comments_not_blank;
alter table ccp.comments add constraint comments_not_blank check (length(trim(comment)) > 0) not valid;

-- ---------------------------------------------------------------------
-- Insert policy: as yourself, on a CC you answer for, on a line that has
-- published actuals. The financials lookup runs under the caller's own
-- RLS (every commenter can read that CC's figures).
-- ---------------------------------------------------------------------
drop policy if exists comments_insert on ccp.comments;
create policy comments_insert on ccp.comments for insert to cc_app
  with check (
    user_email = ccp.app_email()
    and ccp.can_comment(cc_code)
    and exists (select 1 from ccp.financials f
                 where f.cc_code = comments.cc_code
                   and f.period = comments.period
                   and f.gl_group = comments.gl_group
                   and f.actual is not null)
  );

-- ---------------------------------------------------------------------
-- Append-only: block UPDATE / DELETE / TRUNCATE for everyone, including
-- the table owner (cc_app has no such grants in the first place).
-- ---------------------------------------------------------------------
create or replace function ccp.tg_comments_immutable() returns trigger
language plpgsql
as $$
begin
  raise exception 'Variance comments are append-only: they cannot be edited or deleted'
    using errcode = 'P0001';
end $$;

drop trigger if exists comments_immutable on ccp.comments;
create trigger comments_immutable before update or delete on ccp.comments
  for each row execute function ccp.tg_comments_immutable();
drop trigger if exists comments_no_truncate on ccp.comments;
create trigger comments_no_truncate before truncate on ccp.comments
  for each statement execute function ccp.tg_comments_immutable();

-- ---------------------------------------------------------------------
-- Audit: one COMMENT row per new comment (who / which CC / what was said)
-- ---------------------------------------------------------------------
create or replace function ccp.tg_comment_audit() returns trigger
language plpgsql security definer set search_path = ccp, pg_temp
as $$
begin
  insert into ccp.audit_log (user_email, action, entity, entity_id, new_value)
  values (coalesce(ccp.app_email(), new.user_email), 'COMMENT', 'comment', new.cc_code,
          jsonb_build_object('id', new.id, 'period', new.period, 'gl_group', new.gl_group,
                             'comment', new.comment));
  return new;
end $$;

drop trigger if exists comments_audit on ccp.comments;
create trigger comments_audit after insert on ccp.comments
  for each row execute function ccp.tg_comment_audit();

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke execute on function ccp.can_comment(text) from public;
grant execute on function ccp.can_comment(text) to cc_app;
revoke execute on all functions in schema ccp from public;
grant execute on all functions in schema ccp to cc_app;
