-- Monitor items that watch a task carry its due date (D-30 amended). The
-- board's feed now lists, in the projects the owner leads, others' work that
-- is late or due within a week (kind late / due-soon) and work with no PIC
-- due within a week (no-pic). For those the item's date is the task's end
-- date, which is what the owner watches, so it becomes the task's dueDate
-- and they sort by it on the island. Waits (review, decision, blocker,
-- dependency, sign-off, approval) keep no due date: their date is "waiting
-- since". Only os_tracker_task_payload changes; the next sync applies it.
-- Rollback: supabase/migrations/down/20261026000114_tracker_monitor_due_down.sql.

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
