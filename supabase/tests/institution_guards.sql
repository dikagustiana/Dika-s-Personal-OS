-- ===========================================================================
-- INSTITUTION GUARDS — attempted violations against a real Postgres.
-- ===========================================================================
-- House convention: ZERO ROWS RETURNED MEANS HEALTHY. Every row names what
-- broke. Two identities, as in lab_epistemic_gates.sql: OWNER (the director,
-- x-app-key present) and AGENT (superuser with no key — the executor's
-- service role with the application layer bypassed).
--
-- Each case ATTEMPTS the violation and records a failure when the database
-- does not refuse it (or refuses what it should permit). An "audit inert"
-- floor at the end fails the suite if fewer cases ran than are written here,
-- so a broken harness cannot read as healthy.
-- One transaction, rolled back at the end: the suite leaves no trace and can
-- be re-run on the same cluster (the negative control does exactly that).
begin;
create temp table inst_failures (check_name text, detail text);
create temp table inst_counter (n int);
insert into inst_counter values (0);

create or replace function pg_temp.expect_fail(p_check text, p_sql text, p_msg_like text)
returns void language plpgsql as $$
begin
  update inst_counter set n = n + 1;
  begin
    execute p_sql;
    insert into inst_failures values (p_check, 'PERMITTED (expected refusal matching "' || p_msg_like || '")');
  exception when others then
    if sqlerrm not ilike '%' || p_msg_like || '%' then
      insert into inst_failures values (p_check, 'refused for the wrong reason: ' || sqlerrm);
    end if;
  end;
end $$;

create or replace function pg_temp.expect_ok(p_check text, p_sql text)
returns void language plpgsql as $$
begin
  update inst_counter set n = n + 1;
  begin
    execute p_sql;
  exception when others then
    insert into inst_failures values (p_check, 'REFUSED (expected permitted): ' || sqlerrm);
  end;
end $$;

create or replace function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('request.headers', json_build_object('x-app-key', 'inst-test-key')::text, true);
  perform set_config('request.jwt.claims', '{}', true);
end $$;
create or replace function pg_temp.as_agent() returns void language plpgsql as $$
begin
  perform set_config('request.headers', '{}', true);
end $$;

do $$
declare
  v_framer uuid; v_scout uuid; v_literature uuid; v_committee uuid; v_lead uuid;
  v_proposal uuid; v_self uuid; v_before text; v_after text; v_ver_before int; v_ver_after int;
  v_dept uuid; v_dept2 uuid; v_brief uuid; v_brief_int uuid; v_assign uuid; v_assign2 uuid;
  v_corpus_int uuid; v_corpus_pub uuid; v_eval uuid; v_evalrun uuid; v_score numeric; v_review uuid;
  v_hash text; v_n int; v_txt text;
  v_fn text; v_role text; v_expect boolean;
