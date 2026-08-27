-- ===========================================================================
-- EVERY anon-EXECUTABLE SECURITY DEFINER FUNCTION IN public MUST CALL A GATE.
-- ===========================================================================
--
-- Same contract as every suite here: ZERO ROWS when healthy; any row names
-- the function that violates the rule.
--
-- Read-only and secret-free — catalogs only, like rls_function_grants.sql, so
-- this is safe to run against the live project as well as the throwaway
-- cluster. Run it after ANY migration that adds a function, changes a
-- function body, or changes a grant.
--
--     psql "$DATABASE_URL" -f supabase/tests/anon_definer_gates.sql
--     scripts/role-read-tests.sh          (throwaway cluster, full replay,
--                                          negative control included)
--
-- ===========================================================================
-- WHY THIS IS A STANDING CHECK AND NOT A ONE-LINE FIX SOMEWHERE
-- ===========================================================================
-- SECURITY DEFINER means the function runs with its owner's rights, so RLS
-- does not apply inside it. Granting EXECUTE on such a function to `anon` is
-- therefore not "exposing a function" — it is handing an unauthenticated
-- caller whatever that body does, with the row-level guards switched off.
--
-- That is a deliberate and correct pattern in this schema; it is how the
-- passphrase model works at all. What makes it survivable is that the body
-- opens with a gate. os_lab_stale_sweep (20260817000077) was granted to anon
-- and opened with nothing, so for the life of that migration any holder of
-- the anon key could demote verified Lab datapoints and append an unbounded
-- number of rows to os_lab_sweep_log. 20260827000089 gated it.
--
-- THE REPOSITORY IS PUBLIC. The anon key ships in the client bundle by
-- design and is committed in scripts/probe-password-grant.sh with a note
-- saying so. That is fine for a key whose only power is to reach RLS — and it
-- means the NEXT ungated SECURITY DEFINER function is discoverable by anyone
-- who reads the repo, from the migration that adds it, on the day it ships.
-- One function fixed is a patch. This file is the fix.
--
-- ===========================================================================
-- WHAT COUNTS AS A GATE
-- ===========================================================================
-- A call to one of the three functions that check the owner passphrase:
--   public.os_key_valid()          the app key, read from the x-app-key header
--   public.os_read_key_valid()     the read-only credential (20260728000034)
--   private.os_share_owner_gate()  os_key_valid() wrapped in a raise
-- Matched against prosrc by name, the same technique rls_function_grants.sql
-- uses on policy expressions. A body that names one of these has asked; a
-- body that names none has not.
--
-- The `private` schema is deliberately out of scope: PostgREST exposes only
-- the schemas in its search path, `private` is not one of them, and nothing
-- in it is reachable by an HTTP caller regardless of its grants.

