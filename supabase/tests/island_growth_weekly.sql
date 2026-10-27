-- ===========================================================================
-- WEEKLY ITEMS AND THE _in DOORS: EITHER DOMAIN, NOTHING BEYOND. PROVEN.
-- ===========================================================================
--
-- Checks for 20261028000117_island_growth_weekly.sql. Like island_tasks.sql
-- this WRITES (tokens, fixture rows, RPC calls with request.headers set by
-- hand), so it is ONE DO BLOCK THAT ALWAYS ENDS IN AN EXCEPTION —
-- 'island_growth_weekly PASS (n checks)' or 'island_growth_weekly FAIL: …' —
-- and every write rolls back. Safe against production by construction.
--
--   G1 tasks_in: growth read returns open GROWTH tasks, never WORK ones, and
--      carries domain + weekly_item_id; a bad domain → PT422; write token → PT401
--   G2 task_create_in: growth task with a weekly item writes the SPA shape plus
--      weeklyItemId; a WORK item id on a GROWTH task → PT404
--   G3 task_patch_in: weeklyItemId set/cleared; a WORK id patched as growth →
--      PT404; {"priority":…} → PT422; stale → PT409
--   G4 weekly create/read/patch: range overlap read, progress counts, bad
--      dates → PT422, a project of the other domain → PT404, status 'carried'
--      by patch → PT422
--   G5 carry: original 'carried', copy from the Sunday after, same length,
--      carried_from set, open to-dos moved, done ones stay
--   G6 blocks_in / create_in / patch_in: WORK 08:30–18:30 and GROWTH
--      18:30–23:30 (the web's windows), overlap → PT422,
--      ticking a growth block ticks its growth to-do
--   G7 the WORK-only doors are unchanged: os_island_tasks still returns no
--      GROWTH row, os_island_block_create still refuses 19:00
--   G8 anon may execute every new public door and nothing new in private;
--      os_weekly_items is unreadable without a key (RLS)
--   G9 os_daily_logs row count identical before and after

do $$
declare
  rtok text; wtok text;
  since timestamptz := date_trunc('day', now());
  logs0 bigint;
  res jsonb; row1 jsonb; it jsonb; it2 jsonb;
  id_wt uuid; id_gt uuid; id_gt2 uuid; id_wi uuid; id_gi uuid; id_gproj uuid; id_wproj uuid;
  id_b uuid; ts timestamptz;
  pay jsonb;
  fails text[] := '{}';
  n int := 0;
  bday date := date '2000-01-05';
  f text;
begin
  select count(*) into logs0 from public.os_daily_logs;
  rtok := private.os_island_token_mint('read',  'test-read-117');
  wtok := private.os_island_token_mint('write', 'test-write-117');

  insert into public.os_projects (title, type, status, domain, engagement) values ('p-growth-117', 'study', 'active', 'growth', 'internal') returning id into id_gproj;
  insert into public.os_projects (title, type, status, domain, engagement) values ('p-work-117', 'build', 'active', 'work', 'samb') returning id into id_wproj;
  insert into public.os_entries (type, domain, payload) values ('task', 'work', '{"title":"g-work","priority":"normal","done":false}') returning id into id_wt;
  insert into public.os_entries (type, domain, payload) values ('task', 'growth', '{"title":"g-growth","priority":"normal","done":false}') returning id into id_gt;

  -- G4 (first: G2 needs items) ------------------------------------------------
  perform set_config('request.headers', json_build_object('x-island-token', wtok)::text, true);
  it := public.os_island_weekly_create('growth', '  IELTS writing week  ', '2000-01-02', '2000-01-08', id_gproj, 'IELTS');
  id_gi := (it ->> 'id')::uuid;
  n := n + 1;
  if it ->> 'title' <> 'IELTS writing week' or it ->> 'project' <> 'p-growth-117' or it ->> 'status' <> 'open' or (it ->> 'todos')::int <> 0 then
    fails := fails || ('G4 create ' || it::text);
  end if;
  it2 := public.os_island_weekly_create('work', 'Tie-out GL', '2000-01-05', '2000-01-11');
  id_wi := (it2 ->> 'id')::uuid;
  foreach f in array array['end-before-start', 'too-long', 'other-domain-project', 'empty'] loop
    n := n + 1;
    begin
      case f
        when 'end-before-start' then perform public.os_island_weekly_create('growth', 'x', '2000-01-08', '2000-01-02');
        when 'too-long' then perform public.os_island_weekly_create('growth', 'x', '2000-01-01', '2000-06-01');
        when 'other-domain-project' then perform public.os_island_weekly_create('growth', 'x', '2000-01-02', '2000-01-03', id_wproj);
        else perform public.os_island_weekly_create('growth', '   ', '2000-01-02', '2000-01-03');
      end case;
      fails := fails || ('G4 accepted ' || f);
    exception when others then
      if sqlstate not in ('PT422', 'PT404') then fails := fails || ('G4 ' || f || ' ' || sqlstate); end if;
    end;
  end loop;
  n := n + 1;
  begin
    perform public.os_island_weekly_patch(id_gi, (select updated_at from public.os_weekly_items where id = id_gi), '{"status":"carried"}');
    fails := fails || 'G4 status carried by patch';
  exception when others then
    if sqlstate <> 'PT422' then fails := fails || ('G4 carried ' || sqlstate); end if;
  end;

  -- G2 ------------------------------------------------------------------------
  row1 := public.os_island_task_create_in('growth', 'Essay 1', 'normal', '2000-01-04', id_gi);
  id_gt2 := (row1 ->> 'id')::uuid;
  select payload into pay from public.os_entries where id = id_gt2;
  n := n + 1;
  if pay <> jsonb_build_object('title', 'Essay 1', 'priority', 'normal', 'done', false, 'dueDate', '2000-01-04', 'weeklyItemId', id_gi::text)
     or row1 ->> 'domain' <> 'growth' or row1 ->> 'weekly_item_id' <> id_gi::text then
    fails := fails || ('G2 create ' || pay::text);
  end if;
  n := n + 1;
  begin
    perform public.os_island_task_create_in('growth', 'x', 'normal', null, id_wi);
    fails := fails || 'G2 growth task on a work item';
  exception when others then
    if sqlstate <> 'PT404' then fails := fails || ('G2 ' || sqlstate); end if;
  end;

  -- G1 ------------------------------------------------------------------------
  perform set_config('request.headers', json_build_object('x-island-token', rtok)::text, true);
  res := public.os_island_tasks_in('growth', since);
  n := n + 1;
  if exists (select 1 from jsonb_array_elements(res -> 'tasks') t where t ->> 'domain' <> 'growth' or t ->> 'title' = 'g-work')
     or not exists (select 1 from jsonb_array_elements(res -> 'tasks') t where t ->> 'title' = 'Essay 1' and t ->> 'weekly_item_id' = id_gi::text) then
    fails := fails || 'G1 growth read set';
  end if;
  n := n + 1;
  begin
    perform public.os_island_tasks_in('lab', since);
    fails := fails || 'G1 accepted domain lab';
  exception when others then
    if sqlstate <> 'PT422' then fails := fails || ('G1 domain ' || sqlstate); end if;
  end;
  perform set_config('request.headers', json_build_object('x-island-token', wtok)::text, true);
  n := n + 1;
  begin
    perform public.os_island_tasks_in('growth', since);
    fails := fails || 'G1 write token read';
  exception when others then
    if sqlstate <> 'PT401' then fails := fails || ('G1 token ' || sqlstate); end if;
  end;

  -- G3 ------------------------------------------------------------------------
  select updated_at into ts from public.os_entries where id = id_gt;
  row1 := public.os_island_task_patch_in('growth', id_gt, ts, jsonb_build_object('weeklyItemId', id_gi::text));
  n := n + 1;
  if row1 ->> 'weekly_item_id' <> id_gi::text then fails := fails || 'G3 link'; end if;
  select updated_at into ts from public.os_entries where id = id_gt;
  row1 := public.os_island_task_patch_in('growth', id_gt, ts, '{"weeklyItemId":null}');
  n := n + 1;
  if (select payload ? 'weeklyItemId' from public.os_entries where id = id_gt) then fails := fails || 'G3 unlink kept the key'; end if;
  foreach f in array array['work-as-growth', 'priority', 'stale'] loop
    n := n + 1;
    begin
      case f
        when 'work-as-growth' then perform public.os_island_task_patch_in('growth', id_wt, (select updated_at from public.os_entries where id = id_wt), '{"title":"x"}');
        when 'priority' then perform public.os_island_task_patch_in('growth', id_gt, (select updated_at from public.os_entries where id = id_gt), '{"priority":"urgent"}');
        else perform public.os_island_task_patch_in('growth', id_gt, '1999-01-01', '{"title":"x"}');
      end case;
      fails := fails || ('G3 accepted ' || f);
    exception when others then
      if sqlstate not in ('PT404', 'PT422', 'PT409') then fails := fails || ('G3 ' || f || ' ' || sqlstate); end if;
    end;
  end loop;

  -- G4 read + progress ---------------------------------------------------------
  select updated_at into ts from public.os_entries where id = id_gt2;
  perform public.os_island_task_patch_in('growth', id_gt2, ts, '{"done":true}');
  perform public.os_island_task_create_in('growth', 'Essay 2', 'normal', null, id_gi);
  perform set_config('request.headers', json_build_object('x-island-token', rtok)::text, true);
  res := public.os_island_weekly_items('growth', '2000-01-01', '2000-01-03');
  select e into it from jsonb_array_elements(res -> 'items') e where (e ->> 'id')::uuid = id_gi;
  n := n + 1;
  if it is null or (it ->> 'todos')::int <> 2 or (it ->> 'todos_done')::int <> 1
     or exists (select 1 from jsonb_array_elements(res -> 'items') e where e ->> 'domain' <> 'growth') then
    fails := fails || ('G4 read ' || coalesce(it::text, '∅'));
  end if;

  -- G5 carry ------------------------------------------------------------------
  perform set_config('request.headers', json_build_object('x-island-token', wtok)::text, true);
  it2 := public.os_island_weekly_carry(id_gi, (select updated_at from public.os_weekly_items where id = id_gi));
  n := n + 1;
  if (select status from public.os_weekly_items where id = id_gi) <> 'carried'
     or it2 ->> 'start_date' <> '2000-01-09' or it2 ->> 'end_date' <> '2000-01-15'
     or it2 ->> 'carried_from' <> id_gi::text or (it2 ->> 'todos')::int <> 1 then
    fails := fails || ('G5 carry ' || it2::text);
  end if;
  n := n + 1;
  if (select payload ->> 'weeklyItemId' from public.os_entries where id = id_gt2) <> id_gi::text then
    fails := fails || 'G5 a done to-do moved';
  end if;

  -- G6 blocks -----------------------------------------------------------------
  res := public.os_island_block_create_in('growth', bday, '19:00', '20:30', 'IELTS essay', 'task', id_gt);
  id_b := (res ->> 'id')::uuid;
  n := n + 1;
  if res ->> 'domain' <> 'growth' or res ->> 'task_id' <> id_gt::text then fails := fails || ('G6 create ' || res::text); end if;
  foreach f in array array['overlap', 'late', 'growth-morning', 'work-evening', 'ref-other-domain'] loop
    n := n + 1;
    begin
      case f
        when 'overlap' then perform public.os_island_block_create_in('growth', bday, '20:00', '21:00', 'x');
        when 'growth-morning' then perform public.os_island_block_create_in('growth', bday, '10:00', '11:00', 'x');
        when 'work-evening' then perform public.os_island_block_create_in('work', bday, '19:00', '20:00', 'x');
        when 'late' then perform public.os_island_block_create_in('growth', bday, '23:00', '23:59', 'x');
        else perform public.os_island_block_create_in('growth', bday, '21:00', '22:00', 'x', 'task', id_wt);
      end case;
      fails := fails || ('G6 accepted ' || f);
    exception when others then
      if sqlstate not in ('PT422', 'PT404') then fails := fails || ('G6 ' || f || ' ' || sqlstate); end if;
    end;
  end loop;
  perform public.os_island_block_patch_in('growth', id_b, (select updated_at from public.os_entries where id = id_b), '{"done":true}');
  n := n + 1;
  if (select payload -> 'done' from public.os_entries where id = id_gt) <> 'true'::jsonb then fails := fails || 'G6 tick did not reach the to-do'; end if;
  perform set_config('request.headers', json_build_object('x-island-token', rtok)::text, true);
  res := public.os_island_blocks_in(bday);
  n := n + 1;
  if not exists (select 1 from jsonb_array_elements(res -> 'blocks') b where (b ->> 'id')::uuid = id_b and b ->> 'status' = 'done') then
    fails := fails || 'G6 read';
  end if;

  -- G7 the WORK-only doors ------------------------------------------------------
  res := public.os_island_tasks(since);
  n := n + 1;
  if exists (select 1 from jsonb_array_elements(res -> 'tasks') t where t ->> 'title' in ('g-growth', 'Essay 1', 'Essay 2')) then
    fails := fails || 'G7 WORK read shows GROWTH';
  end if;
  perform set_config('request.headers', json_build_object('x-island-token', wtok)::text, true);
  n := n + 1;
  begin
    perform public.os_island_block_create(bday + 1, '19:00', '19:30', 'x');
    fails := fails || 'G7 WORK block at 19:00';
  exception when others then
    if sqlstate <> 'PT422' then fails := fails || ('G7 ' || sqlstate); end if;
  end;

  -- G8 grants and RLS -----------------------------------------------------------
  n := n + 1;
  if exists (
       select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
        where s.nspname = 'public'
          and p.proname in ('os_island_tasks_in', 'os_island_task_create_in', 'os_island_task_patch_in', 'os_island_weekly_items',
                            'os_island_weekly_create', 'os_island_weekly_patch', 'os_island_weekly_carry', 'os_island_blocks_in',
                            'os_island_block_create_in', 'os_island_block_patch_in')
          and (not has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) then
    fails := fails || 'G8 public door grants';
  end if;
  n := n + 1;
  if exists (
       select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
        where s.nspname = 'private'
          and p.proname in ('os_island_domain', 'os_island_task_row_in', 'os_island_weekly_row', 'os_island_weekly_ref',
                            'os_island_block_fit_in', 'os_island_block_row_in', 'os_weekly_item_project_check')
          and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) then
    fails := fails || 'G8 private helper reachable';
  end if;
  perform set_config('request.headers', '{}', true);
  set local role anon;
  n := n + 1;
  if (select count(*) from public.os_weekly_items) <> 0 then fails := fails || 'G8 RLS: anon without a key reads weekly items'; end if;
  reset role;

  -- G9 ------------------------------------------------------------------------
  n := n + 1;
  if (select count(*) from public.os_daily_logs) <> logs0 then fails := fails || 'G9 daily logs changed'; end if;

  if array_length(fails, 1) is null then
    raise exception 'island_growth_weekly PASS (% checks)', n;
  else
    raise exception 'island_growth_weekly FAIL: %', array_to_string(fails, ' | ');
  end if;
end
$$;
