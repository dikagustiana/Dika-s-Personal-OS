-- ===========================================================================
-- WORKFLOWS (085), PROVEN AT THE DATABASE LAYER ALONE.
-- ===========================================================================
--
-- A workflow is a name plus an ordered subset of the closed thirteen-stage
-- set. This suite proves the properties that carry weight, with the client
-- bypassed entirely:
--
--   W1  the seeds landed: five routes, exactly one canonical, and the
--       canonical row is the full S0…S12 run;
--   W2  a stage code outside the thirteen is refused BY THE DATABASE;
--   W3  a duplicated stage code is refused;
--   W4  codes out of canonical order are refused — selection, not
--       arrangement;
--   W5  UPDATE on the canonical row is refused;  W6  DELETE likewise;
--   W7  a second canonical row is refused (partial unique index);
--   W8  the AGENT identity (no key) can neither create, edit, nor delete a
--       workflow — agents run routes, they never draw them;
--   W9  the OWNER can create, rename and delete a NON-canonical route
--       (over-blocking is the same bug inverted);
--   W10 deleting a route a project rides drops the project back to the
--       canonical NULL — never a dangling pointer;
--   W11 workflows weaken NO gate: with a route that omits S5 active on the
--       project, approving a claim on an IND datapoint still refuses with
--       the same G-CLAIM message. The gate does not read the route.
--
-- Same contract as every suite here: ZERO ROWS when healthy; any returned
-- row names what broke. Runs in one transaction ending in ROLLBACK.
--
-- Run:  psql "$DATABASE_URL" -f supabase/tests/lab_workflows.sql
-- or:   scripts/lab-epistemic-tests.sh   (throwaway cluster, full replay,
--                                         negative control included)

begin;

create temp table wf_findings (finding text);

do $$
declare
  old_hash text;
  v_count int;
  v_canonical uuid;
  v_codes text[];
  v_own uuid;
  v_project uuid;
  v_source uuid;
  v_dp uuid;
  v_claim uuid;
  v_workflow_id uuid;
  v_msg text;
