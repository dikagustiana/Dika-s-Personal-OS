-- ===========================================================================
-- RE-APPLY 20260724000012. THE REVOKE IS NOT PRESENT IN PRODUCTION.
-- ===========================================================================
--
-- 20260724000012_verify_key_lockdown.sql exists to do exactly one thing:
--
--   revoke execute on function public.os_verify_key(text) from anon, authenticated;
--
-- It is not in effect on the live project. Measured 2026-08-27 against
-- ascbthsgborseynmmthm:
--
--   proname       | anon_exec | auth_exec | proacl
--   os_verify_key | t         | t         | {postgres=X/postgres,anon=X/postgres,
--                                           authenticated=X/postgres,
--                                           service_role=X/postgres}
--
-- Either 12 was never applied, or a later `create or replace function` reset
-- the ACL — CREATE OR REPLACE preserves grants, but a DROP followed by CREATE
-- does not, and the default grant to PUBLIC would return on a fresh create.
-- Which of those happened is not knowable from here and does not change the
-- remedy.
--
-- WHY THIS MATTERS MORE THAN IT LOOKS
-- Every RLS policy in this schema authorises on os_key_valid(), which reads
-- one passphrase. os_verify_key is the oracle that says whether a candidate
-- passphrase is that one. Reachable by anon, it is an unauthenticated,
-- unlimited, unlogged guessing oracle against the single credential guarding
-- the entire database — and each guess forces a server-side bcrypt, so it is
-- also a cheap way to burn database CPU. 12's own header says this.
--
-- The escalating delay and the temporary lockout live in the
-- verify-passphrase Edge Function (FREE_ATTEMPTS 3, MAX_DELAY_MS 8000,
-- LOCKOUT_AFTER 10, LOCKOUT_MINUTES 15). None of it applies to a caller who
-- skips the function and hits /rest/v1/rpc/os_verify_key directly with the
-- anon key — which is public by design, ships in the client bundle, and is
-- committed in scripts/probe-password-grant.sh. The repository is public.
--
-- WHY THIS IS SAFE TO APPLY NOW
-- 12's header warned that applying it early would lock the owner out, because
-- every build before v5 called the RPC from the browser. That has not been
-- true for a long time. Verified by reading every caller in the tree:
--
--   supabase/functions/verify-passphrase/index.ts:104   service_role
--   supabase/functions/_shared/appKeyAuth.ts:102        service_role
--
-- Both hold the service role, whose grant this migration does not touch. The
-- browser path is src/data/supabaseRepository.ts:159 (verifyAppKey), which
-- POSTs to /functions/v1/verify-passphrase and never names the RPC. There is
-- no third caller.
--
-- Idempotent: revoking a privilege that is already absent is a no-op, so this
-- is safe whether or not 12 ever landed.
--
-- Down-migration:
--   supabase/migrations/down/20260827000090_verify_key_anon_revoke_reapply_down.sql
--
-- Standing check that would have caught this:
--   supabase/tests/anon_definer_gates.sql (added 20260827000089). os_verify_key
--   is deliberately NOT on its exemption list, so on a database missing this
--   revoke the check returns it by name. It does, today, against live.

revoke execute on function public.os_verify_key(text) from anon;
revoke execute on function public.os_verify_key(text) from authenticated;

-- Belt and braces: PUBLIC is the grant that comes back by itself if the
-- function is ever dropped and recreated rather than replaced. 12 did not
-- revoke it because at the time the function had never been recreated.
revoke execute on function public.os_verify_key(text) from public;

-- service_role keeps its grant — it is what the two Edge Functions use, and
-- it is the identity the rate limiting is built around. Stated explicitly
-- rather than left implicit, so a future reader does not "tidy" it away.
grant execute on function public.os_verify_key(text) to service_role;

comment on function public.os_verify_key(text) is
  'The passphrase oracle. SERVICE ROLE ONLY — reachable exclusively through the verify-passphrase Edge Function, which owns the escalating delay and the lockout. anon/authenticated were revoked by 20260724000012 and re-revoked by 20260827000090 after the grant was found live in production. Guarded as a class by supabase/tests/anon_definer_gates.sql.';
