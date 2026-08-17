-- ===========================================================================
-- THE EPISTEMIC GATES, PROVEN AT THE DATABASE LAYER ALONE.
-- ===========================================================================
--
-- Runs as postgres inside one transaction that ends in ROLLBACK — safe
-- against live. Same contract as every suite here: ZERO ROWS when healthy;
-- any returned row names what broke.
--
-- Two identities, both superuser, distinguished ONLY by the header the
-- guards read:
--   OWNER — a transaction-local throwaway app key is swapped into
--           private.os_app_secret and presented via request.headers, the
--           exact shape of the production UI. The real passphrase never
--           appears here.
--   AGENT — request.headers = '{}': what the executor's service role looks
--           like to os_key_valid(). Superuser-with-no-key is the strongest
--           possible stand-in for "automation with the application layer
--           bypassed": if the gates hold against it, no agent weakens them.
--
-- Run:  psql "$DATABASE_URL" -f supabase/tests/lab_epistemic_gates.sql
-- or:   scripts/lab-epistemic-tests.sh   (throwaway cluster, full replay,
--                                         negative control included)

begin;

create temp table gate_findings (finding text);

do $$
declare
  old_hash text;
  v_project uuid;
  v_source uuid;
  v_commit uuid;
  v_dp_manual uuid;      -- manual extraction, verified along the way
  v_dp_agent uuid;       -- agent_from_full_pdf, internal check initially null
  v_dp_conflict_a uuid;
  v_dp_conflict_b uuid;
  v_dp_volatile uuid;    -- for the stale sweep
  v_conflict uuid;
  v_ref uuid;
  v_claim uuid;          -- the workhorse claim
  v_claim_a uuid;        -- layer A
  v_claim_x uuid;        -- contradiction pair
  v_claim_y uuid;
  v_claim_vol uuid;      -- approved on the volatile datapoint
  v_output uuid;
  v_output_vol uuid;
  v_ref_agent uuid;
  v_question uuid;       -- FRAMER (080)
  v_subq_met uuid;       -- sub-question whose requirement gets satisfied
  v_subq_open uuid;      -- sub-question left unsatisfied (G-FALSIFY)
  v_req_met uuid;
  v_req_open uuid;
  v_req_ref uuid;
  v_ref_f uuid;          -- abstract-only reference for the F cases
  v_dp_ind_f uuid;       -- IND datapoint for the F cases
  v_output_f uuid;
  v_claim_b2 uuid;       -- layer B claim for the inference_step cases
  v_claim_c2 uuid;       -- layer C claim for the inference_step cases
  v_candidate uuid;      -- SCOUT (081)
  v_candidate_blog uuid;
  v_stamp timestamptz;
  v_text text;
  v_int int;
  v_bool boolean;
