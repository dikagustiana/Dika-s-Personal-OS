-- ===========================================================================
-- THE ISLAND SEES TODAY'S WORK TIME BLOCKS AND TICKS THEM. NOTHING ELSE. (D-33)
-- ===========================================================================
--
-- The desktop island's Tasks tab gains a "Blocks" segment: the WORK time
-- blocks of the island's local day, in start order, tickable like a to-do.
-- Two doors, same tokens and posture as 20261026000109_island_tasks:
--
--   public.os_island_blocks      read  — WORK blocks whose date is p_day
--   public.os_island_block_patch write — status done (p_done true) or back to
--                                planned (false). Nothing else: skipped,
--                                carried and blocked need a reason or a
--                                carry-over and stay in the web.
--
-- THE PATCH MIRRORS THE WEB'S setBlockStatus (src/views/work/Today.tsx):
--   - leaving blocked/carried drops blockedOn / carryNote (absent keys);
--   - completing a block completes its linked task (taskId), when that task
--     is an open WORK task: done true + completedAt in toISOString form. The
--     tracker writeback trigger (D-31) sees that flip as it sees the web's.
--   - unticking never reopens the linked task (the web doesn't either).
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
-- 2. Read. p_day is the island's local day; the server never guesses one.
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
-- 3. Tick / untick.
-- ---------------------------------------------------------------------------
create or replace function public.os_island_block_patch(
  p_id                  uuid,
  p_expected_updated_at timestamptz,
  p_done                boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur public.os_entries%rowtype;
  r   jsonb;
begin
  perform private.os_island_token_check('write');
  if p_done is null then
    raise exception 'p_done must be true or false' using errcode = 'PT422';
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

  update public.os_entries
     set payload = (payload - 'blockedOn' - 'carryNote')
                   || jsonb_build_object('status', case when p_done then 'done' else 'planned' end)
   where id = p_id
  returning private.os_island_block_row(os_entries.*) into r;

  if p_done and nullif(cur.payload ->> 'taskId', '') is not null then
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

revoke all on function public.os_island_block_patch(uuid, timestamptz, boolean) from public, authenticated;
grant execute on function public.os_island_block_patch(uuid, timestamptz, boolean) to anon;
