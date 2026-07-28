-- ===========================================================================
-- RLS: evaluate os_key_valid() ONCE PER STATEMENT, not once per row.
-- ===========================================================================
-- Every os_ table's policy was `using (os_key_valid())`. Used bare as a
-- predicate, Postgres calls the function per row, and os_key_valid() ends in
-- a bcrypt comparison that is deliberately slow (~5.6ms). The cost therefore
-- scales with row count: at 560 rows os_finish_line_accounts took ~3.1s,
-- crossed the anon role's 3s statement_timeout, and every read of it 500ed.
-- Measured live before this migration:
--
--   Filter: os_key_valid()                (per row)
--   Rows Removed by Filter: 560
--   Execution Time: 3128.688 ms           (> 3s -> statement_timeout -> 500)
--
-- Wrapping the call in a scalar subquery makes the planner evaluate it as an
-- InitPlan — once per statement — which is the pattern Supabase documents for
-- policies that call a function. Same key, same hash, same function, checked
-- once instead of N times. This weakens nothing: a request that fails the
-- check still matches zero rows.
--
-- Applied to EVERY policy that calls os_key_valid(), not only the failing
-- table. The others pay the same per-row cost and simply have not crossed the
-- timeout yet; the next data load would push another one over.
--
-- The policies are enumerated from pg_policy at execution time rather than
-- hardcoded, so a table added after this file was written is corrected too,
-- and re-running is a no-op (the rewritten form contains SELECT and no longer
-- matches the filter).
--
-- os_key_valid() itself is deliberately untouched: body, volatility,
-- SECURITY DEFINER and search_path are all unchanged. Only the way policies
-- invoke it changes.

do $$
declare
  pol record;
begin
  for pol in
    select
      n.nspname  as schema_name,
      c.relname  as table_name,
      p.polname  as policy_name,
      pg_get_expr(p.polqual, p.polrelid)      as using_expr,
      pg_get_expr(p.polwithcheck, p.polrelid) as check_expr
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and (
        (pg_get_expr(p.polqual, p.polrelid) like '%os_key_valid()%'
         and pg_get_expr(p.polqual, p.polrelid) not ilike '%select%')
        or
        (pg_get_expr(p.polwithcheck, p.polrelid) like '%os_key_valid()%'
         and pg_get_expr(p.polwithcheck, p.polrelid) not ilike '%select%')
      )
  loop
    execute format(
      'alter policy %I on %I.%I using ((select public.os_key_valid()))'
      || case when pol.check_expr is not null
              then ' with check ((select public.os_key_valid()))'
              else '' end,
      pol.policy_name, pol.schema_name, pol.table_name
    );
    raise notice 'rewrote policy % on %.%', pol.policy_name, pol.schema_name, pol.table_name;
  end loop;
end $$;
