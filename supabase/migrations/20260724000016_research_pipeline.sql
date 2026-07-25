-- Research pipeline: the methodology apparatus behind GROWTH → Research.
--
-- A research project is NOT a new entity type. It is an ordinary os_projects
-- row parented to the existing Research project, so it inherits nesting in the
-- Projects list, a GROWTH Gantt bar, deadline countdowns, dashboard pinning and
-- documents[] with no new code. These tables carry only what a project cannot:
-- the gate matrix, the evidence register, the claims ledger, the review-cycle
-- history and the decision log.
--
-- WRITTEN BUT NOT APPLIED by the session that authored it — no database access.
-- Idempotent throughout, so applying it twice is a no-op.

-- ---------------------------------------------------------------------------
-- os_projects: priority, and 'parked' as a fourth status
-- ---------------------------------------------------------------------------

alter table public.os_projects
  add column if not exists priority smallint;

comment on column public.os_projects.priority is
  'Research portfolio ordering (1 = highest). Null on every non-research project.';

-- Settings scope to the Research parent row, which is where they logically
-- belong: they govern its children and nothing else in the app.
alter table public.os_projects
  add column if not exists wip_limit smallint;

alter table public.os_projects
  add column if not exists stale_months smallint;

comment on column public.os_projects.wip_limit is
  'Max concurrently active research children. Read from the Research parent; default 2 when null.';

comment on column public.os_projects.stale_months is
  'Age at which a verified register item goes stale and the data loop falls due. Default 12 when null.';

-- 'parked' is load-bearing: a parked project keeps its gates, register and
-- decision log intact. Losing that is the expensive part of returning to work
-- abandoned for months, which is exactly when it gets abandoned.
--
-- The old constraint is DISCOVERED, not guessed. It was written inline in
-- 20260724000001_schema.sql, so Postgres named it; this looks that name up in
-- pg_constraint instead of assuming the default. Dropping by an assumed name
-- would either fail the migration or, worse, silently leave the old constraint
-- in place if the name differed.
do $$
declare
  existing_name text;
begin
  select con.conname into existing_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'os_projects'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) like '%status%'
  limit 1;

  if existing_name is not null then
    execute format('alter table public.os_projects drop constraint %I', existing_name);
    raise notice 'dropped existing status constraint: %', existing_name;
  end if;
end
$$;

-- Re-added unconditionally under a name of our own, so a re-run finds and
-- replaces it deterministically.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'os_projects_status_allowed'
  ) then
    alter table public.os_projects
      add constraint os_projects_status_allowed
      check (status in ('active', 'paused', 'parked', 'done'));
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- os_research_meta — one row per research project
-- ---------------------------------------------------------------------------

