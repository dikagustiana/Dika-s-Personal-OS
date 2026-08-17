-- Down-migration for 20260817000079_lab_hardening.
-- REMOVES THE HARDENING: extraction_method unfreezes, the sweep loses its
-- heartbeat (finalization stops checking that the sweep ever ran), direct
-- contradictions stop blocking approval, model strings unpin, and runs stop
-- recording what actually ran. The three guard bodies are restored to their
-- 20260817000077 definitions verbatim. Never run this to "unblock" a
-- refusal — the refusals are the findings, closed.

drop trigger if exists os_lab_providers_pin_guard on public.os_lab_providers;
drop function if exists public.os_lab_providers_pin_guard();

alter table public.os_lab_runs drop column if exists model;

-- Restore the 077 sweep (no heartbeat insert).
create or replace function public.os_lab_stale_sweep()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  reverted int;
begin
  update public.os_lab_datapoints
     set status = 'IND',
         verification_note = verification_note
           || ' [verification expired ' || to_char(now(), 'YYYY-MM-DD') || ']'
   where status = 'V'
     and ((volatility_class = 'volatile' and verified_at < now() - interval '180 days')
       or (volatility_class = 'slow'     and verified_at < now() - interval '365 days'));
  get diagnostics reverted = row_count;
  return reverted;
end;
$$;

drop policy if exists "require app key to select" on public.os_lab_sweep_log;
drop index if exists public.os_lab_sweep_log_ran_at_idx;
drop table if exists public.os_lab_sweep_log;

-- Restore the 077 datapoints guard (mutable extraction_method, keyless
-- internal_check branch present).
create or replace function public.os_lab_datapoints_gate_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_owner boolean := public.os_key_valid();
  substance_changed boolean;
begin
  if tg_op = 'DELETE' then
    if not is_owner then
      raise exception 'os_lab_datapoints: only the owner deletes evidence.';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'V' then
      raise exception 'G-VERIFY: a datapoint is inserted at IND (or NA) and verified as a separate act — nothing is born verified.';
    end if;
    if not is_owner then
      if new.status <> 'IND' then
        raise exception 'G-VERIFY: an agent writes datapoints at status IND only — % was refused.', new.status;
      end if;
      if new.extraction_method = 'manual' then
        raise exception 'G-EXTRACT: an agent cannot record extraction_method = manual.';
      end if;
    end if;
    new.verified_at := null;
    return new;
  end if;

  substance_changed :=
    new.value is distinct from old.value
    or new.unit is distinct from old.unit
    or new.year is distinct from old.year
    or new.geography is distinct from old.geography
    or new.definition_scope is distinct from old.definition_scope
    or new.source_document_id is distinct from old.source_document_id
    or new.locator is distinct from old.locator
    or new.extraction_method is distinct from old.extraction_method
    or new.volatility_class is distinct from old.volatility_class;

  if not is_owner then
    if old.status = 'V' and new.status = 'IND' and not substance_changed
       and new.internal_check_passed is not distinct from old.internal_check_passed then
      new.verified_at := null;
      return new;
    end if;
    if old.status = 'IND' and new.status = 'IND' and not substance_changed
       and new.verification_note = old.verification_note then
      new.verified_at := null;
      return new;
    end if;
    raise exception 'G-VERIFY: without the app key a datapoint write may only be the stale demotion or an internal_check result — verification is a human act; an agent may propose it, never execute it.';
  end if;

  if new.status = 'V' and old.status <> 'V' then
    if char_length(trim(new.verification_note)) = 0 then
      raise exception 'G-VERIFY: datapoint % cannot reach V without a verification_note saying what was checked against what.', old.id;
    end if;
    if not (new.extraction_method = 'manual' or new.internal_check_passed is true) then
      raise exception 'G-VERIFY: datapoint % was agent-extracted and its internal check has not passed — verify manually or reconcile the document structure first.', old.id;
    end if;
    new.verified_at := now();
  elsif new.status <> 'V' then
    new.verified_at := null;
  else
    new.verified_at := old.verified_at;
    if substance_changed then
      new.status := 'IND';
      new.verified_at := null;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.os_lab_datapoints_gate_guard() from public;
revoke all on function public.os_lab_datapoints_gate_guard() from anon;
revoke all on function public.os_lab_datapoints_gate_guard() from authenticated;

-- Restore the 077 claims guard (no direct-contradiction check).
create or replace function public.os_lab_claims_gate_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_owner boolean := public.os_key_valid();
  bad_id uuid;
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
      raise exception 'G-CLAIM: claim % cannot be approved — supporting datapoint % is not verified (IND or NA).', new.id, bad_id;
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

-- Restore the 077 outputs guard (no heartbeat check).
create or replace function public.os_lab_outputs_gate_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_owner boolean := public.os_key_valid();
  bad_id uuid;
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