-- ---------------------------------------------------------------------------
-- CHECK 1: an anon-executable SECURITY DEFINER function with no gate and no
-- exemption.
--
-- A HIT MEANS: an unauthenticated HTTP caller can execute that body with RLS
-- off. Add a gate to it (the os_share_link_* functions are the pattern), or
-- revoke EXECUTE from anon, or — if it genuinely must be reachable before
-- authentication — add it to the exemption list below WITH ITS REASON. Do not
-- widen the gate regex to make a row disappear.
-- ---------------------------------------------------------------------------
with exempt(proname, why) as (values
  -- The gates themselves. A gate cannot gate on itself, and os_key_valid is
  -- called from inside every RLS predicate in the schema.
  ('os_key_valid',       'IS the gate; called by every RLS policy'),
  ('os_read_key_valid',  'IS the read-only gate (20260728000034)'),
  -- os_verify_key IS DELIBERATELY NOT EXEMPT. DO NOT ADD IT.
  --
  -- It looks like the obvious exemption — it is the unlock check, so it must
  -- be reachable before the caller holds anything to gate on. That reasoning
  -- was accepted once and then RETRACTED by 20260724000012, which revoked
  -- EXECUTE from anon and authenticated outright: an unrated verification
  -- endpoint on a public URL makes passphrase guesses free and unlimited, and
  -- each guess forces a server-side bcrypt, so it doubles as a cheap way to
  -- burn database CPU. The rate limiting, escalating delay and lockout live
  -- in the verify-passphrase Edge Function, which holds the service role;
  -- src/data/supabaseRepository.ts:161 is the only caller the app has.
  --
  -- So on a correctly migrated database this function is not anon-executable
  -- and never reaches check 1 at all. If check 1 names it, the revoke in
  -- 20260724000012 is missing from that database and the front door is open —
  -- which is a finding, not a false positive. Fix the grant, not this list.
  -- Self-scoping rather than gated: the body filters on auth.uid(), so a
  -- caller with no JWT gets an empty array and a caller with one gets only
  -- their own rows. There is no argument by which it can be asked about
  -- somebody else. Granted to anon on purpose by 20260806000057, because the
  -- os_process_* member policies are `to public` and therefore evaluate it as
  -- anon — see rls_function_grants.sql for that incident.
  ('os_member_entities', 'self-scoping on auth.uid(); returns {} without a JWT')
),
anon_definer as (
  select p.proname,
         p.oid,
         p.prosrc,
         p.provolatile
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and has_function_privilege('anon', p.oid, 'EXECUTE')
)
select 'UNGATED DEFINER: public.' || d.proname
    || '() is SECURITY DEFINER, EXECUTE is granted to `anon`, and its body '
    || 'calls none of os_key_valid / os_read_key_valid / os_share_owner_gate. '
    || 'An unauthenticated caller reaches it with RLS switched off'
    || case when d.provolatile = 'v'
            then ' AND IT IS VOLATILE, so it can write.'
            else '.' end
    || ' Gate it, revoke the anon grant, or add it to the exemption list in '
    || 'supabase/tests/anon_definer_gates.sql with its reason.' as problem
from anon_definer d
where d.proname not in (select e.proname from exempt e)
  and d.prosrc !~ 'os_key_valid|os_read_key_valid|os_share_owner_gate'
order by d.provolatile desc, d.proname;

-- ---------------------------------------------------------------------------
-- CHECK 2: a stale exemption.
--
-- A HIT MEANS: the list above names a function that no longer exists, or that
-- anon can no longer execute. Harmless in itself, but an exemption list that
-- accumulates dead names stops being read, and the next real exemption gets
-- waved through beside them. Delete the row.
-- ---------------------------------------------------------------------------
with exempt(proname) as (values
  ('os_key_valid'), ('os_read_key_valid'), ('os_member_entities')
)
select 'STALE EXEMPTION: ' || e.proname
    || ' is on the exemption list in supabase/tests/anon_definer_gates.sql but '
    || 'is not an anon-executable SECURITY DEFINER function in public any more. '
    || 'Remove it from the list.' as problem
from exempt e
where not exists (
  select 1
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = e.proname
    and p.prosecdef
    and has_function_privilege('anon', p.oid, 'EXECUTE')
);

-- ---------------------------------------------------------------------------
-- CHECK 3: the audit-inert floor.
--
-- A check that can never fail proves nothing. If has_function_privilege ever
-- stops resolving, or the `anon` role is absent on some cluster this is run
-- against, checks 1 and 2 both return zero rows and read as "healthy"
-- forever.
--
-- The floor is 5. A correctly migrated database carries 8 anon-executable
-- SECURITY DEFINER functions in public: the 3 exempt ones, the 4
-- os_share_link_* functions, and os_lab_stale_sweep. Anything under 5 means
-- the matcher broke rather than the schema shrank.
-- ---------------------------------------------------------------------------
select 'AUDIT INERT: the definer-gate check found only ' || count(*)
    || ' anon-executable SECURITY DEFINER functions in public, which is below '
    || 'the floor of 5. The matcher is broken, not the schema — fix it before '
    || 'trusting a zero-row result.' as problem
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and has_function_privilege('anon', p.oid, 'EXECUTE')
having count(*) < 5;
