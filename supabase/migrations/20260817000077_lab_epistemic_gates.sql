-- =============================================================================
-- LAB EPISTEMIC LAYER: the gates. Deterministic, in the database, blocking.
-- =============================================================================
--
-- APPLIED 2026-08-17 via the Supabase apply_migration tool (ledger name
-- `lab_epistemic_gates`). Verified live after applying: 14 epistemic
-- triggers in place, pg_cron job `lab-stale-sweep` scheduled daily at
-- 20:00 UTC, keyless claim/project inserts refused with the gate messages.
-- Never `supabase db push` / `migration up` / `db reset` — see 20260817000073.
--
-- Down-migration: down/20260817000077_lab_epistemic_gates_down.sql.
--
-- DESIGN RULES THESE TRIGGERS IMPLEMENT (each traces to a finding; none may
-- be relaxed for convenience):
--
--   * Deterministic gates, probabilistic work. Agents extract, draft,
--     summarize; they NEVER evaluate whether a gate passes. Every gate here
--     is code with a boolean outcome — a gate whose outcome depends on
--     model judgment eventually fails silently (Mandal et al. 2025:
--     "sleepwalking", prompt-format sensitivity).
--   * Provenance must BLOCK, not decorate. A warning label is not a
--     control; assume the owner will ignore his own warnings at 1am
--     (Martin-Boyle et al. 2026). Unverified evidence is structurally
--     unusable downstream, not flagged-but-usable.
--   * Human approval is the only path to publishable status. No agent may
--     write claim approval — enforced HERE, at the database layer, not in a
--     prompt.
--
-- HOW "HUMAN" IS ESTABLISHED, structurally: the owner's UI attaches the
-- passphrase header on every request and public.os_key_valid() confirms it.
-- Agents run through the executor under the SERVICE ROLE, which carries no
-- header — so os_key_valid() is false for every agent by construction, and
-- RLS-exemption does not help them: triggers bind the service role too.
-- An agent may PROPOSE a verification or an approval (in prose, in its
-- output); it cannot execute one. There is no flag that relaxes this.
--
-- EVERY REFUSAL NAMES ITS CAUSE AND THE OFFENDING RECORD. A gate that fails
-- without naming the cause will be worked around.

-- ---------------------------------------------------------------------------
-- Owner-only tables: projects, source documents, commitment sources.
-- Ingestion of a source (with its mandatory snapshot) and the framing of a
-- project or commitment are deliberate human acts in v1.
-- ---------------------------------------------------------------------------
create or replace function public.os_lab_owner_write_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.os_key_valid() then
    raise exception '%: only the owner writes this table — agents propose, they do not record.', tg_table_name;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.os_lab_owner_write_guard() from public;
revoke all on function public.os_lab_owner_write_guard() from anon;
revoke all on function public.os_lab_owner_write_guard() from authenticated;

drop trigger if exists os_lab_projects_owner_guard on public.os_lab_projects;
create trigger os_lab_projects_owner_guard
  before insert or update or delete on public.os_lab_projects
  for each row execute function public.os_lab_owner_write_guard();

drop trigger if exists os_lab_source_documents_owner_guard on public.os_lab_source_documents;
create trigger os_lab_source_documents_owner_guard
  before insert or update or delete on public.os_lab_source_documents
  for each row execute function public.os_lab_owner_write_guard();

drop trigger if exists os_lab_commitment_sources_owner_guard on public.os_lab_commitment_sources;
create trigger os_lab_commitment_sources_owner_guard
  before insert or update or delete on public.os_lab_commitment_sources
  for each row execute function public.os_lab_owner_write_guard();

