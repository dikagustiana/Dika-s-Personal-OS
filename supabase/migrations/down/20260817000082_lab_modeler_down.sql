-- Reverts 20260817000082_lab_modeler.sql: drops the model tables, restores
-- the 081-era requirements/outputs guards and coverage views (satisfaction =
-- datapoint or reference), restores the 077 cascade body, and retires the
-- modeler registry row.

-- requirements lose the model column and kind value first.
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

-- outputs guard back to the 080 body (predicate without model results).
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

-- cascade back to the 077 body (no model_results branch).
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
  end if;
  return null;
end;
$$;

-- coverage views back to the 080 predicate.
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

alter table public.os_lab_evidence_requirements
  drop constraint if exists os_lab_evidence_requirements_mr_kind_chk;
alter table public.os_lab_evidence_requirements
  drop column if exists satisfied_by_model_result_id;
alter table public.os_lab_evidence_requirements
  drop constraint if exists os_lab_evidence_requirements_kind_check;
alter table public.os_lab_evidence_requirements
  add constraint os_lab_evidence_requirements_kind_check
  check (kind in ('datapoint', 'reference'));

drop trigger if exists os_lab_model_results_gate_guard on public.os_lab_model_results;
drop function if exists public.os_lab_model_results_gate_guard();
drop table if exists public.os_lab_model_results;

drop trigger if exists os_lab_model_spec_params_gate_guard on public.os_lab_model_spec_params;
drop function if exists public.os_lab_model_spec_params_gate_guard();
drop table if exists public.os_lab_model_spec_params;

drop trigger if exists os_lab_model_specs_gate_guard on public.os_lab_model_specs;
drop function if exists public.os_lab_model_specs_gate_guard();
drop table if exists public.os_lab_model_specs;

delete from public.os_lab_agents where slug = 'evidence-modeler';
