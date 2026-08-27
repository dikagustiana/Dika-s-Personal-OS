-- Down-migration for 20260827000090_verify_key_anon_revoke_reapply.sql
--
-- Restores the anon and authenticated grants on os_verify_key — which is to
-- say, it REOPENS an unauthenticated, unrate-limited guessing oracle against
-- the single passphrase that every RLS policy in this schema authorises on.
--
-- This exists because every migration here carries a rollback, not because
-- rolling it back is ever the right move. If something broke after 90, the
-- cause is a caller that should be going through the verify-passphrase Edge
-- Function and is not — fix the caller.
--
-- Note that this also restores the state 20260724000012 was written to
-- prevent, so applying it puts the database back in the condition the
-- anon_definer_gates.sql check reports as a finding.

grant execute on function public.os_verify_key(text) to anon;
grant execute on function public.os_verify_key(text) to authenticated;

comment on function public.os_verify_key(text) is null;