begin
  -- ==== identities =========================================================
  update private.os_app_secret set key_hash = extensions.crypt('inst-test-key', extensions.gen_salt('bf'));
  perform pg_temp.as_owner();

  select id into v_framer from public.os_lab_agents where slug = 'evidence-framer';
  select id into v_scout from public.os_lab_agents where slug = 'evidence-scout';
  select id into v_literature from public.os_lab_agents where slug = 'evidence-literature';
  select id into v_dept from public.os_inst_departments where slug = 'framing-office';
  select id into v_dept2 from public.os_inst_departments where slug = 'methodology-desk';

  -- ==== seed sanity ========================================================
  select count(*) into v_n from public.os_inst_departments;
  if v_n <> 10 then insert into inst_failures values ('seed departments', 'expected 10 rows, found ' || v_n); end if;
  select count(*) into v_n from public.os_lab_agents a where not exists (select 1 from public.os_inst_department_members m where m.agent_slug = a.slug);
  if v_n <> 0 then insert into inst_failures values ('seed seats', v_n || ' agent(s) have no seat (orphaned)'); end if;
  select count(*) into v_n from public.os_inst_department_members m where m.agent_slug in ('consolidation-reporting','financial-modeling','verify-financial-model','deck-narrative-drafter')
     and exists (select 1 from public.os_lab_agents a where a.slug = m.agent_slug);
  if v_n <> 0 then insert into inst_failures values ('seed phantoms', 'a phantom seat already has an agent row'); end if;
  select count(*) into v_n from public.os_lab_agents a where not exists (select 1 from public.os_inst_agent_versions v where v.agent_id = a.id and v.status = 'active');
  if v_n <> 0 then insert into inst_failures values ('seed version backfill', v_n || ' agent(s) without an active version'); end if;
  select count(*) into v_n from public.os_lab_agents a join public.os_lab_providers p on p.id = a.default_provider_id where a.data_class = 'internal' and p.name <> 'anthropic';
  if v_n <> 0 then insert into inst_failures values ('seed lanes', v_n || ' internal agent(s) not on Anthropic'); end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name like '%rubric%') then
    insert into inst_failures values ('B-9 rubric location', 'a rubric table is exposed in the public schema');
  end if;

  -- ==== B-1: the live prompt ===============================================
  perform pg_temp.as_agent();
  perform pg_temp.expect_fail('B-1 agent direct prompt update',
    format('update public.os_lab_agents set system_prompt = system_prompt || '' x'' where id = %L', v_framer), 'B-1');
  perform pg_temp.as_owner();
  perform pg_temp.expect_fail('B-1 owner direct prompt update',
    format('update public.os_lab_agents set system_prompt = system_prompt || '' x'' where id = %L', v_framer), 'B-1');

  -- A proposal (agent-made) then promotion (director-only).
  perform pg_temp.as_agent();
  perform pg_temp.expect_fail('B-1 agent inserts an active version',
    format('insert into public.os_inst_agent_versions (agent_id, system_prompt, status, proposed_by, rationale, diff) values (%L, ''p'', ''active'', ''evidence-coordinator'', ''ten characters plus'', ''+p'')', v_framer), 'born proposed');
  perform pg_temp.expect_fail('B-1 proposal without rationale',
    format('insert into public.os_inst_agent_versions (agent_id, system_prompt, proposed_by, rationale, diff) values (%L, ''p'', ''evidence-coordinator'', ''short'', ''+p'')', v_framer), 'rationale');
  update inst_counter set n = n + 1;
  insert into public.os_inst_agent_versions (agent_id, system_prompt, proposed_by, rationale, diff)
    values (v_framer, 'You critique and reframe research questions. NEW VERSION FOR TEST.', 'framing-lead', 'Recurring weakness: framings omit the comparator.', '+NEW VERSION FOR TEST')
    returning id into v_proposal;
  perform pg_temp.expect_fail('B-1 agent promotes', format('select public.os_inst_version_promote(%L)', v_proposal), 'only the director');
  perform pg_temp.expect_fail('B-1 agent rejects', format('select public.os_inst_version_reject(%L, ''not good enough'')', v_proposal), 'only the director');
  select system_prompt, version into v_before, v_ver_before from public.os_lab_agents where id = v_framer;
  if v_before like '%NEW VERSION FOR TEST%' then insert into inst_failures values ('B-1 proposal is not live', 'the proposal text reached the live prompt before promotion'); end if;

  perform pg_temp.as_owner();
  perform pg_temp.expect_fail('B-1 owner edits a version row directly',
    format('update public.os_inst_agent_versions set rationale = ''edited'' where id = %L', v_proposal), 'B-1');
  perform pg_temp.expect_fail('B-1 delete a version row',
    format('delete from public.os_inst_agent_versions where id = %L', v_proposal), 'immutable');
  perform pg_temp.expect_ok('B-1 director promotes', format('select public.os_inst_version_promote(%L)', v_proposal));
  select system_prompt, version into v_after, v_ver_after from public.os_lab_agents where id = v_framer;
  if v_after not like '%NEW VERSION FOR TEST%' then insert into inst_failures values ('B-1 promotion writes the prompt', 'live prompt unchanged after promotion'); end if;
  if v_ver_after <> v_ver_before + 1 then insert into inst_failures values ('B-1 promotion bumps version', format('%s -> %s', v_ver_before, v_ver_after)); end if;
  select count(*) into v_n from public.os_inst_agent_versions where agent_id = v_framer and status = 'active';
  if v_n <> 1 then insert into inst_failures values ('B-1 one active version', v_n || ' active rows'); end if;
  select count(*) into v_n from public.os_inst_agent_versions where agent_id = v_framer and status = 'retired';
  if v_n <> 1 then insert into inst_failures values ('B-1 predecessor retired', v_n || ' retired rows'); end if;
  perform pg_temp.expect_fail('B-1 promote twice', format('select public.os_inst_version_promote(%L)', v_proposal), 'not proposed');
  perform pg_temp.expect_fail('B-1 reject needs a reason',
    format('select public.os_inst_version_reject((select id from public.os_inst_agent_versions where agent_id = %L and status = ''retired'' limit 1), ''x'')', v_framer), 'reason');

  -- ==== B-2: the committee's prompt =========================================
  -- Seeded by 20260910000106 as an internal-lane agent. The suite used to
  -- create a stand-in here; it now uses the real row, so what it tests is
  -- the committee the institution actually has. (If the seed is ever
  -- removed, the stand-in below keeps the B-2 cases running rather than
  -- silently skipping them, which would read as healthy.)
  select id into v_committee from public.os_lab_agents where slug = 'editorial-committee';
  if v_committee is null then
    insert into public.os_lab_agents (slug, name, description, system_prompt, data_class, default_provider_id)
      values ('editorial-committee', 'Editorial Committee (test stand-in)', 'test', 'You are the committee.', 'public', (select id from public.os_lab_providers where name = 'kimi'))
      returning id into v_committee;
    insert into inst_failures values ('B-2 committee seeded', 'no editorial-committee row; 20260910000106 did not run');
  end if;
  update inst_counter set n = n + 1;
  if not exists (select 1 from public.os_lab_agents where slug = 'editorial-committee' and data_class = 'internal') then
    insert into inst_failures values ('B-2 committee lane',
      'the committee is not internal; it cannot review an internal brief without handing SAMB figures to a public-lane agent');
  end if;
  update inst_counter set n = n + 1;
  if not exists (
    select 1 from public.os_inst_agent_versions v
    where v.agent_id = v_committee and v.status = 'active' and v.proposed_by = 'director'
  ) then
    insert into inst_failures values ('B-2 committee launch version',
      'the committee has no director-owned active version; its prompt history does not start anywhere');
  end if;
  perform pg_temp.as_agent();
  perform pg_temp.expect_fail('B-2 lead proposes against the committee',
    format('insert into public.os_inst_agent_versions (agent_id, system_prompt, proposed_by, proposed_by_agent_id, rationale, diff) values (%L, ''changed'', ''evidence-framer'', %L, ''the committee is too strict with framers'', ''+changed'')', v_committee, v_framer), 'B-2');
  perform pg_temp.expect_ok('B-2 committee self-proposal',
    format('insert into public.os_inst_agent_versions (agent_id, system_prompt, proposed_by, proposed_by_agent_id, rationale, diff) values (%L, ''changed by self'', ''editorial-committee'', %L, ''accepted rebuttal showed a blind spot'', ''+changed by self'')', v_committee, v_committee));

  -- ==== B-3: lane at birth ==================================================
  perform pg_temp.as_agent();
  perform pg_temp.expect_fail('B-3 agent creates an internal agent',
    'insert into public.os_lab_agents (slug, name, system_prompt, data_class, default_provider_id) values (''t-internal-by-agent'', ''t'', ''p'', ''internal'', (select id from public.os_lab_providers where name = ''anthropic''))', 'B-3');
  perform pg_temp.expect_ok('B-3 agent creates a public agent',
    format('insert into public.os_lab_agents (slug, name, system_prompt, data_class, default_provider_id, authored_by_agent_id) values (''t-public-by-agent'', ''t'', ''p'', ''public'', (select id from public.os_lab_providers where name = ''kimi''), %L)', v_framer));
  -- AUDIT: 20260830 (lab_public_lane_guards) already freezes data_class after
  -- insert for everyone, so re-laning is delete-and-recreate by the director;
  -- that older guard fires first and is the one this case expects.
  perform pg_temp.expect_fail('B-3 agent re-lanes an agent to internal',
    'update public.os_lab_agents set data_class = ''internal'', default_provider_id = (select id from public.os_lab_providers where name = ''anthropic'') where slug = ''t-public-by-agent''', 'frozen');
  perform pg_temp.as_owner();
  perform pg_temp.expect_fail('B-3 director creates an internal agent attributed to an agent author',
    format('insert into public.os_lab_agents (slug, name, system_prompt, data_class, default_provider_id, authored_by_agent_id) values (''t-internal-authored'', ''t'', ''p'', ''internal'', (select id from public.os_lab_providers where name = ''anthropic''), %L)', v_framer), 'B-3');
  perform pg_temp.expect_ok('B-3 director creates an internal agent',
    'insert into public.os_lab_agents (slug, name, system_prompt, data_class, default_provider_id) values (''t-internal-by-director'', ''t'', ''p'', ''internal'', (select id from public.os_lab_providers where name = ''anthropic''))');
  perform pg_temp.expect_fail('B-3 authorship frozen',
    format('update public.os_lab_agents set authored_by_agent_id = %L where slug = ''t-internal-by-director''', v_framer), 'frozen');

  -- ==== data_class propagation (corpus) =====================================
  perform pg_temp.as_agent();
  insert into public.os_inst_briefs (question, data_class) values ('t public brief question', 'public') returning id into v_brief;
  insert into public.os_inst_briefs (question, data_class) values ('t internal brief question', 'internal') returning id into v_brief_int;
  v_hash := encode(sha256(convert_to('internal text', 'UTF8')), 'hex');
  perform pg_temp.expect_fail('corpus hash must verify',
    format('insert into public.os_inst_corpus (kind, title, data_class, content, content_hash) values (''retrieval'', ''t'', ''public'', ''internal text'', %L)', repeat('0', 64)), 'content_hash');
  update inst_counter set n = n + 1;
  insert into public.os_inst_corpus (kind, title, data_class, content, content_hash, brief_id)
    values ('dataset', 't internal dataset', 'internal', 'internal text', v_hash, v_brief_int) returning id into v_corpus_int;
  v_hash := encode(sha256(convert_to('derived', 'UTF8')), 'hex');
  perform pg_temp.expect_fail('data_class: public derived from internal',
    format('insert into public.os_inst_corpus (kind, title, data_class, content, content_hash, derived_from) values (''output'', ''t'', ''public'', ''derived'', %L, array[%L]::uuid[])', v_hash, v_corpus_int), 'derives from an internal');
  perform pg_temp.expect_fail('data_class: public produced by an internal agent',
    format('insert into public.os_inst_corpus (kind, title, data_class, content, content_hash, created_by_agent_id) values (''output'', ''t'', ''public'', ''derived'', %L, %L)', v_hash, v_framer), 'internal agent');
  perform pg_temp.expect_fail('data_class: public output on an internal brief',
    format('insert into public.os_inst_corpus (kind, title, data_class, content, content_hash, brief_id) values (''output'', ''t'', ''public'', ''derived'', %L, %L)', v_hash, v_brief_int), 'internal brief');
  perform pg_temp.expect_ok('data_class: internal derived from internal',
    format('insert into public.os_inst_corpus (kind, title, data_class, content, content_hash, derived_from) values (''output'', ''t'', ''internal'', ''derived'', %L, array[%L]::uuid[])', v_hash, v_corpus_int));
  v_hash := encode(sha256(convert_to('public text', 'UTF8')), 'hex');
  update inst_counter set n = n + 1;
  insert into public.os_inst_corpus (kind, title, data_class, content, content_hash, brief_id, created_by_agent_id)
    values ('retrieval', 't public retrieval', 'public', 'public text', v_hash, v_brief, v_scout) returning id into v_corpus_pub;
  perform pg_temp.expect_fail('corpus content frozen',
    format('update public.os_inst_corpus set content = ''edited'' where id = %L', v_corpus_pub), 'frozen');
  perform pg_temp.expect_ok('corpus review_status may change',
    format('update public.os_inst_corpus set review_status = ''peer_cleared'' where id = %L', v_corpus_pub));
  perform pg_temp.expect_fail('brief cannot leave the internal lane',
    format('update public.os_inst_briefs set data_class = ''public'' where id = %L', v_brief_int), 'cannot become public');

  -- ==== reviews: never by the author; leads and committee ===================
  insert into public.os_inst_assignments (brief_id, department_id, agent_id, agent_slug, kind, status, input)
    values (v_brief, v_dept, v_framer, 'evidence-framer', 'specialist_work', 'peer_review', 't') returning id into v_assign;
  perform pg_temp.expect_fail('1-A peer review by its author',
    format('insert into public.os_inst_reviews (brief_id, kind, reviewer_agent_id, subject_assignment_id, verdict) values (%L, ''peer'', %L, %L, ''accept'')', v_brief, v_framer, v_assign), 'own author');
  perform pg_temp.expect_ok('1-A peer review by a sibling',
    format('insert into public.os_inst_reviews (brief_id, kind, reviewer_agent_id, subject_assignment_id, verdict) values (%L, ''peer'', %L, %L, ''accept'')', v_brief, v_scout, v_assign));
  perform pg_temp.expect_fail('1-A lead review by a non-lead',
    format('insert into public.os_inst_reviews (brief_id, kind, reviewer_agent_id, subject_assignment_id, verdict) values (%L, ''lead'', %L, %L, ''accept'')', v_brief, v_scout, v_assign), 'by its lead');
  perform pg_temp.as_owner();
  insert into public.os_lab_agents (slug, name, system_prompt, data_class, default_provider_id)
    values ('framing-lead', 'Framing Lead (test stand-in)', 'p', 'public', (select id from public.os_lab_providers where name = 'kimi')) returning id into v_lead;
  perform pg_temp.as_agent();
  perform pg_temp.expect_ok('1-A lead review by the lead',
    format('insert into public.os_inst_reviews (brief_id, kind, reviewer_agent_id, subject_assignment_id, verdict) values (%L, ''lead'', %L, %L, ''rework'')', v_brief, v_lead, v_assign));
  perform pg_temp.expect_fail('1-D committee review by a non-committee agent',
    format('insert into public.os_inst_reviews (brief_id, kind, reviewer_agent_id, subject_assignment_id, verdict) values (%L, ''committee'', %L, %L, ''accept'')', v_brief, v_scout, v_assign), 'by the committee');
  perform pg_temp.expect_ok('1-D committee review by the committee',
    format('insert into public.os_inst_reviews (brief_id, kind, reviewer_agent_id, subject_assignment_id, verdict) values (%L, ''committee'', %L, %L, ''accept'')', v_brief, v_committee, v_assign));
  select id into v_review from public.os_inst_reviews where kind = 'committee' and subject_assignment_id = v_assign limit 1;
  perform pg_temp.expect_fail('1-D committee cannot rebut',
    format('insert into public.os_inst_debates (brief_id, review_id, rebutting_agent_id, rebuttal) values (%L, %L, %L, ''x'')', v_brief, v_review, v_committee), 'does not file');
  perform pg_temp.expect_ok('1-D a reviewed party rebuts',
    format('insert into public.os_inst_debates (brief_id, review_id, rebutting_agent_id, rebuttal) values (%L, %L, %L, ''the finding misreads the scope note'')', v_brief, v_review, v_framer));

  -- ==== B-5 bounds ==========================================================
  perform pg_temp.expect_fail('B-5 rework beyond 2',
    format('update public.os_inst_assignments set rework_count = 3 where id = %L', v_assign), 'check');
  perform pg_temp.expect_fail('B-5 review round beyond 2',
    format('insert into public.os_inst_reviews (brief_id, kind, reviewer_agent_id, subject_assignment_id, verdict, round) values (%L, ''peer'', %L, %L, ''accept'', 3)', v_brief, v_scout, v_assign), 'check');
  perform pg_temp.expect_fail('B-5 submission returns beyond 2',
    format('insert into public.os_inst_submissions (brief_id, from_department_id, to_department_id, produced, return_count) values (%L, %L, %L, ''p'', 3)', v_brief, v_dept, v_dept2), 'check');
  perform pg_temp.expect_fail('B-5 debate round beyond 2',
    format('insert into public.os_inst_debates (brief_id, review_id, rebutting_agent_id, rebuttal, round) values (%L, %L, %L, ''x'', 3)', v_brief, v_review, v_framer), 'check');
  perform pg_temp.expect_fail('1-A submission to own department',
    format('insert into public.os_inst_submissions (brief_id, from_department_id, to_department_id, produced) values (%L, %L, %L, ''p'')', v_brief, v_dept, v_dept), 'own department');

  -- ==== B-9 evaluations =====================================================
  perform pg_temp.as_agent();
  perform pg_temp.expect_fail('B-9 agent writes an evaluation',
    'insert into public.os_inst_evaluations (slug, department_slug, task, expected_answer) values (''t-eval'', ''framing-office'', ''t'', ''t'')', 'B-9');
  perform pg_temp.expect_fail('B-9 agent edits an evaluation',
    'update public.os_inst_evaluations set task = ''changed'' where slug = ''eval-method-cagr''', 'B-9');
  perform pg_temp.expect_fail('B-9 agent reads a rubric',
    '
    select public.os_inst_eval_rubric((select id from public.os_inst_evaluations where slug = ''eval-method-cagr''))', 'director');
  select id into v_eval from public.os_inst_evaluations where slug = 'eval-reconcile-units';
  perform pg_temp.expect_fail('B-9 agent grades itself',
    format('insert into public.os_inst_evaluation_runs (evaluation_id, agent_id, phase, answer, score) values (%L, %L, ''before'', ''x'', 1)', v_eval, v_framer), 'B-9');
  update inst_counter set n = n + 1;
  insert into public.os_inst_evaluation_runs (evaluation_id, agent_id, phase, answer)
    values (v_eval, v_framer, 'before', 'They agree once units are aligned: 12.5 thousand tonnes is 12,500,000 kg.') returning id into v_evalrun;
  select public.os_inst_eval_score(v_evalrun) into v_score;
  if v_score is null or v_score < 0.99 then insert into inst_failures values ('B-9 scorer', 'expected 1.000 for a correct answer, got ' || coalesce(v_score::text, 'null')); end if;
  perform pg_temp.expect_fail('B-9 answer frozen',
    format('update public.os_inst_evaluation_runs set answer = ''edited'' where id = %L', v_evalrun), 'frozen');
  perform pg_temp.as_owner();
  perform pg_temp.expect_ok('B-9 director reads a rubric', format('select public.os_inst_eval_rubric(%L)', v_eval));
  perform pg_temp.expect_ok('B-9 director writes an evaluation',
    'insert into public.os_inst_evaluations (slug, department_slug, task, expected_answer) values (''t-eval-owner'', ''framing-office'', ''t'', ''t'')');

  -- ==== 1-E director decisions ==============================================
  perform pg_temp.as_agent();
  perform pg_temp.expect_fail('1-E agent decides a brief', format('select public.os_inst_brief_decide(%L, ''approved'', null)', v_brief), 'only the director');
  perform pg_temp.as_owner();
  perform pg_temp.expect_fail('1-E decision before the director''s room', format('select public.os_inst_brief_decide(%L, ''approved'', null)', v_brief), 'not reached');
  update public.os_inst_briefs set status = 'director' where id = v_brief;
  perform pg_temp.expect_fail('1-E rejection needs a reason', format('select public.os_inst_brief_decide(%L, ''rejected'', '''')', v_brief), 'reason');
  perform pg_temp.expect_fail('1-E publish before approve', format('select public.os_inst_brief_decide(%L, ''published'', null)', v_brief), 'approve before');
  perform pg_temp.expect_ok('1-E approve', format('select public.os_inst_brief_decide(%L, ''approved'', null)', v_brief));
  perform pg_temp.expect_ok('1-E publish', format('select public.os_inst_brief_decide(%L, ''published'', null)', v_brief));
  if not exists (select 1 from public.os_inst_events where brief_id = v_brief and kind = 'director.decided') then
    insert into inst_failures values ('1-E decision event', 'no director.decided event recorded');
  end if;
  perform pg_temp.expect_fail('events append-only (update)', 'update public.os_inst_events set kind = ''x'' where kind = ''director.decided''', 'append-only');
  perform pg_temp.expect_fail('events append-only (delete)', 'delete from public.os_inst_events where kind = ''director.decided''', 'append-only');

  -- ==== the director's write surface (104) ==================================
  -- 104 opened INSERT/UPDATE to the app-key holder on the pipeline's own
  -- bookkeeping, because the stepper is the director's client (D-12). Four
  -- tables stay closed: the corpus (or a draft becomes an output without
  -- passing the synthesize gate), the egress log (or a blocked call can be
  -- written out of history), the evaluation set and the rubrics (B-9).
  for v_role in select unnest(array['anon', 'authenticated']) loop
    for v_fn in select unnest(array['os_inst_corpus', 'os_inst_egress_blocks', 'os_inst_evaluations']) loop
      update inst_counter set n = n + 1;
      if has_table_privilege(v_role, 'public.' || v_fn, 'insert')
         or has_table_privilege(v_role, 'public.' || v_fn, 'update')
         or has_table_privilege(v_role, 'public.' || v_fn, 'delete') then
        insert into inst_failures values ('write surface ' || v_fn || ' -> ' || v_role,
          'a client role can write a table only the service role may write');
      end if;
    end loop;
    -- ...and the pipeline tables the stepper does need.
    for v_fn in select unnest(array['os_inst_briefs', 'os_inst_assignments', 'os_inst_reviews',
                                    'os_inst_submissions', 'os_inst_debates', 'os_inst_agent_versions',
                                    'os_inst_evaluation_runs', 'os_inst_events']) loop
      update inst_counter set n = n + 1;
      if not has_table_privilege(v_role, 'public.' || v_fn, 'insert') then
        insert into inst_failures values ('write surface ' || v_fn || ' -> ' || v_role,
          'the stepper cannot insert; the client-side pipeline cannot run');
      end if;
    end loop;
    -- A review or an event that can be edited afterwards is not a record.
    for v_fn in select unnest(array['os_inst_reviews', 'os_inst_events', 'os_inst_agent_versions']) loop
      update inst_counter set n = n + 1;
      if has_table_privilege(v_role, 'public.' || v_fn, 'update')
         or has_table_privilege(v_role, 'public.' || v_fn, 'delete') then
        insert into inst_failures values ('write surface ' || v_fn || ' -> ' || v_role,
          'a client role can rewrite a record that must be append-only');
      end if;
    end loop;
  end loop;

  -- The policies exist and are key-gated, not merely the grants.
  update inst_counter set n = n + 1;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename like 'os_inst_%'
      and cmd in ('INSERT', 'UPDATE', 'ALL')
      and coalesce(qual, '') || ' ' || coalesce(with_check, '') not like '%os_key_valid%'
  ) then
    insert into inst_failures values ('write policy', 'an institution write policy does not test os_key_valid()');
  end if;

  -- ==== grant model (102) ===================================================
  -- Supabase's default privileges (mirrored by scripts/lib/pg-cluster.sh)
  -- grant EXECUTE on every new public function to anon, authenticated and
  -- service_role as explicit per-role grants; `revoke ... from public` leaves
  -- them standing. Migration 100 did exactly that and the live check after
  -- applying it caught anon able to call os_inst_eval_score(). 102 revokes
  -- per role; this block keeps it so. Trigger functions and helpers: nobody.
  -- Director RPCs: anon + authenticated (key-checked inside). Scorer writes:
  -- service_role only — never anon, never authenticated.
  for v_fn, v_role, v_expect in
    select g.fn, g.role_name, g.allowed from (values
      ('public.os_inst_guc_on(text)',                         'anon', false), ('public.os_inst_guc_on(text)',                         'authenticated', false), ('public.os_inst_guc_on(text)',                         'service_role', false),
      ('public.os_inst_committee_slug()',                     'anon', false), ('public.os_inst_committee_slug()',                     'authenticated', false), ('public.os_inst_committee_slug()',                     'service_role', false),
      ('public.os_lab_agents_prompt_lock()',                  'anon', false), ('public.os_lab_agents_prompt_lock()',                  'authenticated', false), ('public.os_lab_agents_prompt_lock()',                  'service_role', false),
      ('public.os_lab_agents_lane_at_birth()',                'anon', false), ('public.os_lab_agents_lane_at_birth()',                'authenticated', false), ('public.os_lab_agents_lane_at_birth()',                'service_role', false),
      ('public.os_inst_agent_versions_guard()',               'anon', false), ('public.os_inst_agent_versions_guard()',               'authenticated', false), ('public.os_inst_agent_versions_guard()',               'service_role', false),
      ('public.os_inst_corpus_guard()',                       'anon', false), ('public.os_inst_corpus_guard()',                       'authenticated', false), ('public.os_inst_corpus_guard()',                       'service_role', false),
      ('public.os_inst_briefs_guard()',                       'anon', false), ('public.os_inst_briefs_guard()',                       'authenticated', false), ('public.os_inst_briefs_guard()',                       'service_role', false),
      ('public.os_inst_reviews_guard()',                      'anon', false), ('public.os_inst_reviews_guard()',                      'authenticated', false), ('public.os_inst_reviews_guard()',                      'service_role', false),
      ('public.os_inst_debates_guard()',                      'anon', false), ('public.os_inst_debates_guard()',                      'authenticated', false), ('public.os_inst_debates_guard()',                      'service_role', false),
      ('public.os_inst_submissions_guard()',                  'anon', false), ('public.os_inst_submissions_guard()',                  'authenticated', false), ('public.os_inst_submissions_guard()',                  'service_role', false),
      ('public.os_inst_evaluations_owner_guard()',            'anon', false), ('public.os_inst_evaluations_owner_guard()',            'authenticated', false), ('public.os_inst_evaluations_owner_guard()',            'service_role', false),
      ('public.os_inst_evaluation_runs_guard()',              'anon', false), ('public.os_inst_evaluation_runs_guard()',              'authenticated', false), ('public.os_inst_evaluation_runs_guard()',              'service_role', false),
      ('public.os_inst_events_guard()',                       'anon', false), ('public.os_inst_events_guard()',                       'authenticated', false), ('public.os_inst_events_guard()',                       'service_role', false),
      ('public.os_inst_version_promote(uuid)',                'anon', true),  ('public.os_inst_version_promote(uuid)',                'authenticated', true),  ('public.os_inst_version_promote(uuid)',                'service_role', false),
      ('public.os_inst_version_reject(uuid, text)',           'anon', true),  ('public.os_inst_version_reject(uuid, text)',           'authenticated', true),  ('public.os_inst_version_reject(uuid, text)',           'service_role', false),
      ('public.os_inst_eval_rubric(uuid)',                    'anon', true),  ('public.os_inst_eval_rubric(uuid)',                    'authenticated', true),  ('public.os_inst_eval_rubric(uuid)',                    'service_role', false),
      ('public.os_inst_brief_decide(uuid, text, text)',       'anon', true),  ('public.os_inst_brief_decide(uuid, text, text)',       'authenticated', true),  ('public.os_inst_brief_decide(uuid, text, text)',       'service_role', false),
      ('public.os_inst_eval_score(uuid)',                     'anon', false), ('public.os_inst_eval_score(uuid)',                     'authenticated', false), ('public.os_inst_eval_score(uuid)',                     'service_role', true),
      ('public.os_inst_version_set_eval(uuid, text, numeric)','anon', false), ('public.os_inst_version_set_eval(uuid, text, numeric)','authenticated', false), ('public.os_inst_version_set_eval(uuid, text, numeric)','service_role', true)
    ) as g(fn, role_name, allowed)
  loop
    update inst_counter set n = n + 1;
    if has_function_privilege(v_role, v_fn, 'execute') is distinct from v_expect then
      insert into inst_failures values ('grant ' || v_fn || ' -> ' || v_role,
        'expected execute=' || v_expect || ', found ' || has_function_privilege(v_role, v_fn, 'execute'));
    end if;
  end loop;
  -- The rubric table itself: no API role reaches private.*.
  for v_role in select unnest(array['anon', 'authenticated', 'service_role']) loop
    update inst_counter set n = n + 1;
    if has_schema_privilege(v_role, 'private', 'usage') or has_table_privilege(v_role, 'private.os_inst_evaluation_rubrics', 'select') then
      insert into inst_failures values ('grant private.os_inst_evaluation_rubrics -> ' || v_role, 'an API role can reach the rubric table');
    end if;
  end loop;

  -- ==== the director's scorer (106) ========================================
  -- B-9 needs a caller the client-side stepper can reach; 102 had granted
  -- the scorer to service_role alone, so before/after scoring had none.
  update inst_counter set n = n + 1;
  if not has_function_privilege('anon', 'public.os_inst_eval_score_owner(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.os_inst_eval_score_owner(uuid)', 'execute') then
    insert into inst_failures values ('grant os_inst_eval_score_owner', 'the director cannot score an evaluation run');
  end if;
  update inst_counter set n = n + 1;
  if has_function_privilege('service_role', 'public.os_inst_eval_score_owner(uuid)', 'execute') then
    insert into inst_failures values ('grant os_inst_eval_score_owner -> service_role', 'the stepper can reach the key-gated wrapper');
  end if;
  perform pg_temp.as_agent();
  select id into v_eval from public.os_inst_evaluations where slug = 'eval-method-cagr';
  insert into public.os_inst_evaluation_runs (evaluation_id, agent_id, phase, answer)
    values (v_eval, v_framer, 'baseline', 'CAGR is computed from start and end over a structural break.') returning id into v_evalrun;
  perform pg_temp.expect_fail('B-9 an agent calls the director''s scorer',
    format('select public.os_inst_eval_score_owner(%L)', v_evalrun), 'director');
  perform pg_temp.as_owner();
  perform pg_temp.expect_ok('B-9 the director scores a run', format('select public.os_inst_eval_score_owner(%L)', v_evalrun));
  update inst_counter set n = n + 1;
  if (select score from public.os_inst_evaluation_runs where id = v_evalrun) is null then
    insert into inst_failures values ('B-9 scorer wrote nothing', 'the wrapper returned without writing a score');
  end if;

  -- ==== the director attaches a score to a proposal (107) ===================
  perform pg_temp.as_agent();
  perform pg_temp.expect_fail('B-9 an agent attaches an eval score to a proposal',
    format('select public.os_inst_version_set_eval_owner(%L, ''before'', 0.9)', v_proposal), 'director');
  update inst_counter set n = n + 1;
  if has_function_privilege('service_role', 'public.os_inst_version_set_eval_owner(uuid, text, numeric)', 'execute') then
    insert into inst_failures values ('grant os_inst_version_set_eval_owner -> service_role', 'the stepper can reach the key-gated wrapper');
  end if;

  -- ==== seating an authored agent (106) =====================================
  update inst_counter set n = n + 1;
  if not has_table_privilege('anon', 'public.os_inst_department_members', 'insert') then
    insert into inst_failures values ('grant os_inst_department_members insert',
      'a lead can author a specialist and cannot seat it — an agent with no desk');
  end if;
  update inst_counter set n = n + 1;
  if has_table_privilege('anon', 'public.os_inst_department_members', 'update')
     or has_table_privilege('anon', 'public.os_inst_department_members', 'delete') then
    insert into inst_failures values ('grant os_inst_department_members write',
      'a client role can move or remove a seat; that is a migration');
  end if;

  -- ==== audit inert floor ===================================================
  select n into v_n from inst_counter;
  if v_n < 157 then insert into inst_failures values ('audit inert', 'only ' || v_n || ' checks ran; the suite is not exercising the guards'); end if;
end $$;

select check_name, detail from inst_failures order by check_name;
rollback;
