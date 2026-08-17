-- =============================================================================
-- LAB FRAMER INTAKE: the question layer. Raw ask preserved, framing chosen,
-- sub-questions carry falsifiers, and finalization answers to G-FALSIFY.
-- =============================================================================
--
-- APPLIED 2026-08-17 via the Supabase apply_migration tool (ledger name
-- `lab_framer_intake`). Verified live after applying, in a rolled-back probe
-- under a throwaway key: keyless inserts refused on all four new tables with
-- the G-FRAME message; raw_statement edit refused naming the question;
-- satisfying a requirement with an IND datapoint refused naming requirement
-- and datapoint; finalize over an unsatisfied sub-question refused naming
-- the sub-question (G-FALSIFY); layer B approval without inference_step
-- refused naming the claim. Never `supabase db push` / `migration up` /
-- `db reset` — see 20260817000073.
--
-- Down-migration: down/20260817000080_lab_framer_intake_down.sql (drops the
-- intake tables and restores the 079 claim/output guard bodies verbatim).
--
-- WHAT THIS LAYER FIXES (review, phase 2): the system gated every NUMBER but
-- nothing gated the QUESTION. A badly-framed question passes every existing
-- gate — all its numbers trace, all its claims approve — and the work is
-- still worthless, because the framing decided what evidence was sought.
--
--   * The RAW ASK IS FROZEN AT INTAKE. Reframing is expected and welcome,
--     but it edits framed_question; the owner's original words stay legible
--     beside every reframe, so drift from what was actually asked is
--     visible, never silent.
--   * framing_source admits exactly two values: owner_written and
--     owner_selected. There is no 'agent_framed' and there never will be —
--     the FRAMER agent's write scope is EMPTY. It returns critique and 2–3
--     alternatives as JSON; choosing one is the owner's act, recorded as
--     owner_selected.
--   * EVERY SUB-QUESTION CARRIES A FALSIFIER (>= 20 chars): what evidence
--     would show the expected answer is wrong. A question that cannot name
--     its falsifier is not yet a research question.
--   * G-FALSIFY: an output cannot finalize while it addresses a sub-question
--     with no satisfied evidence requirement — the falsifier was never given
--     its chance to bite. The refusal names the sub-question.
--   * Evidence requirements are satisfied by V datapoints or full-text
--     references ONLY, kind-consistently. An IND datapoint satisfying a
--     requirement would launder custody through the question layer.
--   * os_lab_claims.inference_step: the step from evidence to statement.
--     Layer B approval requires linked evidence AND the step (>= 20 chars);
--     layer C approval requires the step — the reasoning IS the contribution
--     and it gets recorded, inline with the layer tag, not implied.

