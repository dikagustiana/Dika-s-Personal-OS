-- ===========================================================================
-- THE ISLAND PLANS, EDITS AND TICKS THE DAY'S WORK TIME BLOCKS. (D-33)
-- ===========================================================================
--
-- The desktop island's Tasks tab gains a "Blocks" segment: the WORK time
-- blocks of the island's local day, in start order, tickable like a to-do,
-- and plannable from the island's input line. Three doors, same tokens and
-- posture as 20261026000109_island_tasks:
--
--   public.os_island_blocks       read  — WORK blocks whose date is p_day
--   public.os_island_block_create write — a planned WORK block on p_day,
--                                 unattributed (no task, no milestone)
--   public.os_island_block_patch  write — `done` (true → done, false → back to
--                                 planned), `label`, `start` + `end`. Nothing
--                                 else: skipped, carried and blocked need a
--                                 reason or a carry-over and stay in the web,
--                                 and attribution stays in the web too.
--   There is deliberately no delete.
--
-- TIMES MUST FIT THE WEB'S GRID (src/logic/timebox.ts, TimeboxSection): WORK
-- shows 30-minute slots 08:30–18:30 and finds a block by its start. So start
-- and end are HH:MM on :00 or :30, 08:30 <= start < end <= 18:30, and a block
-- may not overlap another WORK block of the same day — an overlapping one
-- would sit in a slot the grid has already given away and never be seen. A
-- block longer than 30 minutes is allowed: the web shows it at its start and
-- counts its full duration (blockMinutes).
--
-- THE DONE PATCH MIRRORS THE WEB'S setBlockStatus (src/views/work/Today.tsx):
--   - leaving blocked/carried drops blockedOn / carryNote (absent keys);
--   - completing a block completes its linked task (taskId), when that task
--     is an open WORK task: done true + completedAt in toISOString form. The
--     tracker writeback trigger (D-31) sees that flip as it sees the web's.
--   - unticking never reopens the linked task (the web doesn't either).
-- THE CREATE MIRRORS createBlock: {date, start, end, label, status: planned},
-- tags '{}', entry_date = date (entryDateFor). No category / taskId keys.
-- os_daily_logs is not touched: the score is computed on screen by the web,
-- the same accepted limitation as island task ticks (docs/island-tasks.md).
--
-- Contract: docs/island-tasks.md § Time blocks.
-- Down-migration: supabase/migrations/down/20261027000116_island_blocks_down.sql
-- Standing check: supabase/tests/island_tasks.sql (C10, C8).

-- ---------------------------------------------------------------------------
-- 1. Row shape. Every value goes through ->> so a payload holding a number or
--    an object where a string belongs reads as a string (or null) instead of
--    breaking the island's decode of the whole list.
-- ---------------------------------------------------------------------------
create or replace function private.os_island_block_row(e public.os_entries)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id',         e.id,
    'date',       coalesce(e.payload ->> 'date', ''),
    'start',      coalesce(e.payload ->> 'start', ''),
    'end',        coalesce(e.payload ->> 'end', ''),
    'label',      coalesce(e.payload ->> 'label', ''),
    'category',   coalesce(to_jsonb(nullif(e.payload ->> 'category', '')), 'null'::jsonb),
    'status',     coalesce(e.payload ->> 'status', 'planned'),
    'task_id',    coalesce(to_jsonb(nullif(e.payload ->> 'taskId', '')), 'null'::jsonb),
    'updated_at', e.updated_at
  )
$$;

