-- ===========================================================================
-- FINISH LINE GRANTS — THE SCOPE MODEL, READ AND WRITTEN AS THE ROLES THAT DO.
-- ===========================================================================
--
-- Same contract as every suite here: ZERO ROWS when healthy; any row names
-- what broke. Runs inside one transaction that ends in ROLLBACK, so the
-- writes it makes on purpose — a contributor's cell update, an owner-authored
-- grant, a membership revoke — never survive it.
--
-- THROWAWAY CLUSTER ONLY, via scripts/grant-scope-tests.sh. It names the rows
-- of fixtures/grant_scope_fixture.sql by uuid and expects the shape that
-- fixtures/grant_scope_scenario.sql leaves behind. Against any other database
-- the first check reports the fixture absent and stops — as a finding, never
-- as a pass.
--
-- WHY THE EXPECTATIONS ARE LITERALS. rls_function_grants.sql and
-- anon_definer_gates.sql read catalogs; collab_rls.sql asserts equality
-- against whatever live holds. Neither shape can say "A reads 8 cells and
-- writes 7", and that sentence is the whole point of 20260904000095: the
-- numbers below were worked out from the fixture by hand, so a policy that
-- drifts toward "the entity" or toward "nothing" shows up as a wrong number,
-- not as a query agreeing with itself.
--
-- The fixture, for reading the numbers:
--   sections  S1 (metrics A1, A2, note N1)   S2 (metric B1)   O1 has NO parent
--   cells     A1 A2 B1 O1 x SAMB ARBI ASI = 12
--   accounts  SAMB: A1 x2, B1, O1, unmapped x2 · ARBI: A1, unmapped · ASI: B1
--             · one unmapped with no entity                          = 10
--   A  write on every (entity, section) the backfill gave them, except
--      (SAMB, S2) read-only and (ASI, S2) revoked
--   B  write on (ARBI, S1) and (ARBI, S2)
--   C  enrolled on SAMB, no grant at all
--
--   A reads  SAMB A1 A2 B1 · ARBI A1 A2 B1 · ASI A1 A2          = 8
--   A writes the same minus SAMB B1                             = 7
--   A's accounts: SAMB A1 x2, B1, unmapped x2 · ARBI A1, unmapped = 7
--   B reads / writes ARBI A1 A2 B1 = 3; B's accounts = 2
--   C reads 0 cells, 0 accounts; the owner reads 12 and 10
--
-- What it pins, in order:
--   catalog   table shape (PK, NOT NULL section, capability check, cascading
--             FK to membership), the guard trigger, the three lookup
--             functions (SECURITY DEFINER, empty search_path, EXECUTE for
--             authenticated and NOT anon), the exact member policy set on
--             cells / accounts / grants, and the four history tables still
--             carrying no UPDATE or DELETE policy for anyone
--   scope     the numbers above, per identity
--   writes    a read-capability UPDATE matches zero rows and writes no
--             history; a write-capability UPDATE matches one row and the
--             trigger appends exactly one history row naming the actor
--   accounts  mapped accounts follow their cell; unmapped follow the entity
--             (D3); an account with no entity is owner-only
--   grants    a member reads only their own rows and writes none; the owner
--             path writes; the guard refuses a metric, a note, an unknown id
--             and an UPDATE toward a metric; revoking membership cascades
--   roles     anon reads nothing and cannot call the lookups; the owner
--             (anon + x-app-key) reads everything

begin;

create temp table fl_grant_findings (finding text);

do $$
declare
  uid_a constant uuid := '11111111-1111-4111-8111-111111111111';  -- SAMB ASI ARBI KNI KDU
  uid_b constant uuid := '22222222-2222-4222-8222-222222222222';  -- ARBI
  uid_c constant uuid := '33333333-3333-4333-8333-333333333333';  -- SAMB, no grants
  s1    constant uuid := 'f1a70000-0000-4000-8000-000000000a01';
  s2    constant uuid := 'f1a70000-0000-4000-8000-000000000a02';
  m_a1  constant uuid := 'f1a70000-0000-4000-8000-000000000b01';
  m_a2  constant uuid := 'f1a70000-0000-4000-8000-000000000b02';
  m_b1  constant uuid := 'f1a70000-0000-4000-8000-000000000b03';
  m_o1  constant uuid := 'f1a70000-0000-4000-8000-000000000b04';
  n_n1  constant uuid := 'f1a70000-0000-4000-8000-000000000c01';
  owner_key constant text := 'role-suite-owner-passphrase';
  failures text[] := '{}';
  checks int := 0;
  n bigint; n2 bigint; expected bigint;
  cell_samb_a1 uuid; cell_samb_b1 uuid; cell_samb_o1 uuid;
  cell_asi_b1 uuid; cell_arbi_a1 uuid;
  v_state text; v_kind text; v_actor uuid;
  fn text; rec record;
  readable uuid[]; writable uuid[];
