-- ===========================================================================
-- COLLABORATOR RLS VERIFICATION — the §9 matrix, executable and re-runnable.
-- ===========================================================================
-- Run the whole file in the Supabase SQL editor (or psql) as postgres.
-- EVERYTHING runs inside begin; … rollback; — the synthetic auth user, the
-- membership row, and every write are rolled back; production is untouched
-- and no fixture survives. Reaching the final select means every assertion
-- held: any failure raises and aborts the script instead.
--
-- This tests the POLICIES AND THE TRIGGER DIRECTLY, as the `authenticated`
-- role carrying a real JWT claim — the boundary that matters when a
-- contributor bypasses the UI and calls PostgREST with curl. The owner
-- passphrase path is deliberately NOT tested here: that would require the
-- passphrase, this file is committed, and the repo is public. The owner path
-- is covered by the §12 manual browser check and was validated in a
-- rolled-back transaction before the trigger migration was applied.
--
-- Counts are asserted by EQUALITY AGAINST LIVE DATA (member-visible count ==
-- postgres-computed expected count), not hardcoded, so the file stays
-- re-runnable as the matrix grows. At the run recorded in
-- docs/preflight-collab.md the concrete numbers were: 49 ASI cells, 21
-- work+samb projects.
--
-- The 16 cases (§9 of the task):
--   1  zero rows from every GROWTH table
--   2  zero rows from entries, daily logs, weekly plans, IELTS, research
--   3  cells: only entity_code='ASI', count matches ASI exactly
--   4  zero rows from os_finish_line_accounts
--   5  projects: only work+samb, zero internal
--   6  UPDATE ASI cell input→figure succeeds; contributor stamp; history row
--   7  UPDATE ASI cell input→zero/undefined/locked each rejected
--   8  UPDATE figure→input rejected
--   9  UPDATE a KNI cell → 0 rows (invisible)
--   10 UPDATE entity_code / item_id → rejected by allowlist
--   11 UPDATE any other non-allowlisted column → rejected; spoofed actor
--      value is overwritten by the trigger
--   12 INSERT/DELETE on cells, items, entities → rejected
--   13 any write to os_finish_line_accounts → rejected
--   14 any write to os_projects → rejected
--   15 UPDATE/DELETE on history → rejected, and zero UPDATE/DELETE policies
--      exist on it for anyone, including the owner
--   16 anon with no header: zero rows everywhere, writes rejected

begin;

do $$
declare
  test_uid constant uuid := 'a11ce000-5afe-4000-8000-c0113b000001';
  failures text[] := '{}';
  n bigint; expected bigint;
  cell_a uuid; kni_cell uuid; asi_item uuid;
  v_state text; v_ak text; v_actor uuid; v_ca timestamptz;
  tbl text;
  member_visible constant text[] := array[
    'os_finish_line_cells','os_finish_line_items','os_finish_line_entities',
    'os_finish_line_account_map','os_finish_line_deps','os_finish_line_item_projects',
    'os_projects','os_entity_members'];
