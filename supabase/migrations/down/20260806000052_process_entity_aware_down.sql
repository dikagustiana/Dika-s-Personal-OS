-- Down-migration for 20260806000052_process_entity_aware.
--
-- ONLY VALID AFTER 20260806000053_arbi_process_seed_down.sql HAS RUN: the
-- single-entity shape this restores (global unique on label, single-column
-- lane PK, the SAMB-only track CHECK) cannot hold two entities' rows — with
-- ARBI still seeded, restoring unique(label) fails on the 19 shared labels,
-- and that failure is the guard working, not a bug in this file.
--
-- Restores the exact pre-52 shape: FKs back to their single-column forms,
-- lanes PK back to (key), CHECK back on track, entity columns dropped,
-- os_process_tracks dropped. SAMB data is untouched throughout — every
-- statement here alters shape, none deletes a SAMB row.

-- 1. Steps: composite FKs and per-entity unique go first.
alter table public.os_process_steps drop constraint if exists os_process_steps_entity_lane_fkey;
alter table public.os_process_steps drop constraint if exists os_process_steps_entity_track_fkey;
alter table public.os_process_steps drop constraint if exists os_process_steps_entity_label_key;

-- 2. Lanes: PK back to the bare key.
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
  if pk_cols = array['entity_code', 'key'] then
    execute format('alter table public.os_process_lanes drop constraint %I', pk_name);
    alter table public.os_process_lanes add primary key (key);
  end if;
end
$$;

-- 3. Steps: the original single-column shapes.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.os_process_steps'::regclass
      and conname = 'os_process_steps_label_key'
  ) then
    alter table public.os_process_steps
      add constraint os_process_steps_label_key unique (label);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.os_process_steps'::regclass
      and conname = 'os_process_steps_track_check'
  ) then
    alter table public.os_process_steps
      add constraint os_process_steps_track_check
      check (track in ('TRADE', 'LP', 'KEDUANYA'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.os_process_steps'::regclass
      and conname = 'os_process_steps_lane_key_fkey'
  ) then
    alter table public.os_process_steps
      add constraint os_process_steps_lane_key_fkey
      foreign key (lane_key) references public.os_process_lanes(key);
  end if;
end
$$;

-- 4. Entity columns off, vocabulary table gone.
alter table public.os_process_steps  drop column if exists entity_code;
alter table public.os_process_lanes  drop column if exists entity_code;
alter table public.os_process_phases drop column if exists entity_code;
alter table public.os_process_gates  drop column if exists entity_code;

drop policy if exists "require app key to select" on public.os_process_tracks;
drop policy if exists "require app key to insert" on public.os_process_tracks;
drop policy if exists "require app key to update" on public.os_process_tracks;
drop policy if exists "require app key to delete" on public.os_process_tracks;
drop table if exists public.os_process_tracks;
