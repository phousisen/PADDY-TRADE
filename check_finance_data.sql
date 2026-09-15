-- ONE query. One result. Every answer at once.
-- [2026-09-14]
--
-- Supabase's editor only shows the LAST query's result, so a file of five
-- questions gives you one answer and silently hides the other four. This is
-- all of them in a single row instead.
--
-- Select everything below, run it, and send me the row.
-- It reads only — nothing is changed.

select
  -- Expenses: the question that decides whether "Operating Expenses 0 ៛" is a
  -- data-entry gap or a bug in my reporting code.
  (select count(*)    from payments where type = 'expense')                       as expense_rows_ever,
  (select sum(amount) from payments where type = 'expense')                       as expense_total_ever,
  (select count(*)    from payments where type = 'expense'
      and pay_date >= date_trunc('month', current_date)::date)                    as expense_rows_this_month,
  (select sum(amount) from payments where type = 'expense'
      and pay_date >= date_trunc('month', current_date)::date)                    as expense_total_this_month,

  -- If expense rows DO exist, these three find where the reports lose them.
  -- A row with no station or no date is invisible to every report and looks
  -- exactly like "no expenses" on screen.
  (select count(*) from payments where type = 'expense' and location_id is null)  as expenses_missing_station,
  (select count(*) from payments where type = 'expense' and pay_date is null)     as expenses_missing_date,
  (select count(*) from payments where type = 'expense' and voided_at is not null) as expenses_voided,

  -- The other zeros on the screen.
  (select count(*) from partners)                                                 as partners,
  (select count(*) from partner_capital_entries)                                  as capital_entries,
  (select count(*) from bank_loans)                                               as loan_entries,

  -- Did the Finance Setup migration actually run? NULL here means the table
  -- is not there yet, which is why those lines read "not entered".
  (to_regclass('public.fixed_assets')     is not null)                            as fixed_assets_table_exists,
  (to_regclass('public.finance_settings') is not null)                            as finance_settings_table_exists,

  -- And a sanity anchor: the reports are reading real trading data.
  (select count(*) from transactions where coalesce(hq_status,'processing') <> 'cancelled') as live_transactions;
