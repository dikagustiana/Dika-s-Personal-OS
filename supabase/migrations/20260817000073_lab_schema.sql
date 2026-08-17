-- =============================================================================
-- LAB: the third workspace. Schema for the agent harness.
-- =============================================================================
--
-- NOT APPLIED. Written on the lab branch; apply via the Supabase
-- apply_migration tool (ledger name `lab_schema`) and update this header.
-- NEVER apply with `supabase db push`, `migration up`, `db reset`, or
-- `db remote commit` — repo filenames and the live ledger use different
-- numbering, so any of those replays the entire history from
-- 0001_schema.sql against live production data.
--
-- Down-migration: down/20260817000073_lab_schema_down.sql.
--
-- Five tables. `os_lab_providers` is a registry of model endpoints and their
-- prices — PRICES LIVE HERE AND ONLY HERE; no price constant exists anywhere
-- in code, so a rate change is a row edit, not a deploy (the same reasoning
-- that put os_model_routing in a table). `os_lab_agents` is the registry of
-- portable prompt artifacts. `os_lab_chains` is an ordered list of steps in
-- jsonb — read with the row, never queried alone, like every other jsonb
-- blob in this schema. `os_lab_runs` is the observability layer: one row per
-- execution, written by the run-lab-agent Edge Function under the service
-- role. `os_lab_artifacts` records files saved off a run's output.
--
-- WHO MAY WRITE WHAT — a deliberate split, enforced by the policy sets below:
--
--   providers, agents, chains  — owner-editable (the four `require app key`
--                                policies, like every other table).
--   runs, artifacts            — SELECT-ONLY for every client role. There is
--                                no insert/update/delete policy at all, for
--                                anyone, the owner included: a run log a
--                                client can rewrite is not a log (the same
--                                reasoning as os_finish_line_cell_history and
--                                os_sign_in_log). The Edge Function writes
--                                them under the service role, which RLS does
--                                not bind — but the DATA-BOUNDARY TRIGGER in
--                                20260817000074 binds even the service role,
--                                so "the executor writes it" never means "the
--                                executor may write anything".
--
-- data_class is NOT NULL with NO DEFAULT, on purpose: creating an agent must
-- state, explicitly, whether it may see internal SAMB figures. A default
-- would let that decision be made by omission, and the entire boundary
-- (20260817000074) hangs off this column.
--
-- Collaborators: no member policies on any lab table. Isolation is the
-- absence of a policy, not a predicate that could be misconfigured
-- (20260804000040). Lab is the owner's instrument panel.

