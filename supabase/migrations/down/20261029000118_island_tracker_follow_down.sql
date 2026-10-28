-- Undo 20261029000118_island_tracker_follow: the payload builder of 114 and
-- the island row of 115 come back. Rows already carrying detail/date keep
-- those keys until their next sync rewrites the payload.

create or replace function private.os_tracker_task_payload(p_item jsonb, p_group text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'title',    left(
                  initcap(p_group) || ' · '
                  || coalesce(nullif(p_item ->> 'ref', '') || ' ', '')
                  || coalesce(p_item ->> 'title', ''), 500),
    'priority', 'normal',
    'done',     false,
    -- A due date for work done now and for watched deadlines; a wait has none.
    'dueDate',  case when (p_group in ('prepare', 'review')
                           or (p_group = 'monitor' and p_item ->> 'kind' in ('late', 'due-soon', 'no-pic')))
                          and (p_item ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$'
                     then p_item ->> 'date' end,
    'tracker',  jsonb_strip_nulls(jsonb_build_object(
                  'key',         p_item ->> 'key',
                  'url',         p_item ->> 'url',
                  'group',       p_group,
                  'kind',        p_item ->> 'kind',
                  'project',     p_item ->> 'project',
                  'taskId',      case when (p_item ->> 'taskId') ~ '^[0-9a-f-]{36}$' then p_item ->> 'taskId' end,
                  'completable', coalesce(p_item -> 'completable' = 'true'::jsonb, false)))
  ))
$$;

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
    'pic_options',  case when e.payload -> 'tracker' ->> 'kind' = 'no-pic'
                          and coalesce(e.payload -> 'tracker' -> 'assign' ->> 'state', 'failed') <> 'pending'
                          and not coalesce(e.payload -> 'tracker' -> 'assign' ->> 'action' = 'assign'
                                           and e.payload -> 'tracker' -> 'assign' ->> 'state' = 'done', false)
                         then coalesce(e.payload -> 'tracker' -> 'pickable', '[]'::jsonb)
                         else '[]'::jsonb end,
    'pic',          case when e.payload -> 'tracker' -> 'assign' ->> 'action' = 'assign'
                          and e.payload -> 'tracker' -> 'assign' ->> 'state' in ('pending', 'done')
                         then to_jsonb(e.payload -> 'tracker' -> 'assign' ->> 'name')
                         else 'null'::jsonb end,
    'updated_at',   e.updated_at
  )
$$;

revoke all on function private.os_tracker_task_payload(jsonb, text) from public, anon, authenticated;
revoke all on function private.os_island_task_row(public.os_entries) from public, anon, authenticated;
