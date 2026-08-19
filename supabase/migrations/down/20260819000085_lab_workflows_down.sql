-- Down-migration for 20260819000085_lab_workflows.
--
-- Removes the workflow layer entirely: the projects column first (it holds
-- the FK), then the table (its trigger and policies go with it), then the
-- guard function, then the enum. Projects lose their route selection and
-- every screen falls back to the canonical thirteen — no epistemic row is
-- touched, because workflows never carried any epistemic state.

alter table public.os_lab_projects drop column if exists workflow_id;

drop table if exists public.os_lab_workflows;

drop function if exists public.os_lab_workflows_gate_guard();

drop type if exists public.os_lab_stage_code;
