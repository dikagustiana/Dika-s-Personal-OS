-- ===========================================================================
-- THE DESKTOP ISLAND READS AND EDITS WORK TASKS. NOTHING ELSE.
-- ===========================================================================
--
-- The owner's Windows island (the Oyen Poni fork, branch more-me) replaces its
-- local to-do list with the WORK daily tasks held here. It is a second client
-- of os_entries next to the SPA, and it must not be a second owner: the owner
-- key (x-app-key, 20260724000002) opens every os_ table including the SAMB
-- Finish line, and a DPAPI blob on a desktop is the wrong place for that.
--
-- So the island gets its own credentials and its own three doors:
--
--   private.os_island_tokens    hashed, one capability per token (read|write),
--                               revocable. A leaked read token cannot write; a
--                               leaked write token cannot list.
--   public.os_island_tasks      read  — open WORK tasks + those completed
--                               since the island's local midnight
--   public.os_island_task_create write — a WORK task, normal unless the owner
--                               typed urgent on purpose
--   public.os_island_task_patch  write — title, done, dueDate. Nothing else,
--                               ever: priority is not patchable from the
--                               island, so it can never move a task into the
--                               scored set by accident.
--
-- WHAT THESE FUNCTIONS NEVER TOUCH, BY CONSTRUCTION: os_daily_logs (the score
-- is out of scope for the island, decision 2026-10-26 — a tick from the
-- island reaches the stored score only when the web next recomputes it),
-- os_projects, GROWTH rows, any type other than 'task'. Every public RPC
-- filters `domain = 'work' and type = 'task'`; a GROWTH id is a 404 that looks
-- exactly like a missing id. There is deliberately no delete.
--
-- THE PAYLOAD MIRRORS THE SPA'S WRITE PATH (src/data/supabaseRepository.ts):
--   - entryToRow serialises the TaskEntry through JSON, which DROPS undefined
--     keys. So an absent dueDate / completedAt is an absent KEY, never a JSON
--     null, and the island writes it the same way: clearing a due date or
--     unticking removes the key.
--   - entry_date is the promoted dueDate for tasks (entryDateFor). listEntries
--     date filters run against it, so every write here keeps it in step.
--   - completedAt is Date.toISOString(): 'YYYY-MM-DDTHH:MM:SS.sssZ' in UTC.
--   - A web-created task carries {title, priority, done} (+ dueDate); no
--     weeklyGoalId / projectId keys. Created here the same way.
--
-- WHY SHA-256 AND NOT crypt(): the owner key is a human passphrase and needs a
-- slow hash. Island tokens are 32 random bytes; a fast hash is correct for
-- that and keeps the per-request check negligible. Same reasoning as the
-- dikagustiana.com progress feed the island already talks to.
--
-- WHY PTxxx ERRCODES: PostgREST maps `PT401` to HTTP 401 and so on, which the
-- island turns into states (token rejected / not found / changed on the web).
--
-- Contract + token runbook: docs/island-tasks.md
-- Down-migration: supabase/migrations/down/20261026000109_island_tasks_down.sql
-- Standing check: supabase/tests/island_tasks.sql (live, rolled back) and
--                 scripts/island-tasks-tests.sh (local replay)

-- ---------------------------------------------------------------------------
-- 1. Token store. Same posture as private.os_share_links: hash only, never
--    granted to anon, the private schema is not exposed through PostgREST.
-- ---------------------------------------------------------------------------
create table if not exists private.os_island_tokens (
  id           uuid primary key default gen_random_uuid(),
  capability   text not null check (capability in ('read', 'write')),
  token_hash   text not null unique,
  label        text not null default '',
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  -- Stamped at most hourly, so a 60-second poll is not a write per request.
  last_seen_at timestamptz
);

comment on table private.os_island_tokens is
  'Scoped credentials for the desktop island. One capability per token, so a leaked read token cannot write and a leaked write token cannot list. Hash only; the raw token is returned once by os_island_token_mint and lives DPAPI-sealed on the PC. Never grant anything here to anon.';