begin
  -- ===== 0. the fixture and the scenario must be here, or nothing is =======
  if to_regclass('public.os_finish_line_grants') is null then
    insert into fl_grant_findings values (
      'TABLE ABSENT: public.os_finish_line_grants does not exist — 20260904000095 has not been applied here. Nothing below was checked.');
    return;
  end if;
  if not exists (select 1 from public.os_finish_line_items where id = s1)
     or not exists (select 1 from public.os_finish_line_cells where item_id = m_o1 and entity_code = 'SAMB') then
    insert into fl_grant_findings values (
      'FIXTURE ABSENT: fixtures/grant_scope_fixture.sql has not been loaded, so nothing below was checked. This suite runs through scripts/grant-scope-tests.sh.');
    return;
  end if;
  if not exists (select 1 from public.os_finish_line_grants
                  where user_id = uid_a and entity_code = 'SAMB' and section_id = s2 and capability = 'read')
     or exists (select 1 from public.os_finish_line_grants where user_id = uid_c) then
    insert into fl_grant_findings values (
      'SCENARIO ABSENT: fixtures/grant_scope_scenario.sql has not been applied (A''s (SAMB, S2) is not read-only, or C still holds grants), so the literal expectations below do not describe this database. Nothing was checked.');
    return;
  end if;
  select count(*) into n from public.os_finish_line_cells
   where item_id in (m_a1, m_a2, m_b1, m_o1);
  if n <> 12 then
    failures := failures || format(
      'FIXTURE SHAPE: expected 12 fixture cells (4 metrics x 3 entities), found %s — the literal expectations in this file no longer describe the fixture. Load fixtures/collab_rls_fixture.sql AFTER this suite, not before.', n);
  end if;

  select id into cell_samb_a1 from public.os_finish_line_cells where item_id = m_a1 and entity_code = 'SAMB';
  select id into cell_samb_b1 from public.os_finish_line_cells where item_id = m_b1 and entity_code = 'SAMB';
  select id into cell_samb_o1 from public.os_finish_line_cells where item_id = m_o1 and entity_code = 'SAMB';
  select id into cell_asi_b1  from public.os_finish_line_cells where item_id = m_b1 and entity_code = 'ASI';
  select id into cell_arbi_a1 from public.os_finish_line_cells where item_id = m_a1 and entity_code = 'ARBI';

  -- ===== 1. catalog: the table ==============================================
  checks := checks + 1;
  if not exists (
    select 1 from pg_constraint con
    where con.conrelid = 'public.os_finish_line_grants'::regclass and con.contype = 'p'
      and (select array_agg(a.attname::text order by a.attnum)
             from pg_attribute a
            where a.attrelid = con.conrelid and a.attnum = any (con.conkey))
          = array['user_id', 'entity_code', 'section_id']
  ) then
    failures := failures || 'CATALOG: os_finish_line_grants primary key is not (user_id, entity_code, section_id) — two rows for one (person, entity, section) can disagree';
  end if;

  checks := checks + 1;
  if not exists (select 1 from pg_attribute
                  where attrelid = 'public.os_finish_line_grants'::regclass
                    and attname = 'section_id' and attnotnull) then
    failures := failures || 'CATALOG: os_finish_line_grants.section_id is nullable — D2 says explicit rows, no wildcard';
  end if;

  checks := checks + 1;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.os_finish_line_grants'::regclass and contype = 'c'
                    and pg_get_constraintdef(oid) ~ 'capability') then
    failures := failures || 'CATALOG: no CHECK constraint on os_finish_line_grants.capability';
  end if;

  checks := checks + 1;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.os_finish_line_grants'::regclass and contype = 'f'
                    and confrelid = 'public.os_entity_members'::regclass and confdeltype = 'c') then
    failures := failures || 'CATALOG: no cascading foreign key from os_finish_line_grants to os_entity_members — a grant could outlive its enrolment';
  end if;

  -- ===== 2. catalog: the section guard ======================================
  checks := checks + 1;
  select tgtype into n from pg_trigger
   where tgrelid = 'public.os_finish_line_grants'::regclass
     and tgname = 'os_finish_line_grants_section_guard' and not tgisinternal;
  if n is null then
    failures := failures || 'CATALOG: trigger os_finish_line_grants_section_guard is missing from os_finish_line_grants';
  elsif (n::int & 2) = 0 or (n::int & 4) = 0 or (n::int & 16) = 0 then
    failures := failures || format('CATALOG: os_finish_line_grants_section_guard is not BEFORE INSERT OR UPDATE (tgtype %s)', n);
  end if;

  -- ===== 3. catalog: the three lookup functions =============================
  foreach fn in array array['os_member_readable_cells', 'os_member_writable_cells', 'os_member_granted_entities'] loop
    checks := checks + 1;
    select p.oid, p.prosecdef, p.proconfig into rec
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = fn and p.pronargs = 0;
    if rec.oid is null then
      failures := failures || format('CATALOG: public.%s() is missing', fn);
      continue;
    end if;
    if not rec.prosecdef then
      failures := failures || format('CATALOG: public.%s() is not SECURITY DEFINER — a member''s own read of os_finish_line_grants would decide their scope', fn);
    end if;
    if rec.proconfig is null or not exists (select 1 from unnest(rec.proconfig) c where c like 'search_path=%') then
      failures := failures || format('CATALOG: public.%s() does not pin search_path', fn);
    end if;
    if not has_function_privilege('authenticated', rec.oid, 'EXECUTE') then
      failures := failures || format('CATALOG: authenticated cannot EXECUTE public.%s() — every member read of cells will throw permission denied (the 7 August shape)', fn);
    end if;
    if has_function_privilege('anon', rec.oid, 'EXECUTE') then
      failures := failures || format('CATALOG: anon can EXECUTE public.%s() — no policy `to authenticated` needs that, and anon_definer_gates.sql will flag it as an ungated definer', fn);
    end if;
  end loop;

  checks := checks + 1;
  select p.oid into rec from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'os_finish_line_grants_section_guard';
  if rec.oid is null then
    failures := failures || 'CATALOG: public.os_finish_line_grants_section_guard() is missing';
  elsif has_function_privilege('anon', rec.oid, 'EXECUTE') or has_function_privilege('authenticated', rec.oid, 'EXECUTE') then
    failures := failures || 'CATALOG: a client role can EXECUTE os_finish_line_grants_section_guard() — trigger firing does not need it';
  end if;

  -- ===== 4. catalog: the policy sets ========================================
  -- Cells: exactly the two grant-derived member policies beside the four
  -- owner ones. The old entity-wide names must be gone.
  checks := checks + 1;
  select coalesce(array_agg(policyname || '|' || cmd || '|' || roles::text order by policyname), '{}') as pols into rec
    from pg_policies
   where schemaname = 'public' and tablename = 'os_finish_line_cells'
     and policyname not like 'require app key%';
  if rec.pols <> array[
       'member reads granted cells|SELECT|{authenticated}',
       'member updates writable cells|UPDATE|{authenticated}'] then
    failures := failures || format('CATALOG: member policies on os_finish_line_cells are %s, expected exactly [member reads granted cells|SELECT|{authenticated}, member updates writable cells|UPDATE|{authenticated}]', rec.pols);
  end if;
  checks := checks + 1;
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'os_finish_line_cells' and policyname like 'require app key%';
  if n <> 4 then
    failures := failures || format('CATALOG: os_finish_line_cells carries %s `require app key` policies, expected 4 — the owner path moved', n);
  end if;

  -- Accounts: one member SELECT policy, and no member write of any kind (D6).
  checks := checks + 1;
  select coalesce(array_agg(policyname || '|' || cmd || '|' || roles::text order by policyname), '{}') as pols into rec
    from pg_policies
   where schemaname = 'public' and tablename = 'os_finish_line_accounts'
     and policyname not like 'require app key%';
  if rec.pols <> array['member reads granted accounts|SELECT|{authenticated}'] then
    failures := failures || format('CATALOG: member policies on os_finish_line_accounts are %s, expected exactly [member reads granted accounts|SELECT|{authenticated}] (D6: members never write accounts)', rec.pols);
  end if;
  checks := checks + 1;
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'os_finish_line_accounts' and policyname like 'require app key%';
  if n <> 4 then
    failures := failures || format('CATALOG: os_finish_line_accounts carries %s `require app key` policies, expected 4 — the owner path moved', n);
  end if;

  -- Grants: the owner's four, a member's read of their own rows, no member write.
  checks := checks + 1;
  select coalesce(array_agg(policyname || '|' || cmd || '|' || roles::text order by policyname), '{}') as pols into rec
    from pg_policies
   where schemaname = 'public' and tablename = 'os_finish_line_grants'
     and policyname not like 'require app key%';
  if rec.pols <> array['member reads own grants|SELECT|{authenticated}'] then
    failures := failures || format('CATALOG: member policies on os_finish_line_grants are %s, expected exactly [member reads own grants|SELECT|{authenticated}]', rec.pols);
  end if;
  checks := checks + 1;
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'os_finish_line_grants' and policyname like 'require app key%'
     and coalesce(qual, '') !~ 'os_read_key_valid' and coalesce(with_check, '') !~ 'os_read_key_valid';
  if n <> 4 then
    failures := failures || format('CATALOG: os_finish_line_grants carries %s owner policies keyed on os_key_valid alone, expected 4 (the read-only key must not enumerate who sees what)', n);
  end if;

  -- History tables: no UPDATE or DELETE policy for anyone, owner included.
  -- os_research_* is deliberately NOT in this list: every one of those tables
  -- has carried the owner's four `require app key to …` policies, UPDATE and
  -- DELETE included, since it was created — they are working tables, not
  -- history, whatever a glance at the prefix suggests.
  checks := checks + 1;
  select coalesce(string_agg(tablename || ':' || policyname, ', ' order by tablename, policyname), '') into fn
    from pg_policies
   where schemaname = 'public'
     and tablename in ('os_finish_line_cell_history', 'os_task_history', 'os_process_text_history', 'os_sign_in_log')
     and cmd in ('UPDATE', 'DELETE', 'ALL');
  if fn <> '' then
    failures := failures || format('HISTORY: UPDATE/DELETE policy exists on a history table: %s — an editable audit trail is not an audit trail', fn);
  end if;

  -- ===== 5. scope, as A =====================================================
  perform set_config('request.headers', '{}', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  checks := checks + 1;
  select count(*) into n from public.os_finish_line_cells;
  if n <> 8 then failures := failures || format('SCOPE A: reads %s cells, expected 8 (SAMB A1 A2 B1, ARBI A1 A2 B1, ASI A1 A2)', n); end if;

  checks := checks + 1;
  select count(*) into n from public.os_finish_line_cells where item_id = m_o1;
  if n <> 0 then failures := failures || format('SCOPE A: sees %s cell(s) of the parentless metric O1 — D4 says a metric with no section is reachable by no grant', n); end if;

  checks := checks + 1;
  select count(*) into n from public.os_finish_line_cells where id = cell_asi_b1;
  if n <> 0 then failures := failures || 'SCOPE A: still sees ASI/B1 after the (ASI, S2) grant was revoked'; end if;

  checks := checks + 1;
  select count(*) into n from public.os_finish_line_cells where id = cell_samb_b1;
  if n <> 1 then failures := failures || 'SCOPE A: cannot see SAMB/B1 through a read-only grant — read must still read'; end if;

  checks := checks + 1;
  readable := public.os_member_readable_cells();
  writable := public.os_member_writable_cells();
  if coalesce(cardinality(readable), 0) <> 8 then failures := failures || format('SCOPE A: os_member_readable_cells() has %s ids, expected 8', coalesce(cardinality(readable), 0)); end if;
  if coalesce(cardinality(writable), 0) <> 7 then failures := failures || format('SCOPE A: os_member_writable_cells() has %s ids, expected 7', coalesce(cardinality(writable), 0)); end if;
  if not (cell_samb_b1 = any (readable)) or cell_samb_b1 = any (writable) then
    failures := failures || 'SCOPE A: SAMB/B1 under a read grant must be in the readable set and NOT in the writable set';
  end if;
  if cell_samb_o1 = any (readable) or cell_asi_b1 = any (readable) then
    failures := failures || 'SCOPE A: the parentless cell or the revoked cell is in os_member_readable_cells()';
  end if;

  checks := checks + 1;
  select coalesce(cardinality(public.os_member_granted_entities()), 0) into n;
  if n <> 5 then failures := failures || format('SCOPE A: os_member_granted_entities() has %s codes, expected 5 (a grant survives on every entity A holds)', n); end if;

  -- ===== 6. writes, as A ====================================================
  -- Read capability: the UPDATE matches nothing, the trigger never runs, no
  -- history is written.
  checks := checks + 1;
  update public.os_finish_line_cells set state = 'figure' where id = cell_samb_b1;
  get diagnostics n = row_count;
  if n <> 0 then failures := failures || format('WRITE A: UPDATE on SAMB/B1 through a READ grant matched %s row(s), expected 0', n); end if;

  -- Write capability: one row, stamped, one history row naming A.
  checks := checks + 1;
  update public.os_finish_line_cells set state = 'figure' where id = cell_samb_a1;
  get diagnostics n = row_count;
  if n <> 1 then failures := failures || format('WRITE A: UPDATE on SAMB/A1 through a WRITE grant matched %s row(s), expected 1', n); end if;

  -- Revoked and parentless: nothing to match.
  checks := checks + 1;
  update public.os_finish_line_cells set note = 'should not land' where id = cell_asi_b1;
  get diagnostics n = row_count;
  if n <> 0 then failures := failures || 'WRITE A: UPDATE on revoked ASI/B1 matched a row'; end if;
  update public.os_finish_line_cells set note = 'should not land' where id = cell_samb_o1;
  get diagnostics n = row_count;
  if n <> 0 then failures := failures || 'WRITE A: UPDATE on parentless SAMB/O1 matched a row'; end if;

  execute 'reset role';
  checks := checks + 1;
  select state into v_state from public.os_finish_line_cells where id = cell_samb_b1;
  if v_state <> 'input' then failures := failures || format('WRITE A: SAMB/B1 is now %s — a read grant wrote', v_state); end if;
  select count(*) into n from public.os_finish_line_cell_history where cell_id = cell_samb_b1;
  if n <> 0 then failures := failures || format('WRITE A: %s history row(s) for SAMB/B1 after a read-only UPDATE', n); end if;

  checks := checks + 1;
  select state, actor_kind, actor into v_state, v_kind, v_actor from public.os_finish_line_cells where id = cell_samb_a1;
  if v_state <> 'figure' or v_kind <> 'contributor' or v_actor is distinct from uid_a then
    failures := failures || format('WRITE A: SAMB/A1 stamp wrong after the write (state=%s actor_kind=%s actor=%s)', v_state, v_kind, v_actor);
  end if;
  select count(*) into n from public.os_finish_line_cell_history where cell_id = cell_samb_a1;
  if n <> 1 then failures := failures || format('WRITE A: %s history row(s) for SAMB/A1, expected exactly 1 from the trigger', n); end if;
  select count(*) into n from public.os_finish_line_cell_history
   where cell_id = cell_samb_a1 and from_state = 'input' and to_state = 'figure'
     and actor_kind = 'contributor' and actor = uid_a;
  if n <> 1 then failures := failures || 'WRITE A: the SAMB/A1 history row does not say input -> figure by contributor A'; end if;

  -- ===== 7. accounts, as A ==================================================
  execute 'set local role authenticated';
  checks := checks + 1;
  select count(*) into n from public.os_finish_line_accounts;
  if n <> 7 then failures := failures || format('ACCOUNTS A: reads %s accounts, expected 7 (SAMB A1 x2 + B1 + unmapped x2, ARBI A1 + unmapped)', n); end if;
  checks := checks + 1;
  select count(*) into n from public.os_finish_line_accounts where cell_id = cell_samb_o1;
  if n <> 0 then failures := failures || 'ACCOUNTS A: the account under parentless SAMB/O1 is visible'; end if;
  checks := checks + 1;
  select count(*) into n from public.os_finish_line_accounts where entity_code is null;
  if n <> 0 then failures := failures || 'ACCOUNTS A: an unmapped account with NO entity is visible — D3 has nothing to key on there'; end if;
  checks := checks + 1;
  select count(*) into n from public.os_finish_line_accounts where cell_id is null and entity_code = 'SAMB';
  if n <> 2 then failures := failures || format('ACCOUNTS A: %s unmapped SAMB accounts, expected 2 (D3: any grant on the entity)', n); end if;
  select count(*) into n from public.os_finish_line_accounts where cell_id is null and entity_code = 'ARBI';
  if n <> 1 then failures := failures || format('ACCOUNTS A: %s unmapped ARBI accounts, expected 1', n); end if;
  checks := checks + 1;
  select count(*) into n from public.os_finish_line_accounts where cell_id = cell_asi_b1;
  if n <> 0 then failures := failures || 'ACCOUNTS A: the account under revoked ASI/B1 is visible'; end if;
  select count(*) into n from public.os_finish_line_accounts where cell_id = cell_samb_b1;
  if n <> 1 then failures := failures || 'ACCOUNTS A: the account under read-only SAMB/B1 is not visible — read must read accounts too'; end if;

  -- ===== 8. B: one entity, both sections, write =============================
  perform set_config('request.jwt.claims', json_build_object('sub', uid_b, 'role', 'authenticated')::text, true);
  checks := checks + 1;
  select count(*) into n from public.os_finish_line_cells;
  if n <> 3 then failures := failures || format('SCOPE B: reads %s cells, expected 3 (ARBI A1 A2 B1)', n); end if;
  select count(*) into n from public.os_finish_line_cells where entity_code <> 'ARBI';
  if n <> 0 then failures := failures || format('SCOPE B: sees %s non-ARBI cell(s)', n); end if;
  checks := checks + 1;
  select count(*) into n from public.os_finish_line_accounts;
  if n <> 2 then failures := failures || format('ACCOUNTS B: reads %s accounts, expected 2 (ARBI A1, ARBI unmapped)', n); end if;
  checks := checks + 1;
  update public.os_finish_line_cells set note = 'suite: B writes a note' where id = cell_arbi_a1;
  get diagnostics n = row_count;
  if n <> 1 then failures := failures || format('WRITE B: note UPDATE on ARBI/A1 matched %s row(s), expected 1', n); end if;
  execute 'reset role';
  select count(*) into n from public.os_finish_line_cell_history
   where cell_id = cell_arbi_a1 and note_changed and actor_kind = 'contributor' and actor = uid_b;
  if n <> 1 then failures := failures || format('WRITE B: %s history row(s) for the note change, expected 1 naming B', n); end if;

  -- ===== 9. C: enrolled, no grant =========================================
  perform set_config('request.jwt.claims', json_build_object('sub', uid_c, 'role', 'authenticated')::text, true);
  select count(*) into expected from public.os_finish_line_items;
  execute 'set local role authenticated';
  checks := checks + 1;
  select count(*) into n from public.os_finish_line_cells;
  if n <> 0 then failures := failures || format('SCOPE C: enrolled with no grant reads %s cell(s), expected 0', n); end if;
  select count(*) into n from public.os_finish_line_accounts;
  if n <> 0 then failures := failures || format('ACCOUNTS C: enrolled with no grant reads %s account(s), expected 0 (D3 keys on grants, not membership)', n); end if;
  checks := checks + 1;
  select count(*) into n from public.os_entity_members;
  if n <> 1 then failures := failures || format('SCOPE C: reads %s membership rows, expected exactly their own 1 — the enrolment still stands', n); end if;
  select count(*) into n from public.os_finish_line_items;
  if n <> expected then failures := failures || format('SCOPE C: reads %s items, expected all %s — structure still hangs off membership', n, expected); end if;
  select count(*) into n from public.os_finish_line_grants;
  if n <> 0 then failures := failures || format('SCOPE C: reads %s grant rows, expected 0', n); end if;

  -- ===== 10. the grants table, as A =========================================
  execute 'reset role';
  select count(*) into expected from public.os_finish_line_grants where user_id = uid_a;
  perform set_config('request.jwt.claims', json_build_object('sub', uid_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  checks := checks + 1;
  select count(*) into n from public.os_finish_line_grants;
  if n <> expected or expected <> 9 then failures := failures || format('GRANTS A: reads %s grant rows, expected their own %s (and the fixture pins 9: 10 backfilled minus the revoked one)', n, expected); end if;
  select count(*) into n from public.os_finish_line_grants where user_id <> uid_a;
  if n <> 0 then failures := failures || format('GRANTS A: reads %s grant row(s) belonging to somebody else', n); end if;

  checks := checks + 1;
  begin
    insert into public.os_finish_line_grants (user_id, entity_code, section_id, capability, created_by)
    values (uid_a, 'ASI', s2, 'write', 'self');
    failures := failures || 'GRANTS A: a member re-granted themselves the revoked (ASI, S2) — INSERT was allowed';
  exception
    when insufficient_privilege then null;
    when others then failures := failures || format('GRANTS A: self-grant INSERT failed as %s (%s), not as RLS 42501', sqlstate, sqlerrm);
  end;

  checks := checks + 1;
  update public.os_finish_line_grants set capability = 'write'
   where user_id = uid_a and entity_code = 'SAMB' and section_id = s2;
  get diagnostics n = row_count;
  if n <> 0 then failures := failures || format('GRANTS A: a member upgraded their own capability — UPDATE matched %s row(s)', n); end if;
  delete from public.os_finish_line_grants where user_id = uid_a;
  get diagnostics n = row_count;
  if n <> 0 then failures := failures || format('GRANTS A: member DELETE matched %s row(s)', n); end if;
  execute 'reset role';
  select capability into fn from public.os_finish_line_grants
   where user_id = uid_a and entity_code = 'SAMB' and section_id = s2;
  if fn <> 'read' then failures := failures || format('GRANTS A: (SAMB, S2) is now %s after a member UPDATE', fn); end if;

  -- ===== 11. the section guard, as postgres (RLS off, triggers on) =========
  checks := checks + 1;
  begin
    insert into public.os_finish_line_grants (user_id, entity_code, section_id, capability, created_by)
    values (uid_b, 'ARBI', m_a1, 'read', 'suite');
    failures := failures || 'GUARD: a grant naming a METRIC was accepted';
  exception
    when check_violation then
      if sqlerrm not like '%kind = ''section''%' then
        failures := failures || format('GUARD: metric refused with the wrong message: %s', sqlerrm);
      end if;
    when others then failures := failures || format('GUARD: metric refused by the wrong layer: %s (%s)', sqlerrm, sqlstate);
  end;
  checks := checks + 1;
  begin
    insert into public.os_finish_line_grants (user_id, entity_code, section_id, capability, created_by)
    values (uid_b, 'ARBI', n_n1, 'read', 'suite');
    failures := failures || 'GUARD: a grant naming a NOTE was accepted';
  exception
    when check_violation then null;
    when others then failures := failures || format('GUARD: note refused by the wrong layer: %s (%s)', sqlerrm, sqlstate);
  end;
  checks := checks + 1;
  begin
    insert into public.os_finish_line_grants (user_id, entity_code, section_id, capability, created_by)
    values (uid_b, 'ARBI', '00000000-0000-4000-8000-00000000beef', 'read', 'suite');
    failures := failures || 'GUARD: a grant naming an id that is no item was accepted';
  exception
    when check_violation then
      if sqlerrm not like '%no item at all%' then
        failures := failures || format('GUARD: unknown id refused with the wrong message: %s', sqlerrm);
      end if;
    when others then failures := failures || format('GUARD: unknown id refused by the wrong layer: %s (%s)', sqlerrm, sqlstate);
  end;
  checks := checks + 1;
  begin
    update public.os_finish_line_grants set section_id = m_a1
     where user_id = uid_b and entity_code = 'ARBI' and section_id = s1;
    failures := failures || 'GUARD: an UPDATE moving a grant onto a METRIC was accepted';
  exception
    when check_violation then null;
    when others then failures := failures || format('GUARD: UPDATE toward a metric refused by the wrong layer: %s (%s)', sqlerrm, sqlstate);
  end;

  -- ===== 12. the owner path: anon + x-app-key ===============================
  select count(*) into expected from public.os_finish_line_cells;
  select count(*) into n from public.os_finish_line_accounts;
  perform set_config('request.headers', json_build_object('x-app-key', owner_key)::text, true);
  perform set_config('request.jwt.claims', '{}', true);
  execute 'set local role anon';
  checks := checks + 1;
  select count(*) into n2 from public.os_finish_line_cells;
  if n2 <> expected then failures := failures || format('OWNER: reads %s cells, expected all %s', n2, expected); end if;
  select count(*) into n2 from public.os_finish_line_accounts;
  if n2 <> n then failures := failures || format('OWNER: reads %s accounts, expected all %s', n2, n); end if;
  select count(*) into n from public.os_finish_line_grants;
  if n <> 11 then failures := failures || format('OWNER: reads %s grant rows, expected all 11 (A 9 + B 2)', n); end if;

  -- The owner grants C read on (SAMB, S1): the write the dashboard will make.
  checks := checks + 1;
  begin
    insert into public.os_finish_line_grants (user_id, entity_code, section_id, capability, created_by)
    values (uid_c, 'SAMB', s1, 'read', 'owner');
    get diagnostics n = row_count;
    if n <> 1 then failures := failures || format('OWNER: grant INSERT matched %s row(s), expected 1', n); end if;
  exception when others then
    failures := failures || format('OWNER: grant INSERT failed: %s (%s)', sqlerrm, sqlstate);
  end;
  execute 'reset role';

  -- ===== 13. C, now holding one read grant ==================================
  perform set_config('request.headers', '{}', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid_c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  checks := checks + 1;
  select count(*) into n from public.os_finish_line_cells;
  if n <> 2 then failures := failures || format('SCOPE C+read: reads %s cells, expected 2 (SAMB A1 A2 under S1)', n); end if;
  select count(*) into n from public.os_finish_line_accounts;
  if n <> 4 then failures := failures || format('ACCOUNTS C+read: reads %s accounts, expected 4 (SAMB A1 x2 mapped, SAMB unmapped x2 by D3)', n); end if;
  checks := checks + 1;
  if coalesce(cardinality(public.os_member_writable_cells()), 0) <> 0 then
    failures := failures || 'SCOPE C+read: os_member_writable_cells() is not empty under a read-only grant';
  end if;
  update public.os_finish_line_cells set note = 'C should not write' where id = cell_samb_a1;
  get diagnostics n = row_count;
  if n <> 0 then failures := failures || format('WRITE C+read: UPDATE matched %s row(s) through a read grant', n); end if;

  -- ===== 14. revoke C's membership: the grant must go with it ===============
  execute 'reset role';
  delete from public.os_entity_members where user_id = uid_c and entity_code = 'SAMB';
  checks := checks + 1;
  select count(*) into n from public.os_finish_line_grants where user_id = uid_c;
  if n <> 0 then failures := failures || format('CASCADE: %s grant row(s) survive the membership revoke', n); end if;
  execute 'set local role authenticated';
  select count(*) into n from public.os_finish_line_cells;
  if n <> 0 then failures := failures || format('CASCADE: C still reads %s cell(s) after the membership revoke', n); end if;
  select count(*) into n from public.os_finish_line_accounts;
  if n <> 0 then failures := failures || format('CASCADE: C still reads %s account(s) after the membership revoke', n); end if;
  execute 'reset role';

  -- ===== 15. anon: no JWT, no header ========================================
  perform set_config('request.headers', '{}', true);
  perform set_config('request.jwt.claims', '{}', true);
  execute 'set local role anon';
  checks := checks + 1;
  select count(*) into n from public.os_finish_line_cells;
  if n <> 0 then failures := failures || format('ANON: reads %s cell(s)', n); end if;
  select count(*) into n from public.os_finish_line_accounts;
  if n <> 0 then failures := failures || format('ANON: reads %s account(s)', n); end if;
  select count(*) into n from public.os_finish_line_grants;
  if n <> 0 then failures := failures || format('ANON: reads %s grant row(s)', n); end if;
  checks := checks + 1;
  begin
    perform public.os_member_readable_cells();
    failures := failures || 'ANON: can call os_member_readable_cells() — the anon revoke is missing';
  exception
    when insufficient_privilege then null;
    when others then failures := failures || format('ANON: os_member_readable_cells() failed as %s, not permission denied', sqlstate);
  end;
  execute 'reset role';

  -- ===== floor ==============================================================
  -- A check that can never fail proves nothing. Every branch above increments
  -- `checks`; if the count ever drops below the floor the file was edited
  -- into silence, not made healthier.
  if checks < 45 then
    failures := failures || format('AUDIT INERT: only %s checks ran, below the floor of 45 — the suite was hollowed out, fix it before trusting a zero-row result', checks);
  end if;

  insert into fl_grant_findings select unnest(failures);
end
$$;

select finding from fl_grant_findings order by finding;

rollback;
