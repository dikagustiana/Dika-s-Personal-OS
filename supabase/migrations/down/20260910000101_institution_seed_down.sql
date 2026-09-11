-- Rollback of 20260910000101_institution_seed. Removes the seeded org
-- rows, evaluations and the eight skill-derived agents. Agents authored at
-- run time (leads, phantoms) are not touched. Versions are immutable by
-- guard; the guard must be dropped (100 down) before this can delete them.
delete from public.os_inst_agent_versions where proposed_by = 'system' and rationale = 'Backfill of the live prompt at institution launch.';
delete from private.os_inst_evaluation_rubrics where evaluation_id in (select id from public.os_inst_evaluations where slug like 'eval-%');
delete from public.os_inst_evaluations where slug like 'eval-%';
delete from public.os_lab_agents where slug in (
  'account-universe-scan','math-specialist','manufacturing-finance-analyst','go-to-market','process-mapper',
  'psak-consolidation','psak-intercompany','deck-layout','scope-analyst','assumption-auditor','method-scout',
  'method-critic','prior-work-analyst','public-data-retriever','source-appraiser','data-reconciler',
  'dataset-curator','scenario-analyst','provenance-checker','numeric-auditor','copy-editor');
delete from public.os_inst_department_members;
delete from public.os_inst_departments;
