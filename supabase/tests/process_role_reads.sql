-- ===========================================================================
-- §11 — READING THE NINE os_process_* TABLES AS THE ROLES THAT ACTUALLY READ
-- THEM. THE INVARIANT THAT MATTERS MOST IS ZERO THROWS.
-- ===========================================================================
--
-- Same contract as integrity_checks.sql and process_entity_checks.sql: every
-- query returns ZERO ROWS when healthy, and any row it returns names what
-- broke. Run through scripts/role-read-tests.sh, which builds the throwaway
-- cluster and loads fixtures/role_read_fixture.sql first.
--
-- WHY THIS SUITE EXISTS
-- On 7 August, `permission denied for function os_member_entities` reached
-- production on every process read, and the whole vitest suite stayed green.
-- It had to: every frontend test runs against a repository double, so nothing
-- in this repo had ever run a SELECT as `anon` or `authenticated`. A row count
-- was never the thing that broke — the QUERY broke — so the assertion that
-- carries the weight here is not "how many rows" but "did it throw at all".
-- Section 0 checks exactly that, for all nine tables under all four
-- conditions, before any count is looked at.
--
-- WHY IT IS NOT RUN AGAINST LIVE
-- It reads as `anon` and as two contributors, which live cannot impersonate
-- without real JWTs, and its fixture writes auth.users rows. The fixture
-- refuses to run where the app secret is set.

-- ---------------------------------------------------------------------------
-- The harness: run one query under one identity and report what happened.
-- ---------------------------------------------------------------------------
-- `set local role` inside a function is scoped to the statement's own
-- transaction, so each call is isolated and nothing leaks into the next.
-- Both the role switch and the query sit inside the same BEGIN/EXCEPTION
-- block, so a throw rolls the role back with the subtransaction rather than
-- stranding the session as `anon`.
--
-- request.headers is set to '{}' rather than left empty for the no-key case:
-- os_key_valid() casts it with `::json`, and '' is not valid json — an empty
-- string would make every anon read fail with a cast error that looks exactly
-- like the permission failure this suite is hunting.
create or replace function pg_temp.read_as(
  role_name text,
  jwt_sub   text,   -- null → no JWT at all, which is what `anon` means
  app_key   text,   -- null → no x-app-key header, i.e. not the owner
  query     text
) returns text language plpgsql as $$
declare n bigint;
begin
  begin
    perform set_config(
      'request.jwt.claims',
      case when jwt_sub is null then '' else json_build_object('sub', jwt_sub)::text end,
      true);
    perform set_config(
      'request.headers',
      case when app_key is null then '{}' else json_build_object('x-app-key', app_key)::text end,
      true);
    execute format('set local role %I', role_name);
    execute query into n;
    return n::text;
  exception when others then
    return 'THREW ' || SQLSTATE || ' ' || SQLERRM;
  end;
end
$$;

-- The four identities of §11, named once.
create or replace function pg_temp.as_anon_nokey(q text) returns text language sql as
$$ select pg_temp.read_as('anon', null, null, q) $$;

create or replace function pg_temp.as_owner(q text) returns text language sql as
$$ select pg_temp.read_as('anon', null, 'role-suite-owner-passphrase', q) $$;

create or replace function pg_temp.as_member5(q text) returns text language sql as
$$ select pg_temp.read_as('authenticated', '11111111-1111-4111-8111-111111111111', null, q) $$;

create or replace function pg_temp.as_arbi(q text) returns text language sql as
$$ select pg_temp.read_as('authenticated', '22222222-2222-4222-8222-222222222222', null, q) $$;

-- The nine tables, in one place so no section can quietly test eight.
create or replace function pg_temp.process_tables() returns setof text language sql as $$
  select unnest(array[
    'os_process_steps', 'os_process_needs', 'os_process_step_items',
    'os_process_lanes', 'os_process_phases', 'os_process_tracks',
    'os_process_gates', 'os_process_references', 'os_process_text_history'])
$$;