begin
  -- ===== fixture, as postgres: synthetic user + ASI membership ==============
  insert into auth.users (id, instance_id, aud, role, email)
  values (test_uid, '00000000-0000-0000-0000-000000000000',
          'authenticated', 'authenticated', 'rls-selftest@example.invalid');
  insert into public.os_entity_members (user_id, entity_code)
  values (test_uid, 'ASI');

  select id, item_id into cell_a, asi_item
    from public.os_finish_line_cells
   where entity_code = 'ASI' and state = 'input'
   order by id limit 1;
  select id into kni_cell
    from public.os_finish_line_cells
   where entity_code = 'KNI' order by id limit 1;
  if cell_a is null or kni_cell is null then
    raise exception 'fixture: needed an ASI input cell and a KNI cell';
  end if;

  -- Identity GUCs: a real contributor JWT, no owner header.
  perform set_config('request.headers', '{}', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', test_uid, 'role', 'authenticated')::text, true);

  -- ===== cases 1 + 2 + 4: zero rows from everything not member-visible =====
  execute 'set local role authenticated';
  for tbl in
    select tablename from pg_tables
    where schemaname = 'public' and tablename like 'os\_%'
      and tablename <> all (member_visible)
  loop
    execute format('select count(*) from public.%I', tbl) into n;
    if n <> 0 then
      failures := failures || format('case 1/2/4: %s returned % rows for a member', tbl, n);
    end if;
  end loop;
  raise notice 'cases 1/2/4: GROWTH, entries/logs/plans, accounts, history all empty for member';

  -- os_entity_members: exactly the one own row
  select count(*) into n from public.os_entity_members;
  if n <> 1 then failures := failures || format('membership self-select: expected 1 row, got %', n); end if;

  -- ===== case 3: cells are exactly ASI's =====
  execute 'reset role';
  select count(*) into expected from public.os_finish_line_cells where entity_code = 'ASI';
  execute 'set local role authenticated';
  select count(*) into n from public.os_finish_line_cells;
  if n <> expected then failures := failures || format('case 3: member sees % cells, ASI has %', n, expected); end if;
  select count(*) into n from public.os_finish_line_cells where entity_code <> 'ASI';
  if n <> 0 then failures := failures || format('case 3: % non-ASI cells visible', n); end if;
  raise notice 'case 3: member sees exactly % ASI cells', expected;

  -- ===== case 5: projects = work & samb only =====
  execute 'reset role';
  select count(*) into expected from public.os_projects where domain = 'work' and engagement = 'samb';
  execute 'set local role authenticated';
  select count(*) into n from public.os_projects;
  if n <> expected then failures := failures || format('case 5: member sees % projects, expected %', n, expected); end if;
  select count(*) into n from public.os_projects where not (domain = 'work' and engagement = 'samb');
  if n <> 0 then failures := failures || format('case 5: % out-of-scope projects visible', n); end if;
  raise notice 'case 5: member sees exactly % work+samb projects, zero internal/growth', expected;

  -- ===== case 7 first, while cell_a is still input: forbidden targets ======
  foreach v_state in array array['zero','undefined','locked'] loop
    begin
      execute format('update public.os_finish_line_cells set state = %L where id = %L', v_state, cell_a);
      failures := failures || format('case 7: input -> %s was allowed', v_state);
    exception when others then
      if sqlerrm not like '%input to figure%' then
        failures := failures || format('case 7: input -> %s rejected by the wrong layer: %s', v_state, sqlerrm);
      end if;
    end;
  end loop;
  raise notice 'case 7: input -> zero/undefined/locked all rejected by the trigger';

  -- ===== case 6: the allowed transition =====
  update public.os_finish_line_cells set state = 'figure' where id = cell_a;
  get diagnostics n = row_count;
  if n <> 1 then failures := failures || format('case 6: expected 1 row updated, got %', n); end if;
  execute 'reset role';
  select state, actor_kind, actor, changed_at into v_state, v_ak, v_actor, v_ca
    from public.os_finish_line_cells where id = cell_a;
  if v_state <> 'figure' or v_ak <> 'contributor' or v_actor is distinct from test_uid or v_ca is null then
    failures := failures || format('case 6: stamp wrong (state=%s actor_kind=%s actor=%s changed_at=%s)', v_state, v_ak, v_actor, v_ca);
  end if;
  select count(*) into n from public.os_finish_line_cell_history
   where cell_id = cell_a and from_state = 'input' and to_state = 'figure'
     and actor_kind = 'contributor' and actor = test_uid;
  if n <> 1 then failures := failures || format('case 6: expected 1 history row, got %', n); end if;
  raise notice 'case 6: input -> figure succeeded; actor stamped; history row written';
  execute 'set local role authenticated';

  -- ===== case 8: backward move rejected =====
  begin
    update public.os_finish_line_cells set state = 'input' where id = cell_a;
    failures := failures || 'case 8: figure -> input was allowed';
  exception when others then
    if sqlerrm not like '%input to figure%' then
      failures := failures || format('case 8: rejected by the wrong layer: %s', sqlerrm);
    end if;
  end;
  raise notice 'case 8: figure -> input rejected';

  -- ===== case 9: KNI cell invisible to an ASI member =====
  update public.os_finish_line_cells set note = 'cross-entity attempt' where id = kni_cell;
  get diagnostics n = row_count;
  if n <> 0 then failures := failures || format('case 9: KNI update touched % rows', n); end if;
  raise notice 'case 9: KNI cell update matched 0 rows';

  -- ===== case 10: entity_code / item_id changes rejected =====
  begin
    update public.os_finish_line_cells set entity_code = 'KNI' where id = cell_a;
    failures := failures || 'case 10: entity_code change was allowed';
  exception when others then
    if sqlerrm not like '%contributors may only change%' then
      failures := failures || format('case 10: entity_code rejected by wrong layer: %s', sqlerrm);
    end if;
  end;
  begin
    update public.os_finish_line_cells set item_id = gen_random_uuid() where id = cell_a;
    failures := failures || 'case 10: item_id change was allowed';
  exception when others then
    if sqlerrm not like '%contributors may only change%' then
      failures := failures || format('case 10: item_id rejected by wrong layer: %s', sqlerrm);
    end if;
  end;
  raise notice 'case 10: entity_code and item_id changes rejected by allowlist';

  -- ===== case 11: any other non-allowlisted column; spoofed actor stomped ===
  begin
    update public.os_finish_line_cells set id = gen_random_uuid() where id = cell_a;
    failures := failures || 'case 11: id change was allowed';
  exception when others then
    if sqlerrm not like '%contributors may only change%' then
      failures := failures || format('case 11: id rejected by wrong layer: %s', sqlerrm);
    end if;
  end;
  update public.os_finish_line_cells
     set actor = '00000000-0000-4000-8000-00000000dead', note = 'actor spoof check'
   where id = cell_a;
  execute 'reset role';
  select actor into v_actor from public.os_finish_line_cells where id = cell_a;
  if v_actor is distinct from test_uid then
    failures := failures || format('case 11: spoofed actor survived as %', v_actor);
  end if;
  execute 'set local role authenticated';
  raise notice 'case 11: non-allowlisted column rejected; client-supplied actor overwritten by trigger';

  -- ===== case 12: INSERT / DELETE on cells, items, entities =====
  begin
    insert into public.os_finish_line_cells (item_id, entity_code, state, actor_kind)
    values (asi_item, 'ASI', 'input', 'owner');
    failures := failures || 'case 12: cell INSERT was allowed';
  exception when others then
    if sqlstate <> '42501' then failures := failures || format('case 12: cell INSERT failed as %s (%s), not RLS', sqlstate, sqlerrm); end if;
  end;
  delete from public.os_finish_line_cells where id = cell_a;
  get diagnostics n = row_count;
  if n <> 0 then failures := failures || 'case 12: cell DELETE touched rows'; end if;
  begin
    insert into public.os_finish_line_items (item, kind, sort_order)
    values ('rls-test-item', 'note', 9999);
    failures := failures || 'case 12: item INSERT was allowed';
  exception when others then
    if sqlstate <> '42501' then failures := failures || format('case 12: item INSERT failed as %s, not RLS', sqlstate); end if;
  end;
  delete from public.os_finish_line_items where item = 'rls-test-item';
  get diagnostics n = row_count;
  if n <> 0 then failures := failures || 'case 12: item DELETE touched rows'; end if;
  begin
    insert into public.os_finish_line_entities (code, label, sort_order)
    values ('ZZRLS', 'rls test', 9999);
    failures := failures || 'case 12: entity INSERT was allowed';
  exception when others then
    if sqlstate <> '42501' then failures := failures || format('case 12: entity INSERT failed as %s, not RLS', sqlstate); end if;
  end;
  delete from public.os_finish_line_entities where code = 'ASI';
  get diagnostics n = row_count;
  if n <> 0 then failures := failures || 'case 12: entity DELETE touched rows'; end if;
  raise notice 'case 12: INSERT rejected (42501) and DELETE matched 0 rows on cells/items/entities';

  -- ===== case 13: accounts fully closed =====
  begin
    insert into public.os_finish_line_accounts (account_name) values ('rls test account');
    failures := failures || 'case 13: account INSERT was allowed';
  exception when others then
    if sqlstate <> '42501' then failures := failures || format('case 13: account INSERT failed as %s, not RLS', sqlstate); end if;
  end;
  update public.os_finish_line_accounts set notes = 'x' where true;
  get diagnostics n = row_count;
  if n <> 0 then failures := failures || 'case 13: account UPDATE touched rows'; end if;
  delete from public.os_finish_line_accounts where true;
  get diagnostics n = row_count;
  if n <> 0 then failures := failures || 'case 13: account DELETE touched rows'; end if;
  raise notice 'case 13: accounts reject INSERT and match 0 rows for UPDATE/DELETE';

  -- ===== case 14: projects read-only =====
  begin
    insert into public.os_projects (domain, title, type, status, sort_order, milestones, engagement)
    values ('work', 'rls test project', 'other', 'active', 9999, '[]', 'samb');
    failures := failures || 'case 14: project INSERT was allowed';
  exception when others then
    if sqlstate <> '42501' then failures := failures || format('case 14: project INSERT failed as %s, not RLS', sqlstate); end if;
  end;
  update public.os_projects set title = title || '!' where true;
  get diagnostics n = row_count;
  if n <> 0 then failures := failures || 'case 14: project UPDATE touched rows'; end if;
  delete from public.os_projects where true;
  get diagnostics n = row_count;
  if n <> 0 then failures := failures || 'case 14: project DELETE touched rows'; end if;
  raise notice 'case 14: projects reject INSERT and match 0 rows for UPDATE/DELETE';

  -- ===== case 15: history append-only =====
  begin
    insert into public.os_finish_line_cell_history (cell_id, actor_kind) values (cell_a, 'owner');
    failures := failures || 'case 15: history INSERT was allowed';
  exception when others then
    if sqlstate <> '42501' then failures := failures || format('case 15: history INSERT failed as %s, not RLS', sqlstate); end if;
  end;
  update public.os_finish_line_cell_history set note_changed = true where true;
  get diagnostics n = row_count;
  if n <> 0 then failures := failures || 'case 15: history UPDATE touched rows'; end if;
  delete from public.os_finish_line_cell_history where true;
  get diagnostics n = row_count;
  if n <> 0 then failures := failures || 'case 15: history DELETE touched rows'; end if;
  execute 'reset role';
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'os_finish_line_cell_history'
     and cmd in ('UPDATE', 'DELETE');
  if n <> 0 then failures := failures || format('case 15: % UPDATE/DELETE policies exist on history — append-only broken', n); end if;
  raise notice 'case 15: history append-only holds; zero UPDATE/DELETE policies exist for anyone';

  -- ===== case 16: anon with no header, no claims =====
  perform set_config('request.jwt.claims', '{}', true);
  execute 'set local role anon';
  for tbl in
    select tablename from pg_tables where schemaname = 'public' and tablename like 'os\_%'
  loop
    execute format('select count(*) from public.%I', tbl) into n;
    if n <> 0 then failures := failures || format('case 16: anon read % rows from %s', n, tbl); end if;
  end loop;
  begin
    insert into public.os_finish_line_entities (code, label, sort_order) values ('ZZANON', 'x', 9998);
    failures := failures || 'case 16: anon entity INSERT was allowed';
  exception when others then
    if sqlstate <> '42501' then failures := failures || format('case 16: anon INSERT failed as %s, not RLS', sqlstate); end if;
  end;
  update public.os_finish_line_cells set note = 'anon' where true;
  get diagnostics n = row_count;
  if n <> 0 then failures := failures || 'case 16: anon UPDATE touched rows'; end if;
  delete from public.os_projects where true;
  get diagnostics n = row_count;
  if n <> 0 then failures := failures || 'case 16: anon DELETE touched rows'; end if;
  execute 'reset role';
  raise notice 'case 16: anon sees zero rows everywhere; writes rejected';

  -- ===== verdict =====
  if array_length(failures, 1) is not null then
    raise exception E'RLS VERIFICATION FAILED — % problem(s):\n%',
      array_length(failures, 1), array_to_string(failures, E'\n');
  end if;
  raise notice 'ALL 16 CASES PASSED';
end
$$;

rollback;

select 'collab_rls: all 16 cases passed; transaction rolled back, no fixture survives' as result;