revoke all on function private.os_island_block_row(public.os_entries) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The time rule both writes run. Raises PT422 with a message the island
--    shows as is; p_except is the block being moved (it may overlap itself).
-- ---------------------------------------------------------------------------
create or replace function private.os_island_block_fit(
  p_day date, p_start text, p_end text, p_except uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  clash text;
begin
  if coalesce(p_start, '') !~ '^([01][0-9]|2[0-3]):(00|30)$'
     or coalesce(p_end, '') !~ '^([01][0-9]|2[0-3]):(00|30)$' then
    raise exception 'times are HH:MM on :00 or :30' using errcode = 'PT422';
  end if;
  if p_start < '08:30' or p_end > '18:30' or p_start >= p_end then
    raise exception 'blocks run 08:30–18:30, start before end' using errcode = 'PT422';
  end if;
  -- Zero-padded HH:MM compares correctly as text.
  select (e.payload ->> 'start') || '–' || (e.payload ->> 'end') || ' ' || coalesce(e.payload ->> 'label', '')
    into clash
    from public.os_entries e
   where e.domain = 'work'
     and e.type = 'timeblock'
     and e.entry_date = p_day
     and e.id is distinct from p_except
     and (e.payload ->> 'start') < p_end
     and (e.payload ->> 'end') > p_start
   order by e.payload ->> 'start'
   limit 1;
  if clash is not null then
    raise exception 'overlaps %', clash using errcode = 'PT422';
  end if;
end
$$;

revoke all on function private.os_island_block_fit(date, text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Read. p_day is the island's local day; the server never guesses one.
-- ---------------------------------------------------------------------------
create or replace function public.os_island_blocks(p_day date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rows jsonb;
begin
  perform private.os_island_token_check('read');
  if p_day is null then
    raise exception 'p_day required' using errcode = 'PT422';
  end if;
  select coalesce(jsonb_agg(private.os_island_block_row(e)
                            order by e.payload ->> 'start', e.created_at), '[]'::jsonb)
    into rows
    from public.os_entries e
   where e.domain = 'work'
     and e.type = 'timeblock'
     and e.entry_date = p_day;
  return jsonb_build_object('blocks', rows);
end
$$;

revoke all on function public.os_island_blocks(date) from public, authenticated;
grant execute on function public.os_island_blocks(date) to anon;

-- ---------------------------------------------------------------------------
-- 4. Create.
-- ---------------------------------------------------------------------------
create or replace function public.os_island_block_create(
  p_day   date,
  p_start text,
  p_end   text,
  p_label text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l text;
  r jsonb;
begin
  perform private.os_island_token_check('write');
  if p_day is null then
    raise exception 'p_day required' using errcode = 'PT422';
  end if;
  l := btrim(coalesce(p_label, ''));
  if l = '' or length(l) > 500 then
    raise exception 'label must be 1..500 chars' using errcode = 'PT422';
  end if;
  perform private.os_island_block_fit(p_day, p_start, p_end, null);
  insert into public.os_entries (type, domain, tags, entry_date, payload)
  values ('timeblock', 'work', '{}', p_day,
          jsonb_build_object('date', to_char(p_day, 'YYYY-MM-DD'), 'start', p_start, 'end', p_end,
                             'label', l, 'status', 'planned'))
  returning private.os_island_block_row(os_entries.*) into r;
  return r;
end
$$;

revoke all on function public.os_island_block_create(date, text, text, text) from public, authenticated;
grant execute on function public.os_island_block_create(date, text, text, text) to anon;

-- ---------------------------------------------------------------------------
-- 5. Patch. Allowlist, WORK filter and updated_at compare, as for tasks.
-- ---------------------------------------------------------------------------
create or replace function public.os_island_block_patch(
  p_id                  uuid,
  p_expected_updated_at timestamptz,
  p_patch               jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur  public.os_entries%rowtype;
  newp jsonb;
  k    text;
  done boolean;
  r    jsonb;
begin
  perform private.os_island_token_check('write');

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'empty patch' using errcode = 'PT422';
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('done', 'label', 'start', 'end') then
      raise exception 'key not allowed: %', k using errcode = 'PT422';
    end if;
  end loop;
  if (p_patch ? 'start') <> (p_patch ? 'end') then
    raise exception 'start and end go together' using errcode = 'PT422';
  end if;

  select * into cur
    from public.os_entries
   where id = p_id and domain = 'work' and type = 'timeblock'
   for update;
  if not found then
    raise exception 'block not found' using errcode = 'PT404';
  end if;
  if p_expected_updated_at is null or cur.updated_at <> p_expected_updated_at then
    raise exception 'block changed' using errcode = 'PT409';
  end if;

  newp := cur.payload;

  if p_patch ? 'label' then
    if jsonb_typeof(p_patch -> 'label') <> 'string'
       or btrim(p_patch ->> 'label') = ''
       or length(btrim(p_patch ->> 'label')) > 500 then
      raise exception 'label must be 1..500 chars' using errcode = 'PT422';
    end if;
    newp := newp || jsonb_build_object('label', btrim(p_patch ->> 'label'));
  end if;

  if p_patch ? 'start' then
    if jsonb_typeof(p_patch -> 'start') <> 'string' or jsonb_typeof(p_patch -> 'end') <> 'string' then
      raise exception 'times are HH:MM on :00 or :30' using errcode = 'PT422';
    end if;
    perform private.os_island_block_fit(cur.entry_date, p_patch ->> 'start', p_patch ->> 'end', cur.id);
    newp := newp || jsonb_build_object('start', p_patch ->> 'start', 'end', p_patch ->> 'end');
  end if;

  if p_patch ? 'done' then
    if jsonb_typeof(p_patch -> 'done') <> 'boolean' then
      raise exception 'done must be boolean' using errcode = 'PT422';
    end if;
    done := (p_patch ->> 'done')::boolean;
    newp := (newp - 'blockedOn' - 'carryNote')
            || jsonb_build_object('status', case when done then 'done' else 'planned' end);
  end if;

  -- updated_at is stamped by the os_entries_updated_at trigger.
  update public.os_entries
     set payload = newp
   where id = p_id
  returning private.os_island_block_row(os_entries.*) into r;

  if done and nullif(cur.payload ->> 'taskId', '') is not null then
    -- Compared as text: taskId has no foreign key and may not be a uuid.
    update public.os_entries
       set payload = payload || jsonb_build_object(
             'done', true,
             'completedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
     where id::text = cur.payload ->> 'taskId'
       and domain = 'work'
       and type = 'task'
       and (payload -> 'done') is distinct from 'true'::jsonb;
  end if;

  return r;
end
$$;

revoke all on function public.os_island_block_patch(uuid, timestamptz, jsonb) from public, authenticated;
grant execute on function public.os_island_block_patch(uuid, timestamptz, jsonb) to anon;
