-- ===========================================================================
-- SAMB OPERATIONAL PROCESS: SWIMLANE AS DATA, NEEDS AS THE REGISTER.
-- ===========================================================================
-- Five tables describing the SAMB operational chain: lanes (the functions),
-- phases (the ribbon), steps (the boxes), gates (the blockers), and needs
-- (the data register that makes the diagram more than a picture). The chain
-- exists to define what "done" means for each Finish line row, which is why
-- os_process_needs carries a nullable FK to os_finish_line_items — a READ
-- relation only. Nothing in this feature writes cell state; cell state
-- changes only through explicit human edits, and that decision is locked.
--
-- Lanes are a table, not an enum and not hardcoded columns — the same
-- precedent as os_finish_line_entities. The frontend must never hardcode the
-- lane list.
--
-- Steps: `label` is the human identity ('6a', '15b', '23'), NOT a sequence.
-- Labels jump and fork deliberately; slot is the ordering, label is the name.
-- Two steps MAY share a slot — that is a parallel branch, not a duplicate,
-- so there is deliberately NO unique constraint on (slot, lane_key). Two
-- steps sharing slot AND lane render stacked in one cell.
--
-- docs / coa / drivers are jsonb on purpose: always read with their step,
-- never queried alone, never filtered — the same pattern as `milestones` on
-- os_projects.
--
-- Phase completeness (phases must tile slot 1..max(slot) exactly once)
-- cannot be enforced at table level; it is asserted by the frontend logic
-- tests instead. The CHECK here only guards each row's own range.
--
-- finish_line_item_id is ON DELETE SET NULL, not restrict/cascade: the
-- Finish line keeps full authority over its own rows. Deleting an item must
-- never be blocked by, nor delete, a process need — the need merely loses
-- its mapping and stays visible in the register.
--
-- NOT APPLIED. This session has no database access. The frontend that reads
-- these tables ships before this file runs, and treats the missing relations
-- (Postgres 42P01) as an ordinary empty state. Apply via the Supabase
-- apply_migration tool per the APPLY BEFORE DEPLOY block in the PR that
-- introduced this file. NEVER apply with `supabase db push`, `migration up`,
-- `db reset`, or `db remote commit` — this repo's filenames and the live
-- ledger's versions are different numbering schemes, so any of those replays
-- the entire history from 0001_schema.sql against live production data.
--
-- Idempotent throughout: create table/index if not exists, policies created
-- only when absent. Safe to re-run.
--
-- Down-migration:
-- supabase/migrations/down/20260806000050_samb_process_schema_down.sql

-- 1. Lanes ------------------------------------------------------------------
create table if not exists public.os_process_lanes (
  key         text primary key,
  label       text not null,
  description text,
  ordinal     integer not null,
  is_external boolean not null default false
);

comment on table public.os_process_lanes is
  'Swimlane rows: the functions that own steps. A table, not an enum — the os_finish_line_entities precedent. is_external marks outside actors (the LP client), rendered dashed.';

-- 2. Gates ------------------------------------------------------------------
-- Created before steps so the FK below can land in one pass.
create table if not exists public.os_process_gates (
  id      text primary key,
  type    text not null check (type in ('DATA', 'DECISION', 'OOS')),
  title   text not null,
  sub     text,
  owner   text,
  unblock text
);

comment on table public.os_process_gates is
  'Blockers G01..G15. DATA = waiting on someone else, DECISION = waiting on the process owner, OOS = outside SAMB scope — kept so gate numbering stays consistent with the blocker register used outside the app; some gates are deliberately referenced by no step.';

-- 3. Phases -----------------------------------------------------------------
create table if not exists public.os_process_phases (
  id        uuid primary key default gen_random_uuid(),
  name      text not null,
  slot_from integer not null,
  slot_to   integer not null,
  constraint os_process_phases_range_check check (slot_to >= slot_from)
);

comment on table public.os_process_phases is
  'The ribbon above the diagram. Phases must tile the slot range exactly once — asserted in frontend logic tests, not enforceable here.';

