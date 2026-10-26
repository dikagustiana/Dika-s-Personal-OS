-- Down-migration for 20261026000110_island_tasks_safe_casts.sql
--
-- Puts back 20261026000109's strict casts (a malformed WORK row then makes
-- every island read fail again) and drops the safe-cast helper.

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
    'done',         coalesce((e.payload ->> 'done')::boolean, false),
    'completed_at', coalesce(e.payload -> 'completedAt', 'null'::jsonb),
    'due_date',     coalesce(e.payload -> 'dueDate', 'null'::jsonb),
    'updated_at',   e.updated_at
  )
$$;

create or replace function public.os_island_tasks(p_since timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rows jsonb;
begin
  perform private.os_island_token_check('read');
  select coalesce(jsonb_agg(private.os_island_task_row(e) order by e.created_at), '[]'::jsonb)
    into rows
    from public.os_entries e
   where e.domain = 'work'
     and e.type = 'task'
     and (   coalesce((e.payload ->> 'done')::boolean, false) = false
          or nullif(e.payload ->> 'completedAt', '')::timestamptz >= p_since);
  return jsonb_build_object('server_time', now(), 'tasks', rows);
end
$$;

drop function if exists private.os_island_ts(text);
