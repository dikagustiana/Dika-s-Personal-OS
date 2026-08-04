-- ===========================================================================
-- GRANT HYGIENE: THE TRIGGER FUNCTION IS NOT AN API.
-- ===========================================================================
-- Supabase's default privileges grant EXECUTE on every new public function to
-- anon and authenticated, which put os_finish_line_cells_write_guard() on the
-- /rest/v1/rpc surface and raised two security-advisor warnings the moment it
-- was created. A trigger function is invoked by the trigger machinery — firing
-- does not check the caller's EXECUTE privilege — so no client role needs, or
-- should have, any grant on it.
--
-- os_member_entities() deliberately KEEPS its authenticated grant: policy
-- predicates evaluate as the querying role, which therefore must be able to
-- execute the function. (anon was never granted; the owner path runs as anon
-- and the member policies are `to authenticated`.)
--
-- Idempotent (revokes are). Down-migration:
-- supabase/migrations/down/20260804000041_write_guard_grants_down.sql

revoke all on function public.os_finish_line_cells_write_guard() from public;
revoke all on function public.os_finish_line_cells_write_guard() from anon;
revoke all on function public.os_finish_line_cells_write_guard() from authenticated;
