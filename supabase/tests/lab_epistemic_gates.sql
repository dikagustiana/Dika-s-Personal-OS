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

  insert into public.os_lab_claims (project_id, statement, layer)
  values (v_project, 't-claim: utilisation is materially below capacity', 'B')
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

  -- ==== G-STALE ============================================================
  insert into public.os_lab_datapoints
    (value, definition_scope, source_document_id, locator, volatility_class, extraction_method)
  values (42, 'current licensed capacity of the regulated facility class', v_source, 'p.7', 'volatile', 'manual')
  returning id into v_dp_volatile;
  update public.os_lab_datapoints
     set status = 'V', verification_note = 'checked against the register'
   where id = v_dp_volatile;
  insert into public.os_lab_claims (project_id, statement, layer)
  values (v_project, 't-volatile: capacity stands at 42', 'B') returning id into v_claim_vol;
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
