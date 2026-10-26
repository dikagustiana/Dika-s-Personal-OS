-- Name a PIC for a tracker task from the desktop island (D-32,
-- docs/tracker-feed.md, docs/island-tasks.md). A Monitor task with no PIC
-- (kind no-pic) carries the people the board would let hold it
-- (payload.tracker.pickable). The island shows them as pills; a pick calls
-- os_island_task_assign, which marks payload.tracker.assign = pending and
-- queues one pg_net POST to tracker-writeback (the same courier as D-31).
-- The courier names the PIC on the board as the owner (save_task, through
-- the feed token) and records the answer with os_tracker_assign_result.
-- Undo (p_person null) clears the PIC again, while that person still holds
-- it. Nothing here decides who may hold a task: the board does, twice
-- (its picker for `pickable`, its own checks on the call).
--
-- Also: os_tracker_task_payload carries `pickable`; the sync keeps a task's
-- `assign` and `writeback` blocks when it refreshes the rest of the tracker
-- block (so a pick in flight is not dropped by a sync that lands first); the
-- island row gains `pic_options` and `pic`. The comment on
-- os_tracker_writeback_result is corrected: os_entries_updated_at stamps
-- updated_at on every update, so recording an answer does move it (an
-- island holding the old value gets one 409 and refetches).
-- Rollback: supabase/migrations/down/20261026000115_tracker_assign_pic_down.sql.

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
                  'completable', coalesce(p_item -> 'completable' = 'true'::jsonb, false),
                  -- Who may hold a no-PIC task: {id, name} pairs only, at most 50.
                  'pickable',    (select jsonb_agg(jsonb_build_object('id', x ->> 'id', 'name', left(x ->> 'name', 80)))
                                    from (select x from jsonb_array_elements(
                                            case when jsonb_typeof(p_item -> 'pickable') = 'array' then p_item -> 'pickable' else '[]'::jsonb end) x
                                           where x ->> 'id' ~ '^[0-9a-f-]{36}$' and coalesce(x ->> 'name', '') <> ''
                                           limit 50) s)))
  ))
$$;