-- ---------------------------------------------------------------------------
-- G-EXTRACT + G-VERIFY: datapoints.
-- G-EXTRACT is mostly column constraints (76): no source, no locator, no
-- real definition_scope — no row, no placeholder for later. This guard adds
-- what a single row cannot express.
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
    -- Verification is a second act, always: nothing is born verified, so
    -- there is exactly one path to V and it runs through G-VERIFY below.
    if new.status = 'V' then
      raise exception 'G-VERIFY: a datapoint is inserted at IND (or NA) and verified as a separate act — nothing is born verified.';
    end if;
    if not is_owner then
      -- The EXTRACTOR's write scope: datapoints at IND only, and it cannot
      -- claim a human did the extraction.
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
    -- Keyless (agent / scheduled) updates: exactly two shapes exist.
    -- 1. The stale sweep's demotion: V→IND, substance untouched, note may
    --    grow (it appends the expiry stamp).
    if old.status = 'V' and new.status = 'IND' and not substance_changed
       and new.internal_check_passed is not distinct from old.internal_check_passed then
      new.verified_at := null;
      return new;
    end if;
    -- 2. Stage-3 internal validation recording its reconciliation result
    --    on a still-unverified row.
    if old.status = 'IND' and new.status = 'IND' and not substance_changed
       and new.verification_note = old.verification_note then
      new.verified_at := null;
      return new;
    end if;
    raise exception 'G-VERIFY: without the app key a datapoint write may only be the stale demotion or an internal_check result — verification is a human act; an agent may propose it, never execute it.';
  end if;

  -- G-VERIFY: the one path to V.
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
    -- Staying V: the clock is guard-owned; editing substance voids the
    -- verification, because the note described a different row.
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

drop trigger if exists os_lab_datapoints_gate_guard on public.os_lab_datapoints;
create trigger os_lab_datapoints_gate_guard
  before insert or update or delete on public.os_lab_datapoints
  for each row execute function public.os_lab_datapoints_gate_guard();

-- G-STALE's downward cascade (and the same cascade for any loss of V):
-- claims depending on the datapoint drop approved→reviewed; outputs citing
-- THOSE claims are marked stale. NEVER upward: nothing here re-approves.
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

revoke all on function public.os_lab_datapoints_cascade_guard() from public;
revoke all on function public.os_lab_datapoints_cascade_guard() from anon;
revoke all on function public.os_lab_datapoints_cascade_guard() from authenticated;

drop trigger if exists os_lab_datapoints_cascade_guard on public.os_lab_datapoints;
create trigger os_lab_datapoints_cascade_guard
  after update on public.os_lab_datapoints
  for each row execute function public.os_lab_datapoints_cascade_guard();

-- ---------------------------------------------------------------------------
-- Conflicts: expected, retained, and resolved only by a human with a note.
-- ---------------------------------------------------------------------------
create or replace function public.os_lab_conflicts_gate_guard()
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
      raise exception 'os_lab_datapoint_conflicts: only the owner deletes a conflict record.';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    -- The REVIEWER's write scope: it records that a conflict exists; the
    -- judgement of which side stands is never its to make.
    if not is_owner and (new.resolution_status <> 'unresolved' or new.resolution_note <> '') then
      raise exception 'os_lab_datapoint_conflicts: an agent records conflicts as unresolved — resolution is the owner''s judgement.';
    end if;
    return new;
  end if;
  if not is_owner then
    raise exception 'os_lab_datapoint_conflicts: resolving conflict % requires the owner.', old.id;
  end if;
  if new.resolution_status <> 'unresolved' and char_length(trim(new.resolution_note)) = 0 then
    raise exception 'os_lab_datapoint_conflicts: conflict % cannot resolve without a note saying why — a resolution without a reason is a coin flip.', old.id;
  end if;
  return new;
end;
$$;

revoke all on function public.os_lab_conflicts_gate_guard() from public;
revoke all on function public.os_lab_conflicts_gate_guard() from anon;
revoke all on function public.os_lab_conflicts_gate_guard() from authenticated;

drop trigger if exists os_lab_conflicts_gate_guard on public.os_lab_datapoint_conflicts;
create trigger os_lab_conflicts_gate_guard
  before insert or update or delete on public.os_lab_datapoint_conflicts
  for each row execute function public.os_lab_conflicts_gate_guard();

