-- =============================================================================
-- INSTITUTION: the Lab as a research institution. Schema.
-- =============================================================================
--
-- APPLIED LIVE 2026-09-10 via the Supabase apply_migration tool (ledger
-- name `institution_schema`), one migration at a time, after the local
-- suite (scripts/institution-tests.sh) was green. NEVER apply with
-- `supabase db push` / `migration up` / `db reset` / `db remote commit` —
-- see 20260817000073.
--
-- Down-migration: down/20260910000099_institution_schema_down.sql.
--
-- WHAT THIS IS. The Lab's agents (os_lab_agents) become the staff of a think
-- tank: a program office that runs a pipeline, eight departments each with a
-- lead and specialists, peer review inside every department, a lead review
-- before anything leaves, an editorial committee at the top, a debate
-- channel back to it, and a corpus every later piece of work cites. Every
-- table here is a RECORD of something an agent or the director did; nothing
-- here is a message.
--
-- REAL COLUMN NAMES, AUDITED 2026-09-10: os_lab_agents(id, slug, name,
-- description, system_prompt, data_class, default_provider_id, version,
-- is_active, created_at, updated_at); os_lab_runs(id, agent_id, provider_id,
-- parent_run_id, chain_id, step_index, input, output, status, error,
-- tokens_in, tokens_out, cost_usd, duration_ms, created_at, model,
-- refusals). tokens_in/tokens_out are written ONCE, at run completion, from
-- the provider's terminal usage frame (run-lab-agent) — there is no
-- incremental token progress anywhere, so nothing downstream may pretend
-- there is.
--
-- WHO WRITES WHAT. The institution's stepper (an Edge Function under the
-- service role) writes assignments, reviews, submissions, debates, corpus,
-- events, egress blocks and PROPOSED agent versions. The director writes
-- decisions only through the key-gated definer functions in 100 (promote /
-- reject a version, decide a brief) and the evaluation set. No client role
-- has a write policy on any table here; SELECT requires the app key (or the
-- read-only key where it exists), like the run log.
--
-- BOUNDED LOOPS (B-5) are CHECK constraints, not conventions: peer review
-- rounds ≤ 2, reworks ≤ 2, returns ≤ 2, debate rounds ≤ 2. A row past the
-- bound cannot exist.
--
-- data_class propagates: every corpus record states its lane, and the guard
-- in 100 refuses a public record derived from any internal input, produced
-- by an internal agent, or belonging to an internal brief.

-- ---------------------------------------------------------------------------
-- agents: two new columns
-- ---------------------------------------------------------------------------
-- authored_by_agent_id: the lead or program office that authored this agent
-- (B-3). Null for director-created rows. The lane-at-birth guard (100)
-- refuses data_class='internal' whenever this is set, and whenever the
-- director credential is absent.
alter table public.os_lab_agents
  add column if not exists authored_by_agent_id uuid references public.os_lab_agents(id),
  add column if not exists authoring_purpose text not null default '';