create or replace function public.os_tracker_sync(p_feed jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item record;
  fresh jsonb;
  merged jsonb;
  cur public.os_entries;
  wb jsonb;
  keys text[] := '{}';
  created int := 0;
  updated int := 0;
  closed int := 0;
begin
  if jsonb_typeof(p_feed -> 'prepare') <> 'array'
     or jsonb_typeof(p_feed -> 'review') <> 'array'
     or jsonb_typeof(p_feed -> 'monitor') <> 'array' then
    raise exception 'not a tracker feed' using errcode = '22023';
  end if;

  for item in
    select g.grp, x.value as it
      from (values ('prepare'), ('review'), ('monitor')) g(grp)
      cross join lateral jsonb_array_elements(p_feed -> g.grp) x
  loop
    -- Same gate as the web's parser: every field a string, the link https.
    continue when jsonb_typeof(item.it) <> 'object'
      or coalesce(item.it ->> 'key', '') = ''
      or coalesce(item.it ->> 'title', '') = ''
      or coalesce(item.it ->> 'url', '') !~ '^https://';
    continue when (item.it ->> 'key') = any (keys);  -- one task per key
    keys := keys || (item.it ->> 'key');
    fresh := private.os_tracker_task_payload(item.it, item.grp);

    select * into cur from public.os_entries e
     where e.domain = 'work' and e.type = 'task'
       and e.payload -> 'tracker' ->> 'key' = item.it ->> 'key'
     order by e.created_at desc
     limit 1;

    if not found then
      insert into public.os_entries (type, domain, tags, entry_date, payload)
      values ('task', 'work', array['tracker'], (fresh ->> 'dueDate')::date, fresh);
      created := created + 1;
    elsif coalesce(cur.payload -> 'done' = 'true'::jsonb, false) then
      wb := cur.payload -> 'tracker' -> 'writeback';
      -- Back open while the board still lists it: closed earlier and back on
      -- the board, or ticked here but the tick never reached the board. The
      -- owner's other ticks stand.
      if cur.payload -> 'tracker' -> 'closed' = 'true'::jsonb
         or wb ->> 'state' = 'failed'
         or (wb ->> 'state' = 'pending' and private.os_island_ts(wb ->> 'at') < now() - interval '30 minutes') then
        update public.os_entries
           set payload = fresh || jsonb_build_object('tracker', (fresh -> 'tracker')
                 || case when wb is not null then jsonb_build_object('lastWriteback', wb) else '{}'::jsonb end),
               entry_date = (fresh ->> 'dueDate')::date, updated_at = now()
         where id = cur.id;
        updated := updated + 1;
      end if;
    else
      -- Open: the board owns title, due date and the tracker block; anything
      -- the owner added here (priority, a project, a weekly goal) stays, and
      -- so does this task's write-back record. A PIC pick stays while it is
      -- in flight or the board still shows no PIC; once the board has one,
      -- the board's own detail says who.
      merged := (cur.payload - 'title' - 'dueDate' - 'tracker')
             || (fresh - 'priority' - 'done')
             || jsonb_build_object('tracker', (fresh -> 'tracker')
                  || jsonb_strip_nulls(jsonb_build_object(
                       'writeback', cur.payload -> 'tracker' -> 'writeback',
                       'assign',    case when fresh -> 'tracker' ->> 'kind' = 'no-pic'
                                           or cur.payload -> 'tracker' -> 'assign' ->> 'state' = 'pending'
                                         then cur.payload -> 'tracker' -> 'assign' end)));
      if merged is distinct from cur.payload then
        update public.os_entries
           set payload = merged, entry_date = (merged ->> 'dueDate')::date, updated_at = now()
         where id = cur.id;
        updated := updated + 1;
      end if;
    end if;
  end loop;

  with gone as (
    update public.os_entries e
       set payload = (e.payload || jsonb_build_object(
                       'done', true,
                       'completedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
                     || jsonb_build_object('tracker', (e.payload -> 'tracker') || '{"closed": true}'::jsonb),
           updated_at = now()
     where e.domain = 'work' and e.type = 'task'
       and e.payload ? 'tracker'
       and coalesce(e.payload -> 'done' = 'true'::jsonb, false) = false
       and not ((e.payload -> 'tracker' ->> 'key') = any (keys))
    returning 1)
  select count(*) into closed from gone;

  return jsonb_build_object('created', created, 'updated', updated, 'closed', closed, 'items', cardinality(keys));
end
$$;

-- The island row: + pic_options (who may hold a no-PIC task, until one is
-- picked) and pic (the name picked, while the pick is pending or taken).
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
    -- Offered while nothing is in flight and no pick has been taken (none
    -- yet, one that failed, or one undone).
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

-- Island: pick a PIC (p_person) for a no-PIC tracker task, or undo the last
-- pick (p_person null). Write token; web-wins check on updated_at, as patch.
create or replace function public.os_island_task_assign(
  p_id                  uuid,
  p_expected_updated_at timestamptz,
  p_person              uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur public.os_entries%rowtype;
  tr jsonb;
  a jsonb;
  v_name text;
  v_action text;
  v_url text := (select decrypted_secret from vault.decrypted_secrets where name = 'tracker_writeback_url');
  v_token text := (select decrypted_secret from vault.decrypted_secrets where name = 'tracker_sync_token');
  r jsonb;
begin
  perform private.os_island_token_check('write');

  select * into cur from public.os_entries
   where id = p_id and domain = 'work' and type = 'task'
   for update;
  if not found or not (cur.payload ? 'tracker') then
    raise exception 'task not found' using errcode = 'PT404';
  end if;
  if p_expected_updated_at is null or cur.updated_at <> p_expected_updated_at then
    raise exception 'task changed' using errcode = 'PT409';
  end if;
  tr := cur.payload -> 'tracker';
  a := tr -> 'assign';
  if coalesce(tr ->> 'taskId', '') = '' then
    raise exception 'not a board task' using errcode = 'PT422';
  end if;

  if p_person is not null then
    if a ->> 'state' = 'pending' then
      raise exception 'a PIC change is on its way · try again in a moment' using errcode = 'PT422';
    end if;
    if tr ->> 'kind' is distinct from 'no-pic' or coalesce(a ->> 'action' = 'assign' and a ->> 'state' = 'done', false) then
      raise exception 'this task already has a PIC' using errcode = 'PT422';
    end if;
    select x ->> 'name' into v_name
      from jsonb_array_elements(coalesce(tr -> 'pickable', '[]'::jsonb)) x
     where x ->> 'id' = p_person::text;
    if v_name is null then
      raise exception 'not one of the people who may hold this task' using errcode = 'PT422';
    end if;
    v_action := 'assign';
  else
    if not coalesce(a ->> 'action' = 'assign' and a ->> 'state' = 'done', false) then
      raise exception 'nothing to undo' using errcode = 'PT422';
    end if;
    p_person := (a ->> 'person')::uuid;
    v_name := a ->> 'name';
    v_action := 'unassign';
  end if;
  if v_url is null or v_token is null then
    raise exception 'tracker write-back is not set up' using errcode = 'PT422';
  end if;

  update public.os_entries
     set payload = payload || jsonb_build_object('tracker', tr || jsonb_build_object('assign',
           jsonb_build_object('state', 'pending', 'action', v_action, 'person', p_person, 'name', v_name, 'at', now())))
   where id = p_id
  returning private.os_island_task_row(os_entries.*) into r;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-token', v_token),
    body := jsonb_build_object('entry', p_id, 'action', v_action),
    timeout_milliseconds := 20000);
  return r;
end
$$;

-- What tracker-writeback writes for a PIC pick: the board's answer.
create or replace function public.os_tracker_assign_result(p_id uuid, p_assign jsonb)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.os_entries e
     set payload = e.payload || jsonb_build_object('tracker',
           (e.payload -> 'tracker') || jsonb_build_object('assign',
             coalesce(e.payload -> 'tracker' -> 'assign', '{}'::jsonb) || p_assign || jsonb_build_object('at', now())))
   where e.id = p_id and e.payload ? 'tracker'
$$;

-- What tracker-writeback writes for a tick: the board's answer. Only the
-- writeback block changes; os_entries_updated_at still stamps updated_at, so
-- an island holding the old value gets one 409 and refetches.
create or replace function public.os_tracker_writeback_result(p_id uuid, p_writeback jsonb)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.os_entries e
     set payload = e.payload || jsonb_build_object('tracker',
           (e.payload -> 'tracker') || jsonb_build_object('writeback', p_writeback || jsonb_build_object('at', now())))
   where e.id = p_id and e.payload ? 'tracker'
$$;

revoke all on function public.os_island_task_assign(uuid, timestamptz, uuid) from public, authenticated;
grant execute on function public.os_island_task_assign(uuid, timestamptz, uuid) to anon;
revoke all on function public.os_tracker_assign_result(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.os_tracker_assign_result(uuid, jsonb) to service_role;
revoke all on function public.os_tracker_writeback_result(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.os_tracker_writeback_result(uuid, jsonb) to service_role;
