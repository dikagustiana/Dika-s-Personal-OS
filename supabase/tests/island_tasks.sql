-- ===========================================================================
-- THE ISLAND'S THREE DOORS OPEN ONLY ONTO WORK TASKS. PROVEN BY CALLING THEM.
-- ===========================================================================
--
-- Checks for 20261026000109_island_tasks.sql (contract: docs/island-tasks.md).
--
-- UNLIKE THE OTHER FILES IN THIS FOLDER, THIS ONE WRITES: it mints tokens,
-- inserts fixture rows and calls the RPCs the way PostgREST would (the
-- request.headers GUC set by hand). So it is ONE DO BLOCK THAT ALWAYS ENDS IN
-- AN EXCEPTION — 'island_tasks PASS (n checks)' or 'island_tasks FAIL: …' —
-- and the exception rolls every write back, whoever runs it and wherever. It
-- is safe against production by construction, and that is how it is run
-- there (MCP execute_sql or the SQL editor). scripts/island-tasks-tests.sh
-- runs it on a local replay and greps for PASS.
--
-- What it asserts (ARCHITECTURE §2.11):
--   1. read with the read token returns exactly the open WORK tasks
--   2. read returns open WORK tasks + WORK tasks completed since p_since only;
--      never GROWTH tasks, never WORK habits, never done-before-since
--   3. read with the write token / no header / revoked token / 63 chars → PT401
--   4. create → normal by default, urgent only when asked; 'high' → PT422;
--      empty title → PT422; read token on create → PT401; entry_date = due;
--      payload has no completedAt / dueDate keys when absent (SPA shape)
--   5. patch title leaves the rest of the payload byte-identical; dueDate null
--      removes the key and entry_date; done true sets completedAt in
--      toISOString form; done false removes it
--   6. stale updated_at → PT409; GROWTH id → PT404; {"priority":…} → PT422 and
--      nothing changed; {} → PT422
--   7. os_daily_logs row count identical before and after
--   8. anon may execute exactly the three public RPCs and nothing in private
--   9. a malformed WORK row (string done, unparseable completedAt) is read
--      as open / left out instead of failing the whole read (needs 110)
--  10. time blocks (needs 116): read returns the WORK blocks of p_day only,
--      in start order; write token on read / read token on patch → PT401;
--      done drops blockedOn, completes the open linked WORK task; untick →
--      planned and the task stays done; stale → PT409; GROWTH block → PT404

do $$
declare
  rtok   text;
  wtok   text;
  xtok   text;
  since  timestamptz := date_trunc('day', now());
  logs0  bigint;
  res    jsonb;
  row1   jsonb;
  id_open uuid; id_growth uuid; id_done_old uuid; id_done_new uuid; id_habit uuid;
  before jsonb;
  after  jsonb;
  got    text;
  fails  text[] := '{}';
  n      int := 0;
  ids    text[];
  bday   date := date '2000-01-03';
  id_blk uuid; id_blk_g uuid; id_linked uuid;
