-- Down-migration for 20261026000112_island_task_project.sql: the row as
-- 20261026000110_island_tasks_safe_casts left it (no project key).

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
    'updated_at',   e.updated_at
  )
$$;

revoke all on function private.os_island_task_row(public.os_entries) from public, anon, authenticated;