-- ===========================================================================
-- 0. NOTHING THROWS. Nine tables x four identities = 36 reads, zero errors.
--    This is the check the last regression would have failed, and it is
--    deliberately first: a count assertion below cannot be trusted while a
--    read is still capable of erroring.
-- ===========================================================================
select 'THROWS: ' || identity || ' reading ' || tbl || ' → ' || result as problem
from (
  select 'anon (no key)' as identity, t as tbl,
         pg_temp.as_anon_nokey(format('select count(*) from public.%I', t)) as result
  from pg_temp.process_tables() t
  union all
  select 'owner (anon + x-app-key)', t,
         pg_temp.as_owner(format('select count(*) from public.%I', t))
  from pg_temp.process_tables() t
  union all
  select 'member of five entities', t,
         pg_temp.as_member5(format('select count(*) from public.%I', t))
  from pg_temp.process_tables() t
  union all
  select 'member of ARBI only', t,
         pg_temp.as_arbi(format('select count(*) from public.%I', t))
  from pg_temp.process_tables() t
) r
where result like 'THREW%';

-- ===========================================================================
-- 1. `anon` WITHOUT A KEY SEES NOTHING — and sees it silently.
--    Not a member, not the owner: every one of the nine returns 0. Section 0
--    already proved none of them threw, so a non-zero here means a policy is
--    handing rows to the open internet.
-- ===========================================================================
select 'anon without key read ' || result || ' rows from ' || tbl
       || ' (expected 0)' as problem
from (
  select t as tbl, pg_temp.as_anon_nokey(format('select count(*) from public.%I', t)) as result
  from pg_temp.process_tables() t
) r
where result <> '0';

-- ===========================================================================
-- 2. THE OWNER SEES EVERYTHING. The §1 ledger numbers, pinned.
--    53 steps = SAMB 30 + ARBI 23. 230 needs. 83 bridge pairs = SAMB 46
--    (45 from the seed + the 18b pair recorded by migration 56) + ARBI 37.
-- ===========================================================================
select 'owner: ' || what || ' = ' || got || ', expected ' || expected as problem
from (
  select 'steps'        as what, pg_temp.as_owner('select count(*) from public.os_process_steps')                  as got, '53'  as expected
  union all select 'steps SAMB',  pg_temp.as_owner($q$select count(*) from public.os_process_steps where entity_code='SAMB'$q$), '30'
  union all select 'steps ARBI',  pg_temp.as_owner($q$select count(*) from public.os_process_steps where entity_code='ARBI'$q$), '23'
  union all select 'needs',       pg_temp.as_owner('select count(*) from public.os_process_needs'),                '230'
  union all select 'bridge',      pg_temp.as_owner('select count(*) from public.os_process_step_items'),           '83'
  union all select 'lanes',       pg_temp.as_owner('select count(*) from public.os_process_lanes'),                '12'
  union all select 'phases',      pg_temp.as_owner('select count(*) from public.os_process_phases'),               '14'
  union all select 'tracks',      pg_temp.as_owner('select count(*) from public.os_process_tracks'),               '6'
  union all select 'gates',       pg_temp.as_owner('select count(*) from public.os_process_gates'),                '27'
  union all select 'text_history',pg_temp.as_owner('select count(*) from public.os_process_text_history'),         '1'
) t
where got <> expected;

-- ===========================================================================
-- 3. A MEMBER OF ALL FIVE ENTITIES READS WHAT THE OWNER READS — for eight of
--    the nine tables. Only SAMB and ARBI have chains, so "all five" and "all
--    there is" are the same set.
-- ===========================================================================
select 'five-entity member: ' || what || ' = ' || got || ', expected ' || expected as problem
from (
  select 'steps'  as what, pg_temp.as_member5('select count(*) from public.os_process_steps')        as got, '53' as expected
  union all select 'needs',      pg_temp.as_member5('select count(*) from public.os_process_needs'),      '230'
  union all select 'bridge',     pg_temp.as_member5('select count(*) from public.os_process_step_items'), '83'
  union all select 'lanes',      pg_temp.as_member5('select count(*) from public.os_process_lanes'),      '12'
  union all select 'phases',     pg_temp.as_member5('select count(*) from public.os_process_phases'),     '14'
  union all select 'tracks',     pg_temp.as_member5('select count(*) from public.os_process_tracks'),     '6'
  union all select 'gates',      pg_temp.as_member5('select count(*) from public.os_process_gates'),      '27'
  union all select 'references', pg_temp.as_member5('select count(*) from public.os_process_references'), '1'
) t
where got <> expected;

-- ===========================================================================
-- 3b. THE NINTH TABLE IS THE POINT: zero rows, WITHOUT an error.
--     os_process_text_history deliberately has no member policy (§14 item 11).
--     The fixture puts one row in it, so this distinguishes "the policy denies
--     the member" from "the table happens to be empty" — without that row the
--     assertion would pass even if someone added a member policy tomorrow.
--     Section 0 already established it did not throw; this pins the count.
-- ===========================================================================
select 'five-entity member read ' || got
       || ' rows from os_process_text_history (expected 0, without error)' as problem
