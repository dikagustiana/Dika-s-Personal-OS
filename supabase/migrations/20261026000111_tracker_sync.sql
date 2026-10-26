-- Tracker sync (D-30, docs/tracker-feed.md). The SAMB Project Board's feed
-- for the owner — prepare / review / monitor — lands as WORK tasks, so it
-- shows wherever WORK tasks show: Today in the web and the desktop island.
--
-- One function owns the merge, os_tracker_sync(feed). It is called by the
-- tracker-feed function each time Today loads, and by the tracker-sync
-- function every 15 minutes through pg_cron. Rules, per feed item key:
--   new                → a WORK task, priority normal (never scored), tagged
--                        'tracker', payload.tracker = {key, url, group, kind, project}
--   still in the feed  → title and due date follow the board
--   ticked by the owner→ stays done: ticking here hides an item, it never
--                        changes the board
--   gone from the feed → done (the board moved on); payload.tracker.closed = true
-- Only rows carrying payload.tracker are ever touched.
--
-- The cron token lives in Vault (tracker_sync_token) with the function's URL
-- (tracker_sync_url); both are created by the runbook, not here.
-- Rollback: supabase/migrations/down/20261026000111_tracker_sync_down.sql.

create extension if not exists pg_net;

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
    'tracker',  jsonb_build_object(
                  'key',     p_item ->> 'key',
                  'url',     p_item ->> 'url',
                  'group',   p_group,
                  'kind',    p_item ->> 'kind',
                  'project', p_item ->> 'project')
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
      -- Done by the owner, or closed earlier and now back on the board: the
      -- owner's tick stands; a closed item comes back open.
      if cur.payload -> 'tracker' -> 'closed' = 'true'::jsonb then
        update public.os_entries
           set payload = fresh, entry_date = (fresh ->> 'dueDate')::date, updated_at = now()
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

-- Is this bearer the cron token in Vault? Asked by tracker-sync only.
create or replace function public.os_tracker_sync_token_ok(p_token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(length(p_token) = 64, false) and exists (
    select 1 from vault.decrypted_secrets s
     where s.name = 'tracker_sync_token'
       and extensions.digest(s.decrypted_secret, 'sha256') = extensions.digest(p_token, 'sha256'))
$$;

-- What pg_cron runs: POST to tracker-sync with the Vault token. Does nothing
-- until the runbook has put both secrets in Vault.
create or replace function private.os_tracker_sync_invoke()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := (select decrypted_secret from vault.decrypted_secrets where name = 'tracker_sync_url');
  v_token text := (select decrypted_secret from vault.decrypted_secrets where name = 'tracker_sync_token');
begin
  if v_url is null or v_token is null then
    raise warning 'tracker sync: tracker_sync_url / tracker_sync_token missing from Vault';
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-token', v_token),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000);
end
$$;

revoke all on function private.os_tracker_task_payload(jsonb, text) from public, anon, authenticated;
revoke all on function public.os_tracker_sync(jsonb) from public, anon, authenticated;
revoke all on function public.os_tracker_sync_token_ok(text) from public, anon, authenticated;
revoke all on function private.os_tracker_sync_invoke() from public, anon, authenticated;
grant execute on function public.os_tracker_sync(jsonb) to service_role;
grant execute on function public.os_tracker_sync_token_ok(text) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'tracker-sync') then
      perform cron.unschedule('tracker-sync');
    end if;
    perform cron.schedule('tracker-sync', '*/15 * * * *', 'select private.os_tracker_sync_invoke()');
  end if;
end
$$;
