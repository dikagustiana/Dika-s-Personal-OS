-- =============================================================================
-- LAB EPISTEMIC LAYER: what stands behind a number.
-- =============================================================================
--
-- APPLIED 2026-08-17 via the Supabase apply_migration tool (ledger name
-- `lab_epistemic_schema`). Verified live after applying: 12 tables, 48
-- policies, keyless writes to projects/claims refused by the guards in 77.
-- Never `supabase db push` / `migration up` / `db reset` — see 20260817000073.
--
-- Down-migration: down/20260817000076_lab_epistemic_schema_down.sql.
--
-- The execution layer (73–75) records WHICH RUN produced WHICH OUTPUT. It
-- says nothing about which datapoint supports which claim, whether that
-- datapoint was verified against a primary source, or whether it has gone
-- stale. Different problems: one is execution audit, this is what makes
-- research output survive external scrutiny. Today the system can emit a
-- number into a draft with no record standing behind it; this layer exists
-- to make that structurally impossible. Nothing here names a subject area,
-- a document, or a funder — the schema is research-domain-agnostic.
--
-- SCOPING RULE, load-bearing: DATAPOINTS ARE SHARED ACROSS PROJECTS — a
-- national statistic is the same fact whichever paper cites it, and
-- re-extracting it per project multiplies both cost and error surface.
-- CLAIMS, OUTPUTS AND COMMITMENTS ARE PROJECT-SCOPED — the same datapoint
-- may support different, even opposing, claims in different projects.
--
-- The gates live in 20260817000077. This file is shape only, plus the
-- constraints a single row can carry (G-EXTRACT is mostly here: a datapoint
-- physically cannot exist without its source, locator and a real
-- definition_scope).

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
create table if not exists public.os_lab_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) > 0),
  research_question text not null default '',
  status text not null default 'active' check (status in ('active', 'dormant', 'closed')),
  -- WIP limiting across the portfolio; null = not slotted.
  wip_slot int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- source documents
-- ---------------------------------------------------------------------------
-- local_snapshot_path is MANDATORY, not nullable, on purpose: institutional
-- URLs move without redirects, and a citation that resolves only to a live
-- URL will break. The snapshot is the citable artifact; the URL is a
-- courtesy.
create table if not exists public.os_lab_source_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) > 0),
  publisher text not null default '',
  publication_date date,
  doc_type text not null check (doc_type in (
    'government_report', 'multilateral_report', 'journal_article',
    'statute', 'dataset', 'corporate_filing', 'news'
  )),
  url text not null default '',
  local_snapshot_path text not null check (char_length(local_snapshot_path) > 0),
  snapshot_hash text not null default '',
  retrieved_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- datapoints — NOT project-scoped. The atomic unit is the datapoint, not
-- the document: a single report yields many datapoints, each independently
-- verifiable.
-- ---------------------------------------------------------------------------
-- definition_scope prevents the most damaging error class: two sources
-- reporting the same nominal quantity while measuring different things —
-- different institutional basis, different coverage, different vintage.
-- Same name, different number, and the divergence surfaces only when
-- someone challenges the figure. The 20-character floor is G-EXTRACT's
-- refusal to accept a label where a definition is required.
create table if not exists public.os_lab_datapoints (
  id uuid primary key default gen_random_uuid(),
  value numeric not null,
  unit text not null default '',
  year int,
  geography text not null default '',
  definition_scope text not null check (char_length(definition_scope) >= 20),
  source_document_id uuid not null references public.os_lab_source_documents(id),
  -- Page, table number, or section identifier. A datapoint you cannot
  -- point to inside its document is a rumour with a bibliography.
  locator text not null check (char_length(locator) > 0),
  retrieved_at timestamptz not null default now(),
  -- IND = extracted, unverified. V = verified. NA = sought and not
  -- available (a real answer worth recording, never a blank).
  status text not null default 'IND' check (status in ('IND', 'V', 'NA')),
  verification_note text not null default '',
  -- When V was granted; guard-stamped, drives G-STALE. Null while not V.
  verified_at timestamptz,
  -- volatile: current institutional/regulatory/market/capacity state.
  -- static: historical outturns and published constants. NO DEFAULT —
  -- assigning it is part of ingestion, like data_class on agents.
  volatility_class text not null check (volatility_class in ('static', 'slow', 'volatile')),
  extraction_method text not null check (extraction_method in (
    'manual', 'agent_from_selected_text', 'agent_from_full_pdf'
  )),
  -- True when hierarchical totals in the source reconciled (Aggarwal-style
  -- internal cross-validation). Null where the document has no such
  -- structure — such datapoints need manual verification to reach V.
  internal_check_passed boolean,
  created_at timestamptz not null default now()
);

