-- Tracker write-back (D-31, docs/tracker-feed.md). Ticking a tracker task
-- done here — from the web or the desktop island — reaches the SAMB Project
-- Board as the board's own centang, when the board allows it: the owner's own
-- open task in a project they administer (the feed marks it `completable`).
-- Unticking sends the board's Batal. Everything else (reviews, decisions,
-- waits, tasks the board would not let the owner tick) stays read-only:
-- ticking it here only hides it, as before (D-30).
--
-- How: a BEFORE UPDATE trigger on os_entries sees `done` flip on a
-- completable tracker task, marks payload.tracker.writeback = pending and
-- queues one pg_net POST to the tracker-writeback function (sent only if the
-- transaction commits). That function calls the board and records the answer
-- with os_tracker_writeback_result: done (with the board's Batal data) or
-- failed. The sync reopens a task whose write-back failed, or never answered
-- within 30 minutes, while the board still lists it — so a tick that did not
-- reach the board is never silently lost.
--
-- Changes os_tracker_task_payload (taskId, completable) and os_tracker_sync
-- (the reopen rule). Rollback: supabase/migrations/down/20261026000113_tracker_writeback_down.sql.

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
    -- Due dates only for work the owner does now; a wait has no due date.
    'dueDate',  case when p_group in ('prepare', 'review') and (p_item ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$'
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
      -- the owner added here (priority, a project, a weekly goal) stays.
      merged := (cur.payload - 'title' - 'dueDate' - 'tracker') || (fresh - 'priority' - 'done');
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

-- The trigger: a tick or untick by the owner on a completable tracker task.
-- The sync's own changes never count: its close sets tracker.closed, and its
-- reopen replaces the tracker block (no writeback in NEW).
create or replace function private.os_tracker_writeback_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  was_done boolean := coalesce(old.payload -> 'done' = 'true'::jsonb, false);
  is_done boolean := coalesce(new.payload -> 'done' = 'true'::jsonb, false);
  tr jsonb := new.payload -> 'tracker';
  v_action text;
  v_url text := (select decrypted_secret from vault.decrypted_secrets where name = 'tracker_writeback_url');
  v_token text := (select decrypted_secret from vault.decrypted_secrets where name = 'tracker_sync_token');
begin
  if tr is null or was_done = is_done
     or coalesce(tr -> 'completable' = 'true'::jsonb, false) = false
     or coalesce(tr ->> 'taskId', '') = ''
     or tr -> 'closed' = 'true'::jsonb then
    return new;
  end if;
  if is_done then
    v_action := 'complete';
  elsif tr -> 'writeback' ->> 'state' = 'done' and tr -> 'writeback' ->> 'action' = 'complete' then
    v_action := 'undo';  -- untick of a tick the board took: its Batal
  else
    return new;          -- untick of a tick that never reached the board: nothing to undo
  end if;
  if v_url is null or v_token is null then
    new.payload := new.payload || jsonb_build_object('tracker', tr || jsonb_build_object('writeback',
      jsonb_build_object('state', 'failed', 'action', v_action, 'at', now(), 'error', 'not configured')));
    return new;
  end if;
  new.payload := new.payload || jsonb_build_object('tracker', tr || jsonb_build_object('writeback',
    jsonb_build_object('state', 'pending', 'action', v_action, 'at', now(),
                       'result', case when v_action = 'undo' then tr -> 'writeback' -> 'result' end)));
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-token', v_token),
    body := jsonb_build_object('entry', new.id, 'action', v_action),
    timeout_milliseconds := 20000);
  return new;
end
$$;

drop trigger if exists os_tracker_writeback on public.os_entries;
create trigger os_tracker_writeback
  before update of payload on public.os_entries
  for each row
  when (new.payload ? 'tracker')
  execute function private.os_tracker_writeback_trigger();

-- What tracker-writeback reads: the entry's tracker block, for one id.
create or replace function public.os_tracker_writeback_entry(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select e.payload -> 'tracker' from public.os_entries e
   where e.id = p_id and e.domain = 'work' and e.type = 'task'
$$;

-- What tracker-writeback writes: the board's answer. Only the writeback
-- block changes, and updated_at stays, so an island holding this row's
-- updated_at does not see a conflict it did not cause.
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

revoke all on function private.os_tracker_writeback_trigger() from public, anon, authenticated;
revoke all on function public.os_tracker_writeback_entry(uuid) from public, anon, authenticated;
revoke all on function public.os_tracker_writeback_result(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.os_tracker_writeback_entry(uuid) to service_role;
grant execute on function public.os_tracker_writeback_result(uuid, jsonb) to service_role;
