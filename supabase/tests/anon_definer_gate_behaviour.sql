-- ===========================================================================
-- THE GATES, CALLED. NOT READ.
-- ===========================================================================
--
-- Companion to anon_definer_gates.sql, which matches gate names against
-- prosrc. That check is live-safe and cheap, and it has one blind spot that
-- cost this project a shipped-and-applied migration:
--
--   A CATALOG CHECK CANNOT TELL A GATE THAT RUNS FROM A GATE THAT IS MERELY
--   MENTIONED.
--
-- 20260827000089 gated os_lab_stale_sweep on
-- `current_user in ('anon','authenticated')`. Inside a SECURITY DEFINER body
-- current_user is the function OWNER, so the condition was false for every
-- caller and the gate did nothing. The body still contained the string
-- `os_key_valid`, so anon_definer_gates.sql passed — and so did its negative
-- control, because removing the gate removes the text too. The hole was
-- applied to production before a live probe found it.
--
-- So this file calls them. Same contract as every suite here: ZERO ROWS when
-- healthy; any row names the function that did not refuse.
--
-- Runs as postgres inside one transaction that ends in ROLLBACK — the same
-- posture as lab_epistemic_gates.sql, and what makes calling functions with
-- side effects safe against live. Every call is made as `anon` with no
-- x-app-key present, which is exactly what an unauthenticated HTTP caller is.
--
--     psql "$DATABASE_URL" -f supabase/tests/anon_definer_gate_behaviour.sql
--     scripts/role-read-tests.sh
--
-- ---------------------------------------------------------------------------
-- HOW THE CALLS ARE BUILT
-- ---------------------------------------------------------------------------
-- Every IN parameter is passed NULL, cast to its declared type. That is safe
-- and sufficient because a correctly written function gates FIRST — the four
-- os_share_link_* functions all open with `perform private.os_share_owner_
-- gate()` — so NULL never reaches argument validation. A function that
-- validates before it gates will not raise insufficient_privilege and will be
-- reported here, which is the right answer: gate-after-work is a finding.
--
-- The exemption list is the same three as anon_definer_gates.sql and is
-- justified there at length. os_verify_key is deliberately absent from it for
-- the reason given there; on a correctly migrated database it is not
-- anon-executable and never reaches this loop.

begin;

create temp table gate_behaviour_findings (finding text);

do $$
declare
  fn record;
  args text;
  stmt text;
  exempt text[] := array['os_key_valid','os_read_key_valid','os_member_entities'];
  examined int := 0;
begin
  -- Make sure no app key is presented: this is the unauthenticated case.
  perform set_config('request.headers', '{}', true);

  for fn in
    select p.oid,
           p.proname,
           p.provolatile,
           (select coalesce(string_agg('null::' || format_type(t, null), ', ' order by ord), '')
              from unnest(p.proargtypes) with ordinality as u(t, ord)) as arglist
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and has_function_privilege('anon', p.oid, 'EXECUTE')
      and not (p.proname = any (exempt))
    order by p.proname
  loop
    examined := examined + 1;
    args := fn.arglist;
    stmt := format('select public.%I(%s)', fn.proname, args);

    begin
      -- Each call gets its own savepoint so one function's writes cannot
      -- reach the next, even before the outer ROLLBACK.
      begin
        set local role anon;
        execute stmt;
        reset role;
        insert into gate_behaviour_findings values (format(
          'UNGATED IN PRACTICE: public.%s(%s) was called as `anon` with no x-app-key and did NOT raise. '
          || 'Its body may mention a gate, but the gate does not fire — check whether it reads current_user '
          || 'inside a SECURITY DEFINER body (that is the definer, never the caller; use the `role` GUC). '
          || 'This is the failure anon_definer_gates.sql structurally cannot see.',
          fn.proname, args));
      exception
        when insufficient_privilege then
          reset role;  -- correct: the gate refused
        when others then
          reset role;
          -- Anything else means the function got past its gate and failed
          -- somewhere inside on NULL arguments — so the gate did not refuse.
          insert into gate_behaviour_findings values (format(
            'GATE RAN LATE OR NOT AT ALL: public.%s(%s) as `anon` raised %L (SQLSTATE %s) rather than '
            || 'insufficient_privilege. A gated function refuses before it validates arguments; this one '
            || 'reached its body first.',
            fn.proname, args, sqlerrm, sqlstate));
      end;
    end;
  end loop;

  -- A check that can never fail proves nothing. A correctly migrated database
  -- carries five non-exempt anon-executable definers: the four os_share_link_*
  -- functions and os_lab_stale_sweep. Below three means the loop stopped
  -- finding things rather than the schema shrinking.
  if examined < 3 then
    insert into gate_behaviour_findings values (format(
      'AUDIT INERT: the behavioural check examined only %s functions, below the floor of 3. '
      || 'The enumeration is broken, not the schema — fix it before trusting a zero-row result.',
      examined));
  end if;
end $$;

select finding from gate_behaviour_findings order by finding;

rollback;