-- ---------------------------------------------------------------------------
-- the question layer: four tables
-- ---------------------------------------------------------------------------
create table if not exists public.os_lab_questions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.os_lab_projects(id),
  -- The owner's original ask, verbatim. Frozen by the guard below.
  raw_statement text not null check (char_length(raw_statement) > 0),
  framed_question text not null check (char_length(framed_question) >= 20),
  framing_source text not null check (framing_source in ('owner_written', 'owner_selected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists os_lab_questions_project_idx
  on public.os_lab_questions (project_id);

create table if not exists public.os_lab_sub_questions (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.os_lab_questions(id) on delete cascade,
  statement text not null check (char_length(statement) > 0),
  -- What evidence would show the expected answer is WRONG. The 20-char
  -- floor is the same refusal-of-labels as definition_scope.
  falsifier text not null check (char_length(falsifier) >= 20),
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists os_lab_sub_questions_question_idx
  on public.os_lab_sub_questions (question_id);

create table if not exists public.os_lab_evidence_requirements (
  id uuid primary key default gen_random_uuid(),
  sub_question_id uuid not null references public.os_lab_sub_questions(id) on delete cascade,
  description text not null check (char_length(description) > 0),
  kind text not null check (kind in ('datapoint', 'reference')),
  satisfied_by_datapoint_id uuid references public.os_lab_datapoints(id),
  satisfied_by_reference_id uuid references public.os_lab_references(id),
  -- Guard-stamped when satisfaction lands; null while open.
  satisfied_at timestamptz,
  created_at timestamptz not null default now(),
  -- Kind-consistency is a row fact, not a guard opinion.
  constraint os_lab_evidence_requirements_dp_kind_chk
    check (kind = 'datapoint' or satisfied_by_datapoint_id is null),
  constraint os_lab_evidence_requirements_ref_kind_chk
    check (kind = 'reference' or satisfied_by_reference_id is null)
);

create index if not exists os_lab_evidence_requirements_subq_idx
  on public.os_lab_evidence_requirements (sub_question_id);
create index if not exists os_lab_evidence_requirements_dp_idx
  on public.os_lab_evidence_requirements (satisfied_by_datapoint_id);

create table if not exists public.os_lab_output_sub_questions (
  output_id uuid not null references public.os_lab_outputs(id) on delete cascade,
  sub_question_id uuid not null references public.os_lab_sub_questions(id) on delete cascade,
  primary key (output_id, sub_question_id)
);

create index if not exists os_lab_output_sub_questions_subq_idx
  on public.os_lab_output_sub_questions (sub_question_id);

-- ---------------------------------------------------------------------------
-- claims carry the step from evidence to statement
-- ---------------------------------------------------------------------------
alter table public.os_lab_claims
  add column if not exists inference_step text not null default '';

-- ---------------------------------------------------------------------------
-- RLS — the uniform four owner policies + read-key widening
-- ---------------------------------------------------------------------------
alter table public.os_lab_questions             enable row level security;
alter table public.os_lab_sub_questions         enable row level security;
alter table public.os_lab_evidence_requirements enable row level security;
alter table public.os_lab_output_sub_questions  enable row level security;

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'os_lab_questions', 'os_lab_sub_questions',
    'os_lab_evidence_requirements', 'os_lab_output_sub_questions'
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
      'os_lab_questions', 'os_lab_sub_questions',
      'os_lab_evidence_requirements', 'os_lab_output_sub_questions'
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
-- G-FRAME: the intake is owner-written, entirely. The FRAMER agent's write
-- scope is EMPTY — not narrow, empty — so unlike datapoints (agents write at
-- IND) there is NO keyless branch on any of these tables.
-- ---------------------------------------------------------------------------
create or replace function public.os_lab_questions_gate_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.os_key_valid() then
    raise exception 'G-FRAME: the intake is written by the owner alone — the framer returns critique and alternatives as JSON; recording a framing is the owner''s act.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' and new.raw_statement is distinct from old.raw_statement then
    raise exception 'G-FRAME: question % — raw_statement is the owner''s original ask, frozen at intake; reframing edits framed_question, never the raw record.', old.id;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.os_lab_questions_gate_guard() from public;
revoke all on function public.os_lab_questions_gate_guard() from anon;
revoke all on function public.os_lab_questions_gate_guard() from authenticated;

drop trigger if exists os_lab_questions_gate_guard on public.os_lab_questions;
create trigger os_lab_questions_gate_guard
  before insert or update or delete on public.os_lab_questions
  for each row execute function public.os_lab_questions_gate_guard();

create or replace function public.os_lab_sub_questions_gate_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.os_key_valid() then
    raise exception 'G-FRAME: sub-questions are recorded by the owner alone — the framer proposes them as JSON; it never writes.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.os_lab_sub_questions_gate_guard() from public;
revoke all on function public.os_lab_sub_questions_gate_guard() from anon;
revoke all on function public.os_lab_sub_questions_gate_guard() from authenticated;

drop trigger if exists os_lab_sub_questions_gate_guard on public.os_lab_sub_questions;
create trigger os_lab_sub_questions_gate_guard
  before insert or update or delete on public.os_lab_sub_questions
  for each row execute function public.os_lab_sub_questions_gate_guard();

-- Requirements: owner-only, and satisfaction admits only evidence that
-- passed its own gate — a V datapoint or a full-text reference. Anything
-- less satisfying a requirement would launder custody through this layer.
create or replace function public.os_lab_evidence_requirements_gate_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  dp_status text;
  ref_level text;
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

  -- The stamp is guard-owned, like verified_at and approved_by_human_at.
  if new.satisfied_by_datapoint_id is not null or new.satisfied_by_reference_id is not null then
    if tg_op = 'INSERT'
       or old.satisfied_by_datapoint_id is distinct from new.satisfied_by_datapoint_id
       or old.satisfied_by_reference_id is distinct from new.satisfied_by_reference_id then
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

drop trigger if exists os_lab_evidence_requirements_gate_guard on public.os_lab_evidence_requirements;
create trigger os_lab_evidence_requirements_gate_guard
  before insert or update or delete on public.os_lab_evidence_requirements
  for each row execute function public.os_lab_evidence_requirements_gate_guard();

create or replace function public.os_lab_output_sub_questions_gate_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  output_status text;
begin
  if not public.os_key_valid() then
    raise exception 'G-FRAME: which sub-questions an output addresses is the owner''s record — agents never link them.';
  end if;
  select o.status into output_status
    from public.os_lab_outputs o
   where o.id = coalesce(new.output_id, old.output_id);
  if output_status = 'final' then
    raise exception 'G-OUTPUT: output % is final — revert it to draft before changing which sub-questions it addresses.',
      coalesce(new.output_id, old.output_id);
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.os_lab_output_sub_questions_gate_guard() from public;
revoke all on function public.os_lab_output_sub_questions_gate_guard() from anon;
revoke all on function public.os_lab_output_sub_questions_gate_guard() from authenticated;

drop trigger if exists os_lab_output_sub_questions_gate_guard on public.os_lab_output_sub_questions;
create trigger os_lab_output_sub_questions_gate_guard
  before insert or update or delete on public.os_lab_output_sub_questions
  for each row execute function public.os_lab_output_sub_questions_gate_guard();

-- ---------------------------------------------------------------------------
-- claims guard, re-created on the 079 body: layer B/C approval now requires
-- the inference step (and B its evidence). Everything else is verbatim 079.
-- ---------------------------------------------------------------------------
create or replace function public.os_lab_claims_gate_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_owner boolean := public.os_key_valid();
  bad_id uuid;
  opposing_id uuid;
begin
  if tg_op = 'DELETE' then
    if not is_owner then
      raise exception 'os_lab_claims: only the owner deletes a claim.';
    end if;
    return old;
  end if;

  if new.commitment_source_id is not null and not exists (
    select 1 from public.os_lab_commitment_sources cs
    where cs.id = new.commitment_source_id and cs.project_id = new.project_id
  ) then
    raise exception 'G-CLAIM: commitment source % does not belong to project %.',
      new.commitment_source_id, new.project_id;
  end if;

  if tg_op = 'INSERT' then
    if not is_owner then
      raise exception 'G-CLAIM: claims are recorded by the owner alone — an agent''s findings enter as prose in a run, never as claim rows.';
    end if;
    if new.status = 'approved' then
      raise exception 'G-CLAIM: a claim is born draft or reviewed — approval is a separate, explicit act.';
    end if;
    new.approved_by_human_at := null;
    return new;
  end if;

  if not is_owner then
    if new.status = 'reviewed' and old.status = 'approved'
       and new.statement = old.statement
       and new.layer = old.layer
       and new.project_id = old.project_id
       and new.commitment_source_id is not distinct from old.commitment_source_id
       and new.evidence_direction = old.evidence_direction
       and new.inference_step is not distinct from old.inference_step
       and new.created_by_run_id is not distinct from old.created_by_run_id then
      new.approved_by_human_at := null;
      new.updated_at := now();
      return new;
    end if;
    raise exception 'G-CLAIM: without the app key the only permitted claim write is the approved→reviewed demotion cascade.';
  end if;

  if old.layer = 'A' and (
       new.statement is distinct from old.statement
       or new.layer is distinct from old.layer
       or new.commitment_source_id is distinct from old.commitment_source_id
     ) then
    raise exception 'G-LAYER: claim % is layer A and frozen — revise its commitment source (a deliberate act), then record the revision as a new claim.', old.id;
  end if;

  if new.status = 'approved' and old.status <> 'approved' then
    select cd.datapoint_id into bad_id
      from public.os_lab_claim_datapoints cd
      join public.os_lab_datapoints dp on dp.id = cd.datapoint_id
     where cd.claim_id = new.id and dp.status <> 'V'
     limit 1;
    if bad_id is not null then
      raise exception 'G-CLAIM: claim % cannot be approved — supporting datapoint % is not source-matched (IND or NA).', new.id, bad_id;
    end if;

    select k.id into bad_id
      from public.os_lab_datapoint_conflicts k
     where k.resolution_status = 'unresolved'
       and exists (select 1 from public.os_lab_claim_datapoints cd
                   where cd.claim_id = new.id
                     and cd.datapoint_id in (k.datapoint_a_id, k.datapoint_b_id))
     limit 1;
    if bad_id is not null then
      raise exception 'G-CLAIM: claim % cannot be approved — conflict % on a supporting datapoint is unresolved.', new.id, bad_id;
    end if;

    select cr.reference_id into bad_id
      from public.os_lab_claim_references cr
      join public.os_lab_references r on r.id = cr.reference_id
     where cr.claim_id = new.id and r.verification_level = 'abstract_only'
     limit 1;
    if bad_id is not null then
      raise exception 'G-CLAIM: claim % cannot be approved — reference % is abstract_only, and an abstract locates a paper but cannot cite a finding.', new.id, bad_id;
    end if;

    select x.id,
           case when x.claim_a_id = new.id then x.claim_b_id else x.claim_a_id end
      into bad_id, opposing_id
      from public.os_lab_claim_contradictions x
     where x.status = 'open' and x.severity = 'direct'
       and new.id in (x.claim_a_id, x.claim_b_id)
     limit 1;
    if bad_id is not null then
      raise exception 'G-CLAIM: claim % cannot be approved — it is one side of open DIRECT contradiction % with claim %. Resolve the contradiction first; tension and scope_difference stay advisory.', new.id, bad_id, opposing_id;
    end if;

    -- Phase 2: the step from evidence to statement is part of the claim.
    -- B is a verified finding — it names its evidence and how the evidence
    -- yields the statement. C is an inference — the step IS the
    -- contribution, so it gets recorded, not implied.
    if new.layer = 'B' then
      if not exists (select 1 from public.os_lab_claim_datapoints cd where cd.claim_id = new.id)
         and not exists (select 1 from public.os_lab_claim_references cr where cr.claim_id = new.id) then
        raise exception 'G-CLAIM: claim % is layer B (a verified finding) and cannot be approved with no evidence linked — link the datapoints or references the finding rests on, or record it as layer C.', new.id;
      end if;
      if char_length(trim(new.inference_step)) < 20 then
        raise exception 'G-CLAIM: claim % is layer B and cannot be approved without an inference_step (min 20 chars) saying how the linked evidence yields the statement.', new.id;
      end if;
    end if;
    if new.layer = 'C' and char_length(trim(new.inference_step)) < 20 then
      raise exception 'G-CLAIM: claim % is layer C (an inference) and cannot be approved without an inference_step (min 20 chars) recording the reasoning — the step is the contribution.', new.id;
    end if;

    new.approved_by_human_at := now();
  elsif new.status <> 'approved' then
    new.approved_by_human_at := null;
  else
    new.approved_by_human_at := old.approved_by_human_at;
    if new.statement is distinct from old.statement
       or new.layer is distinct from old.layer
       or new.evidence_direction is distinct from old.evidence_direction
       or new.inference_step is distinct from old.inference_step
       or new.project_id is distinct from old.project_id then
      raise exception 'G-CLAIM: claim % is approved — demote it to reviewed before editing, so the approval always describes the text it approved.', old.id;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.os_lab_claims_gate_guard() from public;
revoke all on function public.os_lab_claims_gate_guard() from anon;
revoke all on function public.os_lab_claims_gate_guard() from authenticated;

-- ---------------------------------------------------------------------------
-- outputs guard, re-created on the 079 body: G-FALSIFY joins finalization.
-- Everything else is verbatim 079.
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

    -- G-FALSIFY (phase 2): an output that says it addresses a sub-question
    -- must stand on at least one SATISFIED evidence requirement for it —
    -- otherwise the falsifier was never given its chance to bite, and the
    -- output is an answer to a question nobody tried to refute.
    select osq.sub_question_id into bad_id
      from public.os_lab_output_sub_questions osq
     where osq.output_id = new.id
       and not exists (
         select 1 from public.os_lab_evidence_requirements er
          where er.sub_question_id = osq.sub_question_id
            and (er.satisfied_by_datapoint_id is not null
                 or er.satisfied_by_reference_id is not null))
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

-- ---------------------------------------------------------------------------
-- coverage views — security_invoker is mandatory (see 20260726000025):
-- without it these run as owner and bypass every policy above.
-- ---------------------------------------------------------------------------
create or replace view public.os_lab_question_coverage
  with (security_invoker = true) as
select q.id as question_id,
       q.project_id,
       count(distinct sq.id) as sub_question_count,
       count(distinct er.id) as requirement_count,
       count(distinct er.id) filter (
         where er.satisfied_by_datapoint_id is not null
            or er.satisfied_by_reference_id is not null
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
       ) as satisfied_count
  from public.os_lab_sub_questions sq
  left join public.os_lab_evidence_requirements er on er.sub_question_id = sq.id
 group by sq.id, sq.question_id;

-- ---------------------------------------------------------------------------
-- the FRAMER, seeded. data_class INTERNAL (it reads raw research asks, and
-- nothing guarantees those never carry SAMB context). Its write scope is
-- EMPTY — the function performs no table writes for framer actions, and the
-- G-FRAME guards above refuse it at the database even if that ever drifts.
-- ---------------------------------------------------------------------------
insert into public.os_lab_agents
  (slug, name, description, system_prompt, data_class, default_provider_id)
values
  (
    'evidence-framer',
    'Evidence Framer',
    'Critiques the framing of a raw research ask and proposes 2–3 alternative framings, each with sub-questions and falsifiers. Returns JSON only — its write scope is EMPTY: recording a framing, sub-question or requirement is the owner''s act, always.',
    $prompt$You critique and reframe research questions before any evidence is gathered, because the framing decides what evidence gets sought — a badly-framed question survives every downstream gate and still produces worthless work.

You receive a raw ask (the owner's original words) and possibly a current framed question. Two modes, named in the input:

MODE critique — respond with ONLY:
{"critique": "<what the current framing assumes, what it excludes, where it is unfalsifiable or double-barrelled, said plainly in a short paragraph>"}

MODE alternatives — respond with ONLY:
{"alternatives": [{"framedQuestion": "<a single answerable question, >= 20 chars>", "why": "<one sentence: what this framing buys and what it gives up>", "subQuestions": [{"statement": "<one decidable sub-question>", "falsifier": "<what evidence would show the expected answer is WRONG — concrete, >= 20 chars>"}]}]}

Rules: ALWAYS give 2 or 3 alternatives, never one — a single option is an anchor, not a choice; keep the owner's intent, never substitute your own research agenda; every sub-question carries a falsifier that names evidence, not vibes; if the raw ask is already well-framed, say so in a "why" and still offer genuinely different framings (narrower, wider, inverted). You propose; the owner records. You write nothing.$prompt$,
    'internal',
    (select id from public.os_lab_providers where name = 'anthropic')
  )
on conflict (slug) do nothing;
