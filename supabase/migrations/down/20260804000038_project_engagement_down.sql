-- Down-migration for 20260804000038_project_engagement.
-- Run AFTER 20260804000040_member_policies_down.sql — the member SELECT
-- policy on os_projects references the engagement column and must be gone
-- before the column is dropped. Loses every engagement assignment.

drop index if exists public.os_projects_engagement_idx;
alter table public.os_projects drop constraint if exists os_projects_engagement_chk;
alter table public.os_projects drop column if exists engagement;
