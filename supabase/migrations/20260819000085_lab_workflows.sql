-- =============================================================================
-- LAB WORKFLOWS: named, ordered SUBSETS of the closed thirteen-stage set.
-- One pipeline does not fit every purpose — a quick fact-check needs no
-- question framing; a literature sweep needs only discovery. A workflow is a
-- name plus an ordered subset of S0…S12. Nothing more: no branching, no
-- per-workflow gates, no invented stages.
-- =============================================================================
--
-- APPLIED 2026-08-19 via the Supabase apply_migration tool (ledger name
-- `lab_workflows`). Verified live after applying, in rolled-back probes under
-- a throwaway key: an invalid stage code refused naming the code; a duplicate
-- refused; out-of-canonical-order refused; UPDATE and DELETE on the canonical
-- row both refused; a keyless insert refused with the G-WORKFLOW owner
-- message; the five seeds read back with the canonical row first. Never
-- `supabase db push` / `migration up` / `db reset` — see 20260817000073.
--
-- Down-migration: down/20260819000085_lab_workflows_down.sql (drops the
-- column, the table, and the enum).
--
-- THE CONSTRAINTS THAT CARRY WEIGHT, and why they live here and not in the
-- application:
--
--   * stage_codes may only contain codes from the existing thirteen — the
--     stage set is what the GATES are mapped to. If the owner could invent a
--     stage, the mapping breaks. The set is a Postgres enum
--     (os_lab_stage_code) and the guard validates every element against it.
--   * The order is the canonical order, enforced strictly increasing. Stage
--     order is fixed by dependency (S4 cannot precede S3): a workflow is a
--     SELECTION, not an arrangement.
--   * The canonical workflow (is_canonical = true, the full S0…S12 run) is
--     IMMUTABLE — UPDATE and DELETE are refused, and a partial unique index
--     admits at most one canonical row. There must always be one reference
--     path that cannot be edited by accident.
--   * Owner-write guard, same shape as the other owner-only tables (080's
--     G-FRAME): agents have no business defining workflows — they run
--     routes, they never draw them.
--
-- WHAT WORKFLOWS CANNOT DO, recorded so nobody relaxes a gate "because the
-- workflow skips that stage": the gates live in the database and are not
-- workflow-scoped. A workflow that skips S5 does not permit unverified
-- datapoints to support an approved claim — os_lab_claims_gate_guard still
-- refuses. Workflows are presentation and routing over the same rails; this
-- migration adds NO gate changes, deliberately.
--
-- os_lab_projects.workflow_id: nullable; NULL means the canonical route.
-- on delete set null — deleting a (non-canonical) workflow drops any project
-- riding it back to canonical, never into a dangling pointer.

-- ---------------------------------------------------------------------------
-- the closed stage set, as a type
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'os_lab_stage_code' and n.nspname = 'public'
  ) then
    create type public.os_lab_stage_code as enum
      ('S0','S1','S2','S3','S4','S5','S6','S7','S8','S9','S10','S11','S12');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- the table
-- ---------------------------------------------------------------------------
create table if not exists public.os_lab_workflows (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) > 0),
  -- Ordered; every element one of the thirteen. text[] on purpose (the
  -- client reads plain strings); the guard validates against the enum.
  stage_codes text[] not null,
  is_canonical boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most ONE canonical row, ever.
create unique index if not exists os_lab_workflows_one_canonical
  on public.os_lab_workflows (is_canonical) where is_canonical;

-- ---------------------------------------------------------------------------
-- projects ride a workflow; null = canonical
-- ---------------------------------------------------------------------------
alter table public.os_lab_projects
  add column if not exists workflow_id uuid
    references public.os_lab_workflows(id) on delete set null;

create index if not exists os_lab_projects_workflow_idx
  on public.os_lab_projects (workflow_id);