create index if not exists os_lab_datapoints_source_idx on public.os_lab_datapoints (source_document_id);
create index if not exists os_lab_datapoints_status_idx on public.os_lab_datapoints (status);

-- Conflicting datapoints are EXPECTED and both are retained. Never silently
-- reconcile, never deduplicate by overwriting: the resolution is a recorded
-- judgement, and G-CLAIM refuses approval over an unresolved one.
create table if not exists public.os_lab_datapoint_conflicts (
  id uuid primary key default gen_random_uuid(),
  datapoint_a_id uuid not null references public.os_lab_datapoints(id),
  datapoint_b_id uuid not null references public.os_lab_datapoints(id),
  conflict_type text not null check (conflict_type in (
    'value_mismatch', 'definition_mismatch', 'vintage_mismatch'
  )),
  resolution_status text not null default 'unresolved' check (resolution_status in (
    'unresolved', 'resolved_prefer_a', 'resolved_prefer_b', 'resolved_both_valid'
  )),
  resolution_note text not null default '',
  created_at timestamptz not null default now(),
  constraint os_lab_datapoint_conflicts_distinct_chk check (datapoint_a_id <> datapoint_b_id),
  constraint os_lab_datapoint_conflicts_pair_key unique (datapoint_a_id, datapoint_b_id)
);

create index if not exists os_lab_datapoint_conflicts_a_idx on public.os_lab_datapoint_conflicts (datapoint_a_id);
create index if not exists os_lab_datapoint_conflicts_b_idx on public.os_lab_datapoint_conflicts (datapoint_b_id);

-- ---------------------------------------------------------------------------
-- references (literature)
-- ---------------------------------------------------------------------------
-- Literature tools return abstracts. An abstract locates a paper; it never
-- suffices to cite a specific finding. verification_level is what G-CLAIM
-- checks; promotion to full_text_read requires the text on disk (gate in 77).
create table if not exists public.os_lab_references (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) > 0),
  authors text not null default '',
  container text not null default '',
  publication_year int,
  doi text not null default '',
  url text not null default '',
  verification_level text not null default 'abstract_only' check (verification_level in (
    'abstract_only', 'full_text_read'
  )),
  full_text_path text not null default '',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- commitment sources — project-scoped
-- ---------------------------------------------------------------------------
-- Any artifact where a claim has been publicly or formally asserted and can
-- no longer change silently without creating cross-document inconsistency.
-- A project may have zero, one, or many; nothing hardcodes one document.
create table if not exists public.os_lab_commitment_sources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.os_lab_projects(id),
  title text not null check (char_length(title) > 0),
  type text not null check (type in (
    'essay', 'published_paper', 'submitted_proposal', 'public_presentation', 'funder_document'
  )),
  committed_at date not null,
  document_path text not null check (char_length(document_path) > 0),
  created_at timestamptz not null default now()
);

create index if not exists os_lab_commitment_sources_project_idx
  on public.os_lab_commitment_sources (project_id);

