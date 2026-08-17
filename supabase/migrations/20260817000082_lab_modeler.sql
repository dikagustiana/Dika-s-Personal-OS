-- =============================================================================
-- LAB MODELER: declarative model specs, a version-pinned first-party
-- evaluator, and results whose checks are rows — never absences.
-- =============================================================================
--
-- APPLIED 2026-08-17 via the Supabase apply_migration tool (ledger name
-- `lab_modeler`). Verified live after applying, in a rolled-back probe under
-- a throwaway key: keyless spec approval refused; approval without a
-- rationale refused naming the spec; a rationale byte-identical to the
-- generating run's output refused; an assumption parameter without its
-- full-text justification refused; a datapoint parameter binding an IND
-- datapoint refused naming both; a requirement satisfied by a failed-checks
-- result refused. Never `supabase db push` / `migration up` / `db reset` —
-- see 20260817000073.
--
-- Down-migration: down/20260817000082_lab_modeler_down.sql.
--
-- WHAT THIS LAYER FIXES (review, phase 4): quantitative claims either
-- entered as hand-tagged [sim] figures nothing could audit, or did not
-- enter at all. The design rules:
--
--   * A5, ABSOLUTE: no code execution. A model spec is DECLARATIVE JSON —
--     an arithmetic expression over named parameters plus distributions and
--     scenarios — interpreted ONLY by the hand-written, version-pinned
--     evaluator in supabase/functions/_shared/modelEval.ts. No eval, no new
--     Function, no dynamic import, no subprocess, no WASM, no remote
--     execution. The expression grammar cannot express a loop or a call.
--   * THE MODELER PROPOSES DRAFTS. Keyless writes create draft specs and
--     draft-time parameters, nothing else. Approval requires the OWNER'S
--     rationale (>= 20 chars) — and a rationale pasted byte-for-byte from
--     the generating run's output is refused: the reasoning must be the
--     owner's, not the model's echo.
--   * PARAMETERS ARE EVIDENCE OR JUSTIFIED ASSUMPTIONS, no third kind:
--     kind=datapoint binds a source-matched (V) datapoint; kind=assumption
--     carries a value AND a full-text-read reference justifying it.
--   * RESULTS ARE IMMUTABLE RECORDS. Checks (unit algebra, finiteness,
--     bounds, identities, seed convergence, the 1% perturbation smoke test)
--     are stored as rows in `checks`; a failed run is a recorded failure,
--     never an absent row. The only permitted update is the stale_input
--     cascade: when an input datapoint loses V, every result standing on it
--     is flagged — visibly, not deleted.
--   * [sim] GREW AN ID. A draft figure is exempt only as
--     [sim:<model_result_id>], and only when the named result exists,
--     passed its checks, passed sensitivity, has no stale inputs, and
--     matches the figure — five conditions, none of them the model's to
--     assert (see numberScan.ts / labNumbers.ts and the drift test).