begin
  -- ==== identities =========================================================
  select key_hash into old_hash from private.os_app_secret;
  update private.os_app_secret
     set key_hash = extensions.crypt('epistemic-gate-test-key', extensions.gen_salt('bf'));
  -- OWNER on by default; individual cases flip to AGENT and back.
  perform set_config('request.headers',
    json_build_object('x-app-key', 'epistemic-gate-test-key')::text, true);
  perform set_config('request.jwt.claims', '{}', true);

  -- ==== fixture ============================================================
  insert into public.os_lab_projects (name, research_question)
  values ('t-epistemic', 'does the gate hold') returning id into v_project;

  insert into public.os_lab_source_documents (title, doc_type, local_snapshot_path)
  values ('t-source', 'government_report', 'snapshots/t-source.pdf')
  returning id into v_source;

  insert into public.os_lab_commitment_sources (project_id, title, type, committed_at, document_path)
  values (v_project, 't-essay', 'essay', current_date, 'commitments/t-essay.md')
  returning id into v_commit;

  -- The heartbeat (079): finalization refuses while the sweep has never
  -- run, so the fixture runs it once up front — the output cases below
  -- assert their ORIGINAL causes, and the heartbeat gets its own cases.
  perform public.os_lab_stale_sweep();

  -- ==== G-EXTRACT ==========================================================
  -- 1. definition_scope under 20 characters is refused, not placeholdered.
  begin
    insert into public.os_lab_datapoints
      (value, definition_scope, source_document_id, locator, volatility_class, extraction_method)
    values (1, 'too short', v_source, 'p.1', 'static', 'manual');
    insert into gate_findings values ('G-EXTRACT: a datapoint with a 9-char definition_scope was accepted');
  exception when others then null;
  end;

  -- 2. nothing is born verified.
  begin
    insert into public.os_lab_datapoints
      (value, definition_scope, source_document_id, locator, volatility_class, extraction_method, status)
    values (1, 'national nominal GDP, current prices', v_source, 'p.1', 'static', 'manual', 'V');
    insert into gate_findings values ('G-VERIFY: a datapoint was inserted directly at V');
  exception when others then null;
  end;

  -- 3. the honest insert lands (over-blocking is the same bug inverted).
  begin
    insert into public.os_lab_datapoints
      (value, definition_scope, source_document_id, locator, volatility_class, extraction_method)
    values (100, 'national nominal GDP, current prices, BPS basis', v_source, 'tab 2.1', 'static', 'manual')
    returning id into v_dp_manual;
  exception when others then
    insert into gate_findings values ('G-EXTRACT over-blocks: a fully-specified manual datapoint was refused: ' || sqlerrm);
  end;

  -- ==== G-VERIFY ===========================================================
  -- 4. no note, no V.
  begin
    update public.os_lab_datapoints set status = 'V' where id = v_dp_manual;
    insert into gate_findings values ('G-VERIFY: IND→V succeeded without a verification_note');
  exception when others then null;
  end;

  -- 5. manual + note passes, and the guard stamps the clock.
  begin
    update public.os_lab_datapoints
       set status = 'V', verification_note = 'checked against printed table 2.1'
     where id = v_dp_manual;
    select verified_at into v_stamp from public.os_lab_datapoints where id = v_dp_manual;
    if v_stamp is null then
      insert into gate_findings values ('G-VERIFY: V granted but verified_at not stamped');
    end if;
  exception when others then
    insert into gate_findings values ('G-VERIFY over-blocks: manual+note verification refused: ' || sqlerrm);
  end;

  -- 6. agent-extracted without a passed internal check cannot reach V…
  insert into public.os_lab_datapoints
    (value, definition_scope, source_document_id, locator, volatility_class, extraction_method)
  values (200, 'state fiscal transfer total, revised budget basis', v_source, 'tab 4.2', 'slow', 'agent_from_full_pdf')
  returning id into v_dp_agent;
  begin
    update public.os_lab_datapoints
       set status = 'V', verification_note = 'looks right'
     where id = v_dp_agent;
    insert into gate_findings values ('G-VERIFY: agent_from_full_pdf reached V with internal_check_passed null');
  exception when others then null;
  end;
  -- …and can once the internal reconciliation passed.
  begin
    update public.os_lab_datapoints set internal_check_passed = true where id = v_dp_agent;
    update public.os_lab_datapoints
       set status = 'V', verification_note = 'components reconcile to stated subtotal'
     where id = v_dp_agent;
  exception when others then
    insert into gate_findings values ('G-VERIFY over-blocks: internal_check_passed=true + note refused: ' || sqlerrm);
  end;

  -- 7. editing the substance of a V datapoint voids the verification.
  update public.os_lab_datapoints set value = 201 where id = v_dp_agent;
  select status into v_text from public.os_lab_datapoints where id = v_dp_agent;
  if v_text <> 'IND' then
    insert into gate_findings values ('G-VERIFY: a value edit left a datapoint verified (status ' || v_text || ')');
  end if;
  -- restore V for later cases
  update public.os_lab_datapoints
     set status = 'V', verification_note = 'reconciled again after correction'
   where id = v_dp_agent;

  -- ==== G-CLAIM ============================================================
  insert into public.os_lab_datapoints
    (value, definition_scope, source_document_id, locator, volatility_class, extraction_method)
  values (7.3, 'cold-storage utilisation rate, national aggregate', v_source, 'p.12', 'volatile', 'manual')
  returning id into v_dp_conflict_a;

  insert into public.os_lab_claims (project_id, statement, layer, inference_step)
  values (v_project, 't-claim: utilisation is materially below capacity', 'B',
          'the matched utilisation figure sits well below the capacity figure on the same basis')
  returning id into v_claim;
  insert into public.os_lab_claim_datapoints values (v_claim, v_dp_conflict_a);

  -- 8. a claim cannot be born approved.
  begin
    insert into public.os_lab_claims (project_id, statement, layer, status)
    values (v_project, 't-born-approved', 'C', 'approved');
    insert into gate_findings values ('G-CLAIM: a claim was inserted directly at approved');
  exception when others then null;
  end;

  -- 9. approval over an IND datapoint is refused, naming the datapoint.
  begin
    update public.os_lab_claims set status = 'approved' where id = v_claim;
    insert into gate_findings values ('G-CLAIM: approved over an IND datapoint');
  exception when others then
    if sqlerrm not like '%' || v_dp_conflict_a || '%' then
      insert into gate_findings values ('G-CLAIM: refusal did not name the offending datapoint: ' || sqlerrm);
    end if;
  end;

  update public.os_lab_datapoints
     set status = 'V', verification_note = 'checked against annex table'
   where id = v_dp_conflict_a;

  -- 10. an abstract_only reference blocks approval, naming the reference.
  insert into public.os_lab_references (title) values ('t-paper') returning id into v_ref;
  insert into public.os_lab_claim_references values (v_claim, v_ref);
  begin
    update public.os_lab_claims set status = 'approved' where id = v_claim;
    insert into gate_findings values ('G-CLAIM: approved over an abstract_only reference');
  exception when others then
    if sqlerrm not like '%' || v_ref || '%' then
      insert into gate_findings values ('G-CLAIM: refusal did not name the offending reference: ' || sqlerrm);
    end if;
  end;

  -- 11. promotion without the text on disk is refused; with it, allowed.
  begin
    update public.os_lab_references set verification_level = 'full_text_read' where id = v_ref;
    insert into gate_findings values ('references: full_text_read granted with no full_text_path');
  exception when others then null;
  end;
  update public.os_lab_references
     set verification_level = 'full_text_read', full_text_path = 'papers/t-paper.pdf'
   where id = v_ref;

  -- 12. an unresolved conflict on a supporting datapoint blocks approval.
  insert into public.os_lab_datapoints
    (value, definition_scope, source_document_id, locator, volatility_class, extraction_method)
  values (9.1, 'cold-storage utilisation rate, national aggregate, association survey basis', v_source, 'p.3', 'volatile', 'manual')
  returning id into v_dp_conflict_b;
  insert into public.os_lab_datapoint_conflicts (datapoint_a_id, datapoint_b_id, conflict_type)
  values (v_dp_conflict_a, v_dp_conflict_b, 'definition_mismatch')
  returning id into v_conflict;
  begin
    update public.os_lab_claims set status = 'approved' where id = v_claim;
    insert into gate_findings values ('G-CLAIM: approved over an unresolved datapoint conflict');
  exception when others then
    if sqlerrm not like '%' || v_conflict || '%' then
      insert into gate_findings values ('G-CLAIM: refusal did not name the conflict: ' || sqlerrm);
    end if;
  end;

  -- 13. resolving without a note is refused; with one, approval lands and
  --     the guard stamps approved_by_human_at.
  begin
    update public.os_lab_datapoint_conflicts
       set resolution_status = 'resolved_prefer_a' where id = v_conflict;
    insert into gate_findings values ('conflicts: resolved without a resolution_note');
  exception when others then null;
  end;
  update public.os_lab_datapoint_conflicts
     set resolution_status = 'resolved_prefer_a',
         resolution_note = 'BPS basis preferred; survey overcounts informal capacity'
   where id = v_conflict;
  begin
    update public.os_lab_claims set status = 'approved' where id = v_claim;
    select approved_by_human_at into v_stamp from public.os_lab_claims where id = v_claim;
    if v_stamp is null then
      insert into gate_findings values ('G-CLAIM: approved without approved_by_human_at being stamped');
    end if;
  exception when others then
    insert into gate_findings values ('G-CLAIM over-blocks: a fully-gated approval was refused: ' || sqlerrm);
  end;

  -- 14. approved claims are edit-locked and their evidence is pinned.
  begin
    update public.os_lab_claims set statement = 'reworded' where id = v_claim;
    insert into gate_findings values ('G-CLAIM: an approved claim''s statement was edited in place');
  exception when others then null;
  end;
  begin
    delete from public.os_lab_claim_datapoints
     where claim_id = v_claim and datapoint_id = v_dp_conflict_a;
    insert into gate_findings values ('G-CLAIM: evidence was unlinked from an approved claim');
  exception when others then null;
  end;

  -- 15. approved_by_human_at cannot be written directly.
  insert into public.os_lab_claims (project_id, statement, layer, approved_by_human_at)
  values (v_project, 't-stamp-smuggle', 'C', now())
  returning id into v_claim_x;
  select approved_by_human_at into v_stamp from public.os_lab_claims where id = v_claim_x;
  if v_stamp is not null then
    insert into gate_findings values ('G-CLAIM: approved_by_human_at was accepted from the client on insert');
  end if;

  -- ==== G-LAYER ============================================================
  insert into public.os_lab_claims (project_id, statement, layer, commitment_source_id)
  values (v_project, 't-committed: the essay asserts X', 'A', v_commit)
  returning id into v_claim_a;
  -- 16. layer A without a commitment source is a row that cannot exist.
  begin
    insert into public.os_lab_claims (project_id, statement, layer)
    values (v_project, 't-uncommitted-A', 'A');
    insert into gate_findings values ('G-LAYER: a layer A claim was accepted with no commitment source');
  exception when others then null;
  end;
  -- 17. layer A is frozen.
  begin
    update public.os_lab_claims set statement = 'quietly different' where id = v_claim_a;
    insert into gate_findings values ('G-LAYER: a layer A statement was rewritten in place');
  exception when others then null;
  end;

  -- ==== G-OUTPUT ===========================================================
  insert into public.os_lab_outputs (project_id, output_type)
  values (v_project, 'briefing') returning id into v_output;
  -- 18. born draft, always.
  begin
    insert into public.os_lab_outputs (project_id, output_type, status)
    values (v_project, 'briefing', 'final');
    insert into gate_findings values ('G-OUTPUT: an output was inserted directly at final');
  exception when others then null;
  end;
  -- 19. a working draft may cite an unapproved claim; finalizing may not.
  insert into public.os_lab_output_claims values (v_output, v_claim_x);
  begin
    update public.os_lab_outputs set status = 'final' where id = v_output;
    insert into gate_findings values ('G-OUTPUT: finalized citing a non-approved claim');
  exception when others then
    if sqlerrm not like '%' || v_claim_x || '%' then
      insert into gate_findings values ('G-OUTPUT: refusal did not name the unapproved claim: ' || sqlerrm);
    end if;
  end;

  -- 20. no output cites both sides of an open contradiction, draft included.
  insert into public.os_lab_claims (project_id, statement, layer)
  values (v_project, 't-thesis', 'C') returning id into v_claim_y;
  insert into public.os_lab_claim_contradictions (claim_a_id, claim_b_id, severity)
  values (v_claim_x, v_claim_y, 'direct');
  begin
    insert into public.os_lab_output_claims values (v_output, v_claim_y);
    insert into gate_findings values ('G-LAYER: an output now cites both sides of an open contradiction');
  exception when others then null;
  end;

  -- ==== HARDENING (079) ====================================================

  -- H1. extraction_method is provenance and frozen after insert.
  begin
    update public.os_lab_datapoints
       set extraction_method = 'agent_from_full_pdf' where id = v_dp_manual;
    insert into gate_findings values ('H1: extraction_method was relabelled after insert');
  exception when others then
    if sqlerrm not ilike '%provenance%' then
      insert into gate_findings values ('H1: freeze refused with the wrong message: ' || sqlerrm);
    end if;
  end;

  -- H2. the sweep heartbeat gates finalization, naming the SWEEP.
  delete from public.os_lab_sweep_log;
  begin
    update public.os_lab_outputs set status = 'final' where id = v_output;
    insert into gate_findings values ('H2: finalized with the sweep never having run');
  exception when others then
    if sqlerrm not ilike '%sweep%' then
      insert into gate_findings values ('H2: empty-heartbeat refusal did not name the sweep: ' || sqlerrm);
    end if;
  end;
  insert into public.os_lab_sweep_log (ran_at, rows_demoted)
  values (now() - interval '50 hours', 0);
  begin
    update public.os_lab_outputs set status = 'final' where id = v_output;
    insert into gate_findings values ('H2: finalized with a 50-hour-old heartbeat');
  exception when others then
    if sqlerrm not ilike '%sweep%' then
      insert into gate_findings values ('H2: stale-heartbeat refusal did not name the sweep: ' || sqlerrm);
    end if;
  end;
  perform public.os_lab_stale_sweep();
  begin
    update public.os_lab_outputs set status = 'final' where id = v_output;
    insert into gate_findings values ('H2: finalized citing a non-approved claim once the heartbeat was fresh');
  exception when others then
    if sqlerrm not like '%' || v_claim_x || '%' then
      insert into gate_findings values ('H2: with a fresh heartbeat the refusal should be the unapproved claim: ' || sqlerrm);
    end if;
  end;

  -- H3. a DIRECT open contradiction blocks approval of either side.
  --     (v_claim_x ↔ v_claim_y carry one from case 20.)
  begin
    update public.os_lab_claims set status = 'approved' where id = v_claim_y;
    insert into gate_findings values ('H3: approved one side of an open DIRECT contradiction');
  exception when others then
    if sqlerrm not ilike '%direct%' or sqlerrm not like '%' || v_claim_x || '%' then
      insert into gate_findings values ('H3: refusal did not name the contradiction and opposing claim: ' || sqlerrm);
    end if;
  end;
  --     tension stays advisory: an open tension does not block.
  insert into public.os_lab_claims (project_id, statement, layer, inference_step)
  values (v_project, 't-tension-a', 'C',
          'inferred from the divergence between the two matched series')
  returning id into v_dp_conflict_a; -- reuse var as claim id
  insert into public.os_lab_claims (project_id, statement, layer, inference_step)
  values (v_project, 't-tension-b', 'C',
          'inferred from the same divergence read the other way')
  returning id into v_dp_conflict_b;
  insert into public.os_lab_claim_contradictions (claim_a_id, claim_b_id, severity)
  values (v_dp_conflict_a, v_dp_conflict_b, 'tension');
  begin
    update public.os_lab_claims set status = 'approved' where id = v_dp_conflict_a;
  exception when others then
    insert into gate_findings values ('H3 over-blocks: a tension contradiction blocked approval: ' || sqlerrm);
  end;

  -- H4. models are pinned: no aliases, and a marker is required.
  begin
    update public.os_lab_providers set model = 'claude-latest' where name = 'anthropic';
    insert into gate_findings values ('H4: a -latest alias was accepted as a model string');
  exception when others then
    if sqlerrm not ilike '%alias%' then
      insert into gate_findings values ('H4: alias refused with the wrong message: ' || sqlerrm);
    end if;
  end;
  begin
    update public.os_lab_providers set model = 'kimi-preview' where name = 'kimi';
    insert into gate_findings values ('H4: a model string with no version/date marker was accepted');
  exception when others then null;
  end;
  --     grandfathering: an edit that does NOT touch the model passes even
  --     on the alias row that predates the guard.
  begin
    update public.os_lab_providers set is_active = true where name = 'deepseek';
  exception when others then
    insert into gate_findings values ('H4 over-blocks: a non-model edit on the grandfathered row was refused: ' || sqlerrm);
  end;

  -- H5. runs record the resolved model string.
  insert into public.os_lab_runs (agent_id, provider_id, input, status, model)
  select a.id, p.id, 'h5 probe', 'error', p.model
    from public.os_lab_agents a, public.os_lab_providers p
   where a.slug = 'ceo-briefing-deck' and p.name = 'kimi';
  select count(*) into v_int from public.os_lab_runs
   where input = 'h5 probe' and model <> '';
  if v_int <> 1 then
    insert into gate_findings values ('H5: the runs row did not record the resolved model string');
  end if;

  -- ==== FRAMER (080) =======================================================

  -- F0. the honest intake lands: question, sub-questions, requirements.
  begin
    insert into public.os_lab_questions (project_id, raw_statement, framed_question, framing_source)
    values (v_project, 'is cold-chain the bottleneck?',
            'which cold-chain segment binds national capacity growth first', 'owner_written')
    returning id into v_question;
    insert into public.os_lab_sub_questions (question_id, statement, falsifier)
    values (v_question, 'is utilisation below nameplate capacity?',
            'a source-matched utilisation figure at or above nameplate capacity')
    returning id into v_subq_met;
    insert into public.os_lab_sub_questions (question_id, statement, falsifier)
    values (v_question, 'does the licensing regime bind imports?',
            'an import realisation series unchanged across the regulation date')
    returning id into v_subq_open;
    insert into public.os_lab_evidence_requirements (sub_question_id, description, kind)
    values (v_subq_met, 'a source-matched national utilisation rate', 'datapoint')
    returning id into v_req_met;
    insert into public.os_lab_evidence_requirements (sub_question_id, description, kind)
    values (v_subq_open, 'an import realisation series spanning the regulation date', 'datapoint')
    returning id into v_req_open;
    insert into public.os_lab_evidence_requirements (sub_question_id, description, kind)
    values (v_subq_met, 'a full-text study of utilisation methodology', 'reference')
    returning id into v_req_ref;
  exception when others then
    insert into gate_findings values ('F0 over-blocks: an honest owner intake was refused: ' || sqlerrm);
  end;

  -- F1. a sub-question without a real falsifier is a row that cannot exist.
  begin
    insert into public.os_lab_sub_questions (question_id, statement, falsifier)
    values (v_question, 't-lazy', 'none');
    insert into gate_findings values ('F1: a sub-question with a 4-char falsifier was accepted');
  exception when others then null;
  end;

  -- F2. the framer''s write scope is EMPTY: keyless writes refused on all four.
  perform set_config('request.headers', '{}', true);
  begin
    insert into public.os_lab_questions (project_id, raw_statement, framed_question, framing_source)
    values (v_project, 'agent ask', 'an agent-framed question, which must not exist', 'owner_written');
    insert into gate_findings values ('F2: AGENT inserted a question');
  exception when others then null;
  end;
  begin
    insert into public.os_lab_sub_questions (question_id, statement, falsifier)
    values (v_question, 't-agent-subq', 'an agent-invented falsifier long enough to pass');
    insert into gate_findings values ('F2: AGENT inserted a sub-question');
  exception when others then null;
  end;
  begin
    insert into public.os_lab_evidence_requirements (sub_question_id, description, kind)
    values (v_subq_open, 't-agent-req', 'datapoint');
    insert into gate_findings values ('F2: AGENT inserted an evidence requirement');
  exception when others then null;
  end;
  begin
    insert into public.os_lab_output_sub_questions values (v_output, v_subq_open);
    insert into gate_findings values ('F2: AGENT linked an output to a sub-question');
  exception when others then null;
  end;
  perform set_config('request.headers',
    json_build_object('x-app-key', 'epistemic-gate-test-key')::text, true);

  -- F3. raw_statement is frozen at intake, even for the owner.
  begin
    update public.os_lab_questions
       set raw_statement = 'quietly different ask' where id = v_question;
    insert into gate_findings values ('F3: raw_statement was rewritten after intake');
  exception when others then
    if sqlerrm not like '%' || v_question || '%' then
      insert into gate_findings values ('F3: freeze refusal did not name the question: ' || sqlerrm);
    end if;
  end;
  --     reframing (framed_question) stays open — over-blocking check.
  begin
    update public.os_lab_questions
       set framed_question = 'which cold-chain segment binds capacity growth first, and where',
           framing_source = 'owner_selected'
     where id = v_question;
  exception when others then
    insert into gate_findings values ('F3 over-blocks: an owner reframe was refused: ' || sqlerrm);
  end;

  -- F4. only source-matched evidence satisfies a requirement.
  insert into public.os_lab_datapoints
    (value, definition_scope, source_document_id, locator, volatility_class, extraction_method)
  values (55, 'import realisation series, customs clearance basis, monthly', v_source, 'tab 9', 'slow', 'manual')
  returning id into v_dp_ind_f;
  begin
    update public.os_lab_evidence_requirements
       set satisfied_by_datapoint_id = v_dp_ind_f where id = v_req_met;
    insert into gate_findings values ('F4: an IND datapoint satisfied an evidence requirement');
  exception when others then
    if sqlerrm not like '%' || v_req_met || '%' or sqlerrm not like '%' || v_dp_ind_f || '%' then
      insert into gate_findings values ('F4: IND refusal did not name requirement and datapoint: ' || sqlerrm);
    end if;
  end;
  --     a V datapoint does, and the guard stamps satisfied_at.
  begin
    update public.os_lab_evidence_requirements
       set satisfied_by_datapoint_id = v_dp_manual where id = v_req_met;
    select satisfied_at into v_stamp from public.os_lab_evidence_requirements where id = v_req_met;
    if v_stamp is null then
      insert into gate_findings values ('F4: satisfaction landed but satisfied_at was not stamped');
    end if;
  exception when others then
    insert into gate_findings values ('F4 over-blocks: a V datapoint was refused as satisfaction: ' || sqlerrm);
  end;
  --     kind-consistency is a row fact: a reference on a datapoint-kind row.
  begin
    update public.os_lab_evidence_requirements
       set satisfied_by_reference_id = v_ref where id = v_req_open;
    insert into gate_findings values ('F4: a reference satisfied a datapoint-kind requirement');
  exception when others then null;
  end;
  --     an abstract-only reference cannot satisfy a reference-kind row.
  insert into public.os_lab_references (title) values ('t-abstract-f') returning id into v_ref_f;
  begin
    update public.os_lab_evidence_requirements
       set satisfied_by_reference_id = v_ref_f where id = v_req_ref;
    insert into gate_findings values ('F4: an abstract_only reference satisfied a requirement');
  exception when others then
    if sqlerrm not like '%' || v_ref_f || '%' then
      insert into gate_findings values ('F4: abstract refusal did not name the reference: ' || sqlerrm);
    end if;
  end;

  -- F5. G-FALSIFY: an output addressing a sub-question with no satisfied
  --     requirement cannot finalize, and the refusal names the sub-question.
  insert into public.os_lab_outputs (project_id, output_type)
  values (v_project, 'briefing') returning id into v_output_f;
  insert into public.os_lab_output_claims values (v_output_f, v_claim);
  insert into public.os_lab_output_sub_questions values (v_output_f, v_subq_met);
  insert into public.os_lab_output_sub_questions values (v_output_f, v_subq_open);
  begin
    update public.os_lab_outputs set status = 'final' where id = v_output_f;
    insert into gate_findings values ('F5: finalized addressing a sub-question with no satisfied requirement');
  exception when others then
    if sqlerrm not like '%' || v_subq_open || '%' then
      insert into gate_findings values ('F5: G-FALSIFY refusal did not name the sub-question: ' || sqlerrm);
    end if;
  end;
  --     satisfy the open requirement (source-match the IND row first) and
  --     the same finalize lands — the gate reads coverage, not vibes.
  update public.os_lab_datapoints
     set status = 'V', verification_note = 'checked against the customs clearance table'
   where id = v_dp_ind_f;
  update public.os_lab_evidence_requirements
     set satisfied_by_datapoint_id = v_dp_ind_f where id = v_req_open;
  begin
    update public.os_lab_outputs set status = 'final' where id = v_output_f;
    select status into v_text from public.os_lab_outputs where id = v_output_f;
    if v_text <> 'final' then
      insert into gate_findings values ('F5: a fully-covered finalize did not land (status ' || v_text || ')');
    end if;
  exception when others then
    insert into gate_findings values ('F5 over-blocks: a fully-covered finalize was refused: ' || sqlerrm);
  end;
  --     a final output''s sub-question links are pinned.
  begin
    delete from public.os_lab_output_sub_questions
     where output_id = v_output_f and sub_question_id = v_subq_open;
    insert into gate_findings values ('F5: a sub-question was unlinked from a final output');
  exception when others then null;
  end;

  -- F6. layer B approval requires evidence AND the inference step.
  insert into public.os_lab_claims (project_id, statement, layer)
  values (v_project, 't-b2: the series is flat across the date', 'B')
  returning id into v_claim_b2;
  begin
    update public.os_lab_claims set status = 'approved' where id = v_claim_b2;
    insert into gate_findings values ('F6: a layer B claim approved with no evidence linked');
  exception when others then
    if sqlerrm not like '%' || v_claim_b2 || '%' then
      insert into gate_findings values ('F6: no-evidence refusal did not name the claim: ' || sqlerrm);
    end if;
  end;
  insert into public.os_lab_claim_datapoints values (v_claim_b2, v_dp_ind_f);
  begin
    update public.os_lab_claims set status = 'approved' where id = v_claim_b2;
    insert into gate_findings values ('F6: a layer B claim approved without an inference_step');
  exception when others then
    if sqlerrm not ilike '%inference_step%' then
      insert into gate_findings values ('F6: refusal did not name inference_step: ' || sqlerrm);
    end if;
  end;
  begin
    update public.os_lab_claims
       set status = 'approved',
           inference_step = 'the matched series shows no level shift across the regulation date'
     where id = v_claim_b2;
  exception when others then
    insert into gate_findings values ('F6 over-blocks: evidence + inference_step approval refused: ' || sqlerrm);
  end;

  -- F7. layer C approval requires the inference step — the step IS the
  --     contribution and it gets recorded.
  insert into public.os_lab_claims (project_id, statement, layer)
  values (v_project, 't-c2: the regime is not the binding constraint', 'C')
  returning id into v_claim_c2;
  begin
    update public.os_lab_claims set status = 'approved' where id = v_claim_c2;
    insert into gate_findings values ('F7: a layer C claim approved without an inference_step');
  exception when others then
    if sqlerrm not ilike '%inference_step%' then
      insert into gate_findings values ('F7: refusal did not name inference_step: ' || sqlerrm);
    end if;
  end;
  begin
    update public.os_lab_claims
       set status = 'approved',
           inference_step = 'if imports were bound by licensing, the realisation series would shift; it does not'
     where id = v_claim_c2;
  exception when others then
    insert into gate_findings values ('F7 over-blocks: a layer C approval with the step was refused: ' || sqlerrm);
  end;

  -- F8. the coverage views agree with what just happened.
  select satisfied_count into v_int
    from public.os_lab_sub_question_coverage where sub_question_id = v_subq_open;
  if v_int <> 1 then
    insert into gate_findings values ('F8: sub-question coverage view shows ' || v_int || ' satisfied, expected 1');
  end if;

  -- ==== SCOUT (081) ========================================================

  -- S0. the tier comes from the allowlist, never the payload — owner too.
  begin
    insert into public.os_lab_candidate_sources (project_id, title, publisher, url, tier)
    values (v_project, 't-candidate-bps', 'BPS', 'https://example.invalid/bps', 3)
    returning id into v_candidate;
    if (select tier from public.os_lab_candidate_sources where id = v_candidate) <> 1 then
      insert into gate_findings values ('S0: BPS candidate did not get allowlist tier 1');
    end if;
  exception when others then
    insert into gate_findings values ('S0 over-blocks: an honest owner candidate was refused: ' || sqlerrm);
  end;

  -- S1. the SCOUT (keyless): candidate-only, tier recomputed from the
  --     allowlist even when the payload lies.
  perform set_config('request.headers', '{}', true);
  begin
    insert into public.os_lab_candidate_sources (project_id, title, publisher, tier)
    values (v_project, 't-candidate-blog', 'Some Blog', 1)
    returning id into v_candidate_blog;
    if (select tier from public.os_lab_candidate_sources where id = v_candidate_blog) <> 3 then
      insert into gate_findings values ('S1: an unknown publisher kept the payload''s tier claim');
    end if;
    if (select status from public.os_lab_candidate_sources where id = v_candidate_blog) <> 'candidate' then
      insert into gate_findings values ('S1: a keyless candidate landed at a status other than candidate');
    end if;
  exception when others then
    insert into gate_findings values ('S1 over-blocks: the scout''s legitimate candidate insert was refused: ' || sqlerrm);
  end;
  begin
    insert into public.os_lab_candidate_sources (project_id, title, status)
    values (v_project, 't-agent-promoted', 'promoted');
    insert into gate_findings values ('S1: AGENT inserted a candidate at status promoted');
  exception when others then null;
  end;
  -- S2. keyless curation is refused outright.
  begin
    update public.os_lab_candidate_sources set status = 'dismissed' where id = v_candidate;
    insert into gate_findings values ('S2: AGENT dismissed a candidate');
  exception when others then null;
  end;
  -- S2b. the allowlist itself is owner-only.
  begin
    insert into public.os_lab_publisher_tiers (publisher, tier) values ('Agent Times', 1);
    insert into gate_findings values ('S2: AGENT wrote the publisher allowlist');
  exception when others then null;
  end;
  perform set_config('request.headers',
    json_build_object('x-app-key', 'epistemic-gate-test-key')::text, true);

  -- S3. promotion requires the snapshot-backed source document, by name.
  begin
    update public.os_lab_candidate_sources set status = 'promoted' where id = v_candidate;
    insert into gate_findings values ('S3: promoted a candidate with no source document');
  exception when others then
    if sqlerrm not like '%' || v_candidate || '%' then
      insert into gate_findings values ('S3: refusal did not name the candidate: ' || sqlerrm);
    end if;
  end;
  begin
    update public.os_lab_candidate_sources
       set status = 'promoted', promoted_source_document_id = v_source
     where id = v_candidate;
  exception when others then
    insert into gate_findings values ('S3 over-blocks: promotion with a snapshot-backed document was refused: ' || sqlerrm);
  end;

  -- S4. the recheck (keyless): flag columns only; substance is refused.
  perform set_config('request.headers', '{}', true);
  begin
    update public.os_lab_source_documents
       set last_rechecked_at = now(), content_changed_at = now()
     where id = v_source;
  exception when others then
    insert into gate_findings values ('S4 over-blocks: the keyless recheck flag write was refused: ' || sqlerrm);
  end;
  begin
    update public.os_lab_source_documents set title = 'rewritten by the recheck' where id = v_source;
    insert into gate_findings values ('S4: a keyless write touched source-document substance');
  exception when others then null;
  end;
  begin
    insert into public.os_lab_source_documents (title, doc_type, local_snapshot_path)
    values ('t-agent-source', 'news', 'snapshots/x.pdf');
    insert into gate_findings values ('S4: AGENT ingested a source document');
  exception when others then null;
  end;
  perform set_config('request.headers',
    json_build_object('x-app-key', 'epistemic-gate-test-key')::text, true);
  --     and the flag demoted nothing: the V datapoint on v_source stands.
  select status into v_text from public.os_lab_datapoints where id = v_dp_manual;
  if v_text <> 'V' then
    insert into gate_findings values ('S4: the recheck flag demoted a datapoint (is ' || v_text || ')');
  end if;

  -- S5. judgement columns are structurally absent — a regression tripwire.
  select count(*) into v_int
    from information_schema.columns
   where table_schema = 'public' and table_name = 'os_lab_candidate_sources'
     and column_name in ('notes', 'summary', 'assessment', 'relevance', 'relevance_score', 'quality');
  if v_int > 0 then
    insert into gate_findings values ('S5: a judgement column appeared on os_lab_candidate_sources');
  end if;

  -- ==== G-STALE ============================================================
  insert into public.os_lab_datapoints
    (value, definition_scope, source_document_id, locator, volatility_class, extraction_method)
  values (42, 'current licensed capacity of the regulated facility class', v_source, 'p.7', 'volatile', 'manual')
  returning id into v_dp_volatile;
  update public.os_lab_datapoints
     set status = 'V', verification_note = 'checked against the register'
   where id = v_dp_volatile;
  insert into public.os_lab_claims (project_id, statement, layer, inference_step)
  values (v_project, 't-volatile: capacity stands at 42', 'B',
          'read directly off the register entry for the facility class')
  returning id into v_claim_vol;
  insert into public.os_lab_claim_datapoints values (v_claim_vol, v_dp_volatile);
  update public.os_lab_claims set status = 'approved' where id = v_claim_vol;
  insert into public.os_lab_outputs (project_id, output_type)
  values (v_project, 'data_comparison') returning id into v_output_vol;
  insert into public.os_lab_output_claims values (v_output_vol, v_claim_vol);

  -- Backdate the verification 200 days. The clock is guard-owned, so the
  -- test steps around the guard the way only a superuser fixture can.
  alter table public.os_lab_datapoints disable trigger os_lab_datapoints_gate_guard;
  update public.os_lab_datapoints
     set verified_at = now() - interval '200 days' where id = v_dp_volatile;
  alter table public.os_lab_datapoints enable trigger os_lab_datapoints_gate_guard;

  -- The sweep runs KEYLESS, as cron would.
  perform set_config('request.headers', '{}', true);
  select public.os_lab_stale_sweep() into v_int;
  if v_int < 1 then
    insert into gate_findings values ('G-STALE: the sweep reverted nothing for a 200-day-old volatile V');
  end if;
  select status into v_text from public.os_lab_datapoints where id = v_dp_volatile;
  if v_text <> 'IND' then
    insert into gate_findings values ('G-STALE: volatile datapoint still ' || v_text || ' after the sweep');
  end if;
  select status into v_text from public.os_lab_claims where id = v_claim_vol;
  if v_text <> 'reviewed' then
    insert into gate_findings values ('G-STALE: dependent claim did not drop to reviewed (is ' || v_text || ')');
  end if;
  select stale into v_bool from public.os_lab_outputs where id = v_output_vol;
  if not v_bool then
    insert into gate_findings values ('G-STALE: output citing the demoted claim was not marked stale');
  end if;
  -- The static workhorse from earlier must be untouched: static never expires.
  select status into v_text from public.os_lab_datapoints where id = v_dp_manual;
  if v_text <> 'V' then
    insert into gate_findings values ('G-STALE: a static datapoint expired (is ' || v_text || ')');
  end if;

  -- ==== THE AGENT, everywhere it must be refused ===========================
  -- (request.headers is still '{}' from the sweep.)

  -- 21. cannot verify.
  begin
    update public.os_lab_datapoints
       set status = 'V', verification_note = 'agent says fine'
     where id = v_dp_volatile;
    insert into gate_findings values ('AGENT verified a datapoint');
  exception when others then null;
  end;
  -- 22. cannot approve.
  begin
    update public.os_lab_claims set status = 'approved' where id = v_claim_x;
    insert into gate_findings values ('AGENT approved a claim');
  exception when others then null;
  end;
  -- 23. cannot create claims at all.
  begin
    insert into public.os_lab_claims (project_id, statement, layer)
    values (v_project, 't-agent-claim', 'C');
    insert into gate_findings values ('AGENT inserted a claim row');
  exception when others then null;
  end;
  -- 24. datapoints: IND only, never "manual".
  begin
    insert into public.os_lab_datapoints
      (value, definition_scope, source_document_id, locator, volatility_class, extraction_method, status)
    values (5, 'agent probe of the gate, not a real quantity', v_source, 'p.9', 'static', 'agent_from_selected_text', 'NA');
    insert into gate_findings values ('AGENT inserted a datapoint at a status other than IND');
  exception when others then null;
  end;
  begin
    insert into public.os_lab_datapoints
      (value, definition_scope, source_document_id, locator, volatility_class, extraction_method)
    values (5, 'agent probe of the gate, not a real quantity', v_source, 'p.9', 'static', 'manual');
    insert into gate_findings values ('AGENT recorded extraction_method = manual');
  exception when others then null;
  end;
  begin
    insert into public.os_lab_datapoints
      (value, definition_scope, source_document_id, locator, volatility_class, extraction_method)
    values (5, 'agent probe of the gate, a legitimate IND write', v_source, 'p.9', 'static', 'agent_from_selected_text');
  exception when others then
    insert into gate_findings values ('AGENT rail over-blocks: a legitimate IND extraction was refused: ' || sqlerrm);
  end;
  -- 25. references: abstract_only only; no promotion.
  begin
    insert into public.os_lab_references (title, verification_level, full_text_path)
    values ('t-agent-fulltext', 'full_text_read', 'papers/x.pdf');
    insert into gate_findings values ('AGENT wrote a reference at full_text_read');
  exception when others then null;
  end;
  insert into public.os_lab_references (title) values ('t-agent-abstract')
  returning id into v_ref_agent;
  begin
    update public.os_lab_references
       set verification_level = 'full_text_read', full_text_path = 'papers/t.pdf'
     where id = v_ref_agent;
    insert into gate_findings values ('AGENT promoted a reference to full_text_read');
  exception when others then null;
  end;
  -- 26. conflicts and contradictions: recorded open/unresolved, never judged.
  begin
    update public.os_lab_datapoint_conflicts
       set resolution_status = 'resolved_prefer_b', resolution_note = 'agent decided'
     where id = v_conflict;
    insert into gate_findings values ('AGENT resolved a datapoint conflict');
  exception when others then null;
  end;
  -- 27. outputs: draft only; cites approved claims only; cannot edit content.
  begin
    insert into public.os_lab_outputs (project_id, output_type, status)
    values (v_project, 'briefing', 'final');
    insert into gate_findings values ('AGENT inserted a final output');
  exception when others then null;
  end;
  begin
    insert into public.os_lab_output_claims values (v_output, v_claim_y);
    insert into gate_findings values ('AGENT cited a non-approved claim in an output');
  exception when others then null;
  end;
  begin
    update public.os_lab_outputs set content = 'rewritten by the machine' where id = v_output;
    insert into gate_findings values ('AGENT edited output content');
  exception when others then null;
  end;
  -- 28. projects and sources are not the agent's to write.
  begin
    insert into public.os_lab_projects (name) values ('t-agent-project');
    insert into gate_findings values ('AGENT created a project');
  exception when others then null;
  end;

  -- restore the real hash (the rollback would too; explicit is kinder).
  update private.os_app_secret set key_hash = old_hash;
end
$$;

-- The verdict. Zero rows = every gate holds, in both directions.
select finding from gate_findings;

rollback;