-- ---------------------------------------------------------------------------
-- claims — project-scoped
-- ---------------------------------------------------------------------------
-- Layers, applied strictly:
--   A = committed in a commitment_source. Frozen until that commitment is
--       explicitly revised (which is a document act, not a database update).
--   B = verified finding produced in this research.
--   C = researcher hypothesis or inference — usually where the contribution
--       lives. Not a lesser category; the only rule is the three never
--       blend in an output.
-- created_by_run_id is the retrofit hook: it ties this layer into the
-- execution layer's lineage rather than sitting parallel to it.
create table if not exists public.os_lab_claims (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.os_lab_projects(id),
  statement text not null check (char_length(statement) > 0),
  layer text not null check (layer in ('A', 'B', 'C')),
  commitment_source_id uuid references public.os_lab_commitment_sources(id),
  evidence_direction text not null default 'untested' check (evidence_direction in (
    'supports', 'mixed', 'contradicts', 'untested'
  )),
  status text not null default 'draft' check (status in ('draft', 'reviewed', 'approved')),
  -- Writable by NO client and NO agent: the guard stamps it when, and only
  -- when, a human approval passes G-CLAIM. See 20260817000077.
  approved_by_human_at timestamptz,
  created_by_run_id uuid references public.os_lab_runs(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Half of G-CLAIM's layer-A rule is a plain row constraint.
  constraint os_lab_claims_layer_a_commitment_chk
    check (layer <> 'A' or commitment_source_id is not null)
);

create index if not exists os_lab_claims_project_idx on public.os_lab_claims (project_id);
create index if not exists os_lab_claims_status_idx on public.os_lab_claims (status);
create index if not exists os_lab_claims_run_idx on public.os_lab_claims (created_by_run_id);

create table if not exists public.os_lab_claim_datapoints (
  claim_id uuid not null references public.os_lab_claims(id) on delete cascade,
  datapoint_id uuid not null references public.os_lab_datapoints(id),
  primary key (claim_id, datapoint_id)
);

create index if not exists os_lab_claim_datapoints_datapoint_idx
  on public.os_lab_claim_datapoints (datapoint_id);

create table if not exists public.os_lab_claim_references (
  claim_id uuid not null references public.os_lab_claims(id) on delete cascade,
  reference_id uuid not null references public.os_lab_references(id),
  primary key (claim_id, reference_id)
);

create index if not exists os_lab_claim_references_reference_idx
  on public.os_lab_claim_references (reference_id);

-- Detection runs within a project AND across projects that share
-- datapoints — the cross-project case is the higher-value one: a new paper
-- contradicting something already committed elsewhere in the portfolio.
create table if not exists public.os_lab_claim_contradictions (
  id uuid primary key default gen_random_uuid(),
  claim_a_id uuid not null references public.os_lab_claims(id),
  claim_b_id uuid not null references public.os_lab_claims(id),
  severity text not null check (severity in ('direct', 'tension', 'scope_difference')),
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolution_note text not null default '',
  created_at timestamptz not null default now(),
  constraint os_lab_claim_contradictions_distinct_chk check (claim_a_id <> claim_b_id)
);

create index if not exists os_lab_claim_contradictions_a_idx on public.os_lab_claim_contradictions (claim_a_id);
create index if not exists os_lab_claim_contradictions_b_idx on public.os_lab_claim_contradictions (claim_b_id);

-- ---------------------------------------------------------------------------
-- outputs — project-scoped
-- ---------------------------------------------------------------------------
-- `stale` is cascade-set when a supporting datapoint loses V (G-STALE):
-- the output still reads, but it says so. Approval never cascades upward.
create table if not exists public.os_lab_outputs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.os_lab_projects(id),
  output_type text not null check (output_type in (
    'paper_section', 'essay_section', 'literature_note',
    'data_comparison', 'briefing', 'annotated_bibliography'
  )),
  content text not null default '',
  status text not null default 'draft' check (status in ('draft', 'final')),
  stale boolean not null default false,
  generated_by_run_id uuid references public.os_lab_runs(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists os_lab_outputs_project_idx on public.os_lab_outputs (project_id);

create table if not exists public.os_lab_output_claims (
  output_id uuid not null references public.os_lab_outputs(id) on delete cascade,
  claim_id uuid not null references public.os_lab_claims(id),
  primary key (output_id, claim_id)
);

create index if not exists os_lab_output_claims_claim_idx
  on public.os_lab_output_claims (claim_id);

-- ---------------------------------------------------------------------------
-- updated_at maintenance — shared trigger for the tables without a guard
-- that owns the clock (claims and outputs get guard-owned timestamps in 77).
-- ---------------------------------------------------------------------------
drop trigger if exists os_lab_projects_updated_at on public.os_lab_projects;
create trigger os_lab_projects_updated_at
  before update on public.os_lab_projects
  for each row execute function public.os_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — the uniform four owner policies on every table, read-key widening
-- on SELECT, no member policies (lab-wide rule: isolation by absence).
-- ---------------------------------------------------------------------------
alter table public.os_lab_projects             enable row level security;
alter table public.os_lab_source_documents     enable row level security;
alter table public.os_lab_datapoints           enable row level security;
alter table public.os_lab_datapoint_conflicts  enable row level security;
alter table public.os_lab_references           enable row level security;
alter table public.os_lab_commitment_sources   enable row level security;
alter table public.os_lab_claims               enable row level security;
alter table public.os_lab_claim_datapoints     enable row level security;
alter table public.os_lab_claim_references     enable row level security;
alter table public.os_lab_claim_contradictions enable row level security;
alter table public.os_lab_outputs              enable row level security;
alter table public.os_lab_output_claims        enable row level security;

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'os_lab_projects', 'os_lab_source_documents', 'os_lab_datapoints',
    'os_lab_datapoint_conflicts', 'os_lab_references', 'os_lab_commitment_sources',
    'os_lab_claims', 'os_lab_claim_datapoints', 'os_lab_claim_references',
    'os_lab_claim_contradictions', 'os_lab_outputs', 'os_lab_output_claims'
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
      'os_lab_projects', 'os_lab_source_documents', 'os_lab_datapoints',
      'os_lab_datapoint_conflicts', 'os_lab_references', 'os_lab_commitment_sources',
      'os_lab_claims', 'os_lab_claim_datapoints', 'os_lab_claim_references',
      'os_lab_claim_contradictions', 'os_lab_outputs', 'os_lab_output_claims'
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
