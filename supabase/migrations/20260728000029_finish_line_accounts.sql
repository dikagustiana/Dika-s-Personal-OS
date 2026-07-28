-- The account level underneath the Finish-line cells.
--
-- WHAT THIS IS FOR: click a cell that needs work and three of the four fields
-- are empty — what the ideal looks like, how the figure is derived, and who
-- owns the data. Those three already exist, filled, in the owner's
-- consolidation mapping workbook at ACCOUNT level. This gives them somewhere
-- to live inside the app.
--
-- ACCOUNTS HANG OFF cell_id, NOT item_id. An account belongs to one entity and
-- one metric, which is exactly what a cell is. Hanging them off the metric
-- would lose the entity.
--
-- DRIVER INFORMATION IS NEVER AGGREGATED UP TO THE CELL. One metric-entity
-- pair can carry dozens of accounts with different drivers; collapsing them
-- into a single cell-level field would let a cell claim one driver it does not
-- have.
--
-- driver_type IS text, NOT AN ENUM, on purpose. The vocabulary grows as the
-- owner designs more of them. An enum would need a migration every time, and
-- that friction is exactly what stops a list being maintained.
--
-- APPLIED 2026-07-28 via the Supabase apply_migration tool. NEVER apply with
-- `supabase db push`, `migration up`, `db reset`, or `db remote commit` — this
-- repo's filenames and the live ledger use different numbering, so any of
-- those replays the entire history from 0001_schema.sql against live data.
--
-- Idempotent throughout. Safe to re-run.

create table if not exists public.os_finish_line_accounts (
  id            uuid primary key default gen_random_uuid(),

  -- NULLABLE, DELIBERATELY, and this is the one departure from the drafted
  -- schema. An account whose Function x Business matches no metric has no cell
  -- to point at. With a NOT NULL column such a row could not be stored at all,
  -- so the only way to load the workbook would be to drop it — which would
  -- understate the account population behind every cell and make coverage look
  -- better than it is. Unmapped accounts are therefore stored WITH the rest,
  -- carrying `cell_id is null`, and the unmapped list is exactly that query.
  cell_id       uuid references public.os_finish_line_cells(id) on delete cascade,

  coa_entity    text,
  coa_consol    text,
  account_name  text not null,
  -- `function` and `business` are kept as raw workbook facts even though
  -- cell_id is derived from them: they are what the mapping is re-run against
  -- when the chart of accounts changes.
  function      text,
  nature        text,
  business      text,
  is_dummy      boolean not null default false,
  driver_type   text,
  driver_source text,
  data_ideal    text,
  pic           text,
  notes         text,
  sort_order    int not null default 0,
  imported_at   timestamptz not null default now()
);

-- RE-IMPORT REPLACES, NEVER MERGES, and this index is what makes that
-- enforceable: the loader upserts on the natural key, so running the load
-- twice produces the same account count rather than double.
-- coalesce() because coa_entity/coa_consol are nullable and NULL never equals
-- NULL in a unique index.
create unique index if not exists os_finish_line_accounts_natural_key
  on public.os_finish_line_accounts
     (coalesce(coa_entity, ''), coalesce(coa_consol, ''), account_name);

-- Every read is "the accounts for this cell".
create index if not exists os_finish_line_accounts_cell_idx
  on public.os_finish_line_accounts (cell_id);

-- The unmapped list, and the remap routine, both scan on this pair.
create index if not exists os_finish_line_accounts_fn_business_idx
  on public.os_finish_line_accounts (function, business);

comment on table public.os_finish_line_accounts is
  'Account-level detail underneath a Finish-line cell. Loaded from the consolidation mapping workbook; the workbook owns data_ideal, driver_type, driver_source, pic, business and is_dummy and the app never edits them. cell_id is null for an account whose Function x Business maps to no metric — those are surfaced as the unmapped list, never dropped.';

comment on column public.os_finish_line_accounts.cell_id is
  'Derived from the mapping table, not authored. Null means unmapped: surfaced in the unmapped list rather than discarded.';

comment on column public.os_finish_line_accounts.is_dummy is
  'A cell sitting mostly on dummy accounts is not trustworthy however complete its drivers are — the drivers describe placeholders. Surfaced beside the coverage counts rather than resolved.';