-- ---------------------------------------------------------------------------
-- departments and seats
-- ---------------------------------------------------------------------------
-- `kind` puts the program office and the committee in the same table as the
-- eight departments so the floorplan, the roster and the routing all read
-- one list; pipeline_order 0 is the program office, 1..8 the departments in
-- default pipeline order, 9 the committee.
create table if not exists public.os_inst_departments (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  kind text not null check (kind in ('program_office', 'department', 'committee')),
  purpose text not null default '',
  accountable_for text not null default '',
  lead_agent_slug text not null,
  pipeline_order int not null unique check (pipeline_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Seats are BY SLUG, not by agent id: a seat may name an agent that does
-- not exist yet (a phantom dependency, or a lead the program office has not
-- authored). That is how an empty desk with a name plate is a row, not a
-- warning banner. One seat per agent across the whole institution.
create table if not exists public.os_inst_department_members (
  department_id uuid not null references public.os_inst_departments(id) on delete cascade,
  agent_slug text not null unique check (agent_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  role text not null check (role in ('lead', 'specialist')),
  seat_purpose text not null default '',
  position int not null default 0 check (position >= 0),
  primary key (department_id, agent_slug)
);

-- ---------------------------------------------------------------------------
-- agent versions (B-1, B-2)
-- ---------------------------------------------------------------------------
-- IMMUTABLE. A proposal is a row with status 'proposed' carrying the full
-- prompt it would install, the diff against the prompt that was live when it
-- was proposed, the rationale, and the review that triggered it. The guard
-- in 100 permits exactly three transitions — proposed→active (promotion,
-- director only), proposed→rejected (director only, reason required),
-- active→retired (by the promotion of a successor) — and refuses every other
-- UPDATE and every DELETE. No code path writes os_lab_agents.system_prompt
-- except the promotion function, and the prompt-lock trigger in 100 makes
-- that a property of the database, not a convention.
create table if not exists public.os_inst_agent_versions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.os_lab_agents(id) on delete cascade,
  -- Set at promotion to the agents.version the guard (74) bumps to; null
  -- while proposed. Active/retired rows are unique per (agent, version).
  version int check (version >= 1),
  system_prompt text not null,
  status text not null default 'proposed'
    check (status in ('proposed', 'active', 'retired', 'rejected')),
  -- 'director', 'system', or an agent slug (the lead / program office / committee).
  proposed_by text not null,
  proposed_by_agent_id uuid references public.os_lab_agents(id),
  rationale text not null,
  diff text not null,
  triggered_by_review_id uuid,
  eval_score_before numeric(6, 3) check (eval_score_before between 0 and 1),
  eval_score_after numeric(6, 3) check (eval_score_after between 0 and 1),
  approved_by text,
  approved_at timestamptz,
  rejected_reason text,
  created_at timestamptz not null default now()
);

create unique index if not exists os_inst_agent_versions_agent_version_idx
  on public.os_inst_agent_versions (agent_id, version) where version is not null;
create index if not exists os_inst_agent_versions_agent_status_idx
  on public.os_inst_agent_versions (agent_id, status);

-- ---------------------------------------------------------------------------
-- briefs
-- ---------------------------------------------------------------------------
create table if not exists public.os_inst_briefs (
  id uuid primary key default gen_random_uuid(),
  question text not null check (length(question) >= 8),
  -- The program office's restatement: { restated, answerWouldBe, outOfScope, assumptions[] }
  brief jsonb not null default '{}'::jsonb,
  weight_class text not null default 'standard'
    check (weight_class in ('brief', 'standard', 'full')),
  class_overridden_by_director boolean not null default false,
  data_class text not null default 'public' check (data_class in ('internal', 'public')),
  -- Department slugs in the order the brief will visit them.
  routing text[] not null default '{}',
  status text not null default 'intake'
    check (status in ('intake', 'running', 'committee', 'debate', 'director', 'approved', 'rejected', 'published', 'failed', 'paused')),
  current_department_slug text,
  cost_estimate_usd numeric(12, 6) check (cost_estimate_usd >= 0),
  tokens_estimate int check (tokens_estimate >= 0),
  cost_actual_usd numeric(12, 6) not null default 0 check (cost_actual_usd >= 0),
  tokens_actual int not null default 0 check (tokens_actual >= 0),
  -- Steps the stepper has taken; the hard budget is a config value the stepper reads.
  steps_taken int not null default 0 check (steps_taken >= 0),
  final_output_corpus_id uuid,
  director_decision text check (director_decision in ('approved', 'rejected', 'published')),
  director_reason text,
  decided_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists os_inst_briefs_status_idx on public.os_inst_briefs (status, created_at desc);

-- ---------------------------------------------------------------------------
-- corpus (B-6, B-7, B-8)
-- ---------------------------------------------------------------------------
-- Every retrieval, dataset, methodology note, execution result, stated
-- assumption and approved output. `content` is the text actually used and
-- `content_hash` its sha256; both are frozen after insert (guard in 100).
-- Citations point at rows here, never at a live URL.
create table if not exists public.os_inst_corpus (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('retrieval', 'dataset', 'methodology', 'execution', 'assumption', 'output', 'submission')),
  title text not null,
  data_class text not null check (data_class in ('internal', 'public')),
  content text not null default '',
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  -- Retrieval fields (B-6).
  url text,
  http_status int,
  fetched_at timestamptz,
  query text,
  -- Everything else that lets a record be re-derived: tool, script text,
  -- input hashes, library versions, runtime, seed. camelCase keys.
  provenance jsonb not null default '{}'::jsonb,
  derived_from uuid[] not null default '{}',
  brief_id uuid references public.os_inst_briefs(id),
  assignment_id uuid,
  created_by_agent_id uuid references public.os_lab_agents(id),
  created_by_run_id uuid references public.os_lab_runs(id),
  review_status text not null default 'unreviewed'
    check (review_status in ('unreviewed', 'peer_cleared', 'lead_cleared', 'committee_cleared', 'approved', 'rejected', 'superseded')),
  created_at timestamptz not null default now()
);

create index if not exists os_inst_corpus_brief_idx on public.os_inst_corpus (brief_id);
create index if not exists os_inst_corpus_kind_idx on public.os_inst_corpus (kind, created_at desc);
create index if not exists os_inst_corpus_hash_idx on public.os_inst_corpus (content_hash);

alter table public.os_inst_briefs
  drop constraint if exists os_inst_briefs_final_output_fk,
  add constraint os_inst_briefs_final_output_fk
    foreign key (final_output_corpus_id) references public.os_inst_corpus(id);

-- ---------------------------------------------------------------------------
-- assignments
-- ---------------------------------------------------------------------------
-- One row per unit of work the stepper hands an agent. `kind` says which
-- part of the department contract it is; `status` is the floor's authority
-- for what that agent is doing (assigned = walking to the desk, working =
-- a run is in flight, …). rework_count ≤ 2 is B-5.
create table if not exists public.os_inst_assignments (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references public.os_inst_briefs(id) on delete cascade,
  department_id uuid references public.os_inst_departments(id),
  agent_id uuid references public.os_lab_agents(id),
  agent_slug text not null,
  kind text not null check (kind in (
    'program_intake', 'lead_intake', 'specialist_work', 'peer_review', 'lead_review',
    'lead_submit', 'agent_authoring', 'committee_review', 'debate', 'arbitration', 'evaluation')),
  status text not null default 'assigned' check (status in (
    'assigned', 'working', 'peer_review', 'rework', 'accepted', 'returned', 'refused',
    'submitted', 'done', 'failed', 'escalated')),
  parent_assignment_id uuid references public.os_inst_assignments(id),
  input text not null default '',
  output text not null default '',
  output_corpus_id uuid references public.os_inst_corpus(id),
  run_id uuid references public.os_lab_runs(id),
  rework_count int not null default 0 check (rework_count between 0 and 2),
  round int not null default 1 check (round between 1 and 2),
  refusal_reason text,
  detail jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists os_inst_assignments_brief_idx on public.os_inst_assignments (brief_id, created_at);
create index if not exists os_inst_assignments_agent_idx on public.os_inst_assignments (agent_id, status);

alter table public.os_inst_corpus
  drop constraint if exists os_inst_corpus_assignment_fk,
  add constraint os_inst_corpus_assignment_fk
    foreign key (assignment_id) references public.os_inst_assignments(id);

-- ---------------------------------------------------------------------------
-- reviews
-- ---------------------------------------------------------------------------
-- kind peer | lead | committee. `findings` is per-claim: [{ claim, finding,
-- severity, traceable, corpusId }]. The guard in 100 refuses a reviewer who
-- authored the subject — the credential-absence principle (the actor who
-- proposes never verifies) applied between agents.
create table if not exists public.os_inst_reviews (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references public.os_inst_briefs(id) on delete cascade,
  kind text not null check (kind in ('peer', 'lead', 'committee')),
  reviewer_agent_id uuid not null references public.os_lab_agents(id),
  subject_assignment_id uuid references public.os_inst_assignments(id),
  subject_submission_id uuid,
  subject_agent_id uuid references public.os_lab_agents(id),
  findings jsonb not null default '[]'::jsonb,
  verdict text not null check (verdict in ('accept', 'rework', 'reject', 'escalate')),
  summary text not null default '',
  round int not null default 1 check (round between 1 and 2),
  run_id uuid references public.os_lab_runs(id),
  created_at timestamptz not null default now()
);

create index if not exists os_inst_reviews_brief_idx on public.os_inst_reviews (brief_id, created_at);

alter table public.os_inst_agent_versions
  drop constraint if exists os_inst_agent_versions_review_fk,
  add constraint os_inst_agent_versions_review_fk
    foreign key (triggered_by_review_id) references public.os_inst_reviews(id);

-- ---------------------------------------------------------------------------
-- submissions
-- ---------------------------------------------------------------------------
-- A record, not a message: what was produced, what it rests on, what the
-- lead is uncertain about, what it explicitly did not do. to_department_id
-- null with to_committee true is the last department handing over.
-- return_count ≤ 2 is B-5.
create table if not exists public.os_inst_submissions (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references public.os_inst_briefs(id) on delete cascade,
  from_department_id uuid not null references public.os_inst_departments(id),
  to_department_id uuid references public.os_inst_departments(id),
  to_committee boolean not null default false,
  produced text not null,
  rests_on uuid[] not null default '{}',
  uncertainties text not null default '',
  exclusions text not null default '',
  status text not null default 'in_transit'
    check (status in ('in_transit', 'accepted', 'returned', 'superseded')),
  return_count int not null default 0 check (return_count between 0 and 2),
  return_reason text,
  lead_assignment_id uuid references public.os_inst_assignments(id),
  corpus_id uuid references public.os_inst_corpus(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint os_inst_submissions_target check (to_committee or to_department_id is not null)
);

create index if not exists os_inst_submissions_brief_idx on public.os_inst_submissions (brief_id, created_at);

alter table public.os_inst_reviews
  drop constraint if exists os_inst_reviews_submission_fk,
  add constraint os_inst_reviews_submission_fk
    foreign key (subject_submission_id) references public.os_inst_submissions(id);

-- ---------------------------------------------------------------------------
-- debates
-- ---------------------------------------------------------------------------
create table if not exists public.os_inst_debates (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references public.os_inst_briefs(id) on delete cascade,
  review_id uuid not null references public.os_inst_reviews(id),
  rebutting_agent_id uuid not null references public.os_lab_agents(id),
  rebuttal text not null,
  -- The committee's weighing: [{ finding, decision: accepted|rejected|partially_accepted, reason }]
  weighing jsonb not null default '[]'::jsonb,
  outcome text check (outcome in ('accepted', 'rejected', 'partially_accepted', 'escalated')),
  round int not null default 1 check (round between 1 and 2),
  run_id uuid references public.os_lab_runs(id),
  created_at timestamptz not null default now(),
  weighed_at timestamptz
);

create index if not exists os_inst_debates_brief_idx on public.os_inst_debates (brief_id, created_at);

-- ---------------------------------------------------------------------------
-- evaluations (B-9)
-- ---------------------------------------------------------------------------
-- The task and its expected answer are visible to the director; the RUBRIC
-- lives in the private schema, which PostgREST does not expose, so no
-- client and no service-role call can read it: the only path is the
-- scoring function in 100, which returns a number. No agent writes here —
-- the owner guard in 100 requires the director credential for every write.
create table if not exists public.os_inst_evaluations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  department_slug text not null,
  task text not null,
  expected_answer text not null,
  weight numeric(6, 3) not null default 1 check (weight > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create schema if not exists private;

create table if not exists private.os_inst_evaluation_rubrics (
  evaluation_id uuid primary key references public.os_inst_evaluations(id) on delete cascade,
  -- { mustContain: [text], mustContainNumbers: [number], mustNotContain: [text],
  --   mustCite: boolean, weights: { contain, numbers, forbid, cite } }
  rubric jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.os_inst_evaluation_runs (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null references public.os_inst_evaluations(id),
  agent_id uuid not null references public.os_lab_agents(id),
  agent_version_id uuid references public.os_inst_agent_versions(id),
  phase text not null check (phase in ('before', 'after', 'baseline')),
  answer text not null default '',
  score numeric(6, 3) check (score between 0 and 1),
  run_id uuid references public.os_lab_runs(id),
  created_at timestamptz not null default now()
);

create index if not exists os_inst_evaluation_runs_version_idx on public.os_inst_evaluation_runs (agent_version_id);

-- ---------------------------------------------------------------------------
-- egress blocks (B-4) and the event log
-- ---------------------------------------------------------------------------
create table if not exists public.os_inst_egress_blocks (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid references public.os_inst_briefs(id) on delete cascade,
  assignment_id uuid references public.os_inst_assignments(id),
  agent_id uuid references public.os_lab_agents(id),
  run_id uuid references public.os_lab_runs(id),
  tool text not null,
  -- What matched, truncated and never the whole query: the log must not
  -- itself become the leak.
  matched_excerpt text not null default '',
  query_hash text not null,
  created_at timestamptz not null default now()
);

-- Append-only: what happened, in order, per brief. The floor and the
-- director's room read it; the guard in 100 refuses UPDATE and DELETE.
create table if not exists public.os_inst_events (
  id bigint generated always as identity primary key,
  brief_id uuid references public.os_inst_briefs(id) on delete cascade,
  kind text not null,
  agent_slug text,
  department_slug text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists os_inst_events_brief_idx on public.os_inst_events (brief_id, id);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
drop trigger if exists os_inst_departments_updated_at on public.os_inst_departments;
create trigger os_inst_departments_updated_at
  before update on public.os_inst_departments
  for each row execute function public.os_set_updated_at();
drop trigger if exists os_inst_briefs_updated_at on public.os_inst_briefs;
create trigger os_inst_briefs_updated_at
  before update on public.os_inst_briefs
  for each row execute function public.os_set_updated_at();
drop trigger if exists os_inst_assignments_updated_at on public.os_inst_assignments;
create trigger os_inst_assignments_updated_at
  before update on public.os_inst_assignments
  for each row execute function public.os_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: SELECT with the app key (or the read-only key), no client writes.
-- ---------------------------------------------------------------------------
do $$
declare
  tbl text;
  has_read_key boolean;
begin
  has_read_key := exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'os_read_key_valid');
  foreach tbl in array array[
    'os_inst_departments', 'os_inst_department_members', 'os_inst_agent_versions',
    'os_inst_briefs', 'os_inst_corpus', 'os_inst_assignments', 'os_inst_reviews',
    'os_inst_submissions', 'os_inst_debates', 'os_inst_evaluations',
    'os_inst_evaluation_runs', 'os_inst_egress_blocks', 'os_inst_events'
  ] loop
    execute format('alter table public.%I enable row level security', tbl);
    if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = tbl and policyname = 'require app key to select') then
      if has_read_key then
        execute format(
          'create policy "require app key to select" on public.%I
             for select using ((select public.os_key_valid()) or (select public.os_read_key_valid()))', tbl);
      else
        execute format(
          'create policy "require app key to select" on public.%I
             for select using ((select public.os_key_valid()))', tbl);
      end if;
    end if;
  end loop;
end
$$;

-- The rubric table is in `private`: no grants to any client role, and the
-- schema is not exposed by PostgREST. Only the definer scorer reads it.
alter table private.os_inst_evaluation_rubrics enable row level security;
revoke all on private.os_inst_evaluation_rubrics from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: the floor subscribes to these. Guarded because the local test
-- cluster has no supabase_realtime publication.
-- ---------------------------------------------------------------------------
do $$
declare
  tbl text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach tbl in array array[
      'os_lab_runs', 'os_inst_assignments', 'os_inst_reviews', 'os_inst_submissions',
      'os_inst_debates', 'os_inst_agent_versions', 'os_inst_egress_blocks', 'os_inst_events',
      'os_inst_briefs'
    ] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = tbl) then
        execute format('alter publication supabase_realtime add table public.%I', tbl);
      end if;
    end loop;
  else
    raise notice 'supabase_realtime publication absent (local replay) — realtime tables not added';
  end if;
end
$$;
