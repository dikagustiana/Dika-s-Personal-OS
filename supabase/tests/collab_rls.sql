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
-- contributor bypasses the UI and calls PostgREST with curl. The REAL owner
-- passphrase never appears here: this file is committed and the repo is
-- public. The 16-case block leaves the owner path to the manual browser
-- check; the slice-1 block's case 15 exercises it with a TRANSACTION-LOCAL
-- THROWAWAY key (hash swapped in, original restored, all rolled back), which
-- proves the owner branch without carrying any credential.
--
-- Counts are asserted by EQUALITY AGAINST LIVE DATA (member-visible count ==
-- postgres-computed expected count), not hardcoded, so the file stays
-- re-runnable as the matrix grows. At the run recorded in
-- docs/preflight-collab.md the concrete numbers were: 49 ASI cells, 21
-- work+samb projects. (Since slice 1 the project count for this identity is
-- asserted as ZERO — see case 5.)
--
-- SINCE 20260904000095 (finish_line_grants) membership is the enrolment and
-- os_finish_line_grants is the scope. Each synthetic member below is given a
-- WRITE grant on every section of its entity — exactly what the backfill gave
-- every live member — and two consequences run through the file: the cells a
-- member reads are the entity's SECTIONED cells (the parentless metrics are
-- owner-only, D4), and os_finish_line_accounts is no longer closed to members
-- (the accounts under readable cells plus the entity's unmapped ones, D3).
-- Cases 17-20 exercise the grant model itself. The file also runs on the
-- throwaway cluster now, through scripts/grant-scope-tests.sh, with
-- fixtures/collab_rls_fixture.sql supplying the projects and the KNI cell.
--
-- The 16 cases (§9 of the task), plus the four grant-model cases from 095:
--   1  zero rows from every GROWTH table
--   2  zero rows from entries, daily logs, weekly plans, IELTS, research
--   3  REWRITTEN AT 095: cells are exactly the ASI cells whose metric sits
--      under a section — every section is granted, so that is every ASI
--      cell except the parentless metrics' (D4), which must be invisible
--   4  REWRITTEN AT 095: accounts are no longer closed — the count equals
--      the accounts under readable cells plus the unmapped ASI accounts
--      (D3), and nothing of another entity or of no entity
--   5  REWRITTEN AT SLICE 1: this identity holds an entity grant and no
--      project grant, so it now sees ZERO projects — the engagement-based
--      policy this case used to describe was replaced in 20260804000045
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
--   17 a READ grant on cell_a's section: the cell still reads, UPDATE matches
--      0 rows; restoring write writes again
--   18 revoking that section removes its cells (and their accounts); the
--      rest stays; re-granting restores the count
--   19 membership with no grant at all: 0 cells, 0 accounts, UPDATE matches
--      0 rows; the own membership row and the item structure still read
--   20 a member cannot INSERT a grant row (42501); the section guard refuses
--      a grant naming a metric (23514), RLS off

begin;

do $$
declare
  test_uid constant uuid := 'a11ce000-5afe-4000-8000-c0113b000001';
  failures text[] := '{}';
  n bigint; expected bigint; cells_expected bigint; orphan bigint; under_sec bigint;
  cell_a uuid; kni_cell uuid; asi_item uuid; sec_a uuid;
  v_state text; v_ak text; v_actor uuid; v_ca timestamptz;
  tbl text;
  member_visible constant text[] := array[
    'os_finish_line_cells','os_finish_line_items','os_finish_line_entities',
    'os_finish_line_account_map','os_finish_line_deps','os_finish_line_item_projects',
    'os_projects','os_entity_members',
    -- since 095: accounts follow the grant (case 4), and a member reads
    -- their own grant rows
    'os_finish_line_accounts','os_finish_line_grants',
    -- member-visible since 20260806000058 (own-entity rows) and 054
    -- (references, for any member). An ASI member reads zero own-entity
    -- process rows on live only because no ASI process is seeded; the
    -- references table has carried a row every member can read, so this
    -- block was red against live until these nine were listed.
    'os_process_forms','os_process_gates','os_process_lanes','os_process_needs',
    'os_process_phases','os_process_references','os_process_step_items',
    'os_process_steps','os_process_tracks'];
begin
  -- ===== fixture, as postgres: synthetic user + ASI membership + grants =====
  insert into auth.users (id, instance_id, aud, role, email)
  values (test_uid, '00000000-0000-0000-0000-000000000000',
          'authenticated', 'authenticated', 'rls-selftest@example.invalid');
  insert into public.os_entity_members (user_id, entity_code)
  values (test_uid, 'ASI');
  -- Since 095 membership is the enrolment and grants are the scope: write on
  -- every ASI section, which is what the backfill gave every live member.
  -- The parentless metrics (D4) are reachable by no grant.
  insert into public.os_finish_line_grants (user_id, entity_code, section_id, capability, created_by)
  select test_uid, 'ASI', s.id, 'write', 'rls-selftest'
    from public.os_finish_line_items s where s.kind = 'section';

  -- cell_a must sit UNDER A SECTION: a parentless metric's cell is owner-only
  -- since 095, and picking one would fail every write case for the wrong
  -- reason. sec_a is that section, for cases 17-20.
  select c.id, c.item_id, i.parent_id into cell_a, asi_item, sec_a
    from public.os_finish_line_cells c
    join public.os_finish_line_items i on i.id = c.item_id
    join public.os_finish_line_items s on s.id = i.parent_id and s.kind = 'section'
   where c.entity_code = 'ASI' and c.state = 'input'
   order by c.id limit 1;
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

  -- ===== cases 1 + 2: zero rows from everything not member-visible =========
  execute 'set local role authenticated';
  for tbl in
    select tablename from pg_tables
    where schemaname = 'public' and tablename like 'os\_%'
      and tablename <> all (member_visible)
  loop
    execute format('select count(*) from public.%I', tbl) into n;
    if n <> 0 then
      failures := failures || format('case 1/2: %s returned %s rows for a member', tbl, n);
    end if;
  end loop;
  raise notice 'cases 1/2: GROWTH, entries/logs/plans, history all empty for member';

  -- os_entity_members: exactly the one own row
  select count(*) into n from public.os_entity_members;
  if n <> 1 then failures := failures || format('membership self-select: expected 1 row, got %s', n); end if;

  -- ===== case 3 (rewritten at 095): cells are exactly ASI's SECTIONED ones =
  -- Every ASI section is granted, so the member reads every ASI cell whose
  -- metric has a parent section and NONE of the parentless metrics' (D4).
  execute 'reset role';
  select count(*) into cells_expected
    from public.os_finish_line_cells c
    join public.os_finish_line_items i on i.id = c.item_id
    join public.os_finish_line_items s on s.id = coalesce(i.parent_id, i.id) and s.kind = 'section'
   where c.entity_code = 'ASI';
  select count(*) into orphan
    from public.os_finish_line_cells c
    join public.os_finish_line_items i on i.id = c.item_id
   where c.entity_code = 'ASI' and i.parent_id is null;
  if orphan = 0 then
    failures := failures || 'case 3: no parentless ASI cell exists, so the D4 half of this case is vacuous — live or the fixture changed shape';
  end if;
  execute 'set local role authenticated';
  select count(*) into n from public.os_finish_line_cells;
  if n <> cells_expected then failures := failures || format('case 3: member sees %s cells, ASI has %s under sections', n, cells_expected); end if;
  select count(*) into n from public.os_finish_line_cells where entity_code <> 'ASI';
  if n <> 0 then failures := failures || format('case 3: %s non-ASI cells visible', n); end if;
  select count(*) into n
    from public.os_finish_line_cells c
    join public.os_finish_line_items i on i.id = c.item_id
   where i.parent_id is null;
  if n <> 0 then failures := failures || format('case 3: %s parentless-metric cells visible — D4 says owner-only', n); end if;
  raise notice 'case 3: member sees exactly % sectioned ASI cells and none of the % parentless ones', cells_expected, orphan;

  -- ===== case 4 (rewritten at 095): accounts follow the grant ==============
  -- Members read the accounts under their readable cells plus the unmapped
  -- accounts of an entity they hold any grant on (D3). Nothing else: not an
  -- account under a parentless metric, not an unmapped account of another
  -- entity, not one with no entity at all.
  execute 'reset role';
  select count(*) into expected
    from public.os_finish_line_accounts a
   where a.cell_id in (
           select c.id
             from public.os_finish_line_cells c
             join public.os_finish_line_items i on i.id = c.item_id
             join public.os_finish_line_items s on s.id = coalesce(i.parent_id, i.id) and s.kind = 'section'
            where c.entity_code = 'ASI')
      or (a.cell_id is null and a.entity_code = 'ASI');
  execute 'set local role authenticated';
  select count(*) into n from public.os_finish_line_accounts;
  if n <> expected then failures := failures || format('case 4: member sees %s accounts, expected %s (under readable ASI cells + unmapped ASI)', n, expected); end if;
  select count(*) into n from public.os_finish_line_accounts a
   where a.cell_id is null and a.entity_code is distinct from 'ASI';
  if n <> 0 then failures := failures || format('case 4: %s unmapped accounts of another entity (or of no entity) visible', n); end if;
  select count(*) into n from public.os_finish_line_accounts a
   where a.cell_id is not null
     and not exists (select 1 from public.os_finish_line_cells c where c.id = a.cell_id);
  if n <> 0 then failures := failures || format('case 4: %s mapped accounts visible whose cell is not', n); end if;
  raise notice 'case 4: member sees exactly % accounts — under readable cells, plus unmapped ASI (D3)', expected;

  -- ===== case 5 (rewritten at slice 1): entity grant alone = zero projects ==
  -- The engagement predicate died in 20260804000045; project read is a
  -- per-project grant on the second axis. This identity holds ASI and no
  -- project membership, so the correct count is zero — under the old policy
  -- it was every SAMB WORK project. Membership fails closed.
  select count(*) into n from public.os_projects;
  if n <> 0 then failures := failures || format('case 5: %s projects visible with zero project grants', n); end if;
  raise notice 'case 5: zero project grants -> zero projects (engagement predicate is gone)';

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
  if n <> 1 then failures := failures || format('case 6: expected 1 row updated, got %s', n); end if;
  execute 'reset role';
  select state, actor_kind, actor, changed_at into v_state, v_ak, v_actor, v_ca
    from public.os_finish_line_cells where id = cell_a;
  if v_state <> 'figure' or v_ak <> 'contributor' or v_actor is distinct from test_uid or v_ca is null then
    failures := failures || format('case 6: stamp wrong (state=%s actor_kind=%s actor=%s changed_at=%s)', v_state, v_ak, v_actor, v_ca);
  end if;
  select count(*) into n from public.os_finish_line_cell_history
   where cell_id = cell_a and from_state = 'input' and to_state = 'figure'
     and actor_kind = 'contributor' and actor = test_uid;
  if n <> 1 then failures := failures || format('case 6: expected 1 history row, got %s', n); end if;
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
  if n <> 0 then failures := failures || format('case 9: KNI update touched %s rows', n); end if;
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
    failures := failures || format('case 11: spoofed actor survived as %s', v_actor);
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

  -- ===== case 13: accounts stay read-only for members (D6) =====
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
  raise notice 'case 13: accounts reject INSERT and match 0 rows for UPDATE/DELETE — read-only for members (D6)';

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
  if n <> 0 then failures := failures || format('case 15: %s UPDATE/DELETE policies exist on history — append-only broken', n); end if;
  raise notice 'case 15: history append-only holds; zero UPDATE/DELETE policies exist for anyone';

  -- ===== case 17 (095): a READ grant reads and does not write ==============
  update public.os_finish_line_grants set capability = 'read'
   where user_id = test_uid and entity_code = 'ASI' and section_id = sec_a;
  execute 'set local role authenticated';
  select count(*) into n from public.os_finish_line_cells where id = cell_a;
  if n <> 1 then failures := failures || 'case 17: cell_a invisible under a read grant — read must still read'; end if;
  update public.os_finish_line_cells set note = 'read grant should not write' where id = cell_a;
  get diagnostics n = row_count;
  if n <> 0 then failures := failures || format('case 17: UPDATE through a read grant matched %s row(s)', n); end if;
  execute 'reset role';
  update public.os_finish_line_grants set capability = 'write'
   where user_id = test_uid and entity_code = 'ASI' and section_id = sec_a;
  execute 'set local role authenticated';
  update public.os_finish_line_cells set note = 'write grant writes again' where id = cell_a;
  get diagnostics n = row_count;
  if n <> 1 then failures := failures || format('case 17: UPDATE after restoring write matched %s row(s), expected 1', n); end if;
  raise notice 'case 17: read grant reads cell_a and matches 0 rows on UPDATE; write restored writes again';

  -- ===== case 18 (095): revoking a section removes its cells and accounts ==
  execute 'reset role';
  select count(*) into under_sec
    from public.os_finish_line_cells c
    join public.os_finish_line_items i on i.id = c.item_id
   where c.entity_code = 'ASI' and coalesce(i.parent_id, i.id) = sec_a;
  delete from public.os_finish_line_grants
   where user_id = test_uid and entity_code = 'ASI' and section_id = sec_a;
  execute 'set local role authenticated';
  select count(*) into n from public.os_finish_line_cells where id = cell_a;
  if n <> 0 then failures := failures || 'case 18: cell_a still visible after its section was revoked'; end if;
  select count(*) into n from public.os_finish_line_cells;
  if n <> cells_expected - under_sec then failures := failures || format('case 18: %s cells after revoking one section, expected %s', n, cells_expected - under_sec); end if;
  select count(*) into n from public.os_finish_line_accounts where cell_id = cell_a;
  if n <> 0 then failures := failures || format('case 18: %s accounts under cell_a still visible after the revoke', n); end if;
  execute 'reset role';
  insert into public.os_finish_line_grants (user_id, entity_code, section_id, capability, created_by)
  values (test_uid, 'ASI', sec_a, 'write', 'rls-selftest');
  execute 'set local role authenticated';
  select count(*) into n from public.os_finish_line_cells;
  if n <> cells_expected then failures := failures || format('case 18: %s cells after re-granting, expected %s', n, cells_expected); end if;
  raise notice 'case 18: revoking one section removed its % cells; re-granting restored them', under_sec;

  -- ===== case 19 (095): enrolled, no grant: nothing but structure ==========
  execute 'reset role';
  delete from public.os_finish_line_grants where user_id = test_uid;
  select count(*) into expected from public.os_finish_line_items;
  execute 'set local role authenticated';
  select count(*) into n from public.os_finish_line_cells;
  if n <> 0 then failures := failures || format('case 19: %s cells visible with a membership and no grant', n); end if;
  select count(*) into n from public.os_finish_line_accounts;
  if n <> 0 then failures := failures || format('case 19: %s accounts visible with a membership and no grant', n); end if;
  select count(*) into n from public.os_entity_members;
  if n <> 1 then failures := failures || format('case 19: %s membership rows visible, expected the own 1', n); end if;
  select count(*) into n from public.os_finish_line_items;
  if n <> expected then failures := failures || format('case 19: %s items visible, expected all %s — structure hangs off the enrolment', n, expected); end if;
  update public.os_finish_line_cells set note = 'no grant' where id = cell_a;
  get diagnostics n = row_count;
  if n <> 0 then failures := failures || 'case 19: UPDATE matched a row with no grant'; end if;
  raise notice 'case 19: membership without grants reads 0 cells and 0 accounts; own membership row and item structure still read';

  -- ===== case 20 (095): no member write to grants; the section guard =======
  begin
    insert into public.os_finish_line_grants (user_id, entity_code, section_id, capability, created_by)
    values (test_uid, 'ASI', sec_a, 'write', 'self');
    failures := failures || 'case 20: a member INSERTed a grant row';
  exception when others then
    if sqlstate <> '42501' then failures := failures || format('case 20: member grant INSERT failed as %s, not RLS', sqlstate); end if;
  end;
  execute 'reset role';
  begin
    insert into public.os_finish_line_grants (user_id, entity_code, section_id, capability, created_by)
    values (test_uid, 'ASI', asi_item, 'write', 'rls-selftest');
    failures := failures || 'case 20: a grant naming a METRIC was accepted';
  exception when others then
    if sqlstate <> '23514' or sqlerrm not like '%kind = ''section''%' then
      failures := failures || format('case 20: metric grant refused by the wrong layer: %s (%s)', sqlerrm, sqlstate);
    end if;
  end;
  raise notice 'case 20: member cannot INSERT a grant (42501); the guard refuses a grant on a metric (23514)';

  -- ===== case 16: anon with no header, no claims =====
  perform set_config('request.jwt.claims', '{}', true);
  execute 'set local role anon';
  for tbl in
    select tablename from pg_tables where schemaname = 'public' and tablename like 'os\_%'
  loop
    execute format('select count(*) from public.%I', tbl) into n;
    if n <> 0 then failures := failures || format('case 16: anon read %s rows from %s', n, tbl); end if;
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
  raise notice 'ALL 20 CASES PASSED';
end
$$;

-- ===========================================================================
-- SLICE 1 — the §6 matrix: project membership, tasks, history. 15 cases.
-- ===========================================================================
-- Self-contained second block: its own synthetic users (a main member and a
-- foil who belongs to a DIFFERENT project), its own grants, rolled back with
-- everything else. The main identity holds entity ASI AND one project — the
-- two independent axes on a single JWT, which is the configuration the §6
-- table demands.
--
--   1  projects: zero BEFORE any grant (entity membership alone grants no
--      project — the two axes are independent), exactly the granted one after
--   2  growth and out-of-scope tables: zero rows for a project member
--   3  tasks: a real task in another project is invisible
--   4  task INSERT in the granted project succeeds; spoofed created_by /
--      actor values overwritten; five birth history rows from ''
--   5  task INSERT into a non-granted project rejected
--   6  project_id immutable for members — toward a non-granted project AND
--      toward a second granted one
--   7  non-allowlisted task columns (created_at, created_by) rejected;
--      spoofed actor on an allowed write overwritten
--   8  task DELETE matches zero rows, own task included
--   9  os_projects UPDATE/DELETE match zero rows
--   10 assignee outside the project rejected; member assignee succeeds with
--      a history row
--   11 os_task_history: invisible to members, INSERT rejected, UPDATE/DELETE
--      match zero rows, and zero UPDATE/DELETE policies exist for anyone
--   12 cells unchanged by slice 1: ASI-only, input→figure still the one
--      transition
--   13 revoking the project grant zeroes projects and tasks immediately on
--      the same claims — access dies via the membership lookup, not token
--      expiry (the browser-real-JWT variant is runbook step B)
--   14 positive control after revocation: the entity axis still writes, so
--      the zeroes in 13 are revocation, not a dead session
--   15 owner path with a TXN-LOCAL THROWAWAY key (never the real passphrase,
--      which this committed file must not carry), as the anon role the real
--      owner path uses: insert/update/move/'cancelled'/delete all reachable,
--      and any owner write resets actor_kind to 'owner'
do $$
declare
  uid_main constant uuid := 'a11ce000-5afe-4000-8000-c0113b000002';
  uid_foil constant uuid := 'a11ce000-5afe-4000-8000-c0113b000003';
  spoof constant uuid := '00000000-0000-4000-8000-00000000dead';
  failures text[] := '{}';
  n bigint; expected bigint;
  proj_granted uuid; proj_other uuid; proj_second uuid;
  task_main uuid; owner_task uuid; cell_asi uuid;
  v_kind text; v_uuid uuid;
  old_hash text;
  tbl text;
  member_visible constant text[] := array[
    'os_finish_line_cells','os_finish_line_items','os_finish_line_entities',
    'os_finish_line_account_map','os_finish_line_deps','os_finish_line_item_projects',
    'os_projects','os_entity_members','os_project_members','os_tasks',
    'os_finish_line_accounts','os_finish_line_grants',
    'os_process_forms','os_process_gates','os_process_lanes','os_process_needs',
    'os_process_phases','os_process_references','os_process_step_items',
    'os_process_steps','os_process_tracks'];
begin
  -- ===== fixture, as postgres ==============================================
  insert into auth.users (id, instance_id, aud, role, email) values
    (uid_main, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-selftest-main@example.invalid'),
    (uid_foil, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-selftest-foil@example.invalid');
  insert into public.os_entity_members (user_id, entity_code) values (uid_main, 'ASI');
  -- 095: the entity axis is a grant per section now; write on all of ASI's.
  insert into public.os_finish_line_grants (user_id, entity_code, section_id, capability, created_by)
  select uid_main, 'ASI', s.id, 'write', 'rls-selftest'
    from public.os_finish_line_items s where s.kind = 'section';

  select id into proj_granted from public.os_projects where domain = 'work' order by id limit 1;
  select id into proj_other   from public.os_projects where domain = 'work' order by id offset 1 limit 1;
  select id into proj_second  from public.os_projects where domain = 'work' order by id offset 2 limit 1;
  -- Under a section, as in block 1: a parentless metric's cell is owner-only.
  select c.id into cell_asi
    from public.os_finish_line_cells c
    join public.os_finish_line_items i on i.id = c.item_id
    join public.os_finish_line_items s on s.id = i.parent_id and s.kind = 'section'
   where c.entity_code = 'ASI' and c.state = 'input' order by c.id limit 1;
  if proj_granted is null or proj_other is null or proj_second is null or cell_asi is null then
    raise exception 'slice-1 fixture: needed three WORK projects and an ASI input cell';
  end if;

  perform set_config('request.headers', '{}', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid_main, 'role', 'authenticated')::text, true);

  -- ===== case 1a: entity membership alone grants zero projects =============
  execute 'set local role authenticated';
  select count(*) into n from public.os_projects;
  if n <> 0 then failures := failures || format('case 1: %s projects visible before any project grant', n); end if;
  if public.os_member_projects() <> '{}'::uuid[] then
    failures := failures || 'case 1: os_member_projects() not empty before any grant';
  end if;
  raise notice 'case 1a: entity grant alone -> zero projects (axes are independent)';

  -- ===== grants + foil task ================================================
  execute 'reset role';
  insert into public.os_project_members (user_id, project_id, created_by) values
    (uid_main, proj_granted, 'owner'),
    (uid_foil, proj_other,   'owner');
  -- The foil creates a real task in the OTHER project, as itself.
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid_foil, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.os_tasks (project_id, title) values (proj_other, 'slice1 foil task');
  execute 'reset role';
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid_main, 'role', 'authenticated')::text, true);

  -- ===== case 1b: exactly the granted project ==============================
  execute 'set local role authenticated';
  select count(*) into n from public.os_projects;
  if n <> 1 then failures := failures || format('case 1: %s projects visible, expected exactly 1', n); end if;
  select count(*) into n from public.os_projects where id <> proj_granted;
  if n <> 0 then failures := failures || format('case 1: %s non-granted projects visible', n); end if;
  raise notice 'case 1b: member sees exactly the granted project';

  -- ===== case 2: everything out of scope stays empty =======================
  for tbl in
    select tablename from pg_tables
    where schemaname = 'public' and tablename like 'os\_%'
      and tablename <> all (member_visible)
  loop
    execute format('select count(*) from public.%I', tbl) into n;
    if n <> 0 then
      failures := failures || format('case 2: %s returned %s rows for a project member', tbl, n);
    end if;
  end loop;
  raise notice 'case 2: growth and out-of-scope tables (task history included) all empty';

  -- ===== case 3: the foil''s task exists and is invisible ===================
  select count(*) into n from public.os_tasks;
  if n <> 0 then failures := failures || format('case 3: %s foreign tasks visible', n); end if;
  raise notice 'case 3: task in a non-granted project invisible';

  -- ===== case 4: INSERT in the granted project, spoof overwritten, birth history
  insert into public.os_tasks (project_id, title, detail, created_by_kind, created_by, actor_kind, actor)
  values (proj_granted, 'slice1 main task', 'd1', 'owner', spoof, 'owner', spoof)
  returning id into task_main;
  execute 'reset role';
  select count(*) into n from public.os_tasks
   where id = task_main and created_by_kind = 'contributor' and created_by = uid_main
     and actor_kind = 'contributor' and actor = uid_main and changed_at is not null;
  if n <> 1 then failures := failures || 'case 4: attribution stamp wrong or spoof survived'; end if;
  select count(*) into n from public.os_task_history where task_id = task_main and from_value = '';
  if n <> 5 then failures := failures || format('case 4: expected 5 birth history rows, got %s', n); end if;
  select count(*) into n from public.os_task_history
   where task_id = task_main and field = 'title' and to_value = 'slice1 main task' and actor = uid_main;
  if n <> 1 then failures := failures || 'case 4: title birth row missing or misattributed'; end if;
  select count(*) into n from public.os_task_history
   where task_id = task_main and (from_value is null or to_value is null);
  if n <> 0 then failures := failures || 'case 4: null value column in fresh history (tripwire)'; end if;
  raise notice 'case 4: INSERT stamped contributor, spoof overwritten, 5 birth rows from ''''';
  execute 'set local role authenticated';

  -- ===== case 5: INSERT into a non-granted project ==========================
  begin
    insert into public.os_tasks (project_id, title) values (proj_other, 'should not exist');
    failures := failures || 'case 5: INSERT into a non-granted project was allowed';
  exception when others then
    if sqlerrm not like '%not one of your projects%' and sqlstate <> '42501' then
      failures := failures || format('case 5: rejected by the wrong layer: %s', sqlerrm);
    end if;
  end;
  raise notice 'case 5: INSERT into a non-granted project rejected';

  -- ===== case 6: project_id immutable toward a non-granted project =========
  begin
    update public.os_tasks set project_id = proj_other where id = task_main;
    failures := failures || 'case 6: move to a non-granted project was allowed';
  exception when others then
    if sqlerrm not like '%may not move a task%' then
      failures := failures || format('case 6: rejected by the wrong layer: %s', sqlerrm);
    end if;
  end;
  raise notice 'case 6: project_id immutable for members';

  -- ===== case 7: non-allowlisted columns; spoofed actor stomped ============
  begin
    update public.os_tasks set created_at = now() - interval '1 year' where id = task_main;
    failures := failures || 'case 7: created_at backdate was allowed';
  exception when others then
    if sqlerrm not like '%may only change task content%' then
      failures := failures || format('case 7: created_at rejected by the wrong layer: %s', sqlerrm);
    end if;
  end;
  begin
    update public.os_tasks set created_by = spoof where id = task_main;
    failures := failures || 'case 7: created_by change was allowed';
  exception when others then
    if sqlerrm not like '%may only change task content%' then
      failures := failures || format('case 7: created_by rejected by the wrong layer: %s', sqlerrm);
    end if;
  end;
  update public.os_tasks set actor = spoof, title = 'slice1 main task v2' where id = task_main;
  execute 'reset role';
  select actor into v_uuid from public.os_tasks where id = task_main;
  if v_uuid is distinct from uid_main then
    failures := failures || format('case 7: spoofed actor survived as %s', v_uuid);
  end if;
  select count(*) into n from public.os_task_history
   where task_id = task_main and field = 'title'
     and from_value = 'slice1 main task' and to_value = 'slice1 main task v2'
     and actor_kind = 'contributor' and actor = uid_main;
  if n <> 1 then failures := failures || 'case 7: title change history row missing'; end if;
  execute 'set local role authenticated';
  raise notice 'case 7: created_at/created_by rejected; spoofed actor overwritten; history intact';

  -- ===== case 8: DELETE matches zero rows, own task included ===============
  delete from public.os_tasks where id = task_main;
  get diagnostics n = row_count;
  if n <> 0 then failures := failures || 'case 8: member DELETE touched own task'; end if;
  delete from public.os_tasks where true;
  get diagnostics n = row_count;
  if n <> 0 then failures := failures || 'case 8: member DELETE touched rows'; end if;
  raise notice 'case 8: task DELETE matches 0 rows for members';

  -- ===== case 9: projects stay read-only ===================================
  update public.os_projects set title = title || '!' where true;
  get diagnostics n = row_count;
  if n <> 0 then failures := failures || 'case 9: project UPDATE touched rows'; end if;
  delete from public.os_projects where true;
  get diagnostics n = row_count;
  if n <> 0 then failures := failures || 'case 9: project DELETE touched rows'; end if;
  raise notice 'case 9: os_projects UPDATE/DELETE match 0 rows for a project member';

  -- ===== case 10: assignee must belong to the task''s project ===============
  begin
    update public.os_tasks set assignee = uid_foil where id = task_main;
    failures := failures || 'case 10: non-member assignee was allowed';
  exception when others then
    if sqlerrm not like '%assignee must be a member%' then
      failures := failures || format('case 10: rejected by the wrong layer: %s', sqlerrm);
    end if;
  end;
  update public.os_tasks set assignee = uid_main where id = task_main;
  get diagnostics n = row_count;
  if n <> 1 then failures := failures || 'case 10: member assignee update matched 0 rows'; end if;
  execute 'reset role';
  select count(*) into n from public.os_task_history
   where task_id = task_main and field = 'assignee'
     and from_value = '' and to_value = uid_main::text;
  if n <> 1 then failures := failures || 'case 10: assignee history row missing'; end if;
  execute 'set local role authenticated';
  raise notice 'case 10: assignee outside the project rejected; member assignee logged';

  -- ===== case 11: task history closed to members, append-only for all ======
  select count(*) into n from public.os_task_history;
  if n <> 0 then failures := failures || format('case 11: member read %s history rows', n); end if;
  begin
    insert into public.os_task_history (task_id, field, from_value, to_value, actor_kind)
    values (task_main, 'title', 'x', 'y', 'contributor');
    failures := failures || 'case 11: history INSERT was allowed';
  exception when others then
    if sqlstate <> '42501' then
      failures := failures || format('case 11: history INSERT failed as %s, not RLS', sqlstate);
    end if;
  end;
  update public.os_task_history set to_value = 'tampered' where true;
  get diagnostics n = row_count;
  if n <> 0 then failures := failures || 'case 11: history UPDATE touched rows'; end if;
  delete from public.os_task_history where true;
  get diagnostics n = row_count;
  if n <> 0 then failures := failures || 'case 11: history DELETE touched rows'; end if;
  execute 'reset role';
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'os_task_history'
     and cmd in ('UPDATE', 'DELETE');
  if n <> 0 then failures := failures || format('case 11: %s UPDATE/DELETE policies exist on task history', n); end if;
  execute 'set local role authenticated';
  raise notice 'case 11: task history invisible to members and append-only for everyone';

  -- ===== case 12: cells behave exactly as before slice 1 ===================
  -- (sectioned ASI cells since 095 — the same expression block 1's case 3 uses)
  execute 'reset role';
  select count(*) into expected
    from public.os_finish_line_cells c
    join public.os_finish_line_items i on i.id = c.item_id
    join public.os_finish_line_items s on s.id = coalesce(i.parent_id, i.id) and s.kind = 'section'
   where c.entity_code = 'ASI';
  execute 'set local role authenticated';
  select count(*) into n from public.os_finish_line_cells;
  if n <> expected then failures := failures || format('case 12: member sees %s cells, ASI has %s', n, expected); end if;
  update public.os_finish_line_cells set state = 'figure' where id = cell_asi;
  get diagnostics n = row_count;
  if n <> 1 then failures := failures || 'case 12: input -> figure stopped working'; end if;
  begin
    update public.os_finish_line_cells set state = 'input' where id = cell_asi;
    failures := failures || 'case 12: figure -> input became allowed';
  exception when others then
    if sqlerrm not like '%input to figure%' then
      failures := failures || format('case 12: rejected by the wrong layer: %s', sqlerrm);
    end if;
  end;
  raise notice 'case 12: cells unchanged — ASI-only, input -> figure still the one transition';

  -- ===== case 6b + 13: second grant, move still refused, then revocation ===
  execute 'reset role';
  insert into public.os_project_members (user_id, project_id, created_by)
  values (uid_main, proj_second, 'owner');
  execute 'set local role authenticated';
  select count(*) into n from public.os_projects;
  if n <> 2 then failures := failures || format('case 13: expected 2 projects after second grant, saw %s', n); end if;
  begin
    update public.os_tasks set project_id = proj_second where id = task_main;
    failures := failures || 'case 6b: move between two granted projects was allowed';
  exception when others then
    if sqlerrm not like '%may not move a task%' then
      failures := failures || format('case 6b: rejected by the wrong layer: %s', sqlerrm);
    end if;
  end;
  execute 'reset role';
  delete from public.os_project_members where user_id = uid_main;
  execute 'set local role authenticated';
  select count(*) into n from public.os_projects;
  if n <> 0 then failures := failures || format('case 13: %s projects visible after revocation', n); end if;
  select count(*) into n from public.os_tasks;
  if n <> 0 then failures := failures || format('case 13: %s tasks visible after revocation', n); end if;
  update public.os_tasks set title = 'post-revocation' where id = task_main;
  get diagnostics n = row_count;
  if n <> 0 then failures := failures || 'case 13: task UPDATE still reachable after revocation'; end if;
  raise notice 'case 6b: move refused even between two granted projects';
  raise notice 'case 13: revocation zeroes projects and tasks on the same claims, immediately';

  -- ===== case 14: positive control — the entity axis is still alive ========
  update public.os_finish_line_cells set note = 'slice1 positive control' where id = cell_asi;
  get diagnostics n = row_count;
  if n <> 1 then failures := failures || 'case 14: positive-control cell write failed — identity dead, case 13 proves nothing'; end if;
  raise notice 'case 14: entity-axis write still succeeds — revocation was the project axis only';

  -- ===== case 15: the owner path, with a throwaway key =====================
  -- The REAL passphrase never appears here: a throwaway hash is swapped in
  -- for this transaction and the original restored below (and the outer
  -- rollback would restore it regardless). Role anon + header is the exact
  -- shape of the production owner path.
  execute 'reset role';
  select key_hash into old_hash from private.os_app_secret;
  update private.os_app_secret
     set key_hash = extensions.crypt('slice1-throwaway-key', extensions.gen_salt('bf'));
  perform set_config('request.headers',
    json_build_object('x-app-key', 'slice1-throwaway-key')::text, true);
  perform set_config('request.jwt.claims', '{}', true);
  execute 'set local role anon';
  insert into public.os_tasks (project_id, title) values (proj_other, 'slice1 owner task')
  returning id into owner_task;
  update public.os_tasks set status = 'done' where id = task_main;
  update public.os_tasks set status = 'cancelled' where id = owner_task;
  update public.os_tasks set project_id = proj_second where id = owner_task;
  delete from public.os_tasks where id = owner_task;
  get diagnostics n = row_count;
  if n <> 1 then failures := failures || 'case 15: owner DELETE matched 0 rows'; end if;
  execute 'reset role';
  select actor_kind, actor into v_kind, v_uuid from public.os_tasks where id = task_main;
  if v_kind <> 'owner' or v_uuid is not null then
    failures := failures || format('case 15: owner write left actor_kind=%s actor=%s', v_kind, v_uuid);
  end if;
  select count(*) into n from public.os_task_history
   where task_id = task_main and field = 'status'
     and from_value = 'open' and to_value = 'done'
     and actor_kind = 'owner' and actor is null;
  if n <> 1 then failures := failures || 'case 15: owner status change missing from history'; end if;
  select count(*) into n from public.os_task_history where task_id = owner_task;
  if n < 6 then failures := failures || format('case 15: owner task history incomplete (%s rows)', n); end if;
  update private.os_app_secret set key_hash = old_hash;
  perform set_config('request.headers', '{}', true);
  raise notice 'case 15: owner path — insert/update/cancelled/move/delete all reachable, actor_kind resets to owner';

  -- ===== verdict =====
  if array_length(failures, 1) is not null then
    raise exception E'SLICE-1 RLS VERIFICATION FAILED — % problem(s):\n%',
      array_length(failures, 1), array_to_string(failures, E'\n');
  end if;
  raise notice 'ALL 15 SLICE-1 CASES PASSED';
end
$$;

-- ===========================================================================
-- DOMAIN-GUARD PATCH — the GROWTH gap, closed and proven. 6 cases.
-- ===========================================================================
-- Membership fails closed against the ABSENCE of a grant; these cases prove
-- it now also fails against a WRONG one, in three layers. Case 3 is the one
-- that matters: the layer-one trigger is DISABLED inside the transaction and
-- a GROWTH membership row planted directly, so layer two (the domain join in
-- os_member_projects()) is proven independently rather than assumed to be
-- shielded by layer one.
--
--   1  granting a GROWTH project via the owner path → layer-one trigger
--      refuses, owner included: GROWTH isolation is not a permission the
--      owner can spend
--   2  granting a project id that resolves to nothing → distinct message
--   3  with the trigger disabled, a planted GROWTH membership row:
--      os_member_projects() returns EMPTY for that user
--   4  same state: the projects policy returns zero rows
--   5  same state, with a real task on that GROWTH project (owner-created):
--      the tasks policy returns zero rows
--   6  a WORK grant still succeeds and behaves exactly as before — and the
--      poisoned GROWTH row stays inert beside it
do $$
declare
  uid_g constant uuid := 'a11ce000-5afe-4000-8000-c0113b000004';
  failures text[] := '{}';
  n bigint; expected bigint;
  proj_work uuid; proj_growth uuid;
  old_hash text;
begin
  -- ===== fixture, as postgres ==============================================
  insert into auth.users (id, instance_id, aud, role, email) values
    (uid_g, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-selftest-domain@example.invalid');
  select id into proj_work   from public.os_projects where domain = 'work'   order by id limit 1;
  select id into proj_growth from public.os_projects where domain = 'growth' order by id limit 1;
  if proj_work is null or proj_growth is null then
    raise exception 'domain-guard fixture: needed a WORK and a GROWTH project';
  end if;

  -- Owner path shape: anon role + a txn-local throwaway key (never the real
  -- passphrase — this file is committed and the repo is public).
  select key_hash into old_hash from private.os_app_secret;
  update private.os_app_secret
     set key_hash = extensions.crypt('domain-guard-throwaway', extensions.gen_salt('bf'));
  perform set_config('request.headers',
    json_build_object('x-app-key', 'domain-guard-throwaway')::text, true);
  perform set_config('request.jwt.claims', '{}', true);
  execute 'set local role anon';

  -- ===== case 1: GROWTH grant refused, owner path included ================
  begin
    insert into public.os_project_members (user_id, project_id, created_by)
    values (uid_g, proj_growth, 'owner');
    failures := failures || 'case 1: GROWTH grant via the owner path was allowed';
  exception when others then
    if sqlerrm not like '%only WORK projects are grantable%' then
      failures := failures || format('case 1: rejected by the wrong layer: %s', sqlerrm);
    end if;
  end;
  raise notice 'patch case 1: GROWTH grant refused by the layer-one trigger, owner included';

  -- ===== case 2: unresolvable project id, distinct message =================
  begin
    insert into public.os_project_members (user_id, project_id, created_by)
    values (uid_g, '00000000-0000-4000-8000-00000000beef', 'owner');
    failures := failures || 'case 2: grant on a nonexistent project was allowed';
  exception when others then
    if sqlerrm not like '%does not resolve to a project%' then
      failures := failures || format('case 2: wrong message: %s', sqlerrm);
    end if;
  end;
  raise notice 'patch case 2: unresolvable project id refused with its own message';

  -- A real task on the GROWTH project, via the owner path (the owner may) —
  -- this is what case 5 must NOT show the member.
  insert into public.os_tasks (project_id, title) values (proj_growth, 'domain-guard growth task');
  execute 'reset role';

  -- ===== plant the poisoned row: layer one out of the way ==================
  alter table public.os_project_members disable trigger os_project_members_domain_guard;
  insert into public.os_project_members (user_id, project_id, created_by)
  values (uid_g, proj_growth, 'layer-two-test');
  alter table public.os_project_members enable trigger os_project_members_domain_guard;

  update private.os_app_secret set key_hash = old_hash;
  perform set_config('request.headers', '{}', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid_g, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- ===== case 3: the function excludes the row — layer two, independent ====
  if public.os_member_projects() <> '{}'::uuid[] then
    failures := failures || format('case 3: os_member_projects() = %s with only a GROWTH row — layer two is not independent',
      public.os_member_projects());
  end if;
  raise notice 'patch case 3: os_member_projects() empty despite the planted GROWTH row';

  -- ===== case 4: the projects policy returns zero rows =====================
  select count(*) into n from public.os_projects;
  if n <> 0 then failures := failures || format('case 4: %s projects visible through a GROWTH grant', n); end if;
  raise notice 'patch case 4: projects policy returns zero rows';

  -- ===== case 5: the tasks policy returns zero rows ========================
  select count(*) into n from public.os_tasks;
  if n <> 0 then failures := failures || format('case 5: %s tasks visible through a GROWTH grant', n); end if;
  raise notice 'patch case 5: tasks policy returns zero rows, growth task invisible';

  -- ===== case 6: WORK grants unchanged; the poisoned row stays inert =======
  execute 'reset role';
  select key_hash into old_hash from private.os_app_secret;
  update private.os_app_secret
     set key_hash = extensions.crypt('domain-guard-throwaway', extensions.gen_salt('bf'));
  perform set_config('request.headers',
    json_build_object('x-app-key', 'domain-guard-throwaway')::text, true);
  perform set_config('request.jwt.claims', '{}', true);
  execute 'set local role anon';
  insert into public.os_project_members (user_id, project_id, created_by)
  values (uid_g, proj_work, 'owner');
  execute 'reset role';
  update private.os_app_secret set key_hash = old_hash;
  perform set_config('request.headers', '{}', true);
  -- Tasks already sitting in proj_work belong to earlier blocks of this same
  -- transaction — slice 1 leaves its task_main in the first WORK project —
  -- so "exactly the own task" is really "those plus one, and nothing from
  -- the GROWTH project". Counted as postgres, before becoming the member.
  select count(*) into expected from public.os_tasks where project_id = proj_work;
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid_g, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if public.os_member_projects() <> array[proj_work] then
    failures := failures || format('case 6: os_member_projects() = %s, expected exactly the WORK grant',
      public.os_member_projects());
  end if;
  select count(*) into n from public.os_projects;
  if n <> 1 then failures := failures || format('case 6: %s projects visible, expected 1', n); end if;
  insert into public.os_tasks (project_id, title) values (proj_work, 'domain-guard work task');
  select count(*) into n from public.os_tasks;
  if n <> expected + 1 then failures := failures || format('case 6: %s tasks visible, expected %s (the tasks already in the WORK project plus the own one)', n, expected + 1); end if;
  select count(*) into n from public.os_tasks where project_id <> proj_work;
  if n <> 0 then failures := failures || format('case 6: %s task(s) visible outside the granted WORK project — the GROWTH task leaked', n); end if;
  execute 'reset role';

  -- ===== verdict =====
  if array_length(failures, 1) is not null then
    raise exception E'DOMAIN-GUARD VERIFICATION FAILED — % problem(s):\n%',
      array_length(failures, 1), array_to_string(failures, E'\n');
  end if;
  raise notice 'ALL 6 DOMAIN-GUARD CASES PASSED';
end
$$;

-- ===========================================================================
-- PROVISIONING-PATH CASES — the Edge Function's SQL, replayed as its role.
-- ===========================================================================
-- (S1-S4 need 20260904000096: the two scope actions and their audit columns.)
-- provision-collaborator runs as service_role. These cases replay the exact
-- statements its grant-projects / revoke actions run, AS service_role, so
-- the audited path is proven at the SQL surface without the owner
-- passphrase (which this committed file must never carry). The HTTP half —
-- a wrong or absent owner key answering 401 with zero writes — is probed
-- live against the deployed function (verified 2026-08-05: {"error":
-- "Unauthorized"}, member_rows 0, log rows 0).
--
--   P1 granting several projects at once writes several os_project_members
--      rows and ONE provision-log entry carrying every project id
--   P2 a GROWTH grant as service_role is refused by the domain trigger —
--      RLS is bypassed for this role; triggers are not
--   S1 grant-scope (20260904000096): the upsert the function runs moves every
--      ASI section to READ in place — no duplicate rows — and the audit row
--      carries the entity, every section id and the capability
--   S2 the same upsert moves ONE section back to WRITE; row count unchanged
--   S3 revoke-scope removes exactly that one row; the audit row names it
--   S4 the audit REFUSES a scope entry that cannot say what it granted —
--      no sections, no capability, two entities, two sections on a revoke —
--      and the log gains nothing from any of them (audit failed = action
--      failed, at the SQL layer the function cannot get around)
--   P3 revoke clears BOTH axes and writes one log row carrying both arrays;
--      the scope grants go with the membership through the 095 cascade
do $$
declare
  uid_p constant uuid := 'a11ce000-5afe-4000-8000-c0113b000007';
  failures text[] := '{}';
  n bigint; expected bigint;
  proj_a uuid; proj_b uuid; proj_g uuid; sec_one uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email)
  values (uid_p, '00000000-0000-0000-0000-000000000000',
          'authenticated', 'authenticated', 'rls-selftest-provisioning@example.invalid');
  insert into public.os_entity_members (user_id, entity_code) values (uid_p, 'ASI');
  -- 095: grants ride on the membership through a cascading FK; P3 proves it.
  insert into public.os_finish_line_grants (user_id, entity_code, section_id, capability, created_by)
  select uid_p, 'ASI', s.id, 'write', 'rls-selftest'
    from public.os_finish_line_items s where s.kind = 'section';
  select id into proj_a from public.os_projects where domain = 'work'   order by id limit 1;
  select id into proj_b from public.os_projects where domain = 'work'   order by id offset 1 limit 1;
  select id into proj_g from public.os_projects where domain = 'growth' order by id limit 1;
  if proj_a is null or proj_b is null or proj_g is null then
    raise exception 'provisioning fixture: needed two WORK projects and a GROWTH project';
  end if;
  create temporary table _prov on commit drop as select proj_a as a, proj_b as b, proj_g as g;
  grant select on _prov to service_role;

  -- ===== P1: multi-grant, one audited action ===============================
  execute 'set local role service_role';
  insert into public.os_project_members (user_id, project_id, role, created_by)
  select uid_p, p.id, 'contributor', 'owner'
  from (select a as id from _prov union all select b from _prov) p
  on conflict (user_id, project_id) do nothing;
  perform public.os_provision_record(
    p_action := 'grant-projects',
    p_email := 'rls-selftest-provisioning@example.invalid',
    p_project_ids := (select array[a, b] from _prov));
  execute 'reset role';
  select count(*) into n from public.os_project_members where user_id = uid_p;
  if n <> 2 then failures := failures || format('P1: %s membership rows, expected 2', n); end if;
  select count(*) into n from private.os_provision_log
   where action = 'grant-projects' and email = 'rls-selftest-provisioning@example.invalid';
  if n <> 1 then failures := failures || format('P1: %s log rows, expected exactly 1', n); end if;
  select array_length(project_ids, 1) into n from private.os_provision_log
   where action = 'grant-projects' and email = 'rls-selftest-provisioning@example.invalid';
  if n <> 2 then failures := failures || format('P1: log row carries %s project ids, expected 2', n); end if;
  raise notice 'P1: multi-grant wrote 2 rows and one audited action carrying both ids';

  -- ===== P2: the trigger holds against the function''s own role =============
  execute 'set local role service_role';
  begin
    insert into public.os_project_members (user_id, project_id, role, created_by)
    select uid_p, g, 'contributor', 'owner' from _prov;
    failures := failures || 'P2: GROWTH grant as service_role was allowed';
  exception when others then
    if sqlerrm not like '%only WORK projects are grantable%' then
      failures := failures || format('P2: refused by the wrong layer: %s', sqlerrm);
    end if;
  end;
  execute 'reset role';
  raise notice 'P2: GROWTH grant refused for service_role — triggers are not RLS';

  -- ===== S1: grant-scope — every ASI section to READ, in place, audited ======
  -- The function upserts on the (user, entity, section) key with no
  -- ignoreDuplicates, so a capability change is an UPDATE of the same row.
  select count(*) into expected from public.os_finish_line_items where kind = 'section';
  select id into sec_one from public.os_finish_line_items where kind = 'section' order by id limit 1;
  execute 'set local role service_role';
  insert into public.os_finish_line_grants (user_id, entity_code, section_id, capability, created_by)
  select uid_p, 'ASI', s.id, 'read', 'owner'
    from public.os_finish_line_items s where s.kind = 'section'
  on conflict (user_id, entity_code, section_id) do update set capability = excluded.capability;
  perform public.os_provision_record(
    p_action := 'grant-scope',
    p_email := 'rls-selftest-provisioning@example.invalid',
    p_entity_codes := array['ASI'],
    p_section_ids := (select array_agg(id) from public.os_finish_line_items where kind = 'section'),
    p_capability := 'read');
  execute 'reset role';
  select count(*) into n from public.os_finish_line_grants where user_id = uid_p;
  if n <> expected then failures := failures || format('S1: %s grant rows after the upsert, expected %s (one per section, no duplicates)', n, expected); end if;
  select count(*) into n from public.os_finish_line_grants where user_id = uid_p and capability <> 'read';
  if n <> 0 then failures := failures || format('S1: %s rows did not move to read', n); end if;
  select count(*) into n from private.os_provision_log
   where action = 'grant-scope' and email = 'rls-selftest-provisioning@example.invalid'
     and entity_codes = array['ASI'] and cardinality(section_ids) = expected and capability = 'read';
  if n <> 1 then failures := failures || format('S1: %s grant-scope log rows carrying the entity, every section and the capability, expected 1', n); end if;
  raise notice 'S1: grant-scope moved % sections to read in place and logged one row naming all of them', expected;

  -- ===== S2: one section back to WRITE, same row =============================
  execute 'set local role service_role';
  insert into public.os_finish_line_grants (user_id, entity_code, section_id, capability, created_by)
  values (uid_p, 'ASI', sec_one, 'write', 'owner')
  on conflict (user_id, entity_code, section_id) do update set capability = excluded.capability;
  perform public.os_provision_record(
    p_action := 'grant-scope', p_email := 'rls-selftest-provisioning@example.invalid',
    p_entity_codes := array['ASI'], p_section_ids := array[sec_one], p_capability := 'write');
  execute 'reset role';
  select count(*) into n from public.os_finish_line_grants where user_id = uid_p;
  if n <> expected then failures := failures || format('S2: row count changed to %s on a capability change', n); end if;
  select count(*) into n from public.os_finish_line_grants
   where user_id = uid_p and entity_code = 'ASI' and section_id = sec_one and capability = 'write';
  if n <> 1 then failures := failures || 'S2: the one section did not move back to write'; end if;
  raise notice 'S2: one section back to write, row count unchanged';

  -- ===== S3: revoke-scope removes exactly that row ===========================
  execute 'set local role service_role';
  delete from public.os_finish_line_grants
   where user_id = uid_p and entity_code = 'ASI' and section_id = sec_one;
  perform public.os_provision_record(
    p_action := 'revoke-scope', p_email := 'rls-selftest-provisioning@example.invalid',
    p_entity_codes := array['ASI'], p_section_ids := array[sec_one]);
  execute 'reset role';
  select count(*) into n from public.os_finish_line_grants where user_id = uid_p;
  if n <> expected - 1 then failures := failures || format('S3: %s grant rows after revoke-scope, expected %s', n, expected - 1); end if;
  select count(*) into n from public.os_entity_members where user_id = uid_p and entity_code = 'ASI';
  if n <> 1 then failures := failures || 'S3: revoke-scope removed the membership — it must remove one grant only'; end if;
  select count(*) into n from private.os_provision_log
   where action = 'revoke-scope' and email = 'rls-selftest-provisioning@example.invalid'
     and entity_codes = array['ASI'] and section_ids = array[sec_one] and capability is null;
  if n <> 1 then failures := failures || format('S3: %s revoke-scope log rows naming the one section, expected 1', n); end if;
  raise notice 'S3: revoke-scope removed one row, kept the membership, logged the section';

  -- ===== S4: the audit refuses an entry that cannot say what it granted =====
  select count(*) into expected from private.os_provision_log;
  execute 'set local role service_role';
  begin
    perform public.os_provision_record(
      p_action := 'grant-scope', p_email := 'x@example.invalid', p_entity_codes := array['ASI']);
    failures := failures || 'S4: a grant-scope entry with no sections and no capability was accepted';
  exception when check_violation then null;
    when others then failures := failures || format('S4: no-sections entry refused by the wrong layer: %s', sqlerrm);
  end;
  begin
    perform public.os_provision_record(
      p_action := 'grant-scope', p_email := 'x@example.invalid', p_entity_codes := array['ASI'],
      p_section_ids := array[sec_one]);
    failures := failures || 'S4: a grant-scope entry with no capability was accepted';
  exception when check_violation then null;
    when others then failures := failures || format('S4: no-capability entry refused by the wrong layer: %s', sqlerrm);
  end;
  begin
    perform public.os_provision_record(
      p_action := 'grant-scope', p_email := 'x@example.invalid', p_entity_codes := array['ASI', 'ARBI'],
      p_section_ids := array[sec_one], p_capability := 'read');
    failures := failures || 'S4: a grant-scope entry naming two entities was accepted';
  exception when check_violation then null;
    when others then failures := failures || format('S4: two-entity entry refused by the wrong layer: %s', sqlerrm);
  end;
  begin
    perform public.os_provision_record(
      p_action := 'grant-scope', p_email := 'x@example.invalid', p_entity_codes := array['ASI'],
      p_section_ids := array[sec_one], p_capability := 'admin');
    failures := failures || 'S4: a grant-scope entry with capability admin was accepted';
  exception when check_violation then null;
    when others then failures := failures || format('S4: admin-capability entry refused by the wrong layer: %s', sqlerrm);
  end;
  begin
    perform public.os_provision_record(
      p_action := 'revoke-scope', p_email := 'x@example.invalid', p_entity_codes := array['ASI'],
      p_section_ids := (select array_agg(id) from public.os_finish_line_items where kind = 'section'));
    failures := failures || 'S4: a revoke-scope entry naming every section was accepted';
  exception when check_violation then null;
    when others then failures := failures || format('S4: multi-section revoke entry refused by the wrong layer: %s', sqlerrm);
  end;
  execute 'reset role';
  select count(*) into n from private.os_provision_log;
  if n <> expected then failures := failures || format('S4: the log grew by %s row(s) from refused entries', n - expected); end if;
  raise notice 'S4: five malformed scope entries refused; the log did not grow';

  -- ===== P3: revoke clears both axes, one audited action ===================
  execute 'set local role service_role';
  delete from public.os_entity_members where user_id = uid_p;
  delete from public.os_project_members where user_id = uid_p;
  perform public.os_provision_record(
    p_action := 'revoke',
    p_email := 'rls-selftest-provisioning@example.invalid',
    p_entity_codes := array['ASI'],
    p_project_ids := (select array[a, b] from _prov));
  execute 'reset role';
  select count(*) into n from public.os_entity_members where user_id = uid_p;
  if n <> 0 then failures := failures || format('P3: %s entity rows survive revoke', n); end if;
  select count(*) into n from public.os_project_members where user_id = uid_p;
  if n <> 0 then failures := failures || format('P3: %s project rows survive revoke', n); end if;
  select count(*) into n from public.os_finish_line_grants where user_id = uid_p;
  if n <> 0 then failures := failures || format('P3: %s grant rows survive the membership revoke — the cascade from 095 is missing', n); end if;
  select count(*) into n from private.os_provision_log
   where action = 'revoke' and email = 'rls-selftest-provisioning@example.invalid'
     and entity_codes = array['ASI'] and array_length(project_ids, 1) = 2;
  if n <> 1 then failures := failures || 'P3: revoke log row missing or missing an axis'; end if;
  raise notice 'P3: revoke cleared both axes (grants cascaded with the membership) and logged both arrays in one action';

  -- ===== verdict =====
  if array_length(failures, 1) is not null then
    raise exception E'PROVISIONING-PATH VERIFICATION FAILED — % problem(s):\n%',
      array_length(failures, 1), array_to_string(failures, E'\n');
  end if;
  raise notice 'ALL 7 PROVISIONING-PATH CASES PASSED';
end
$$;

rollback;

select 'collab_rls: all 48 cases passed (16 original + 4 grant model + 15 slice 1 + 6 domain guard + 7 provisioning path); transaction rolled back, no fixture survives' as result;
