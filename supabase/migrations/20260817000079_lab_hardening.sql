-- =============================================================================
-- LAB HARDENING: findings from the external adversarial review, DB half.
-- =============================================================================
--
-- APPLIED 2026-08-17 via the Supabase apply_migration tool (ledger name
-- `lab_hardening`). Verified live after applying, in a rolled-back probe
-- under a throwaway key: extraction_method relabel refused naming the
-- datapoint; model "claude-latest" refused as an alias naming the provider
-- row; approval of one side of an open DIRECT contradiction refused naming
-- the contradiction and the opposing claim. os_lab_sweep_log and
-- os_lab_runs.model in place. Never `supabase db push` / `migration up` /
-- `db reset` — see 20260817000073.
--
-- Down-migration: down/20260817000079_lab_hardening_down.sql (restores the
-- 077 guard bodies verbatim).
--
-- Five findings closed here; the executor/client halves land with the same
-- build:
--
--  1.5  extraction_method is FROZEN after insert. It is provenance — a fact
--       about the past — and the V gate keys on it, so a mutable label let
--       an agent extraction be relabelled `manual` and skip the internal-
--       check precondition. Also REMOVED: the keyless UPDATE branch that
--       allowed internal_check_passed changes on IND rows. It was written
--       for a stage-3 action that never materialised (the extractor sets
--       the flag at INSERT); unused capability is capability to remove.
--
--  1.8  The sweep gets a heartbeat. os_lab_stale_sweep() returned a count
--       nothing recorded, so "no expiries today" and "the sweep never ran"
--       were indistinguishable and the staleness guarantee could stop
--       holding silently. Every run now logs to os_lab_sweep_log, and an
--       output cannot finalize while the newest heartbeat is older than 48
--       hours (or absent) — the refusal names the SWEEP's staleness, not
--       the data's.
--
--  1.13 A DIRECT open contradiction blocks approval of either side. Until
--       now two separate outputs could each finalize citing opposite sides,
--       and approval was never blocked at all — the REVIEWER's highest-
--       value output gated nothing. 'tension' and 'scope_difference' stay
--       advisory on purpose: blocking on them would train the owner to
--       resolve records just to clear a path.
--
--  1.14 Models are pinned. os_lab_providers.model was free text, so an
--       alias like `-latest` meant a provider-side update changed behaviour
--       silently. A model string may not say `latest` and must carry a
--       version or date marker (a digit). The check fires only when the
--       model CHANGES, so the pre-existing `deepseek-chat` row (DeepSeek's
--       public API exposes only alias names — a recorded limitation, not an
--       oversight) is grandfathered until someone edits it. And every
--       os_lab_runs row now records the RESOLVED model string at dispatch,
--       so provider drift is visible retrospectively in the run log.
--
--  1.10 Wording: guard messages describing the V state now say
--       "source-matched" where they said "verified" — the mechanism
--       delivers custody (value compared against the cited location by a
--       human), not correctness, and the words must not claim more than
--       the mechanism delivers. The enum value V is unchanged.

-- ---------------------------------------------------------------------------
-- 1.14a — runs record what actually ran
-- ---------------------------------------------------------------------------
alter table public.os_lab_runs
  add column if not exists model text not null default '';

-- ---------------------------------------------------------------------------
-- 1.8a — the sweep heartbeat table
-- ---------------------------------------------------------------------------
create table if not exists public.os_lab_sweep_log (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default now(),
  rows_demoted int not null
);

alter table public.os_lab_sweep_log enable row level security;

-- SELECT-only for clients: the sweep function (security definer) is the
-- only writer, and a heartbeat a client can forge is not a heartbeat.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_lab_sweep_log'
                 and policyname = 'require app key to select') then
    create policy "require app key to select" on public.os_lab_sweep_log
      for select using ((select public.os_key_valid()));
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
    where schemaname = 'public' and tablename = 'os_lab_sweep_log'
      and policyname = 'require app key to select'
      and qual not ilike '%os_read_key_valid%'
  ) then
    alter policy "require app key to select" on public.os_lab_sweep_log
      using ((select public.os_key_valid()) or (select public.os_read_key_valid()));
  end if;
end
$$;

create index if not exists os_lab_sweep_log_ran_at_idx
  on public.os_lab_sweep_log (ran_at desc);

