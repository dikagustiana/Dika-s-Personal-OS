-- The island's task row names the board project of a tracker task (D-30).
-- The desktop island can group its to-do by project; a tracker task carries
-- the board's project name in payload.tracker.project, and every other task
-- is "stand alone" (project null). One added key, nothing else changes: the
-- island ignores keys it does not know, so an older island keeps working.
-- Rollback: supabase/migrations/down/20261026000112_island_task_project_down.sql.

create or replace function private.os_island_task_row(e public.os_entries)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id',           e.id,
    'title',        coalesce(e.payload ->> 'title', ''),
    'priority',     coalesce(e.payload ->> 'priority', 'normal'),
    'done',         coalesce(e.payload -> 'done' = 'true'::jsonb, false),
    'completed_at', coalesce(e.payload -> 'completedAt', 'null'::jsonb),
    'due_date',     coalesce(e.payload -> 'dueDate', 'null'::jsonb),
    'project',      to_jsonb(nullif(e.payload -> 'tracker' ->> 'project', '')),
    'updated_at',   e.updated_at
  )
$$;

revoke all on function private.os_island_task_row(public.os_entries) from public, anon, authenticated;
