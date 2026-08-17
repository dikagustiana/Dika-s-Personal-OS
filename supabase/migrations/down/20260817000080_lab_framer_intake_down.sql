-- Reverts 20260817000080_lab_framer_intake.sql: drops the question layer,
-- removes inference_step, restores the 079 claim/output guard bodies
-- verbatim, and retires the framer registry row.

-- views first (they read the tables)
drop view if exists public.os_lab_sub_question_coverage;
drop view if exists public.os_lab_question_coverage;

-- guards + tables, leaf-first
drop trigger if exists os_lab_output_sub_questions_gate_guard on public.os_lab_output_sub_questions;
drop function if exists public.os_lab_output_sub_questions_gate_guard();
drop table if exists public.os_lab_output_sub_questions;

drop trigger if exists os_lab_evidence_requirements_gate_guard on public.os_lab_evidence_requirements;
drop function if exists public.os_lab_evidence_requirements_gate_guard();
drop table if exists public.os_lab_evidence_requirements;

drop trigger if exists os_lab_sub_questions_gate_guard on public.os_lab_sub_questions;
drop function if exists public.os_lab_sub_questions_gate_guard();
drop table if exists public.os_lab_sub_questions;

drop trigger if exists os_lab_questions_gate_guard on public.os_lab_questions;
drop function if exists public.os_lab_questions_gate_guard();
drop table if exists public.os_lab_questions;

delete from public.os_lab_agents where slug = 'evidence-framer';

alter table public.os_lab_claims drop column if exists inference_step;

-- ---------------------------------------------------------------------------
-- claims guard: the 079 body, verbatim
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

    new.approved_by_human_at := now();
  elsif new.status <> 'approved' then
    new.approved_by_human_at := null;
  else
    new.approved_by_human_at := old.approved_by_human_at;
    if new.statement is distinct from old.statement
       or new.layer is distinct from old.layer
       or new.evidence_direction is distinct from old.evidence_direction
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
-- outputs guard: the 079 body, verbatim
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
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.os_lab_outputs_gate_guard() from public;
revoke all on function public.os_lab_outputs_gate_guard() from anon;
revoke all on function public.os_lab_outputs_gate_guard() from authenticated;
