-- Down-migration for 20260817000083_lab_run_refusals.
--
-- Drops the refusals column. The refusal HISTORY goes with it — that is
-- what "down" means here, and it is why this file exists rather than being
-- assumed: reverting the console's memory is a decision, not a side effect.
-- The executor tolerates the column's absence (the bookkeeping PATCH is
-- best-effort and swallowed), so rolling back does not break runs.

alter table public.os_lab_runs
  drop column if exists refusals;