-- 1.8b — the sweep logs every run, including the quiet ones.
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
  -- The heartbeat: a zero is information ("ran, nothing expired") and its
  -- absence is now a detectable condition rather than a silent one.
  insert into public.os_lab_sweep_log (rows_demoted) values (reverted);
  return reverted;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1.5 — datapoints guard: extraction_method frozen, dead branch removed
-- ---------------------------------------------------------------------------
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
      raise exception 'G-VERIFY: a datapoint is inserted at IND (or NA) and source-matched as a separate act — nothing is born matched.';
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

  -- UPDATE ----------------------------------------------------------------
  -- 1.5: provenance is a fact about the past; it does not get edited. The
  -- V gate keys on extraction_method, so a mutable label was a bypass.
  if new.extraction_method is distinct from old.extraction_method then
    raise exception 'G-VERIFY: datapoint % — extraction_method is provenance and is frozen after insert; relabelling an agent extraction as manual would skip the internal-check precondition for V.', old.id;
  end if;

  substance_changed :=
    new.value is distinct from old.value
    or new.unit is distinct from old.unit
    or new.year is distinct from old.year
    or new.geography is distinct from old.geography
    or new.definition_scope is distinct from old.definition_scope
    or new.source_document_id is distinct from old.source_document_id
    or new.locator is distinct from old.locator
    or new.volatility_class is distinct from old.volatility_class;

  if not is_owner then
    -- Keyless (the sweep) updates: exactly ONE shape exists now — the
    -- stale demotion, V→IND, substance untouched, note allowed to grow.
    -- The old second shape (internal_check on IND rows) served a stage-3
    -- action that never materialised and was removed with 1.5.
    if old.status = 'V' and new.status = 'IND' and not substance_changed
       and new.internal_check_passed is not distinct from old.internal_check_passed then
      new.verified_at := null;
      return new;
    end if;
    raise exception 'G-VERIFY: without the app key the only permitted datapoint write is the stale demotion — a source-match is a human act; an agent may propose it, never execute it.';
  end if;

  if new.status = 'V' and old.status <> 'V' then
    if char_length(trim(new.verification_note)) = 0 then
      raise exception 'G-VERIFY: datapoint % cannot reach V without a verification_note saying what was compared against what.', old.id;
    end if;
    if not (new.extraction_method = 'manual' or new.internal_check_passed is true) then
      raise exception 'G-VERIFY: datapoint % was agent-extracted and its internal check has not passed — source-match it manually or reconcile the document structure first.', old.id;
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

-- ---------------------------------------------------------------------------
-- 1.13 — claims guard: a direct open contradiction blocks approval
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

    -- 1.13: a DIRECT open contradiction blocks either side. Two outputs
    -- finalizing on opposite sides of the same open contradiction is the
    -- inconsistency this table exists to catch; approval is where it bites.
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
-- 1.8c — outputs guard: the sweep heartbeat gates finalization
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
    -- 1.8: the staleness guarantee is only as alive as its sweep. This
    -- refusal names the SWEEP's staleness, not the data's — "no flags
    -- today" and "the sweep did not run" must be distinguishable, and a
    -- finalization is the moment that distinction pays.
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

-- ---------------------------------------------------------------------------
-- 1.14b — models are pinned facts, not aliases
-- ---------------------------------------------------------------------------
create or replace function public.os_lab_providers_pin_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Fires only when the model string CHANGES: the pre-existing
  -- deepseek-chat row (an alias — DeepSeek's public API offers no pinned
  -- names; recorded limitation) is grandfathered until edited.
  if tg_op = 'INSERT' or new.model is distinct from old.model then
    if new.model ilike '%latest%' or new.model !~ '\d' then
      raise exception 'os_lab_providers: model "%" on provider % is an alias, not a pin — it may not say latest and must carry a version or date marker. A pinned string is a fact; an alias is a promise someone else can break.', new.model, new.id;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.os_lab_providers_pin_guard() from public;
revoke all on function public.os_lab_providers_pin_guard() from anon;
revoke all on function public.os_lab_providers_pin_guard() from authenticated;

drop trigger if exists os_lab_providers_pin_guard on public.os_lab_providers;
create trigger os_lab_providers_pin_guard
  before insert or update on public.os_lab_providers
  for each row execute function public.os_lab_providers_pin_guard();