-- ---------------------------------------------------------------------------
-- seeds — BEFORE the guard trigger exists, because the migration itself has
-- no app key. Five routes so the feature is usable immediately; only the
-- first is canonical. The owner can rename or delete any non-canonical one.
-- ---------------------------------------------------------------------------
insert into public.os_lab_workflows (name, stage_codes, is_canonical)
select v.name, v.stage_codes, v.is_canonical
from (values
  ('Riset penuh',
   array['S0','S1','S2','S3','S4','S5','S6','S7','S8','S9','S10','S11','S12'],
   true),
  ('Cek angka cepat',      array['S3','S4','S5'], false),
  ('Sapuan literatur',     array['S2','S6'],      false),
  ('Model ulang',          array['S7','S8'],      false),
  ('Pendasaran referensi', array['S6'],           false)
) as v(name, stage_codes, is_canonical)
where not exists (select 1 from public.os_lab_workflows);

-- ---------------------------------------------------------------------------
-- G-WORKFLOW: the guard. Owner-only writes; closed set; canonical order;
-- canonical row immutable. Guard owns the updated_at clock (080 style).
-- ---------------------------------------------------------------------------
create or replace function public.os_lab_workflows_gate_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  valid_codes text[] := enum_range(null::public.os_lab_stage_code)::text[];
  code text;
  pos int;
  prev_pos int := 0;
  seen text[] := '{}';
begin
  if not public.os_key_valid() then
    raise exception 'G-WORKFLOW: workflows are defined by the owner alone — agents run routes, they never draw them.';
  end if;

  if tg_op = 'DELETE' then
    if old.is_canonical then
      raise exception 'G-WORKFLOW: the canonical workflow is immutable — one reference path must always exist that no edit or delete can reach.';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.is_canonical then
    raise exception 'G-WORKFLOW: the canonical workflow is immutable — one reference path must always exist that no edit or delete can reach.';
  end if;

  if new.stage_codes is null or array_length(new.stage_codes, 1) is null then
    raise exception 'G-WORKFLOW: a workflow needs at least one stage.';
  end if;

  foreach code in array new.stage_codes loop
    pos := array_position(valid_codes, code);
    if pos is null then
      raise exception 'G-WORKFLOW: stage code % is not one of the thirteen — the stage set is closed; the gates are mapped to it, and an invented stage has no gate.', code;
    end if;
    if code = any(seen) then
      raise exception 'G-WORKFLOW: stage code % appears twice — a workflow is an ordered SUBSET of the thirteen.', code;
    end if;
    if pos <= prev_pos then
      raise exception 'G-WORKFLOW: stage codes must follow the canonical order S0…S12 (% may not follow %) — order is fixed by dependency; a workflow is a selection, not an arrangement.', code, valid_codes[prev_pos];
    end if;
    seen := seen || code;
    prev_pos := pos;
  end loop;

  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.os_lab_workflows_gate_guard() from public;
revoke all on function public.os_lab_workflows_gate_guard() from anon;
revoke all on function public.os_lab_workflows_gate_guard() from authenticated;

drop trigger if exists os_lab_workflows_gate_guard on public.os_lab_workflows;
create trigger os_lab_workflows_gate_guard
  before insert or update or delete on public.os_lab_workflows
  for each row execute function public.os_lab_workflows_gate_guard();

-- ---------------------------------------------------------------------------
-- RLS — the uniform four owner policies + read-key widening (080's shape)
-- ---------------------------------------------------------------------------
alter table public.os_lab_workflows enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_lab_workflows'
                 and policyname = 'require app key to select') then
    create policy "require app key to select" on public.os_lab_workflows
      for select using ((select public.os_key_valid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_lab_workflows'
                 and policyname = 'require app key to insert') then
    create policy "require app key to insert" on public.os_lab_workflows
      for insert with check ((select public.os_key_valid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_lab_workflows'
                 and policyname = 'require app key to update') then
    create policy "require app key to update" on public.os_lab_workflows
      for update using ((select public.os_key_valid()))
      with check ((select public.os_key_valid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_lab_workflows'
                 and policyname = 'require app key to delete') then
    create policy "require app key to delete" on public.os_lab_workflows
      for delete using ((select public.os_key_valid()));
  end if;
end
$$;

do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'os_read_key_valid'
  ) and exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'os_lab_workflows'
      and policyname = 'require app key to select'
      and qual not ilike '%os_read_key_valid%'
  ) then
    alter policy "require app key to select" on public.os_lab_workflows
      using ((select public.os_key_valid()) or (select public.os_read_key_valid()));
  end if;
end
$$;