begin
  -- ==== identities =========================================================
  select key_hash into old_hash from private.os_app_secret;
  update private.os_app_secret
     set key_hash = extensions.crypt('workflow-gate-test-key', extensions.gen_salt('bf'));
  perform set_config('request.headers',
    json_build_object('x-app-key', 'workflow-gate-test-key')::text, true);
  perform set_config('request.jwt.claims', '{}', true);

  -- ==== W1 the seeds =======================================================
  select count(*) into v_count from public.os_lab_workflows;
  if v_count < 5 then
    insert into wf_findings values ('W1: expected the five seeded routes, found ' || v_count);
  end if;
  select count(*) into v_count from public.os_lab_workflows where is_canonical;
  if v_count <> 1 then
    insert into wf_findings values ('W1: expected exactly ONE canonical route, found ' || v_count);
  end if;
  select id, stage_codes into v_canonical, v_codes
    from public.os_lab_workflows where is_canonical;
  if v_codes is distinct from array['S0','S1','S2','S3','S4','S5','S6','S7','S8','S9','S10','S11','S12'] then
    insert into wf_findings values ('W1: the canonical route is not the full S0…S12 run: ' || v_codes::text);
  end if;

  -- ==== W2 invented stage refused ==========================================
  begin
    insert into public.os_lab_workflows (name, stage_codes) values ('w2', array['S3','S99']);
    insert into wf_findings values ('W2: a stage code outside the thirteen was accepted');
  exception when others then
    if sqlerrm not like '%not one of the thirteen%' then
      insert into wf_findings values ('W2: refused with the wrong message: ' || sqlerrm);
    end if;
  end;

  -- ==== W3 duplicate refused ===============================================
  begin
    insert into public.os_lab_workflows (name, stage_codes) values ('w3', array['S3','S3']);
    insert into wf_findings values ('W3: a duplicated stage code was accepted');
  exception when others then
    if sqlerrm not like '%appears twice%' then
      insert into wf_findings values ('W3: refused with the wrong message: ' || sqlerrm);
    end if;
  end;

  -- ==== W4 out of canonical order refused ==================================
  begin
    insert into public.os_lab_workflows (name, stage_codes) values ('w4', array['S4','S3']);
    insert into wf_findings values ('W4: out-of-order stage codes were accepted');
  exception when others then
    if sqlerrm not like '%canonical order%' then
      insert into wf_findings values ('W4: refused with the wrong message: ' || sqlerrm);
    end if;
  end;

  -- ==== W5 / W6 the canonical row is immutable =============================
  begin
    update public.os_lab_workflows set name = 'renamed' where id = v_canonical;
    insert into wf_findings values ('W5: the canonical route accepted an UPDATE');
  exception when others then
    if sqlerrm not like '%immutable%' then
      insert into wf_findings values ('W5: refused with the wrong message: ' || sqlerrm);
    end if;
  end;
  begin
    delete from public.os_lab_workflows where id = v_canonical;
    insert into wf_findings values ('W6: the canonical route accepted a DELETE');
  exception when others then
    if sqlerrm not like '%immutable%' then
      insert into wf_findings values ('W6: refused with the wrong message: ' || sqlerrm);
    end if;
  end;

  -- ==== W7 a second canonical refused ======================================
  begin
    insert into public.os_lab_workflows (name, stage_codes, is_canonical)
    values ('w7', array['S0'], true);
    insert into wf_findings values ('W7: a SECOND canonical route was accepted');
  exception when others then null;
  end;

  -- ==== W8 agents never draw routes ========================================
  perform set_config('request.headers', '{}', true);
  begin
    insert into public.os_lab_workflows (name, stage_codes) values ('w8', array['S3']);
    insert into wf_findings values ('W8: a keyless INSERT was accepted');
  exception when others then
    if sqlerrm not like '%owner alone%' then
      insert into wf_findings values ('W8: insert refused with the wrong message: ' || sqlerrm);
    end if;
  end;
  begin
    update public.os_lab_workflows set name = 'agent-renamed' where not is_canonical;
    insert into wf_findings values ('W8: a keyless UPDATE was accepted');
  exception when others then null;
  end;
  begin
    delete from public.os_lab_workflows where not is_canonical;
    insert into wf_findings values ('W8: a keyless DELETE was accepted');
  exception when others then null;
  end;
  perform set_config('request.headers',
    json_build_object('x-app-key', 'workflow-gate-test-key')::text, true);

  -- ==== W9 the owner's non-canonical CRUD lands ============================
  begin
    insert into public.os_lab_workflows (name, stage_codes)
    values ('w9-route', array['S3','S5','S12']) returning id into v_own;
    update public.os_lab_workflows set name = 'w9-route-renamed' where id = v_own;
    select count(*) into v_count from public.os_lab_workflows
     where id = v_own and name = 'w9-route-renamed';
    if v_count <> 1 then
      insert into wf_findings values ('W9: the owner rename did not land');
    end if;
  exception when others then
    insert into wf_findings values ('W9 over-blocks: owner create/rename refused: ' || sqlerrm);
  end;

  -- ==== W10 deleting a ridden route drops the project to canonical NULL ====
  begin
    insert into public.os_lab_projects (name, research_question, workflow_id)
    values ('t-wf-project', 'route test', v_own) returning id into v_project;
    delete from public.os_lab_workflows where id = v_own;
    select workflow_id into v_workflow_id from public.os_lab_projects where id = v_project;
    if v_workflow_id is not null then
      insert into wf_findings values ('W10: deleting the route left the project pointing at ' || v_workflow_id);
    end if;
  exception when others then
    insert into wf_findings values ('W10: route delete under a riding project failed: ' || sqlerrm);
  end;

  -- ==== W11 workflows weaken NO gate =======================================
  -- Put the project on a route that OMITS S5, then try to approve a claim
  -- standing on an IND datapoint. G-CLAIM must refuse exactly as before —
  -- the gate never reads the route.
  begin
    select id into v_workflow_id from public.os_lab_workflows where name = 'Sapuan literatur';
    update public.os_lab_projects set workflow_id = v_workflow_id where id = v_project;

    insert into public.os_lab_source_documents (title, doc_type, local_snapshot_path)
    values ('t-wf-source', 'government_report', 'snapshots/t-wf.pdf') returning id into v_source;
    insert into public.os_lab_datapoints
      (value, definition_scope, source_document_id, locator, volatility_class, extraction_method)
    values (7, 'a definition scope long enough for the gate', v_source, 'p.7', 'static', 'manual')
    returning id into v_dp;
    insert into public.os_lab_claims (project_id, statement, layer, evidence_direction, status, inference_step)
    values (v_project, 'claim over an IND datapoint', 'B', 'supports', 'draft',
            'the matched figure sits under the cap on the same basis')
    returning id into v_claim;
    insert into public.os_lab_claim_datapoints (claim_id, datapoint_id) values (v_claim, v_dp);

    begin
      update public.os_lab_claims set status = 'approved' where id = v_claim;
      insert into wf_findings values ('W11: a route omitting S5 let an IND-backed claim approve — a workflow weakened G-CLAIM');
    exception when others then
      v_msg := sqlerrm;
      if v_msg not like '%not source-matched%' then
        insert into wf_findings values ('W11: refused, but not by G-CLAIM''s datapoint arm: ' || v_msg);
      end if;
    end;
  exception when others then
    insert into wf_findings values ('W11: fixture failed: ' || sqlerrm);
  end;

  -- restore the real hash inside the transaction (rollback restores it
  -- anyway; this keeps the suite safe even if someone edits the tail).
  update private.os_app_secret set key_hash = old_hash;
end
$$;

select * from wf_findings;

rollback;