create table if not exists public.os_research_meta (
  project_id uuid primary key references public.os_projects(id) on delete cascade,
  template text not null,
  question text not null default '',
  output text not null default '',
  audience text not null default '',
  -- Array of arrays of boolean, indexed POSITIONALLY against the template's
  -- stages and their gate criteria. Deliberately not normalised into rows: the
  -- criterion text lives in the template, so editing it propagates everywhere
  -- at once. Copying the text into data would freeze it at insert time.
  gates jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.os_research_meta is
  'Per-project research metadata. gates is positional against the template — never store criterion text here.';

-- ---------------------------------------------------------------------------
-- os_research_items — the evidence register
--
-- Relational rather than jsonb because the portfolio queries ACROSS projects:
-- shared pending work and cross-project value conflicts both need to group by
-- item name over every project at once.
-- ---------------------------------------------------------------------------

create table if not exists public.os_research_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.os_projects(id) on delete cascade,
  name text not null,
  unit text not null default '',
  type text not null default 'parameter'
    check (type in ('parameter', 'dataset', 'dokumen', 'paper', 'wawancara', 'baseline')),
  crit boolean not null default false,
  status text not null default 'IND' check (status in ('IND', 'V', 'NA')),
  value text not null default '',
  source text not null default '',
  -- Text, not date: the console records free-form reference periods like
  -- "2024" or "Q3 2025", which a date column cannot hold without inventing a
  -- day that was never published.
  asof text not null default '',
  note text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists os_research_items_project_idx
  on public.os_research_items (project_id, sort_order);

-- Cross-project lookups group on the normalised name.
create index if not exists os_research_items_name_idx
  on public.os_research_items (lower(btrim(name)));

comment on column public.os_research_items.asof is
  'Free-form reference period ("2024", "Q3 2025"). Text by design — see the migration comment.';

-- ---------------------------------------------------------------------------
-- os_research_claims — three-layer claims ledger
-- ---------------------------------------------------------------------------

create table if not exists public.os_research_claims (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.os_projects(id) on delete cascade,
  text text not null,
  -- (a) baseline fact already in use · (b) verified finding with source ·
  -- (c) hypothesis or inference.
  layer text not null check (layer in ('a', 'b', 'c')),
  ev text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists os_research_claims_project_idx
  on public.os_research_claims (project_id, sort_order);

-- ---------------------------------------------------------------------------
-- os_research_cycles — review-loop history, APPEND-ONLY
--
-- item_count and cite_count are SNAPSHOTS taken when the cycle ran. loopDue
-- compares today's counts against them to detect new work since the last
-- review, so they cannot be derived after the fact — they must be stored.
-- ---------------------------------------------------------------------------

create table if not exists public.os_research_cycles (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.os_projects(id) on delete cascade,
  loop text not null check (loop in ('data', 'cite', 'method')),
  n integer not null,
  date date not null,
  verdict text not null check (verdict in ('clean', 'rework')),
  findings text not null default '',
  item_count integer not null default 0,
  cite_count integer not null default 0,
  invalidated integer not null default 0,
  back_label text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists os_research_cycles_project_idx
  on public.os_research_cycles (project_id, loop, date);

comment on table public.os_research_cycles is
  'APPEND-ONLY. Recording a review cycle is a judgement about a moment; rewriting it destroys the record it exists to keep. No update or delete path exists in the repository layer.';

-- ---------------------------------------------------------------------------
-- os_research_log — decision log, APPEND-ONLY
-- ---------------------------------------------------------------------------

create table if not exists public.os_research_log (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.os_projects(id) on delete cascade,
  date date not null,
  text text not null,
  created_at timestamptz not null default now()
);

create index if not exists os_research_log_project_idx
  on public.os_research_log (project_id, date);

comment on table public.os_research_log is
  'APPEND-ONLY, same reasoning as os_research_cycles. The methodology loop treats rejected paths as evidence; an editable log is not evidence.';

-- ---------------------------------------------------------------------------
-- os_fact_library — cross-project verified facts, NOT project-scoped
-- ---------------------------------------------------------------------------

create table if not exists public.os_fact_library (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit text not null default '',
  value text not null default '',
  source text not null default '',
  asof text not null default '',
  -- Text, not a foreign key: provenance must survive deleting the project the
  -- fact was promoted from. A cascade here would erase where a figure came
  -- from, which is the only thing that makes it reusable.
  from_project text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists os_fact_library_name_idx
  on public.os_fact_library (lower(btrim(name)));

comment on column public.os_fact_library.from_project is
  'Name of the project this fact was promoted from, denormalised on purpose so deleting that project does not erase provenance.';

-- ---------------------------------------------------------------------------
-- RLS — the same app-key policy every other os_ table carries
-- ---------------------------------------------------------------------------

alter table public.os_research_meta enable row level security;
alter table public.os_research_items enable row level security;
alter table public.os_research_claims enable row level security;
alter table public.os_research_cycles enable row level security;
alter table public.os_research_log enable row level security;
alter table public.os_fact_library enable row level security;

do $$
declare
  target text;
begin
  for target in
    select unnest(array[
      'os_research_meta',
      'os_research_items',
      'os_research_claims',
      'os_research_cycles',
      'os_research_log',
      'os_fact_library'
    ])
  loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = target and policyname = 'require app key'
    ) then
      execute format(
        'create policy "require app key" on public.%I for all to anon, authenticated using (public.os_key_valid()) with check (public.os_key_valid())',
        target
      );
    end if;
  end loop;
end
$$;
