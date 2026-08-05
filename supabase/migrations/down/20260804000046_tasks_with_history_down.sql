-- Down-migration for 20260804000046_tasks_with_history.
-- Run FIRST when unwinding slice 1 (before I and H): the member policies
-- here call os_member_projects(). DESTROYS ALL TASKS AND ALL TASK HISTORY —
-- there is no soft path; export first if any task row has ever mattered.

drop trigger if exists os_tasks_write_guard on public.os_tasks;
drop function if exists public.os_tasks_write_guard();

drop policy if exists "owner reads history" on public.os_task_history;
drop table if exists public.os_task_history;

drop policy if exists "member reads tasks in granted projects"   on public.os_tasks;
drop policy if exists "member inserts tasks in granted projects" on public.os_tasks;
drop policy if exists "member updates tasks in granted projects" on public.os_tasks;
drop policy if exists "require app key to select" on public.os_tasks;
drop policy if exists "require app key to insert" on public.os_tasks;
drop policy if exists "require app key to update" on public.os_tasks;
drop policy if exists "require app key to delete" on public.os_tasks;
drop table if exists public.os_tasks;