revoke all on table private.os_island_tokens from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Minting. Owner-only: run from the SQL editor / MCP as postgres. The raw
--    value is returned once and is not recoverable afterwards.
-- ---------------------------------------------------------------------------
create or replace function private.os_island_token_mint(p_capability text, p_label text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  raw text;
begin
  if p_capability is null or p_capability not in ('read', 'write') then
    raise exception 'capability must be read or write';
  end if;
  raw := encode(extensions.gen_random_bytes(32), 'hex');
  insert into private.os_island_tokens (capability, token_hash, label)
  values (p_capability,
          encode(pg_catalog.sha256(convert_to(raw, 'UTF8')), 'hex'),
          coalesce(p_label, ''));
  return raw;
end
$$;

revoke all on function private.os_island_token_mint(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The check every public RPC runs first.
-- ---------------------------------------------------------------------------
create or replace function private.os_island_token_check(p_capability text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate text;
  h         text;
  tok_id    uuid;
  seen      timestamptz;
begin
  -- request.headers is the GUC PostgREST sets per request; os_key_valid()
  -- reads the owner key the same way.
  candidate := coalesce(current_setting('request.headers', true)::json ->> 'x-island-token', '');
  -- Shape first: anything that is not 64 lowercase hex is refused unhashed.
  if candidate !~ '^[0-9a-f]{64}$' then
    raise exception 'island token required' using errcode = 'PT401';
  end if;
  h := encode(pg_catalog.sha256(convert_to(candidate, 'UTF8')), 'hex');
  select t.id, t.last_seen_at into tok_id, seen
    from private.os_island_tokens t
   where t.token_hash = h
     and t.capability = p_capability
     and t.revoked_at is null;
  if tok_id is null then
    -- One message for wrong token, wrong capability and revoked token, so a
    -- caller learns nothing about which of the three it hit.
    raise exception 'island token rejected' using errcode = 'PT401';
  end if;
  if seen is null or seen < now() - interval '1 hour' then
    update private.os_island_tokens set last_seen_at = now() where id = tok_id;
  end if;
  -- A task list is personal data; no proxy or client cache should keep it.
  perform set_config('response.headers', '[{"Cache-Control": "no-store"}]', true);
  return tok_id;
end
$$;

revoke all on function private.os_island_token_check(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The one row shape all three RPCs return. Wire casing is snake_case; the
--    stored payload keeps the SPA's camelCase keys. The island never sees
--    weeklyGoalId, projectId, tags or entry_date.
-- ---------------------------------------------------------------------------
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
    'done',         coalesce((e.payload ->> 'done')::boolean, false),
    -- Echoed as stored (ISO string), JSON null when the key is absent.
    'completed_at', coalesce(e.payload -> 'completedAt', 'null'::jsonb),
    'due_date',     coalesce(e.payload -> 'dueDate', 'null'::jsonb),
    -- The optimistic-concurrency token: the island sends it back verbatim on
    -- a patch, and a moved value means the web changed the row first.
    'updated_at',   e.updated_at
  )
$$;

revoke all on function private.os_island_task_row(public.os_entries) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Read.
-- ---------------------------------------------------------------------------
-- p_since is the island's LOCAL midnight expressed in UTC. The server never
-- guesses a timezone: the island decides what "today" means, and asks for the
-- tasks completed since then so it can show them struck through and untick.
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
     and (   coalesce((e.payload ->> 'done')::boolean, false) = false
          or nullif(e.payload ->> 'completedAt', '')::timestamptz >= p_since);
  return jsonb_build_object('server_time', now(), 'tasks', rows);
end
$$;

revoke all on function public.os_island_tasks(timestamptz) from public, authenticated;
grant execute on function public.os_island_tasks(timestamptz) to anon;

-- ---------------------------------------------------------------------------
-- 6. Create.
-- ---------------------------------------------------------------------------
-- urgent only when the island sends it, and the island sends it only for an
-- explicit `add !`. An urgent task enters the web's scored set the moment it
-- exists, so it must never be a default.
create or replace function public.os_island_task_create(
  p_title    text,
  p_priority text default 'normal',
  p_due      date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t   text;
  p   jsonb;
  r   jsonb;
begin
  perform private.os_island_token_check('write');
  t := btrim(coalesce(p_title, ''));
  if t = '' or length(t) > 500 then
    raise exception 'title must be 1..500 chars' using errcode = 'PT422';
  end if;
  if p_priority is null or p_priority not in ('normal', 'urgent') then
    raise exception 'priority must be normal or urgent' using errcode = 'PT422';
  end if;
  p := jsonb_build_object('title', t, 'priority', p_priority, 'done', false);
  if p_due is not null then
    p := p || jsonb_build_object('dueDate', to_char(p_due, 'YYYY-MM-DD'));
  end if;
  insert into public.os_entries (type, domain, tags, entry_date, payload)
  values ('task', 'work', '{}', p_due, p)
  returning private.os_island_task_row(os_entries.*) into r;
  return r;
end
$$;

revoke all on function public.os_island_task_create(text, text, date) from public, authenticated;
grant execute on function public.os_island_task_create(text, text, date) to anon;

-- ---------------------------------------------------------------------------
-- 7. Patch. The allowlist is the security boundary, the row filter is the
--    domain boundary, the updated_at compare is the conflict boundary (web
--    wins; the island refetches).
-- ---------------------------------------------------------------------------
create or replace function public.os_island_task_patch(
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
  due  date;
  k    text;
  r    jsonb;
begin
  perform private.os_island_token_check('write');

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'empty patch' using errcode = 'PT422';
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('title', 'done', 'dueDate') then
      raise exception 'key not allowed: %', k using errcode = 'PT422';
    end if;
  end loop;

  select * into cur
    from public.os_entries
   where id = p_id and domain = 'work' and type = 'task'
   for update;
  if not found then
    raise exception 'task not found' using errcode = 'PT404';
  end if;
  if p_expected_updated_at is null or cur.updated_at <> p_expected_updated_at then
    raise exception 'task changed' using errcode = 'PT409';
  end if;

  newp := cur.payload;
  due := cur.entry_date;

  if p_patch ? 'title' then
    if jsonb_typeof(p_patch -> 'title') <> 'string'
       or btrim(p_patch ->> 'title') = ''
       or length(btrim(p_patch ->> 'title')) > 500 then
      raise exception 'title must be 1..500 chars' using errcode = 'PT422';
    end if;
    newp := newp || jsonb_build_object('title', btrim(p_patch ->> 'title'));
  end if;

  if p_patch ? 'dueDate' then
    if jsonb_typeof(p_patch -> 'dueDate') = 'null' then
      -- Absent key, as the SPA writes it, and entry_date follows.
      newp := newp - 'dueDate';
      due := null;
    elsif jsonb_typeof(p_patch -> 'dueDate') = 'string' then
      begin
        due := (p_patch ->> 'dueDate')::date;
      exception when others then
        raise exception 'dueDate must be YYYY-MM-DD' using errcode = 'PT422';
      end;
      newp := newp || jsonb_build_object('dueDate', to_char(due, 'YYYY-MM-DD'));
    else
      raise exception 'dueDate must be a date string or null' using errcode = 'PT422';
    end if;
  end if;

  if p_patch ? 'done' then
    if jsonb_typeof(p_patch -> 'done') <> 'boolean' then
      raise exception 'done must be boolean' using errcode = 'PT422';
    end if;
    if (p_patch ->> 'done')::boolean then
      -- Date.toISOString() format, so the SPA's completedAt.startsWith(day)
      -- reads it exactly like its own.
      newp := newp || jsonb_build_object(
        'done', true,
        'completedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    else
      newp := (newp - 'completedAt') || jsonb_build_object('done', false);
    end if;
  end if;

  -- updated_at is stamped by the os_entries_updated_at trigger.
  update public.os_entries
     set payload = newp, entry_date = due
   where id = p_id
  returning private.os_island_task_row(os_entries.*) into r;
  return r;
end
$$;

revoke all on function public.os_island_task_patch(uuid, timestamptz, jsonb) from public, authenticated;
grant execute on function public.os_island_task_patch(uuid, timestamptz, jsonb) to anon;