begin
  select count(*) into logs0 from public.os_daily_logs;

  -- No DELETE to start from an empty list: the MCP SQL path asks for a
  -- confirmation on any DELETE, and the assertions don't need one. C1
  -- compares against the live open count; C2 looks at the fixture rows only
  -- (titles 't-…').

  rtok := private.os_island_token_mint('read',  'test-read');
  wtok := private.os_island_token_mint('write', 'test-write');
  xtok := private.os_island_token_mint('read',  'test-revoked');
  update private.os_island_tokens set revoked_at = now() where label = 'test-revoked';

  -- 1 ------------------------------------------------------------------------
  perform set_config('request.headers', json_build_object('x-island-token', rtok)::text, true);
  res := public.os_island_tasks(since);
  n := n + 1;
  if jsonb_array_length(res -> 'tasks') <> (select count(*) from public.os_entries
       where domain = 'work' and type = 'task' and coalesce((payload ->> 'done')::boolean, false) = false) then
    fails := fails || 'C1 read count';
  end if;

  -- 2 ------------------------------------------------------------------------
  insert into public.os_entries (type, domain, entry_date, payload) values
    ('task', 'work', null, '{"title":"t-open","priority":"normal","done":false}')
    returning id into id_open;
  insert into public.os_entries (type, domain, entry_date, payload) values
    ('task', 'growth', null, '{"title":"t-growth","priority":"normal","done":false}')
    returning id into id_growth;
  insert into public.os_entries (type, domain, entry_date, payload) values
    ('task', 'work', null, jsonb_build_object('title','t-done-old','priority','normal','done',true,
       'completedAt', to_char((since - interval '2 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
    returning id into id_done_old;
  insert into public.os_entries (type, domain, entry_date, payload) values
    ('task', 'work', null, jsonb_build_object('title','t-done-new','priority','urgent','done',true,
       'completedAt', to_char((since + interval '1 minute') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
    returning id into id_done_new;
  insert into public.os_entries (type, domain, entry_date, payload) values
    ('habit', 'work', null, '{"title":"t-habit","active":true,"order":0}')
    returning id into id_habit;

  res := public.os_island_tasks(since);
  select array_agg(t ->> 'title' order by t ->> 'title') into ids from jsonb_array_elements(res -> 'tasks') t
   where t ->> 'title' like 't-%';
  n := n + 1;
  if ids is distinct from array['t-done-new', 't-open'] then
    fails := fails || ('C2 read set = ' || coalesce(array_to_string(ids, ','), '∅'));
  end if;

  -- 3 ------------------------------------------------------------------------
  foreach got in array array[wtok, '', xtok, left(rtok, 63)] loop
    perform set_config('request.headers',
      case when got = '' then '{}' else json_build_object('x-island-token', got)::text end, true);
    n := n + 1;
    begin
      perform public.os_island_tasks(since);
      fails := fails || 'C3 read accepted a bad token';
    exception when others then
      if sqlstate <> 'PT401' then fails := fails || ('C3 ' || sqlstate); end if;
    end;
  end loop;

  -- 4 ------------------------------------------------------------------------
  perform set_config('request.headers', json_build_object('x-island-token', wtok)::text, true);
  row1 := public.os_island_task_create('  Buy toner  ', 'normal', '2026-10-31');
  n := n + 1;
  if row1 ->> 'priority' <> 'normal' or row1 ->> 'title' <> 'Buy toner'
     or row1 ->> 'due_date' <> '2026-10-31' or (row1 ->> 'done')::boolean then
    fails := fails || ('C4 create row ' || row1::text);
  end if;
  select payload into after from public.os_entries where id = (row1 ->> 'id')::uuid;
  n := n + 1;
  if after <> '{"title":"Buy toner","priority":"normal","done":false,"dueDate":"2026-10-31"}'::jsonb then
    fails := fails || ('C4 payload ' || after::text);
  end if;
  n := n + 1;
  if (select entry_date from public.os_entries where id = (row1 ->> 'id')::uuid) is distinct from '2026-10-31'::date then
    fails := fails || 'C4 entry_date';
  end if;
  res := public.os_island_task_create('Call the bank');
  n := n + 1;
  if res ->> 'priority' <> 'normal' or res -> 'due_date' <> 'null'::jsonb then
    fails := fails || 'C4 default not normal/no due';
  end if;
  res := public.os_island_task_create('Urgent one', 'urgent');
  n := n + 1;
  if res ->> 'priority' <> 'urgent' then fails := fails || 'C4 urgent'; end if;
  n := n + 1;
  begin
    perform public.os_island_task_create('x', 'high');
    fails := fails || 'C4 high accepted';
  exception when others then
    if sqlstate <> 'PT422' then fails := fails || ('C4 high ' || sqlstate); end if;
  end;
  n := n + 1;
  begin
    perform public.os_island_task_create('   ');
    fails := fails || 'C4 empty title accepted';
  exception when others then
    if sqlstate <> 'PT422' then fails := fails || ('C4 empty ' || sqlstate); end if;
  end;
  perform set_config('request.headers', json_build_object('x-island-token', rtok)::text, true);
  n := n + 1;
  begin
    perform public.os_island_task_create('read token write');
    fails := fails || 'C4 read token created';
  exception when others then
    if sqlstate <> 'PT401' then fails := fails || ('C4 rtok ' || sqlstate); end if;
  end;

  -- 5 ------------------------------------------------------------------------
  perform set_config('request.headers', json_build_object('x-island-token', wtok)::text, true);
  select payload into before from public.os_entries where id = (row1 ->> 'id')::uuid;
  row1 := public.os_island_task_patch((row1 ->> 'id')::uuid, (row1 ->> 'updated_at')::timestamptz, '{"title":"Buy toner x2"}');
  select payload into after from public.os_entries where id = (row1 ->> 'id')::uuid;
  n := n + 1;
  if after ->> 'title' <> 'Buy toner x2' or (after - 'title') <> (before - 'title') then
    fails := fails || 'C5 title patch touched other keys';
  end if;

  row1 := public.os_island_task_patch((row1 ->> 'id')::uuid, (row1 ->> 'updated_at')::timestamptz, '{"dueDate":null}');
  n := n + 1;
  if exists (select 1 from public.os_entries where id = (row1 ->> 'id')::uuid and (payload ? 'dueDate' or entry_date is not null)) then
    fails := fails || 'C5 dueDate null left the key or entry_date';
  end if;

  row1 := public.os_island_task_patch((row1 ->> 'id')::uuid, (row1 ->> 'updated_at')::timestamptz, '{"dueDate":"2026-11-03"}');
  n := n + 1;
  if (select entry_date from public.os_entries where id = (row1 ->> 'id')::uuid) <> '2026-11-03'::date then
    fails := fails || 'C5 dueDate set did not move entry_date';
  end if;

  row1 := public.os_island_task_patch((row1 ->> 'id')::uuid, (row1 ->> 'updated_at')::timestamptz, '{"done":true}');
  n := n + 1;
  if not (row1 ->> 'done')::boolean
     or row1 ->> 'completed_at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' then
    fails := fails || ('C5 done true ' || row1::text);
  end if;

  row1 := public.os_island_task_patch((row1 ->> 'id')::uuid, (row1 ->> 'updated_at')::timestamptz, '{"done":false}');
  n := n + 1;
  if exists (select 1 from public.os_entries where id = (row1 ->> 'id')::uuid and (payload ? 'completedAt' or (payload ->> 'done')::boolean)) then
    fails := fails || 'C5 done false kept completedAt';
  end if;

  -- 6 ------------------------------------------------------------------------
  n := n + 1;
  begin
    perform public.os_island_task_patch((row1 ->> 'id')::uuid, '2000-01-01T00:00:00Z', '{"done":true}');
    fails := fails || 'C6 stale accepted';
  exception when others then
    if sqlstate <> 'PT409' then fails := fails || ('C6 stale ' || sqlstate); end if;
  end;
  n := n + 1;
  begin
    perform public.os_island_task_patch(id_growth,
      (select updated_at from public.os_entries where id = id_growth), '{"done":true}');
    fails := fails || 'C6 growth patched';
  exception when others then
    if sqlstate <> 'PT404' then fails := fails || ('C6 growth ' || sqlstate); end if;
  end;
  n := n + 1;
  begin
    perform public.os_island_task_patch(id_habit,
      (select updated_at from public.os_entries where id = id_habit), '{"title":"x"}');
    fails := fails || 'C6 habit patched';
  exception when others then
    if sqlstate <> 'PT404' then fails := fails || ('C6 habit ' || sqlstate); end if;
  end;
  select payload into before from public.os_entries where id = (row1 ->> 'id')::uuid;
  n := n + 1;
  begin
    perform public.os_island_task_patch((row1 ->> 'id')::uuid, (row1 ->> 'updated_at')::timestamptz, '{"priority":"urgent"}');
    fails := fails || 'C6 priority accepted';
  exception when others then
    if sqlstate <> 'PT422' then fails := fails || ('C6 priority ' || sqlstate); end if;
  end;
  n := n + 1;
  if (select payload from public.os_entries where id = (row1 ->> 'id')::uuid) <> before then
    fails := fails || 'C6 refused patch changed the row';
  end if;
  n := n + 1;
  begin
    perform public.os_island_task_patch((row1 ->> 'id')::uuid, (row1 ->> 'updated_at')::timestamptz, '{}');
    fails := fails || 'C6 empty patch accepted';
  exception when others then
    if sqlstate <> 'PT422' then fails := fails || ('C6 empty ' || sqlstate); end if;
  end;
  perform set_config('request.headers', json_build_object('x-island-token', rtok)::text, true);
  n := n + 1;
  begin
    perform public.os_island_task_patch((row1 ->> 'id')::uuid, (row1 ->> 'updated_at')::timestamptz, '{"done":true}');
    fails := fails || 'C6 read token patched';
  exception when others then
    if sqlstate <> 'PT401' then fails := fails || ('C6 rtok ' || sqlstate); end if;
  end;

  -- 9 (20261026000110) -------------------------------------------------------
  -- A malformed WORK row is shown as open or left out, never an error for
  -- every row: a string `done` and an unparseable `completedAt`.
  insert into public.os_entries (type, domain, entry_date, payload) values
    ('task', 'work', null, '{"title":"t-bad-done","priority":"normal","done":"yes"}'),
    ('task', 'work', null, '{"title":"t-bad-at","priority":"normal","done":true,"completedAt":"kemarin"}');
  perform set_config('request.headers', json_build_object('x-island-token', rtok)::text, true);
  n := n + 1;
  begin
    res := public.os_island_tasks(since);
    if not exists (select 1 from jsonb_array_elements(res -> 'tasks') t where t ->> 'title' = 't-bad-done' and not (t ->> 'done')::boolean)
       or exists (select 1 from jsonb_array_elements(res -> 'tasks') t where t ->> 'title' = 't-bad-at') then
      fails := fails || 'C9 malformed rows misread';
    end if;
  exception when others then
    fails := fails || ('C9 malformed row broke the read: ' || sqlstate);
  end;

  -- 7 ------------------------------------------------------------------------
  n := n + 1;
  if (select count(*) from public.os_daily_logs) <> logs0 then
    fails := fails || 'C7 os_daily_logs moved';
  end if;

  -- 8 ------------------------------------------------------------------------
  n := n + 1;
  select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text) into ids
    from pg_proc p
   where p.proname like 'os_island%'
     and has_function_privilege('anon', p.oid, 'execute');
  if ids is distinct from array[
       'os_island_block_patch(uuid,timestamp with time zone,boolean)',
       'os_island_blocks(date)',
       'os_island_task_assign(uuid,timestamp with time zone,uuid)',
       'os_island_task_create(text,text,date)',
       'os_island_task_patch(uuid,timestamp with time zone,jsonb)',
       'os_island_tasks(timestamp with time zone)'] then
    fails := fails || ('C8 anon can execute ' || coalesce(array_to_string(ids, ' | '), '∅'));
  end if;
  n := n + 1;
  if has_table_privilege('anon', 'private.os_island_tokens', 'select') then
    fails := fails || 'C8 anon reads the token table';
  end if;


  -- 10 -----------------------------------------------------------------------
  insert into public.os_entries (type, domain, entry_date, payload) values
    ('task', 'work', null, '{"title":"t-linked","priority":"normal","done":false}')
    returning id into id_linked;
  insert into public.os_entries (type, domain, entry_date, payload) values
    ('timeblock', 'work', bday, jsonb_build_object('date', bday::text, 'start', '10:00', 'end', '11:00',
       'label', 'b-second', 'status', 'blocked', 'blockedOn', 'x', 'taskId', id_linked::text))
    returning id into id_blk;
  insert into public.os_entries (type, domain, entry_date, payload) values
    ('timeblock', 'work', bday, jsonb_build_object('date', bday::text, 'start', '09:00', 'end', '10:00',
       'label', 'b-first', 'status', 'planned', 'category', 'deep-work'));
  insert into public.os_entries (type, domain, entry_date, payload) values
    ('timeblock', 'work', bday + 1, jsonb_build_object('date', (bday + 1)::text, 'start', '09:00', 'end', '10:00',
       'label', 'b-tomorrow', 'status', 'planned'));
  insert into public.os_entries (type, domain, entry_date, payload) values
    ('timeblock', 'growth', bday, jsonb_build_object('date', bday::text, 'start', '08:00', 'end', '09:00',
       'label', 'b-growth', 'status', 'planned'))
    returning id into id_blk_g;

  perform set_config('request.headers', json_build_object('x-island-token', rtok)::text, true);
  res := public.os_island_blocks(bday);
  select array_agg(b ->> 'label' order by ord) into ids
    from jsonb_array_elements(res -> 'blocks') with ordinality as x(b, ord);
  n := n + 1;
  if ids is distinct from array['b-first', 'b-second'] then
    fails := fails || ('C10 block read = ' || coalesce(array_to_string(ids, ','), '∅'));
  end if;
  row1 := res -> 'blocks' -> 1;
  n := n + 1;
  if row1 ->> 'task_id' <> id_linked::text or (res -> 'blocks' -> 1 -> 'category') <> 'null'::jsonb
     or (res -> 'blocks' -> 0 ->> 'category') <> 'deep-work' then
    fails := fails || ('C10 block row = ' || row1::text);
  end if;

  n := n + 1;
  begin
    perform public.os_island_block_patch(id_blk, (row1 ->> 'updated_at')::timestamptz, true);
    fails := fails || 'C10 read token patched a block';
  exception when others then
    if sqlstate <> 'PT401' then fails := fails || ('C10 read-token patch ' || sqlstate); end if;
  end;

  perform set_config('request.headers', json_build_object('x-island-token', wtok)::text, true);
  n := n + 1;
  begin
    perform public.os_island_blocks(bday);
    fails := fails || 'C10 write token read blocks';
  exception when others then
    if sqlstate <> 'PT401' then fails := fails || ('C10 write-token read ' || sqlstate); end if;
  end;

  res := public.os_island_block_patch(id_blk, (row1 ->> 'updated_at')::timestamptz, true);
  select payload into after from public.os_entries where id = id_blk;
  n := n + 1;
  if res ->> 'status' <> 'done' or after ? 'blockedOn' or after ->> 'label' <> 'b-second' then
    fails := fails || ('C10 done = ' || after::text);
  end if;
  select payload into after from public.os_entries where id = id_linked;
  n := n + 1;
  if after -> 'done' <> 'true'::jsonb
     or (after ->> 'completedAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' then
    fails := fails || ('C10 linked task = ' || after::text);
  end if;

  n := n + 1;
  begin
    perform public.os_island_block_patch(id_blk, '2000-01-01T00:00:00Z', false);
    fails := fails || 'C10 stale block patch accepted';
  exception when others then
    if sqlstate <> 'PT409' then fails := fails || ('C10 stale ' || sqlstate); end if;
  end;

  res := public.os_island_block_patch(id_blk, (res ->> 'updated_at')::timestamptz, false);
  n := n + 1;
  if res ->> 'status' <> 'planned'
     or (select payload -> 'done' from public.os_entries where id = id_linked) <> 'true'::jsonb then
    fails := fails || 'C10 untick';
  end if;

  n := n + 1;
  begin
    perform public.os_island_block_patch(id_blk_g, now(), true);
    fails := fails || 'C10 GROWTH block patched';
  exception when others then
    if sqlstate <> 'PT404' then fails := fails || ('C10 growth ' || sqlstate); end if;
  end;

  if cardinality(fails) = 0 then
    raise exception 'island_tasks PASS (% checks)', n;
  else
    raise exception 'island_tasks FAIL (% of % checks): %', cardinality(fails), n, array_to_string(fails, ' ; ');
  end if;
end
$$;