comment on column public.os_finish_line_accounts.imported_at is
  'The honesty field. Shown on screen, because a stale import that looks live is worse than no import.';

alter table public.os_finish_line_accounts enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'os_finish_line_accounts'
      and policyname = 'require app key'
  ) then
    create policy "require app key" on public.os_finish_line_accounts
      for all to anon, authenticated
      using (public.os_key_valid())
      with check (public.os_key_valid());
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- THE MAPPING, AS DATA
-- ---------------------------------------------------------------------------
-- The workbook is at account level, the app is at metric level, and the join is
--   Function x Business x Entity -> cell
-- Entity comes from the account's own coa_entity, so the only part that needs
-- authoring is Function x Business -> metric.
--
-- THIS IS A TABLE AND NOT A switch STATEMENT because the owner's chart of
-- accounts changes. A hardcoded mapping would rot, and every correction would
-- need a deploy. Editing one row here and re-running the remap moves the
-- accounts, with no code change and no rebuild.
--
-- Functions below operating income — Finance Income, Finance Expense, Other
-- Income, Other Expense, Current Tax, Deferred Tax, Related Income Tax — are
-- deliberately given NO row here. They have no metric in the current matrix, so
-- they route to the unmapped list, and that list is then a real finding: it
-- says what the pack does not yet cover.
create table if not exists public.os_finish_line_account_map (
  id          uuid primary key default gen_random_uuid(),
  function    text not null,
  business    text not null,
  -- The metric row this pair belongs to. Cascades, so removing a metric cannot
  -- leave a mapping pointing at nothing.
  item_id     uuid not null references public.os_finish_line_items(id) on delete cascade,
  updated_at  timestamptz not null default now()
);

create unique index if not exists os_finish_line_account_map_key
  on public.os_finish_line_account_map (function, business);

comment on table public.os_finish_line_account_map is
  'Function x Business -> metric. Authored data, not code: edit a row and re-run os_finish_line_remap_accounts() to move accounts, no deploy required. A pair with no row here is unmapped by design.';

alter table public.os_finish_line_account_map enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'os_finish_line_account_map'
      and policyname = 'require app key'
  ) then
    create policy "require app key" on public.os_finish_line_account_map
      for all to anon, authenticated
      using (public.os_key_valid())
      with check (public.os_key_valid());
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- THE ONE DERIVATION
-- ---------------------------------------------------------------------------
-- cell_id is computed HERE and nowhere else. The app reads the stored column
-- and never re-derives it, so there is exactly one definition of "which cell
-- does this account belong to" — this project has twice shipped two paths
-- computing one number and had two screens disagree.
--
-- Returns the number of accounts that ended up mapped, so a caller can see the
-- effect of a mapping edit without counting rows itself.
create or replace function public.os_finish_line_remap_accounts()
returns table (mapped bigint, unmapped bigint)
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.os_finish_line_accounts a
     set cell_id = c.id
    from public.os_finish_line_account_map m
    join public.os_finish_line_cells c on c.item_id = m.item_id
   where a.function = m.function
     and a.business = m.business
     and c.entity_code = a.coa_entity
     and a.cell_id is distinct from c.id;

  -- Anything that no longer matches a mapping row loses its cell rather than
  -- keeping a stale one. It reappears in the unmapped list, which is the
  -- honest outcome — a silently retained old cell would be worse.
  update public.os_finish_line_accounts a
     set cell_id = null
   where a.cell_id is not null
     and not exists (
       select 1
         from public.os_finish_line_account_map m
         join public.os_finish_line_cells c on c.item_id = m.item_id
        where a.function = m.function
          and a.business = m.business
          and c.entity_code = a.coa_entity
          and c.id = a.cell_id
     );

  return query
    select count(*) filter (where cell_id is not null),
           count(*) filter (where cell_id is null)
      from public.os_finish_line_accounts;
end
$$;

comment on function public.os_finish_line_remap_accounts() is
  'Recomputes every account cell_id from os_finish_line_account_map. The single definition of account -> cell. Run after editing a mapping row; no deploy needed.';