-- ---------------------------------------------------------------------------
-- References: the LITERATURE agent writes abstract_only, full stop.
-- Promotion needs the text on disk AND the owner.
-- ---------------------------------------------------------------------------
create or replace function public.os_lab_references_gate_guard()
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
      raise exception 'os_lab_references: only the owner deletes a reference.';
    end if;
    return old;
  end if;
  if not is_owner then
    if tg_op = 'INSERT' and new.verification_level <> 'abstract_only' then
      raise exception 'os_lab_references: an agent writes references at abstract_only — full_text_read is a claim about reading, and the agent has not read.';
    end if;
    if tg_op = 'UPDATE' and new.verification_level is distinct from old.verification_level then
      raise exception 'os_lab_references: promotion of reference % is the owner''s act, with the full text at full_text_path.', old.id;
    end if;
  end if;
  if new.verification_level = 'full_text_read' and char_length(new.full_text_path) = 0 then
    raise exception 'os_lab_references: full_text_read without a full_text_path is an abstract wearing a costume — put the text on disk first.';
  end if;
  return new;
end;
$$;

revoke all on function public.os_lab_references_gate_guard() from public;
revoke all on function public.os_lab_references_gate_guard() from anon;
revoke all on function public.os_lab_references_gate_guard() from authenticated;

drop trigger if exists os_lab_references_gate_guard on public.os_lab_references;
create trigger os_lab_references_gate_guard
  before insert or update or delete on public.os_lab_references
  for each row execute function public.os_lab_references_gate_guard();

-- ---------------------------------------------------------------------------
-- G-CLAIM + G-LAYER: claims.
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
begin
  if tg_op = 'DELETE' then
    if not is_owner then
      raise exception 'os_lab_claims: only the owner deletes a claim.';
    end if;
    return old;
  end if;

  -- The commitment source must belong to the claim's own project — a claim
  -- cannot borrow another project's commitments.
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

  -- UPDATE ----------------------------------------------------------------
  if not is_owner then
    -- The one keyless write: the downward cascade demoting approved →
    -- reviewed when a supporting datapoint loses V. Nothing else moves.
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

  -- G-LAYER: layer A claims are frozen. Revising one means revising its
  -- commitment source — a document act — then recording a new claim; a
  -- database update that quietly rewrites a public commitment is exactly
  -- the inconsistency this table exists to prevent.
  if old.layer = 'A' and (
       new.statement is distinct from old.statement
       or new.layer is distinct from old.layer
       or new.commitment_source_id is distinct from old.commitment_source_id
     ) then
    raise exception 'G-LAYER: claim % is layer A and frozen — revise its commitment source (a deliberate act), then record the revision as a new claim.', old.id;
  end if;

  if new.status = 'approved' and old.status <> 'approved' then
    -- G-CLAIM, each condition named with its offending record.
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

    -- The layer-A commitment requirement is the row CHECK; reaching here
    -- means it holds. The stamp is guard-owned: no client writes it.
    new.approved_by_human_at := now();
  elsif new.status <> 'approved' then
    new.approved_by_human_at := null;
  else
    -- Staying approved: the stamp is untouchable and the substance is too —
    -- an approved claim that needs editing is demoted first, on purpose.
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

drop trigger if exists os_lab_claims_gate_guard on public.os_lab_claims;
create trigger os_lab_claims_gate_guard
  before insert or update or delete on public.os_lab_claims
  for each row execute function public.os_lab_claims_gate_guard();

-- Evidence links: drawn by the owner. A link added to an ALREADY-approved
-- claim must satisfy the same conditions approval did, or the approval
-- would quietly come to rest on evidence that never passed the gate.
-- Unlinking from an approved claim is refused for the mirror reason.
create or replace function public.os_lab_claim_links_gate_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_owner boolean := public.os_key_valid();
  claim_status text;
  bad_id uuid;