-- ---------------------------------------------------------------------------
-- providers
-- ---------------------------------------------------------------------------
-- Two adapters exist and only two: `anthropic` speaks /v1/messages,
-- `openai` speaks /chat/completions. DeepSeek and Kimi are both the second
-- kind — same adapter code, different base_url and model. A third adapter
-- value is refused here so nobody writes one by accident.
--
-- `name` is constrained to the three known providers because the boundary
-- trigger keys on name = 'anthropic': an open vocabulary would let a fourth
-- row impersonate nothing, but a constrained one makes the trigger's
-- comparison a comparison against a closed set. API KEYS ARE NOT HERE and
-- must never be: keys are Edge Function secrets (LAB_ANTHROPIC_API_KEY,
-- LAB_DEEPSEEK_API_KEY, LAB_KIMI_API_KEY), set out-of-band like
-- RESEARCH_MODEL_API_KEY before them.
create table if not exists public.os_lab_providers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (name in ('anthropic', 'deepseek', 'kimi')),
  adapter text not null check (adapter in ('anthropic', 'openai')),
  base_url text not null,
  model text not null,
  -- USD per million tokens, in and out. numeric, never float: money.
  cost_in_per_mtok numeric(12, 4) not null check (cost_in_per_mtok >= 0),
  cost_out_per_mtok numeric(12, 4) not null check (cost_out_per_mtok >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- agents
-- ---------------------------------------------------------------------------
-- `description` holds the trigger description — the text that says when the
-- agent should fire. The dependency checker parses it (and system_prompt)
-- for references to sibling agent slugs, so the slug grammar is enforced
-- here: lowercase kebab-case, the shape a SKILL.md name already has.
--
-- `version` starts at 1 and is bumped BY THE GUARD TRIGGER (74) whenever
-- system_prompt changes — the client cannot forget to increment it and
-- cannot backdate it. No version history table: that is the prompt-diff
-- viewer by the back door, and Part G rules it out (see TODO.md).
create table if not exists public.os_lab_agents (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  description text not null default '',
  system_prompt text not null,
  -- NOT NULL, NO DEFAULT. See the header.
  data_class text not null check (data_class in ('internal', 'public')),
  default_provider_id uuid references public.os_lab_providers(id),
  version int not null default 1 check (version >= 1),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- chains
-- ---------------------------------------------------------------------------
-- `steps` is an ordered jsonb array of { agentSlug, inputTemplate } where
-- inputTemplate may interpolate {{previous_output}} and {{initial_input}}.
-- camelCase keys, like every jsonb blob here — the array round-trips into
-- the TS type directly. Steps reference agents BY SLUG, not by id, so a
-- chain can be authored before its agents exist; the dependency checker is
-- what surfaces the gap, exactly as it does for prompt references.
-- Created before runs because runs carry a chain_id FK.
create table if not exists public.os_lab_chains (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  steps jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- runs
-- ---------------------------------------------------------------------------
-- `provider_id` is the provider ACTUALLY USED, resolved at dispatch — never
-- inferred later from the agent's default, which may have changed since.
-- `parent_run_id` is load-bearing: it is what makes a chain inspectable
-- after the fact, so it is indexed below. No updated_at: a run row's
-- lifecycle (running → ok/error) is carried by status, and the terminal
-- write stamps duration_ms; log tables here do not carry client-editable
-- timestamps.
create table if not exists public.os_lab_runs (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.os_lab_agents(id),
  provider_id uuid not null references public.os_lab_providers(id),
  parent_run_id uuid references public.os_lab_runs(id),
  chain_id uuid references public.os_lab_chains(id),
  step_index int check (step_index >= 0),
  input text not null,
  output text not null default '',
  status text not null check (status in ('queued', 'running', 'ok', 'error')),
  error text,
  tokens_in int check (tokens_in >= 0),
  tokens_out int check (tokens_out >= 0),
  -- Computed AT RUN TIME from the provider row's rate columns. numeric(12,6):
  -- a single cheap run costs fractions of a cent and must not round to zero.
  cost_usd numeric(12, 6) check (cost_usd >= 0),
  duration_ms int check (duration_ms >= 0),
  created_at timestamptz not null default now()
);

create index if not exists os_lab_runs_agent_id_idx on public.os_lab_runs (agent_id);
create index if not exists os_lab_runs_parent_run_id_idx on public.os_lab_runs (parent_run_id);
create index if not exists os_lab_runs_chain_id_idx on public.os_lab_runs (chain_id);
create index if not exists os_lab_runs_created_at_idx on public.os_lab_runs (created_at desc);

-- ---------------------------------------------------------------------------
-- artifacts
-- ---------------------------------------------------------------------------
-- storage_path points into the private `lab-artifacts` Storage bucket.
-- Uploads and signed download URLs go through the Edge Function (service
-- role); no client role has any Storage policy, because the owner's
-- x-app-key credential is a PostgREST concept the Storage API cannot check.
create table if not exists public.os_lab_artifacts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.os_lab_runs(id),
  filename text not null,
  mime text not null,
  storage_path text not null,
  size_bytes int not null check (size_bytes >= 0),
  created_at timestamptz not null default now()
);

create index if not exists os_lab_artifacts_run_id_idx on public.os_lab_artifacts (run_id);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
-- providers and chains use the shared trigger, like every unguarded table.
-- agents deliberately DO NOT: their guard trigger (74) owns updated_at,
-- following the cell guard's precedent — a timestamp the client can
-- backdate is not a timestamp, and agents carry version semantics that
-- must move in lockstep with it. runs and artifacts have no updated_at.
drop trigger if exists os_lab_providers_updated_at on public.os_lab_providers;
create trigger os_lab_providers_updated_at
  before update on public.os_lab_providers
  for each row execute function public.os_set_updated_at();

drop trigger if exists os_lab_chains_updated_at on public.os_lab_chains;
create trigger os_lab_chains_updated_at
  before update on public.os_lab_chains
  for each row execute function public.os_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.os_lab_providers enable row level security;
alter table public.os_lab_agents    enable row level security;
alter table public.os_lab_chains    enable row level security;
alter table public.os_lab_runs      enable row level security;
alter table public.os_lab_artifacts enable row level security;

-- The three owner-editable tables get the uniform four policies. Predicates
-- are subquery-wrapped so the bcrypt compare is an InitPlan, once per
-- statement — see 20260728000030 for the 3.1s incident that made this rule.
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'os_lab_providers', 'os_lab_agents', 'os_lab_chains'
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

-- runs and artifacts: SELECT only. The absent write policies are the point —
-- see the header. The Edge Function writes under the service role.
do $$
declare
  tbl text;
begin
  foreach tbl in array array['os_lab_runs', 'os_lab_artifacts'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = tbl
                   and policyname = 'require app key to select') then
      execute format(
        'create policy "require app key to select" on public.%I
           for select using ((select public.os_key_valid()))', tbl);
    end if;
  end loop;
end
$$;

-- The read-only credential accepts SELECT on every other table; widen the
-- five SELECT policies to it, conditionally, exactly as 20260730000035 did
-- for os_model_routing. On a fresh replay before os_read_key_valid exists,
-- this is a no-op and the owner-only policy stands.
do $$
declare
  tbl text;
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'os_read_key_valid'
  ) then
    foreach tbl in array array[
      'os_lab_providers', 'os_lab_agents', 'os_lab_chains',
      'os_lab_runs', 'os_lab_artifacts'
    ] loop
      if exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = tbl
          and policyname = 'require app key to select'
          and qual not ilike '%os_read_key_valid%'
      ) then
        execute format(
          'alter policy "require app key to select" on public.%I
             using ((select public.os_key_valid()) or (select public.os_read_key_valid()))',
          tbl);
      end if;
    end loop;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Storage bucket for artifacts
-- ---------------------------------------------------------------------------
-- Private bucket, no client policies: every upload and every signed URL is
-- minted by the Edge Function under the service role. Guarded because the
-- local test cluster (scripts/lib/pg-cluster.sh) has no storage schema —
-- there, the bucket simply does not exist and nothing lab-schema-shaped
-- depends on it.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'buckets'
  ) then
    insert into storage.buckets (id, name, public)
    values ('lab-artifacts', 'lab-artifacts', false)
    on conflict (id) do nothing;
  else
    raise notice 'storage schema absent (local replay) — create the lab-artifacts bucket live';
  end if;
end
$$;