-- 4. Steps ------------------------------------------------------------------
create table if not exists public.os_process_steps (
  id       uuid primary key default gen_random_uuid(),
  label    text not null unique,
  slot     integer not null,
  lane_key text not null references public.os_process_lanes(key),
  co       text,
  track    text not null check (track in ('TRADE', 'LP', 'KEDUANYA')),
  name     text not null,
  risk     text,
  control  text,
  note     text,
  gate_id  text references public.os_process_gates(id),
  docs     jsonb not null default '[]',
  coa      jsonb not null default '[]',
  drivers  jsonb not null default '[]'
);

comment on table public.os_process_steps is
  'Boxes in the swimlane. label is the human identity and is NOT sequential — 6a/6b are parallel branches, 21→23→22 is deliberate; slot is the column order. No unique (slot, lane_key): same slot + same lane = stacked boxes in one cell.';
comment on column public.os_process_steps.docs is
  'jsonb array of text. Read with the step, never queried alone — the os_projects.milestones pattern.';
comment on column public.os_process_steps.coa is
  'jsonb array of {code,label}. Same pattern as docs.';
comment on column public.os_process_steps.drivers is
  'jsonb array of text. Same pattern as docs.';

-- 5. Needs — the data register ---------------------------------------------
create table if not exists public.os_process_needs (
  id                  uuid primary key default gen_random_uuid(),
  step_id             uuid not null references public.os_process_steps(id) on delete cascade,
  item                text not null,
  kind                text not null check (kind in ('MASTER', 'TRANSAKSI', 'PARAMETER', 'REFERENSI')),
  src                 text,
  owner               text,
  status              text not null check (status in ('ADA', 'SEBAGIAN', 'BELUM')),
  finish_line_item_id uuid references public.os_finish_line_items(id) on delete set null,
  requested_on        date
);

comment on table public.os_process_needs is
  'What must exist for a step to run correctly — not what the step produces. The bridge to the Finish line: finish_line_item_id says which row this need helps close. The relation is read-only toward cells; nothing here ever writes cell state.';
comment on column public.os_process_needs.finish_line_item_id is
  'Nullable by design: seed does not fill it, mapping is applied by label at apply time, and an unmatched label stays NULL — the need still shows in the register, only the Finish line link is missing. ON DELETE SET NULL keeps Finish line authority over its own rows.';
comment on column public.os_process_needs.requested_on is
  'When the item was requested from its owner. Not in the seed; filled in by hand later. The only column in this feature editable from inside the app — status BELUM moves nobody, "requested on X, unanswered" does.';

create index if not exists os_process_needs_status_idx
  on public.os_process_needs (status);
create index if not exists os_process_needs_owner_idx
  on public.os_process_needs (owner);
create index if not exists os_process_needs_finish_line_item_idx
  on public.os_process_needs (finish_line_item_id);

-- 6. RLS --------------------------------------------------------------------
-- The house pattern from the most recent table (os_tasks): four split
-- policies per table, every predicate subquery-wrapped so os_key_valid()
-- evaluates once per statement. Owner-only SELECT — the share read-only key
-- does NOT read process tables: the key was issued for the surface that
-- existed when it was issued, and silently widening an already-issued
-- credential to new content types is a permission grant, not a default
-- (the os_tasks stance).
alter table public.os_process_lanes  enable row level security;
alter table public.os_process_gates  enable row level security;
alter table public.os_process_phases enable row level security;
alter table public.os_process_steps  enable row level security;
alter table public.os_process_needs  enable row level security;

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'os_process_lanes', 'os_process_gates', 'os_process_phases',
    'os_process_steps', 'os_process_needs'
  ] loop
    if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = tbl
                   and policyname = 'require app key to select') then
      execute format(
        'create policy "require app key to select" on public.%I
           for select using ((select public.os_key_valid()))', tbl);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = tbl
                   and policyname = 'require app key to insert') then
      execute format(
        'create policy "require app key to insert" on public.%I
           for insert with check ((select public.os_key_valid()))', tbl);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = tbl
                   and policyname = 'require app key to update') then
      execute format(
        'create policy "require app key to update" on public.%I
           for update using ((select public.os_key_valid()))
           with check ((select public.os_key_valid()))', tbl);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = tbl
                   and policyname = 'require app key to delete') then
      execute format(
        'create policy "require app key to delete" on public.%I
           for delete using ((select public.os_key_valid()))', tbl);
    end if;
  end loop;
end
$$;