begin
  if not is_owner then
    raise exception '%: evidence links are drawn by the owner alone.', tg_table_name;
  end if;

  if tg_op = 'DELETE' then
    select c.status into claim_status from public.os_lab_claims c where c.id = old.claim_id;
    if claim_status = 'approved' then
      raise exception 'G-CLAIM: claim % is approved — demote it before removing the evidence its approval rests on.', old.claim_id;
    end if;
    return old;
  end if;

  select c.status into claim_status from public.os_lab_claims c where c.id = new.claim_id;
  if claim_status = 'approved' then
    if tg_table_name = 'os_lab_claim_datapoints' then
      if not exists (select 1 from public.os_lab_datapoints dp
                     where dp.id = new.datapoint_id and dp.status = 'V') then
        raise exception 'G-CLAIM: claim % is approved — datapoint % must be verified before it can join the claim''s evidence.', new.claim_id, new.datapoint_id;
      end if;
      select k.id into bad_id from public.os_lab_datapoint_conflicts k
       where k.resolution_status = 'unresolved'
         and new.datapoint_id in (k.datapoint_a_id, k.datapoint_b_id)
       limit 1;
      if bad_id is not null then
        raise exception 'G-CLAIM: claim % is approved — datapoint % carries unresolved conflict %.', new.claim_id, new.datapoint_id, bad_id;
      end if;
    else
      if not exists (select 1 from public.os_lab_references r
                     where r.id = new.reference_id and r.verification_level = 'full_text_read') then
        raise exception 'G-CLAIM: claim % is approved — reference % is abstract_only and cannot join its evidence.', new.claim_id, new.reference_id;
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.os_lab_claim_links_gate_guard() from public;
revoke all on function public.os_lab_claim_links_gate_guard() from anon;
revoke all on function public.os_lab_claim_links_gate_guard() from authenticated;

drop trigger if exists os_lab_claim_datapoints_gate_guard on public.os_lab_claim_datapoints;
create trigger os_lab_claim_datapoints_gate_guard
  before insert or delete on public.os_lab_claim_datapoints
  for each row execute function public.os_lab_claim_links_gate_guard();

drop trigger if exists os_lab_claim_references_gate_guard on public.os_lab_claim_references;
create trigger os_lab_claim_references_gate_guard
  before insert or delete on public.os_lab_claim_references
  for each row execute function public.os_lab_claim_links_gate_guard();

-- Contradictions: the REVIEWER records that one exists (open, no verdict);
-- resolution is the owner's, with a note. Never auto-resolved in favour of
-- the newer record — never auto-resolved at all.
create or replace function public.os_lab_contradictions_gate_guard()
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
      raise exception 'os_lab_claim_contradictions: only the owner deletes a contradiction record.';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if not is_owner and (new.status <> 'open' or new.resolution_note <> '') then
      raise exception 'os_lab_claim_contradictions: an agent records contradictions as open — resolution is the owner''s judgement.';
    end if;
    return new;
  end if;
  if not is_owner then
    raise exception 'os_lab_claim_contradictions: resolving contradiction % requires the owner.', old.id;
  end if;
  if new.status = 'resolved' and char_length(trim(new.resolution_note)) = 0 then
    raise exception 'os_lab_claim_contradictions: contradiction % cannot resolve without a note saying how.', old.id;
  end if;
  return new;
end;
$$;

revoke all on function public.os_lab_contradictions_gate_guard() from public;
revoke all on function public.os_lab_contradictions_gate_guard() from anon;
revoke all on function public.os_lab_contradictions_gate_guard() from authenticated;

drop trigger if exists os_lab_contradictions_gate_guard on public.os_lab_claim_contradictions;
create trigger os_lab_contradictions_gate_guard
  before insert or update or delete on public.os_lab_claim_contradictions
  for each row execute function public.os_lab_contradictions_gate_guard();

-- ---------------------------------------------------------------------------
-- G-OUTPUT: outputs and their claim links.
-- (G-NUMBER — the numeric-token scan — is a service-layer gate on the save
-- path, with its own tests: prose parsing does not belong in plpgsql. This
-- trigger holds the structural half: nothing final cites an unapproved
-- claim, a stale output cannot finalize, and no output cites both sides of
-- an open contradiction.)
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
begin
  if tg_op = 'DELETE' then
    if not is_owner then
      raise exception 'os_lab_outputs: only the owner deletes an output.';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    -- Everyone, DRAFTER included: outputs are born draft. Finalisation is
    -- the gated act below.
    if new.status <> 'draft' then
      raise exception 'G-OUTPUT: an output is born draft — finalisation is a separate, gated act.';
    end if;
    new.stale := false;
    return new;
  end if;

  if not is_owner then
    -- Keyless: the cascade marking an output stale, and nothing else.
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

