-- ===========================================================================
-- ONE BAD ROW MUST NOT TAKE THE WHOLE ISLAND LIST DOWN.
-- ===========================================================================
--
-- 20261026000109 read `done` with `::boolean` and `completedAt` with
-- `::timestamptz` on every WORK task. The SPA only ever writes a boolean and an
-- ISO string, but a payload is jsonb and nothing in the schema holds it to
-- that. One row with `"done": "yes"` or `"completedAt": "kemarin"` would make
-- os_island_tasks raise on every call, and the island would read that as
-- "offline" indefinitely. (Found by the Phase 40 acceptance review.)
--
-- Now: `done` is true only when it is the JSON boolean true; a completedAt
-- that does not parse counts as "not completed since p_since" (the island
-- then shows the row only if it is open), via a cast that returns NULL
-- instead of raising. Nothing else changes: same signatures, same grants.
--
-- Down-migration: supabase/migrations/down/20261026000110_island_tasks_safe_casts_down.sql

create or replace function private.os_island_ts(p text)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
begin
  return nullif(p, '')::timestamptz;
exception when others then
  return null;
end
$$;

revoke all on function private.os_island_ts(text) from public, anon, authenticated;

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
     and (   coalesce(e.payload -> 'done' = 'true'::jsonb, false) = false
          or private.os_island_ts(e.payload ->> 'completedAt') >= p_since);
  return jsonb_build_object('server_time', now(), 'tasks', rows);
end
$$;

revoke all on function public.os_island_tasks(timestamptz) from public, authenticated;
grant execute on function public.os_island_tasks(timestamptz) to anon;