from (select pg_temp.as_member5('select count(*) from public.os_process_text_history') as got) t
where got <> '0';

-- ===========================================================================
-- 4. A MEMBER OF ARBI ALONE SEES ARBI ALONE.
--    This is also the proof that the entity picker narrows itself with no
--    frontend code: the picker is built from `distinct entity_code` over the
--    rows that came back, so zero SAMB rows IS a one-entity picker.
-- ===========================================================================
select 'ARBI-only member: ' || what || ' = ' || got || ', expected ' || expected as problem
from (
  select 'steps'  as what, pg_temp.as_arbi('select count(*) from public.os_process_steps')        as got, '23' as expected
  union all select 'needs',  pg_temp.as_arbi('select count(*) from public.os_process_needs'),         '112'
  union all select 'bridge', pg_temp.as_arbi('select count(*) from public.os_process_step_items'),    '37'
  union all select 'lanes',  pg_temp.as_arbi('select count(*) from public.os_process_lanes'),         '6'
  union all select 'phases', pg_temp.as_arbi('select count(*) from public.os_process_phases'),        '7'
  union all select 'tracks', pg_temp.as_arbi('select count(*) from public.os_process_tracks'),        '3'
  union all select 'gates',  pg_temp.as_arbi('select count(*) from public.os_process_gates'),         '12'
) t
where got <> expected;

-- Zero SAMB rows, stated as its own assertion on every table that carries an
-- entity — a count that merely MATCHES ARBI's could still be the wrong rows.
select 'ARBI-only member saw ' || got || ' SAMB rows in ' || tbl || ' (expected 0)' as problem
from (
  select 'os_process_steps' as tbl,
         pg_temp.as_arbi($q$select count(*) from public.os_process_steps where entity_code='SAMB'$q$) as got
  union all select 'os_process_lanes',
         pg_temp.as_arbi($q$select count(*) from public.os_process_lanes where entity_code='SAMB'$q$)
  union all select 'os_process_phases',
         pg_temp.as_arbi($q$select count(*) from public.os_process_phases where entity_code='SAMB'$q$)
  union all select 'os_process_tracks',
         pg_temp.as_arbi($q$select count(*) from public.os_process_tracks where entity_code='SAMB'$q$)
  union all select 'os_process_gates',
         pg_temp.as_arbi($q$select count(*) from public.os_process_gates where entity_code='SAMB'$q$)
  union all select 'os_process_needs',
         pg_temp.as_arbi($q$select count(*) from public.os_process_needs n
                            join public.os_process_steps s on s.id = n.step_id
                            where s.entity_code='SAMB'$q$)
  union all select 'os_process_step_items',
         pg_temp.as_arbi($q$select count(*) from public.os_process_step_items i
                            join public.os_process_steps s on s.id = i.step_id
                            where s.entity_code='SAMB'$q$)
) t
where got <> '0';

-- ===========================================================================
-- 5. CONTRIBUTORS ARE READ-ONLY, AND `requested_on` IS THE ONE THAT TEMPTS.
--    The register renders it as an editable date input. Only the owner may
--    write it (§13, §14 item 12). An UPDATE that matches no row under RLS
--    reports 0 rows rather than throwing, so the assertion is "0 rows
--    affected" — and the read directly after proves nothing changed.
-- ===========================================================================
select 'contributor wrote requested_on: ' || got || ' (expected 0 rows affected)' as problem
from (
  select pg_temp.read_as('authenticated', '11111111-1111-4111-8111-111111111111', null,
    $q$with w as (update public.os_process_needs set requested_on = '2026-01-01' returning 1)
       select count(*) from w$q$) as got
) t
where got <> '0';

-- ===========================================================================
-- 6. THE GRANT ITSELF, STATED AS A FACT ABOUT THE DATABASE.
--    Sections 0-5 fail if this is missing, but they fail with 36 error rows
--    that all say the same thing. This one line names the cause, so the next
--    person reads one sentence instead of reverse-engineering it from a wall
--    of THREW.
-- ===========================================================================
select 'os_member_entities() has no EXECUTE for `' || r || '`, but the member '
       || 'policies are `to public` — see 20260806000057' as problem
from unnest(array['anon', 'authenticated']) r
where not has_function_privilege(r, 'public.os_member_entities()', 'EXECUTE');
