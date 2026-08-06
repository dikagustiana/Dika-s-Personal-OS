-- ===========================================================================
-- PROCESS FEATURE BECOMES ENTITY-AWARE. Schema only — the ARBI seed is
-- 20260806000053.
-- ===========================================================================
-- The six os_process_* tables were implicitly single-entity: a global unique
-- on step labels, a global lane PK, a CHECK constraint carrying SAMB's track
-- vocabulary, and no entity column anywhere. ARBI's B2C chain cannot be
-- inserted against that shape — 19 of its 23 labels collide with SAMB's, its
-- tracks are FORWARD/REVERSE, and its WAREHOUSE lane carries a different
-- description at a different ordinal. This migration makes entity part of
-- the identity of lanes, phases and steps, and moves the track vocabulary
-- from a CHECK into a table.
--
-- WHY A TABLE AND NOT A WIDER CHECK: both entities use KEDUANYA with the
-- same meaning (the shared backbone) but different branch names — SAMB
-- TRADE/LP, ARBI FORWARD/REVERSE. One global CHECK would let a SAMB step
-- claim track REVERSE, and would make every frontend filter list offer
-- tracks that mean nothing for the entity in view. os_process_tracks keys
-- the vocabulary by entity, and the steps FK (entity_code, track) makes a
-- cross-entity track a constraint violation instead of a rendering surprise.
--
-- ORDER OF OPERATIONS MATTERS: os_process_steps.lane_key points at the lane
-- PK, so that FK is dropped before the PK widens to (entity_code, key) and
-- recreated afterwards as the composite (entity_code, lane_key) — which is
-- STRONGER than what it replaces: a step's lane must now belong to the
-- step's own entity.
--
-- WHAT DOES NOT CHANGE, DELIBERATELY:
--   - os_process_needs and os_process_step_items get NO entity column. Both
--     inherit their entity through step_id; a second copy would be a second
--     source of truth that can drift from the step. Queries that need the
--     entity of a need or a bridge edge join through the step.
--   - os_process_gates keeps its text PK. G01..G15 and B01..B12 are already
--     namespaced by prefix, and changing the PK would force the steps FK to
--     change with it for no gain. entity_code on gates is NULLABLE: a
--     cross-entity gate is a real future (B04 is the seam to SAMB's LP
--     track), so the column must not promise one entity per gate.
--
-- Constraint drops are CATALOG-DRIVEN (by column set, not by name): the live
-- constraints were created inline by 20260806000050, so their names are the
-- Postgres defaults — but a rename would make a by-name drop silently skip,
-- and a skipped drop here means the ARBI seed fails on a constraint this
-- file claimed to remove.
--
-- Backfill is 'SAMB' throughout: every existing row IS the SAMB chain, and
-- the regression bar for this migration is that no SAMB count moves — 6
-- lanes, 7 phases, 15 gates, 30 steps, 118 needs, 45 bridge pairs, asserted
-- by the frontend logic tests either side of the apply.
--
-- NOT APPLIED. This session has no database access. Apply via the Supabase
-- apply_migration tool BEFORE deploying the frontend that reads
-- entity_code, per the APPLY BEFORE DEPLOY block in the PR that introduced
-- this file. NEVER apply with `supabase db push`, `migration up`,
-- `db reset`, or `db remote commit` — this repo's filenames and the live
-- ledger's versions are different numbering schemes, so any of those
-- replays the entire history from 0001_schema.sql against production data.
--
-- Idempotent throughout: guarded column adds, catalog checks before every
-- constraint drop/add, policies created only when absent. Safe to re-run.
--
-- Down-migration:
-- supabase/migrations/down/20260806000052_process_entity_aware_down.sql
-- (requires 20260806000053's down FIRST — the single-entity shape cannot
-- hold two entities' rows).

-- 1. The track vocabulary, per entity ---------------------------------------
create table if not exists public.os_process_tracks (
  entity_code text not null references public.os_finish_line_entities(code),
  code        text not null,
  label       text not null,
  ordinal     integer not null,
  is_shared   boolean not null default false,
  primary key (entity_code, code)
);

comment on table public.os_process_tracks is
  'Track vocabulary per entity — replaces the CHECK on os_process_steps.track. Branch tracks (is_shared=false) are the filter buttons and the walk roots; the one is_shared track per entity is the shared backbone that joins every walk. label is what chips display (KEDUANYA renders as BERSAMA).';
comment on column public.os_process_tracks.is_shared is
  'Exactly one true per entity by convention (asserted in frontend tests, not enforceable here without a partial unique index that would block a future two-backbone entity).';

alter table public.os_process_tracks enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_process_tracks'
                 and policyname = 'require app key to select') then
    create policy "require app key to select" on public.os_process_tracks
      for select using ((select public.os_key_valid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_process_tracks'
                 and policyname = 'require app key to insert') then
    create policy "require app key to insert" on public.os_process_tracks
      for insert with check ((select public.os_key_valid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_process_tracks'
                 and policyname = 'require app key to update') then
    create policy "require app key to update" on public.os_process_tracks
      for update using ((select public.os_key_valid()))
      with check ((select public.os_key_valid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_process_tracks'
                 and policyname = 'require app key to delete') then
    create policy "require app key to delete" on public.os_process_tracks
      for delete using ((select public.os_key_valid()));
  end if;
end
$$;

-- SAMB's vocabulary, seeded HERE rather than in a seed migration: the steps
-- FK added in section 4 points at these rows, and 30 live SAMB steps must
-- satisfy it the moment it lands.
insert into public.os_process_tracks (entity_code, code, label, ordinal, is_shared) values
  ('SAMB', 'TRADE',    'TRADE',   1, false),
  ('SAMB', 'LP',       'LP',      2, false),
  ('SAMB', 'KEDUANYA', 'BERSAMA', 3, true)
on conflict (entity_code, code) do nothing;

-- 2. Lanes: entity joins the identity ---------------------------------------
alter table public.os_process_lanes
  add column if not exists entity_code text references public.os_finish_line_entities(code);
update public.os_process_lanes set entity_code = 'SAMB' where entity_code is null;
alter table public.os_process_lanes alter column entity_code set not null;

-- The steps FK targets the lane PK, so it must let go before the PK widens.
-- Catalog-driven: drop whatever FK on os_process_steps references
-- os_process_lanes, whatever it is named.
do $$
declare
  fk record;
begin
  for fk in
    select conname from pg_constraint
    where conrelid = 'public.os_process_steps'::regclass
      and contype = 'f'
      and confrelid = 'public.os_process_lanes'::regclass
  loop
    execute format('alter table public.os_process_steps drop constraint %I', fk.conname);
  end loop;
end
$$;

-- Widen the PK to (entity_code, key) — only when it is still the single
-- column, so a re-run passes straight through.
do $$
declare
  pk_name text;
  pk_cols text[];
begin
  select c.conname,
         (select array_agg(a.attname::text order by k.ord)
          from unnest(c.conkey) with ordinality as k(attnum, ord)
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
    into pk_name, pk_cols
  from pg_constraint c
  where c.conrelid = 'public.os_process_lanes'::regclass and c.contype = 'p';
  if pk_cols = array['key'] then
    execute format('alter table public.os_process_lanes drop constraint %I', pk_name);
    alter table public.os_process_lanes add primary key (entity_code, key);
  end if;
end
$$;

comment on table public.os_process_lanes is
  'Swimlane rows per entity: PK (entity_code, key), so ARBI''s WAREHOUSE can carry its own description and ordinal beside SAMB''s. Still a table, never an enum — the os_finish_line_entities precedent. is_external marks outside actors (the LP client, the marketplaces, the couriers), rendered dashed.';

-- 3. Phases: per entity ------------------------------------------------------
alter table public.os_process_phases
  add column if not exists entity_code text references public.os_finish_line_entities(code);
update public.os_process_phases set entity_code = 'SAMB' where entity_code is null;
alter table public.os_process_phases alter column entity_code set not null;

comment on table public.os_process_phases is
  'The ribbon above the diagram, per entity. Phases must tile slot 1..max(slot) exactly once PER ENTITY — asserted in frontend logic tests, not enforceable here.';

-- 4. Steps: entity column, per-entity label, track FK, composite lane FK -----
alter table public.os_process_steps
  add column if not exists entity_code text references public.os_finish_line_entities(code);
update public.os_process_steps set entity_code = 'SAMB' where entity_code is null;
alter table public.os_process_steps alter column entity_code set not null;

-- Drop the GLOBAL unique on label — found by its column set, not its name.
-- This is blocker #1: 19 of ARBI's 23 labels already exist as SAMB steps.
do $$
declare
  uq record;
begin
  for uq in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.os_process_steps'::regclass
      and c.contype = 'u'
      and (select array_agg(a.attname::text order by k.ord)
           from unnest(c.conkey) with ordinality as k(attnum, ord)
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
          = array['label']
  loop
    execute format('alter table public.os_process_steps drop constraint %I', uq.conname);
  end loop;
end
$$;

-- Label stays the identity — WITHIN an entity. '6a' can exist once per chain.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.os_process_steps'::regclass
      and conname = 'os_process_steps_entity_label_key'
  ) then
    alter table public.os_process_steps
      add constraint os_process_steps_entity_label_key unique (entity_code, label);
  end if;
end
$$;

-- Drop the CHECK carrying SAMB's track vocabulary — blocker #2. Found by
-- shape: the check constraints on this table that mention the track column.
do $$
declare
  ck record;
begin
  for ck in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.os_process_steps'::regclass
      and c.contype = 'c'
      and exists (
        select 1 from unnest(c.conkey) k
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
        where a.attname = 'track'
      )
  loop
    execute format('alter table public.os_process_steps drop constraint %I', ck.conname);
  end loop;
end
$$;

-- The replacement is a FK into the vocabulary table: a step's track must be
-- one of its OWN entity's tracks.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.os_process_steps'::regclass
      and conname = 'os_process_steps_entity_track_fkey'
  ) then
    alter table public.os_process_steps
      add constraint os_process_steps_entity_track_fkey
      foreign key (entity_code, track)
      references public.os_process_tracks(entity_code, code);
  end if;
end
$$;

-- Recreate the lane FK as the composite — stronger than the one dropped in
-- section 2: a step's lane must belong to the step's own entity.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.os_process_steps'::regclass
      and conname = 'os_process_steps_entity_lane_fkey'
  ) then
    alter table public.os_process_steps
      add constraint os_process_steps_entity_lane_fkey
      foreign key (entity_code, lane_key)
      references public.os_process_lanes(entity_code, key);
  end if;
end
$$;

comment on table public.os_process_steps is
  'Boxes in the swimlane, per entity. label is the human identity and unique per (entity_code, label) — 6a/6b are parallel branches, 21→23→22 is deliberate; slot is the column order. No unique (slot, lane_key): same slot + same lane = stacked boxes in one cell. track references os_process_tracks(entity_code, code); lane_key references os_process_lanes(entity_code, key) — both FKs pin the step to its own entity''s vocabulary.';

-- 5. Gates: entity as an attribute, PK untouched ----------------------------
alter table public.os_process_gates
  add column if not exists entity_code text references public.os_finish_line_entities(code);
update public.os_process_gates set entity_code = 'SAMB' where entity_code is null;
-- Deliberately NOT set not null: see the header. A cross-entity gate keeps
-- the column nullable on purpose.

comment on column public.os_process_gates.entity_code is
  'Which entity''s blocker register this gate belongs to. NULLABLE by design: a future cross-entity gate (B04 mirrors SAMB''s LP seam) must not be forced to pick a side. The PK stays the bare id — G/B prefixes already namespace the two registers.';
