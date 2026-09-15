-- Who changed it, when, and what it became.
-- [2026-09-15]
--
-- Run this ONE STATEMENT AT A TIME in Supabase → SQL Editor. The editor
-- truncates long multi-line pastes and only shows the LAST query's result, so
-- running the whole file in one go can silently skip the end of it.
--
-- WHY THIS EXISTS
--
-- Two HQ finance accounts are being given the right to correct transactions.
-- Before that happens the trail has to be worth reading. Three gaps:
--
--   1. change_requests recorded who ASKED and never who APPROVED, or when.
--      The screen works around it by counting "approved this month" off the
--      request date, because there was no resolved date to count.
--
--   2. A rejection recorded the requester's reason — the very thing being
--      refused — and nothing about why it was refused.
--
--   3. transactions_history (from sql/06_harden_data_safety.sql) already
--      stores a complete before/after of EVERY column on EVERY change,
--      written by the database itself, so it catches edits made straight
--      through the SQL editor as well as through the app. But it records no
--      actor, and it has row-level security enabled with no policies, so
--      nobody can read it from inside PaddyTrade.
--
-- Nothing here changes an existing row. Every column added is nullable, so
-- requests that were resolved before today simply have no resolver recorded
-- rather than claiming a wrong one.
--
-- The app works either way: api.resolveChangeRequest tries the new columns
-- first and falls back to writing the status alone if they are not there yet.


-- 1 ------------------------------------------------------------------------
-- When the request was actually decided. NOT the same as created_at, which is
-- when it was raised.
alter table change_requests add column if not exists resolved_at timestamptz;


-- 2 ------------------------------------------------------------------------
-- Who decided it.
alter table change_requests add column if not exists resolved_by uuid references profiles(id);


-- 3 ------------------------------------------------------------------------
-- Why it was refused, in the approver's words.
alter table change_requests add column if not exists reject_reason text;


-- 4 ------------------------------------------------------------------------
create index if not exists change_requests_resolved_idx on change_requests(resolved_at desc);


-- 5 ------------------------------------------------------------------------
-- The database-level trail gains an actor. auth.uid() is the signed-in user
-- as Postgres sees them — it cannot be forged from the client, which is the
-- whole point of capturing it here rather than trusting what the app sends.
--
-- Null when a change is made by a migration or by someone using the service
-- key rather than a login. Null is the honest answer there; do not default it
-- to anything, or a script's edits will look like a person's.
alter table transactions_history add column if not exists changed_by uuid;


-- 6 ------------------------------------------------------------------------
-- Replace the trigger function so it records that actor. Same before/after
-- images as before — this only adds who.
create or replace function log_transactions_change()
returns trigger
language plpgsql
security definer
as $$
begin
  if (tg_op = 'DELETE') then
    insert into transactions_history (operation, transaction_id, row_data, changed_by)
    values ('DELETE', old.id, jsonb_build_object('old', to_jsonb(old)), auth.uid());
    return old;
  elsif (tg_op = 'UPDATE') then
    insert into transactions_history (operation, transaction_id, row_data, changed_by)
    values ('UPDATE', new.id, jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new)), auth.uid());
    return new;
  else
    insert into transactions_history (operation, transaction_id, row_data, changed_by)
    values ('INSERT', new.id, jsonb_build_object('new', to_jsonb(new)), auth.uid());
    return new;
  end if;
end;
$$;


-- 7 ------------------------------------------------------------------------
-- Let an admin READ the history. Still no insert, update or delete policy for
-- anyone — the table is written only by the trigger above (which runs as
-- security definer) and can never be edited or cleared through the app.
--
-- This is the point at which "the database has a perfect record nobody can
-- see" becomes "the Activity Log can show what actually changed".
create policy transactions_history_read on transactions_history
  for select to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));


-- 8 ------------------------------------------------------------------------
-- Check what you just built. Run this last; it changes nothing.
select
  (select count(*) from information_schema.columns
     where table_name = 'change_requests' and column_name = 'resolved_at')        as cr_resolved_at,
  (select count(*) from information_schema.columns
     where table_name = 'change_requests' and column_name = 'resolved_by')        as cr_resolved_by,
  (select count(*) from information_schema.columns
     where table_name = 'change_requests' and column_name = 'reject_reason')      as cr_reject_reason,
  (select count(*) from information_schema.columns
     where table_name = 'transactions_history' and column_name = 'changed_by')    as hist_changed_by,
  (select count(*) from pg_policies
     where tablename = 'transactions_history' and policyname = 'transactions_history_read') as hist_read_policy;
-- Expect: 1, 1, 1, 1, 1.
--
-- If hist_changed_by or hist_read_policy comes back 0, sql/06_harden_data_safety.sql
-- was never run — statements 5, 6 and 7 need that table to exist first. Run
-- that file, then come back to these three.
