-- Finance Setup — the figures the financial statements need and the
-- weighbridge can never work out on its own.
-- [2026-09-14]
--
-- Run this ONE STATEMENT AT A TIME in Supabase → SQL Editor. The editor
-- truncates long multi-line pastes and only shows the LAST query's result, so
-- running the whole file in one go can silently skip the end of it.
--
-- What this adds, and why each one exists:
--
--   partners.share_pct      Who owns what percentage OF A STATION. Capital and
--                           ownership are different things — at Pong Ro the
--                           split does not follow the money put in — so the
--                           share has to be recorded separately from the
--                           capital entries that already exist.
--
--   fixed_assets            What the business owns that wears out: trucks,
--                           scales, buildings. Without this there is no
--                           depreciation line and no fixed assets on the
--                           balance sheet — and the reports say "not entered"
--                           rather than quietly printing zero.
--
--   finance_settings        One row per station: the cash that was in the safe
--                           before the system started, the tax rate, the loan
--                           interest rate. Opening cash is the one that closes
--                           the "unexplained" gap at the bottom of the balance
--                           sheet.
--
-- Nothing here changes a single existing row. Every report keeps working
-- exactly as it does now until something is actually entered.


-- 1 ------------------------------------------------------------------------
-- Ownership share, per partner, per station. NULL means "nobody has said yet"
-- and the reports show it as not entered — never as zero and never as "the
-- rest", both of which would be inventions.
alter table partners add column if not exists share_pct numeric;


-- 2 ------------------------------------------------------------------------
alter table partners add constraint partners_share_pct_range
  check (share_pct is null or (share_pct >= 0 and share_pct <= 100));


-- 3 ------------------------------------------------------------------------
-- What the business owns that wears out. Straight-line depreciation:
-- cost / useful_life_years, counted from in_service_date.
create table if not exists fixed_assets (
  id                uuid primary key default gen_random_uuid(),
  location_id       uuid not null references locations(id),
  name              text not null,
  category          text,
  cost              numeric not null check (cost >= 0),
  useful_life_years numeric not null check (useful_life_years > 0),
  in_service_date   date not null,
  disposed_date     date,
  note              text,
  created_by        uuid,
  created_at        timestamptz not null default now()
);


-- 4 ------------------------------------------------------------------------
create index if not exists fixed_assets_location_idx on fixed_assets(location_id);


-- 5 ------------------------------------------------------------------------
-- One row per station. Everything is nullable on purpose: a station that has
-- not been set up yet must read as "not entered", which is exactly what NULL
-- means and exactly what the reports print.
create table if not exists finance_settings (
  location_id        uuid primary key references locations(id),
  opening_cash       numeric,
  opening_cash_date  date,
  tax_rate_pct       numeric check (tax_rate_pct is null or (tax_rate_pct >= 0 and tax_rate_pct <= 100)),
  interest_rate_pct  numeric check (interest_rate_pct is null or interest_rate_pct >= 0),
  fiscal_year_start  date,
  note               text,
  updated_by         uuid,
  updated_at         timestamptz not null default now()
);


-- 6 ------------------------------------------------------------------------
alter table fixed_assets     enable row level security;


-- 7 ------------------------------------------------------------------------
alter table finance_settings enable row level security;


-- 8 ------------------------------------------------------------------------
-- Read: anyone signed in. These are reference figures, and every report that
-- needs them is already permission-gated at the page.
create policy fixed_assets_read on fixed_assets
  for select to authenticated using (true);


-- 9 ------------------------------------------------------------------------
create policy finance_settings_read on finance_settings
  for select to authenticated using (true);


-- 10 -----------------------------------------------------------------------
-- Write: admins only. These change what every financial statement says, so
-- station staff must not be able to move them.
--
-- NOTE: this mirrors how the app already decides who is an admin. If your
-- profiles table names the column differently, adjust the sub-select — do NOT
-- widen it to `using (true)`, which would let any signed-in station account
-- rewrite the group's opening cash.
create policy fixed_assets_write on fixed_assets
  for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));


-- 11 -----------------------------------------------------------------------
create policy finance_settings_write on finance_settings
  for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));


-- 12 -----------------------------------------------------------------------
-- Check what you just built. Run this last; it changes nothing.
select
  (select count(*) from information_schema.columns
     where table_name = 'partners' and column_name = 'share_pct')      as partners_share_pct,
  (select count(*) from information_schema.tables
     where table_name = 'fixed_assets')                                as fixed_assets_table,
  (select count(*) from information_schema.tables
     where table_name = 'finance_settings')                            as finance_settings_table,
  (select count(*) from locations)                                     as stations,
  (select count(*) from partners where share_pct is not null)          as shares_entered;
-- Expect: 1, 1, 1, your station count, and 0 shares entered (you enter those
-- in the app, under Reports → Finance Setup).
