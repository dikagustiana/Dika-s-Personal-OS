-- ===========================================================================
-- §9.2 — EVERY FUNCTION CALLED IN AN RLS PREDICATE MUST HAVE EXECUTE FOR
-- EVERY ROLE THAT CAN REACH THAT TABLE.
-- ===========================================================================
--
-- Same contract as the other files here: ZERO ROWS when healthy; any row
-- names the (table, policy, function, role) that violates the rule.
--
-- Read-only and secret-free — it looks at catalogs only, so unlike
-- process_role_reads.sql this one is safe to run against the live project as
-- well as the throwaway cluster. Run it after ANY migration that adds a
-- policy, adds a function, or changes a grant.
--
-- ===========================================================================
-- WHY THIS IS A STANDING CHECK AND NOT A NOTE SOMEWHERE
-- ===========================================================================
-- This is the rule the 7 August outage broke. `os_member_entities()` was
-- granted to `authenticated` only — deliberately, with a comment in migration
-- 20260804000037 explaining that the member policies were `to authenticated`
-- and no other role would ever evaluate it. That was true when written. Then
-- `process_member_read_policies` added eight policies with NO `to` clause,
-- which means `to public`, which means `anon`, and the comment silently
-- became false. Nothing checked it, so nothing said so until production did.
--
-- The trap that makes this class unsurvivable rather than merely wrong: the
-- house pattern wraps predicate calls as `(select fn())` so Postgres runs
-- them once as an InitPlan instead of once per row (migration
-- 20260728000030, adopted after a live 500). An InitPlan is evaluated BEFORE
-- any row is processed, so it cannot be skipped by the OR short-circuit that
-- would otherwise let a passing `os_key_valid()` policy carry the query. The
-- optimisation and the failure mode are the same line of SQL. You cannot fix
-- this by writing policies more carefully; you fix it by checking the grants.
--
-- ===========================================================================
-- WHAT "CAN REACH" MEANS, PRECISELY — THIS IS THE PART THAT IS EASY TO MISS
-- ===========================================================================
-- It is the policy's `to` clause that decides which roles evaluate a
-- predicate, NOT which role the policy was written for and NOT which role the
-- app happens to use. A policy with no `to` clause is `to public`: EVERY
-- role, including `anon`. That single distinction is the entire difference
-- between the os_process_* member policies (`to public`, so they need the
-- anon grant) and the os_finish_line_* member policies from
-- 20260804000040 (`to authenticated`, so they do not).
--
-- pg_policy.polroles is `{0}` for PUBLIC, which is why the expansion below
-- fans a public policy out across all three API roles instead of trusting the
-- role list verbatim.

with policy_expr as (
  select c.relname as tbl,
         pol.polname,
         pol.polroles,
         coalesce(pg_get_expr(pol.polqual,      pol.polrelid, true), '') || ' ' ||
         coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid, true), '') as expr
  from pg_policy pol
  join pg_class c     on c.oid = pol.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
),
-- Zero-argument public functions are the only shape used in these predicates
-- (os_key_valid, os_read_key_valid, os_member_entities, os_member_projects).
-- Restricting to pronargs = 0 keeps the name match from colliding with
-- unrelated helpers that merely share a prefix.
candidate_fn as (
  select p.proname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.pronargs = 0
),
-- A policy `to public` (polroles = {0}) is evaluated by every role, so it is
-- expanded across all three API roles. Any other policy is evaluated only by
-- the roles it names.
pair as (
  select pe.tbl, pe.polname, f.proname, api.rolname as role_name
  from policy_expr pe
  join candidate_fn f on pe.expr ~ ('\m' || f.proname || '\M')
  cross join (select unnest(array['anon','authenticated','service_role']) as rolname) api
  where pe.polroles = '{0}'::oid[]
     or api.rolname = any (select r.rolname from pg_roles r where r.oid = any (pe.polroles))
)
select 'RLS GRANT GAP: policy "' || polname || '" on ' || tbl
    || ' calls ' || proname || '() and is evaluated by `' || role_name
    || '`, which has no EXECUTE on it. Every read of ' || tbl
    || ' as `' || role_name || '` will throw permission denied — the predicate '
    || 'is an InitPlan and no other passing policy can short-circuit it.' as problem
from pair
where has_table_privilege(role_name, ('public.' || quote_ident(tbl))::regclass, 'SELECT')
  and not has_function_privilege(role_name, ('public.' || quote_ident(proname) || '()')::text, 'EXECUTE')
order by tbl, polname, role_name;

-- ---------------------------------------------------------------------------
-- A check that can never fail proves nothing. If the join above ever stops
-- matching — a renamed catalog column, a predicate shape the regex misses —
-- it would return zero rows and read as "healthy" forever. So: assert that it
-- examined a plausible number of pairs at all.
--
-- The floor is 100. Live carries ~509 (table, policy, function, role) pairs
-- across 36 tables, dominated by os_key_valid on every table; anything under
-- 100 means the matcher broke rather than the schema shrank.
-- ---------------------------------------------------------------------------
with policy_expr as (
  select c.relname as tbl, pol.polname, pol.polroles,
         coalesce(pg_get_expr(pol.polqual, pol.polrelid, true), '') || ' ' ||
         coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid, true), '') as expr
  from pg_policy pol
  join pg_class c     on c.oid = pol.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
),
candidate_fn as (
  select p.proname from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.pronargs = 0
),
pair as (
  select pe.tbl, api.rolname
  from policy_expr pe
  join candidate_fn f on pe.expr ~ ('\m' || f.proname || '\M')
  cross join (select unnest(array['anon','authenticated','service_role']) as rolname) api
  where pe.polroles = '{0}'::oid[]
     or api.rolname = any (select r.rolname from pg_roles r where r.oid = any (pe.polroles))
)
select 'AUDIT INERT: the grant check matched only ' || count(*)
    || ' (policy, role) pairs, which is below the floor of 100. The matcher is '
    || 'broken, not the schema — fix it before trusting a zero-row result.' as problem
from pair
having count(*) < 100;
