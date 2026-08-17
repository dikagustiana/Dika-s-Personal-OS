-- Down-migration for 20260817000075_lab_seed.
-- Removes the seeded chain, the four seeded agents and the three provider
-- rows — BY NAME/SLUG, so agents and providers created after the seed
-- survive. FAILS BY DESIGN if any seeded agent or provider has runs: the
-- run log references them, and deleting a run's agent would orphan the
-- log's meaning. Delete (or export and delete) the runs first if the seeds
-- must truly go.

delete from public.os_lab_chains
where name = 'Proses ke keputusan';

delete from public.os_lab_agents
where slug in (
  'senior-finance-analyst',
  'business-process-improvement',
  'pmo-coordinator',
  'ceo-briefing-deck'
);

delete from public.os_lab_providers
where name in ('anthropic', 'deepseek', 'kimi');