drop trigger if exists os_lab_outputs_gate_guard on public.os_lab_outputs;
create trigger os_lab_outputs_gate_guard
  before insert or update or delete on public.os_lab_outputs
  for each row execute function public.os_lab_outputs_gate_guard();

create or replace function public.os_lab_output_claims_gate_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_owner boolean := public.os_key_valid();
  output_status text;
  claim_status text;
  bad_id uuid;
begin
  if tg_op = 'DELETE' then
    if not is_owner then
      raise exception 'os_lab_output_claims: only the owner unlinks a citation.';
    end if;
    return old;
  end if;

  select o.status into output_status from public.os_lab_outputs o where o.id = new.output_id;
  if output_status = 'final' then
    raise exception 'G-OUTPUT: output % is final — revert it to draft before changing what it cites.', new.output_id;
  end if;

  -- The DRAFTER generates from APPROVED claims only; a human working draft
  -- may cite anything (that is what a working draft is for — the layer tags
  -- render inline there, which is what keeps the layers from blending).
  if not is_owner then
    select c.status into claim_status from public.os_lab_claims c where c.id = new.claim_id;
    if claim_status is distinct from 'approved' then
      raise exception 'G-OUTPUT: the drafter cites approved claims only — claim % is %.', new.claim_id, coalesce(claim_status, 'missing');
    end if;
  end if;

  -- No output — draft included — cites both sides of an open contradiction.
  select x.id into bad_id
    from public.os_lab_claim_contradictions x
   where x.status = 'open'
     and ((x.claim_a_id = new.claim_id and exists (
             select 1 from public.os_lab_output_claims oc
             where oc.output_id = new.output_id and oc.claim_id = x.claim_b_id))
       or (x.claim_b_id = new.claim_id and exists (
             select 1 from public.os_lab_output_claims oc
             where oc.output_id = new.output_id and oc.claim_id = x.claim_a_id)))
   limit 1;
  if bad_id is not null then
    raise exception 'G-LAYER: linking claim % would make output % cite both sides of open contradiction % — resolve it first.', new.claim_id, new.output_id, bad_id;
  end if;

  return new;
end;
$$;

revoke all on function public.os_lab_output_claims_gate_guard() from public;
revoke all on function public.os_lab_output_claims_gate_guard() from anon;
revoke all on function public.os_lab_output_claims_gate_guard() from authenticated;

drop trigger if exists os_lab_output_claims_gate_guard on public.os_lab_output_claims;
create trigger os_lab_output_claims_gate_guard
  before insert or delete on public.os_lab_output_claims
  for each row execute function public.os_lab_output_claims_gate_guard();

-- ---------------------------------------------------------------------------
-- G-STALE: the sweep. volatile V expires after 180 days, slow after 365,
-- static never. The demotion itself triggers the downward cascade
-- (os_lab_datapoints_cascade_guard); approval never cascades upward.
-- ---------------------------------------------------------------------------
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

-- Callable by the UI's "run sweep" action (anon + app key) AND by pg_cron
-- (no headers). EXECUTE for anon is deliberate and safe: the function can
-- only apply the standing expiry policy — a fail-safe direction the daily
-- job takes anyway — and can neither verify, approve, nor read anything out.
revoke all on function public.os_lab_stale_sweep() from public;
grant execute on function public.os_lab_stale_sweep() to anon;
grant execute on function public.os_lab_stale_sweep() to authenticated;
grant execute on function public.os_lab_stale_sweep() to service_role;

-- Daily at 20:00 UTC (03:00 WIB), where pg_cron exists. On the local test
-- cluster it does not, and the notice says so; the sweep stays callable by
-- hand everywhere.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    begin
      perform cron.unschedule('lab-stale-sweep');
    exception when others then
      null; -- first schedule: nothing to unschedule
    end;
    perform cron.schedule('lab-stale-sweep', '0 20 * * *', 'select public.os_lab_stale_sweep()');
    raise notice 'lab-stale-sweep scheduled daily at 20:00 UTC';
  else
    raise notice 'pg_cron unavailable here — run os_lab_stale_sweep() from the Evidence screen or schedule externally';
  end if;
end
$$;
