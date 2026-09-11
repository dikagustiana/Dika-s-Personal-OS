-- Rollback of 20260910000104: back to select-only from the client. The
-- client-side stepper stops working; nothing else changes.
--
-- NOTE: this does NOT restore the wide default-privilege grants 104 revoked
-- (anon and authenticated held INSERT/UPDATE/DELETE on every institution
-- table before it). Handing those back would re-open the gap for no reason;
-- a rollback of a tightening is a tightening that stays.
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'os_inst_briefs', 'os_inst_assignments', 'os_inst_reviews', 'os_inst_submissions',
    'os_inst_debates', 'os_inst_agent_versions', 'os_inst_evaluation_runs', 'os_inst_events'
  ] loop
    execute format('drop policy if exists "require app key to insert" on public.%I', tbl);
    execute format('drop policy if exists "require app key to update" on public.%I', tbl);
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', tbl);
  end loop;
end
$$;
