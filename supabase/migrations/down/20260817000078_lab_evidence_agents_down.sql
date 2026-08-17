-- Down-migration for 20260817000078_lab_evidence_agents.
-- Removes the coordinator's task ledger (DESTROYS the record of what was
-- delegated to which agent and how it ended) and the six seeded agent rows
-- — by slug, so agents created later survive. FAILS BY DESIGN if any of the
-- six has runs: the run log references them. Delete (or export and delete)
-- those runs first if the seeds must truly go.

drop trigger if exists os_lab_tasks_updated_at on public.os_lab_tasks;
drop policy if exists "require app key to select" on public.os_lab_tasks;
drop policy if exists "require app key to insert" on public.os_lab_tasks;
drop policy if exists "require app key to update" on public.os_lab_tasks;
drop policy if exists "require app key to delete" on public.os_lab_tasks;
drop index if exists public.os_lab_tasks_project_idx;
drop table if exists public.os_lab_tasks;

delete from public.os_lab_agents
where slug in (
  'evidence-coordinator',
  'evidence-locator',
  'evidence-extractor',
  'evidence-literature',
  'evidence-reviewer',
  'evidence-drafter'
);
