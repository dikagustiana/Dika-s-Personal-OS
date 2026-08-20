-- ===========================================================================
-- THE SECOND AXIS: PRODUCT FORM BESIDE SOURCING TRACK. SCHEMA ONLY.
-- ===========================================================================
-- KGR's chain carries two orthogonal facts about a step: which SOURCING MODE
-- reaches it (slaughter the bird vs buy the finished good — the axis that
-- partitions 24 of 38 steps) and which PRODUCT FORM it is restricted to
-- (carcass vs further-processed — the axis that touches four boxes). One enum
-- column cannot carry both: a carcass can be slaughtered or bought, a cut-up
-- SKU can be produced or bought. `os_process_steps.track` keeps the axis that
-- deserves the filter; this migration adds the vocabulary and column for the
-- axis that deserves a chip.
--
-- A FORM IS A CHIP, NEVER A FILTER. Unlike os_process_tracks there is no
-- is_shared and no backbone semantics: no walk starts from a form, no button
-- filters by one. Null is the normal case — only steps whose output form is
-- genuinely restricted carry a value.
--
-- PHASES LEARN TRACK SCOPE in the same pass: a nullable `track` column whose
-- null value means "the default ribbon, applying to every track" — which is
-- the existing behaviour, so every current phase row (SAMB, ARBI, and KGR's
-- ten) is untouched and keeps track = null.
--
-- THE PHASE INVARIANT CHANGES SHAPE, deliberately, and the frontend logic
-- test changes with it:
--   * unchanged — phases with track IS NULL tile slot 1..max exactly once
--     per entity;
--   * new — phases with a non-null track must not overlap each other WITHIN
--     that track, and must cover every slot that carries a step reachable on
--     that track. They need not tile: a gap is a true statement that the
--     walk jumps.
-- process_entity_checks.sql carries the SQL half of both assertions.
--
-- APPLY ORDER, THE REVERSE OF THE USUAL NOTE: this file lands BEFORE the
-- frontend that selects the new columns deploys. The deployed frontend names
-- its columns explicitly and never sees these; the next deploy reads them
-- with plain selects and no 42703 window exists. The 42P01/42703 guards
-- elsewhere stay exactly as narrow as they are.
--
-- Idempotent throughout. Contains no financial figures.
--
-- Down-migration:
-- supabase/migrations/down/20260820000086_process_forms_and_phase_tracks_down.sql

-- 1. The form vocabulary, per entity — the os_process_tracks shape minus the
--    walk semantics.
create table if not exists public.os_process_forms (
  entity_code text not null references public.os_finish_line_entities(code),
  code        text not null,
  label       text not null,
  ordinal     integer not null,
  primary key (entity_code, code)
);

comment on table public.os_process_forms is
  'Product-form vocabulary per entity — the second, orthogonal axis to os_process_tracks. A form is a CHIP, never a filter button and never a walk root: unlike track it carries no is_shared and no backbone semantics. Null form is the normal case; only steps whose output form is genuinely restricted carry one.';

alter table public.os_process_forms enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_process_forms'
                 and policyname = 'require app key to select') then
    create policy "require app key to select" on public.os_process_forms
      for select using ((select public.os_key_valid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_process_forms'
                 and policyname = 'require app key to insert') then
    create policy "require app key to insert" on public.os_process_forms
      for insert with check ((select public.os_key_valid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_process_forms'
                 and policyname = 'require app key to update') then
    create policy "require app key to update" on public.os_process_forms
      for update using ((select public.os_key_valid()))
      with check ((select public.os_key_valid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_process_forms'
                 and policyname = 'require app key to delete') then
    create policy "require app key to delete" on public.os_process_forms
      for delete using ((select public.os_key_valid()));
  end if;
  -- The member read, mirroring 20260806000058 on os_process_tracks: a
  -- contributor reads the vocabulary of their own entities and nothing else.
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_process_forms'
                 and policyname = 'member reads own-entity rows') then
    create policy "member reads own-entity rows" on public.os_process_forms
      for select
      using (entity_code = any ((select public.os_member_entities())::text[]));
  end if;
end
$$;

-- 2. The form column on steps, pinned to the step's own entity's vocabulary —
--    the same composite-FK discipline as (entity_code, track).
alter table public.os_process_steps
  add column if not exists form text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.os_process_steps'::regclass
      and conname = 'os_process_steps_form_fk'
  ) then
    alter table public.os_process_steps
      add constraint os_process_steps_form_fk
      foreign key (entity_code, form) references public.os_process_forms(entity_code, code);
  end if;
end
$$;

comment on column public.os_process_steps.form is
  'Product form this step is restricted to (KGR: KARKAS or OLAHAN), or null — the normal case — when the step serves any form. Orthogonal to track: rendered as a chip, never offered as a filter.';

-- 3. Track scope on phases. Null = the default ribbon, every track — the
--    pre-existing behaviour, so no current row changes meaning.
alter table public.os_process_phases
  add column if not exists track text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.os_process_phases'::regclass
      and conname = 'os_process_phases_track_fk'
  ) then
    alter table public.os_process_phases
      add constraint os_process_phases_track_fk
      foreign key (entity_code, track) references public.os_process_tracks(entity_code, code);
  end if;
end
$$;

comment on table public.os_process_phases is
  'The ribbon above the diagram, per entity. Rows with track NULL are the default ribbon and must tile slot 1..max(slot) exactly once per entity; rows with a track apply only under that track''s filter, must not overlap each other within the track, must cover every slot reachable on it, and MAY gap — a gap is a true statement that the walk jumps. Both halves asserted in frontend logic tests and process_entity_checks.sql, not enforceable here.';

-- 4. KGR's form vocabulary. The meaning of the old KARKAS/OLAHAN tracks
--    survives here; no other entity gets rows.
insert into public.os_process_forms (entity_code, code, label, ordinal) values
  ('KGR', 'KARKAS', 'KARKAS', 1),
  ('KGR', 'OLAHAN', 'OLAHAN', 2)
on conflict (entity_code, code) do nothing;