-- ---------------------------------------------------------------------------
-- specs
-- ---------------------------------------------------------------------------
create table if not exists public.os_lab_model_specs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.os_lab_projects(id),
  name text not null check (char_length(name) > 0),
  kind text not null check (kind in ('expression', 'monte_carlo', 'scenario')),
  -- The declarative spec. JSON, never code — see the header.
  spec jsonb not null,
  -- Guard-computed on every write; a payload hash is overwritten silently.
  spec_hash text not null default '',
  -- The OWNER'S reasoning: why this structure answers the question. Never
  -- the model's; the approval gate compares against the run log.
  rationale text not null default '',
  status text not null default 'draft' check (status in ('draft', 'approved')),
  approved_by_human_at timestamptz,
  created_by_run_id uuid references public.os_lab_runs(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists os_lab_model_specs_project_idx
  on public.os_lab_model_specs (project_id);

-- ---------------------------------------------------------------------------
-- parameters
-- ---------------------------------------------------------------------------
create table if not exists public.os_lab_model_spec_params (
  id uuid primary key default gen_random_uuid(),
  spec_id uuid not null references public.os_lab_model_specs(id) on delete cascade,
  name text not null check (name ~ '^[a-z_][a-z0-9_]*$'),
  kind text not null check (kind in ('datapoint', 'assumption')),
  datapoint_id uuid references public.os_lab_datapoints(id),
  value numeric,
  unit text not null default '',
  justification_reference_id uuid references public.os_lab_references(id),
  distribution jsonb,
  created_at timestamptz not null default now(),
  unique (spec_id, name),
  constraint os_lab_model_spec_params_dp_chk
    check (kind <> 'datapoint' or datapoint_id is not null),
  constraint os_lab_model_spec_params_assumption_chk
    check (kind <> 'assumption' or (value is not null and justification_reference_id is not null))
);

create index if not exists os_lab_model_spec_params_spec_idx
  on public.os_lab_model_spec_params (spec_id);

-- ---------------------------------------------------------------------------
-- results
-- ---------------------------------------------------------------------------
create table if not exists public.os_lab_model_results (
  id uuid primary key default gen_random_uuid(),
  spec_id uuid not null references public.os_lab_model_specs(id),
  evaluator_version text not null check (char_length(evaluator_version) > 0),
  seed bigint,
  result_value numeric,
  result_unit text not null default '',
  result_summary jsonb not null default '{}'::jsonb,
  -- Every check as a row: {name, passed, detail}. Failures are records.
  checks jsonb not null default '[]'::jsonb,
  checks_passed boolean not null default false,
  sensitivity_passed boolean,
  input_datapoint_ids uuid[] not null default '{}',
  -- Cascade-set when an input datapoint loses V. Never cleared by machine.
  stale_input boolean not null default false,
  -- The manual registration path: a result computed OUTSIDE this system
  -- (a workbook, an external engine), registered by the owner with a note.
  external boolean not null default false,
  external_note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists os_lab_model_results_spec_idx
  on public.os_lab_model_results (spec_id);
create index if not exists os_lab_model_results_inputs_idx
  on public.os_lab_model_results using gin (input_datapoint_ids);

-- ---------------------------------------------------------------------------
-- evidence requirements learn about model results
-- ---------------------------------------------------------------------------
alter table public.os_lab_evidence_requirements
  add column if not exists satisfied_by_model_result_id uuid references public.os_lab_model_results(id);

do $$
begin
  -- Widen the kind enum to admit model_result requirements.
  alter table public.os_lab_evidence_requirements
    drop constraint if exists os_lab_evidence_requirements_kind_check;
  alter table public.os_lab_evidence_requirements
    add constraint os_lab_evidence_requirements_kind_check
    check (kind in ('datapoint', 'reference', 'model_result'));
exception when others then
  raise notice 'kind check rewrite skipped: %', sqlerrm;
end
$$;

alter table public.os_lab_evidence_requirements
  drop constraint if exists os_lab_evidence_requirements_mr_kind_chk;
alter table public.os_lab_evidence_requirements
  add constraint os_lab_evidence_requirements_mr_kind_chk
  check (kind = 'model_result' or satisfied_by_model_result_id is null);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.os_lab_model_specs       enable row level security;
alter table public.os_lab_model_spec_params enable row level security;
alter table public.os_lab_model_results     enable row level security;

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'os_lab_model_specs', 'os_lab_model_spec_params', 'os_lab_model_results'
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
      'os_lab_model_specs', 'os_lab_model_spec_params', 'os_lab_model_results'
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
-- G-MODEL: specs. The modeler proposes drafts; approval is the owner's,
-- with the owner's OWN rationale.
-- ---------------------------------------------------------------------------
create or replace function public.os_lab_model_specs_gate_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_owner boolean := public.os_key_valid();
  run_output text;
begin
  if tg_op = 'DELETE' then
    if not is_owner then
      raise exception 'os_lab_model_specs: only the owner deletes a spec.';
    end if;
    return old;
  end if;

  -- The hash is guard-computed on every write; a payload hash is a claim
  -- and claims are not columns.
  new.spec_hash := md5(new.spec::text);

  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'G-MODEL: a spec is born draft — approval is a separate, gated act.';
    end if;
    if not is_owner and char_length(new.rationale) > 0 then
      raise exception 'G-MODEL: the rationale is the owner''s reasoning about the model — an agent cannot supply it, empty or otherwise.';
    end if;
    new.approved_by_human_at := null;
    return new;
  end if;

  -- UPDATE ----------------------------------------------------------------
  if not is_owner then
    raise exception 'G-MODEL: without the app key model specs are read-only after insert — approval, rationale and revision are the owner''s.';
  end if;

  if new.status = 'approved' and old.status <> 'approved' then
    if char_length(trim(new.rationale)) < 20 then
      raise exception 'G-MODEL: spec % cannot be approved without a rationale (min 20 chars) — why this structure answers the question, in the owner''s words.', old.id;
    end if;
    if new.created_by_run_id is not null then
      select r.output into run_output
        from public.os_lab_runs r where r.id = new.created_by_run_id;
      if run_output is not null and position(trim(new.rationale) in run_output) > 0 then
        raise exception 'G-MODEL: spec % cannot be approved — the rationale appears byte-for-byte in the generating run''s output. The rationale is the owner''s reasoning about the model, not the model''s explanation of itself.', old.id;
      end if;
    end if;
    new.approved_by_human_at := now();
  elsif new.status <> 'approved' then
    new.approved_by_human_at := null;
  else
    new.approved_by_human_at := old.approved_by_human_at;
    if new.spec is distinct from old.spec
       or new.name is distinct from old.name
       or new.kind is distinct from old.kind
       or new.rationale is distinct from old.rationale then
      raise exception 'G-MODEL: spec % is approved — demote it to draft before editing, so the approval always describes the spec it approved.', old.id;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.os_lab_model_specs_gate_guard() from public;
revoke all on function public.os_lab_model_specs_gate_guard() from anon;
revoke all on function public.os_lab_model_specs_gate_guard() from authenticated;

drop trigger if exists os_lab_model_specs_gate_guard on public.os_lab_model_specs;
create trigger os_lab_model_specs_gate_guard
  before insert or update or delete on public.os_lab_model_specs
  for each row execute function public.os_lab_model_specs_gate_guard();

-- ---------------------------------------------------------------------------
-- G-MODEL: parameters. Evidence or justified assumption; frozen once the
-- spec is approved.
-- ---------------------------------------------------------------------------
create or replace function public.os_lab_model_spec_params_gate_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_owner boolean := public.os_key_valid();
  spec_status text;
  dp_status text;
  ref_level text;
begin
  select s.status into spec_status
    from public.os_lab_model_specs s
   where s.id = coalesce(new.spec_id, old.spec_id);

  if spec_status = 'approved' then
    raise exception 'G-MODEL: spec % is approved — its parameters are frozen; demote the spec before editing what it stands on.', coalesce(new.spec_id, old.spec_id);
  end if;

  if tg_op = 'DELETE' then
    if not is_owner then
      raise exception 'os_lab_model_spec_params: only the owner deletes a parameter.';
    end if;
    return old;
  end if;
  if not is_owner and tg_op = 'UPDATE' then
    raise exception 'G-MODEL: without the app key parameters are written once, at proposal — revision is the owner''s.';
  end if;

  if new.kind = 'datapoint' then
    select dp.status into dp_status
      from public.os_lab_datapoints dp where dp.id = new.datapoint_id;
    if dp_status is distinct from 'V' then
      raise exception 'G-MODEL: parameter % cannot bind datapoint % — it is not source-matched (status %). A model input is source-matched evidence or a justified assumption; there is no third kind.',
        new.name, new.datapoint_id, coalesce(dp_status, 'missing');
    end if;
  end if;
  if new.kind = 'assumption' then
    select r.verification_level into ref_level
      from public.os_lab_references r where r.id = new.justification_reference_id;
    if ref_level is distinct from 'full_text_read' then
      raise exception 'G-MODEL: assumption % requires a full-text justification — reference % is %; an abstract cannot justify a number you made up.',
        new.name, new.justification_reference_id, coalesce(ref_level, 'missing');
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.os_lab_model_spec_params_gate_guard() from public;
revoke all on function public.os_lab_model_spec_params_gate_guard() from anon;
revoke all on function public.os_lab_model_spec_params_gate_guard() from authenticated;

drop trigger if exists os_lab_model_spec_params_gate_guard on public.os_lab_model_spec_params;
create trigger os_lab_model_spec_params_gate_guard
  before insert or update or delete on public.os_lab_model_spec_params
  for each row execute function public.os_lab_model_spec_params_gate_guard();

-- ---------------------------------------------------------------------------
-- G-MODEL: results. Immutable records; the one update is the stale cascade.
-- ---------------------------------------------------------------------------
create or replace function public.os_lab_model_results_gate_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_owner boolean := public.os_key_valid();
begin
  if tg_op = 'DELETE' then
    if not is_owner then
      raise exception 'os_lab_model_results: only the owner deletes a result.';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.external then
      if not is_owner then
        raise exception 'G-MODEL: an external result is the owner''s registration — an agent cannot record one.';
      end if;
      if char_length(trim(new.external_note)) < 20 then
        raise exception 'G-MODEL: an external result needs a note (min 20 chars) saying where it was computed and how to reproduce it.';
      end if;
    end if;
    if new.stale_input then
      raise exception 'G-MODEL: a result is born with fresh inputs — stale_input is the cascade''s to set, later.';
    end if;
    return new;
  end if;

  -- UPDATE: exactly one shape — the stale_input cascade.
  if new.stale_input = true and old.stale_input = false
     and new.spec_id = old.spec_id
     and new.evaluator_version = old.evaluator_version
     and new.seed is not distinct from old.seed
     and new.result_value is not distinct from old.result_value
     and new.result_unit = old.result_unit
     and new.result_summary = old.result_summary
     and new.checks = old.checks
     and new.checks_passed = old.checks_passed
     and new.sensitivity_passed is not distinct from old.sensitivity_passed
     and new.input_datapoint_ids = old.input_datapoint_ids
     and new.external = old.external
     and new.external_note = old.external_note then
    return new;
  end if;
  raise exception 'G-MODEL: model results are immutable records — a wrong result is superseded by a new run, never edited. (Only the stale_input cascade may touch a row.)';
end;
$$;

revoke all on function public.os_lab_model_results_gate_guard() from public;
revoke all on function public.os_lab_model_results_gate_guard() from anon;
revoke all on function public.os_lab_model_results_gate_guard() from authenticated;

drop trigger if exists os_lab_model_results_gate_guard on public.os_lab_model_results;
create trigger os_lab_model_results_gate_guard
  before insert or update or delete on public.os_lab_model_results
  for each row execute function public.os_lab_model_results_gate_guard();

-- ---------------------------------------------------------------------------
-- the cascade grows a branch: a datapoint losing V flags every result
-- standing on it. Flags — never deletes, never edits values.
-- (077 body plus the model_results update; everything else verbatim.)
-- ---------------------------------------------------------------------------
create or replace function public.os_lab_datapoints_cascade_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'V' and new.status <> 'V' then
    with demoted as (
      update public.os_lab_claims c
         set status = 'reviewed'
       where c.status = 'approved'
         and exists (select 1 from public.os_lab_claim_datapoints cd
                     where cd.claim_id = c.id and cd.datapoint_id = new.id)
      returning c.id
    )
    update public.os_lab_outputs o
       set stale = true
     where o.stale = false
       and exists (select 1 from public.os_lab_output_claims oc
                   where oc.output_id = o.id
                     and oc.claim_id in (select id from demoted));

    -- Phase 4: results whose inputs moved are flagged where they stand.
    update public.os_lab_model_results r
       set stale_input = true
     where r.stale_input = false
       and new.id = any(r.input_datapoint_ids);
  end if;
  return null;
end;
$$;

revoke all on function public.os_lab_datapoints_cascade_guard() from public;
revoke all on function public.os_lab_datapoints_cascade_guard() from anon;
revoke all on function public.os_lab_datapoints_cascade_guard() from authenticated;

-- ---------------------------------------------------------------------------
-- requirements guard, re-created on the 080 body: model results satisfy a
-- requirement only when they EARNED it. Everything else verbatim.
-- ---------------------------------------------------------------------------
create or replace function public.os_lab_evidence_requirements_gate_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  dp_status text;
  ref_level text;
  mr record;
begin
  if not public.os_key_valid() then
    raise exception 'G-FRAME: evidence requirements are recorded by the owner alone — the framer proposes them as JSON; it never writes.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.satisfied_by_datapoint_id is not null then
    select dp.status into dp_status
      from public.os_lab_datapoints dp where dp.id = new.satisfied_by_datapoint_id;
    if dp_status is distinct from 'V' then
      raise exception 'G-FALSIFY: requirement % cannot be satisfied by datapoint % — it is not source-matched (status %). Only V evidence satisfies a requirement.',
        new.id, new.satisfied_by_datapoint_id, coalesce(dp_status, 'missing');
    end if;
  end if;
  if new.satisfied_by_reference_id is not null then
    select r.verification_level into ref_level
      from public.os_lab_references r where r.id = new.satisfied_by_reference_id;
    if ref_level is distinct from 'full_text_read' then
      raise exception 'G-FALSIFY: requirement % cannot be satisfied by reference % — it is %; an abstract locates a paper, it cannot satisfy an evidence requirement.',
        new.id, new.satisfied_by_reference_id, coalesce(ref_level, 'missing');
    end if;
  end if;
  if new.satisfied_by_model_result_id is not null then
    select checks_passed, sensitivity_passed, stale_input into mr
      from public.os_lab_model_results where id = new.satisfied_by_model_result_id;
    if not found then
      raise exception 'G-FALSIFY: requirement % names model result %, which does not exist.', new.id, new.satisfied_by_model_result_id;
    end if;
    if not mr.checks_passed then
      raise exception 'G-FALSIFY: requirement % cannot be satisfied by model result % — its checks did not pass, and a failed check is a recorded fact, not a formality.', new.id, new.satisfied_by_model_result_id;
    end if;
    if mr.sensitivity_passed is distinct from true then
      raise exception 'G-FALSIFY: requirement % cannot be satisfied by model result % — it failed (or never ran) the 1%% perturbation smoke test.', new.id, new.satisfied_by_model_result_id;
    end if;
    if mr.stale_input then
      raise exception 'G-FALSIFY: requirement % cannot be satisfied by model result % — its inputs went stale (a supporting datapoint lost V). Re-run the model on fresh evidence.', new.id, new.satisfied_by_model_result_id;
    end if;
  end if;

  if new.satisfied_by_datapoint_id is not null
     or new.satisfied_by_reference_id is not null
     or new.satisfied_by_model_result_id is not null then
    if tg_op = 'INSERT'
       or old.satisfied_by_datapoint_id is distinct from new.satisfied_by_datapoint_id
       or old.satisfied_by_reference_id is distinct from new.satisfied_by_reference_id
       or old.satisfied_by_model_result_id is distinct from new.satisfied_by_model_result_id then
      new.satisfied_at := now();
    else
      new.satisfied_at := old.satisfied_at;
    end if;
  else
    new.satisfied_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.os_lab_evidence_requirements_gate_guard() from public;
revoke all on function public.os_lab_evidence_requirements_gate_guard() from anon;
revoke all on function public.os_lab_evidence_requirements_gate_guard() from authenticated;

-- ---------------------------------------------------------------------------
-- outputs guard: only the G-FALSIFY satisfaction predicate widens to admit
-- model results. Everything else verbatim 080.
-- ---------------------------------------------------------------------------
create or replace function public.os_lab_outputs_gate_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_owner boolean := public.os_key_valid();
  bad_id uuid;
  last_sweep timestamptz;
begin
  if tg_op = 'DELETE' then
    if not is_owner then
      raise exception 'os_lab_outputs: only the owner deletes an output.';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'G-OUTPUT: an output is born draft — finalisation is a separate, gated act.';
    end if;
    new.stale := false;
    return new;
  end if;

  if not is_owner then
    if new.stale = true and old.stale = false
       and new.status = old.status
       and new.content = old.content
       and new.output_type = old.output_type
       and new.project_id = old.project_id then
      new.updated_at := now();
      return new;
    end if;
    raise exception 'G-OUTPUT: without the app key the only permitted output write is the stale-marking cascade.';
  end if;

  if old.status = 'final' and new.status = 'final'
     and (new.content is distinct from old.content
          or new.output_type is distinct from old.output_type) then
    raise exception 'G-OUTPUT: output % is final — revert it to draft before editing.', old.id;
  end if;

  if new.status = 'final' and old.status <> 'final' then
    select max(ran_at) into last_sweep from public.os_lab_sweep_log;
    if last_sweep is null then
      raise exception 'G-STALE: the staleness sweep has NEVER run — output % cannot finalize until it has. Run the sweep from the Evidence screen.', new.id;
    end if;
    if last_sweep < now() - interval '48 hours' then
      raise exception 'G-STALE: the staleness sweep itself is stale (last ran %) — output % cannot finalize until the sweep has run within 48 hours.', to_char(last_sweep, 'YYYY-MM-DD HH24:MI'), new.id;
    end if;

    if new.stale then
      raise exception 'G-OUTPUT: output % is stale — its supporting evidence moved; re-review the claims and clear the flag first.', old.id;
    end if;
    select oc.claim_id into bad_id
      from public.os_lab_output_claims oc
      join public.os_lab_claims c on c.id = oc.claim_id
     where oc.output_id = new.id and c.status <> 'approved'
     limit 1;
    if bad_id is not null then
      raise exception 'G-OUTPUT: output % cannot finalize — cited claim % is not approved.', new.id, bad_id;
    end if;
    select x.id into bad_id
      from public.os_lab_claim_contradictions x
     where x.status = 'open'
       and exists (select 1 from public.os_lab_output_claims a
                   where a.output_id = new.id and a.claim_id = x.claim_a_id)
       and exists (select 1 from public.os_lab_output_claims b
                   where b.output_id = new.id and b.claim_id = x.claim_b_id)
     limit 1;
    if bad_id is not null then
      raise exception 'G-LAYER: output % cites both sides of open contradiction % — resolve it first.', new.id, bad_id;
    end if;

    select osq.sub_question_id into bad_id
      from public.os_lab_output_sub_questions osq
     where osq.output_id = new.id
       and not exists (
         select 1 from public.os_lab_evidence_requirements er
          where er.sub_question_id = osq.sub_question_id
            and (er.satisfied_by_datapoint_id is not null
                 or er.satisfied_by_reference_id is not null
                 or er.satisfied_by_model_result_id is not null))
     limit 1;
    if bad_id is not null then
      raise exception 'G-FALSIFY: output % addresses sub-question % which has no satisfied evidence requirement — the falsifier was never given its chance to bite. Satisfy a requirement (a source-matched datapoint or a full-text reference) or unlink the sub-question.', new.id, bad_id;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.os_lab_outputs_gate_guard() from public;
revoke all on function public.os_lab_outputs_gate_guard() from anon;
revoke all on function public.os_lab_outputs_gate_guard() from authenticated;

-- Coverage views: the satisfaction predicate widens the same way.
create or replace view public.os_lab_question_coverage
  with (security_invoker = true) as
select q.id as question_id,
       q.project_id,
       count(distinct sq.id) as sub_question_count,
       count(distinct er.id) as requirement_count,
       count(distinct er.id) filter (
         where er.satisfied_by_datapoint_id is not null
            or er.satisfied_by_reference_id is not null
            or er.satisfied_by_model_result_id is not null
       ) as satisfied_count
  from public.os_lab_questions q
  left join public.os_lab_sub_questions sq on sq.question_id = q.id
  left join public.os_lab_evidence_requirements er on er.sub_question_id = sq.id
 group by q.id, q.project_id;

create or replace view public.os_lab_sub_question_coverage
  with (security_invoker = true) as
select sq.id as sub_question_id,
       sq.question_id,
       count(er.id) as requirement_count,
       count(er.id) filter (
         where er.satisfied_by_datapoint_id is not null
            or er.satisfied_by_reference_id is not null
            or er.satisfied_by_model_result_id is not null
       ) as satisfied_count
  from public.os_lab_sub_questions sq
  left join public.os_lab_evidence_requirements er on er.sub_question_id = sq.id
 group by sq.id, sq.question_id;

-- ---------------------------------------------------------------------------
-- the MODELER, seeded. INTERNAL (it reads the project's evidence base to
-- propose structures). Its writes: draft specs and their parameters, via the
-- keyless branches above — approval, rationale and every run are the owner's.
-- ---------------------------------------------------------------------------
insert into public.os_lab_agents
  (slug, name, description, system_prompt, data_class, default_provider_id)
values
  (
    'evidence-modeler',
    'Evidence Modeler',
    'Proposes DECLARATIVE model specs (arithmetic expression + distributions + scenarios as JSON — never code) over source-matched datapoints and justified assumptions. Drafts only: approval requires the owner''s own rationale, and every run goes through the version-pinned first-party evaluator.',
    $prompt$You propose quantitative model structures over an evidence base. A spec is DECLARATIVE: one arithmetic expression over named parameters (operators + - * / ^ and parentheses only — no functions, no loops, no code), optional distributions for Monte Carlo, optional named scenarios.

Respond with ONLY a JSON object:
{"name": "<short model name>", "kind": "expression|monte_carlo|scenario", "spec": {"expression": "<e.g. price * volume / 1000>", "outputUnit": "<unit algebra must derive this from the parameter units>", "bounds": {"min": <num or omit>, "max": <num or omit>}, "identities": [{"left": "<expr>", "right": "<expr>"}], "iterations": <int, monte_carlo only>, "scenarios": {"<name>": {"<param>": <override>}}}, "params": [{"name": "<snake_case>", "kind": "datapoint|assumption", "datapointId": "<existing V datapoint id, datapoint kind only>", "value": <num, assumption kind only>, "unit": "<the parameter's unit>", "justificationReferenceId": "<existing full-text reference id, assumption kind only>", "distribution": {"type": "normal|lognormal|uniform|triangular|pert", "...": 0}}]}

Rules: every parameter is a source-matched datapoint (reference its id) or an assumption justified by a full-text reference — nothing else exists; use ONLY ids you were given; keep units honest — the evaluator derives the output unit symbolically and a mismatch is a recorded failure; declare bounds and identities where the domain has them, because the checks that catch your own errors are the ones you declare. You propose a DRAFT: the rationale, the approval and every run are the owner's.$prompt$,
    'internal',
    (select id from public.os_lab_providers where name = 'anthropic')
  )
on conflict (slug) do nothing;
