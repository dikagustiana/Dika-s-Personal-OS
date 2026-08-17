-- Down-migration for 20260817000073_lab_schema.
-- DESTROYS THE ENTIRE LAB: every provider row, agent, chain, RUN RECORD and
-- artifact record — the run log is the only record of what was sent to which
-- model at what cost, and it exists nowhere else. Export os_lab_runs before
-- running this if any run has ever completed. Objects in the lab-artifacts
-- Storage bucket are NOT deleted here (storage rows are not schema); empty
-- the bucket in the dashboard if the files must go too.
-- Run down/20260817000074_lab_data_boundary_down.sql FIRST so no boundary
-- trigger sits on a table that is mid-drop; 75's seed rows die with the
-- tables. Drops in mirror order: dependents first, policies before tables.

drop index if exists public.os_lab_artifacts_run_id_idx;
drop policy if exists "require app key to select" on public.os_lab_artifacts;
drop table if exists public.os_lab_artifacts;

drop index if exists public.os_lab_runs_agent_id_idx;
drop index if exists public.os_lab_runs_parent_run_id_idx;
drop index if exists public.os_lab_runs_chain_id_idx;
drop index if exists public.os_lab_runs_created_at_idx;
drop policy if exists "require app key to select" on public.os_lab_runs;
drop table if exists public.os_lab_runs;

drop trigger if exists os_lab_chains_updated_at on public.os_lab_chains;
drop policy if exists "require app key to select" on public.os_lab_chains;
drop policy if exists "require app key to insert" on public.os_lab_chains;
drop policy if exists "require app key to update" on public.os_lab_chains;
drop policy if exists "require app key to delete" on public.os_lab_chains;
drop table if exists public.os_lab_chains;

drop policy if exists "require app key to select" on public.os_lab_agents;
drop policy if exists "require app key to insert" on public.os_lab_agents;
drop policy if exists "require app key to update" on public.os_lab_agents;
drop policy if exists "require app key to delete" on public.os_lab_agents;
drop table if exists public.os_lab_agents;

drop trigger if exists os_lab_providers_updated_at on public.os_lab_providers;
drop policy if exists "require app key to select" on public.os_lab_providers;
drop policy if exists "require app key to insert" on public.os_lab_providers;
drop policy if exists "require app key to update" on public.os_lab_providers;
drop policy if exists "require app key to delete" on public.os_lab_providers;
drop table if exists public.os_lab_providers;

-- The bucket row, where a storage schema exists (no-op on the local cluster).
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'buckets'
  ) then
    delete from storage.buckets where id = 'lab-artifacts';
  end if;
end
$$;
