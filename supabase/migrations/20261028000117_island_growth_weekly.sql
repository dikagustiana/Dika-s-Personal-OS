-- ===========================================================================
-- WEEKLY ITEMS, AND THE ISLAND'S DOORS INTO GROWTH. (more-me v2 F5, D-34)
-- ===========================================================================
--
-- The owner's island gets a Work | Growth switch on its Tasks tab and weekly
-- items: date-ranged work ("Tie-out GL KGR, 28 Oct – 31 Oct") that daily
-- to-dos hang under. Decision 2026-10-27 (owner): a NEW table, not the
-- existing os_weekly_plans goals — those are pinned to one ISO week
-- (Monday–Sunday) and cannot span weeks; the island's week is Sunday–Saturday.
-- os_weekly_plans and its goals stay exactly as they are; the web keeps using
-- them.
--
-- WHAT CHANGES FOR THE ISLAND TOKEN (supersedes D-28's "WORK only"): the
-- token's reach becomes tasks, weekly items and time blocks of EITHER domain,
-- each RPC taking the domain explicitly. Still never: os_daily_logs (the
-- score), os_projects writes, habits, braindumps, deletes, the Finish line,
-- the Lab, members. The GROWTH guard (20260804000047) is untouched: it is
-- about MEMBERS, and the island token is the owner's own second client.
--
-- THE EXISTING DOORS ARE NOT TOUCHED. os_island_tasks / _task_create /
-- _task_patch / _blocks / _block_create / _block_patch keep their WORK-only
-- bodies and signatures, so the island already deployed keeps working byte
-- for byte. The new doors carry the suffix _in and a p_domain argument.
--
-- PARENT, NOT DEPENDENCY: a task's payload.weeklyItemId names its weekly item.
-- That is a hierarchy (the item's progress = done to-dos / all), never a
-- "blocked by" edge; ticking every to-do never closes the item, `done` does.
-- The web keeps unknown payload keys (rowToEntry spreads the payload), so a
-- task edited on the web keeps its link.
--
-- Down-migration: supabase/migrations/down/20261028000117_island_growth_weekly_down.sql
-- Standing check: supabase/tests/island_growth_weekly.sql (one DO block, always
-- raises, rolls back; safe against production by construction).

-- ---------------------------------------------------------------------------
-- 1. Weekly items. Owner-only, the same four policies as os_weekly_plans
--    (app key writes; app key or read key reads). No member policy: members
--    never see weekly items of either domain.
-- ---------------------------------------------------------------------------
create table if not exists public.os_weekly_items (
  id           uuid primary key default gen_random_uuid(),
  domain       text not null check (domain in ('work', 'growth')),
  title        text not null check (length(btrim(title)) between 1 and 300),
  start_date   date not null,
  end_date     date not null,
  project_id   uuid references public.os_projects (id) on delete set null,
  area         text check (area is null or length(btrim(area)) between 1 and 60),
  status       text not null default 'open' check (status in ('open', 'done', 'carried')),
  carried_from uuid references public.os_weekly_items (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint os_weekly_items_range check (end_date >= start_date and end_date - start_date <= 92)
);

create index if not exists os_weekly_items_domain_end_idx on public.os_weekly_items (domain, end_date);

drop trigger if exists os_weekly_items_updated_at on public.os_weekly_items;
create trigger os_weekly_items_updated_at
  before update on public.os_weekly_items
  for each row execute function public.os_set_updated_at();

-- A weekly item's project, when it has one, is a project of the same domain.
create or replace function private.os_weekly_item_project_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.project_id is not null and not exists (
       select 1 from public.os_projects p where p.id = new.project_id and p.domain = new.domain) then
    raise exception 'project must be of the same domain' using errcode = '23514';
  end if;
  return new;
end
$$;

revoke all on function private.os_weekly_item_project_check() from public, anon, authenticated;

drop trigger if exists os_weekly_items_project_check on public.os_weekly_items;
create trigger os_weekly_items_project_check
  before insert or update of project_id, domain on public.os_weekly_items
  for each row execute function private.os_weekly_item_project_check();

alter table public.os_weekly_items enable row level security;

drop policy if exists "require app key to select" on public.os_weekly_items;
create policy "require app key to select" on public.os_weekly_items
  for select using ((select public.os_key_valid()) or (select public.os_read_key_valid()));
drop policy if exists "require app key to insert" on public.os_weekly_items;
create policy "require app key to insert" on public.os_weekly_items
  for insert with check ((select public.os_key_valid()));
drop policy if exists "require app key to update" on public.os_weekly_items;
create policy "require app key to update" on public.os_weekly_items
  for update using ((select public.os_key_valid())) with check ((select public.os_key_valid()));
drop policy if exists "require app key to delete" on public.os_weekly_items;
create policy "require app key to delete" on public.os_weekly_items
  for delete using ((select public.os_key_valid()));

-- ---------------------------------------------------------------------------
-- 2. Shared helpers.
-- ---------------------------------------------------------------------------
create or replace function private.os_island_domain(p_domain text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_domain is null or p_domain not in ('work', 'growth') then
    raise exception 'domain must be work or growth' using errcode = 'PT422';
  end if;
  return p_domain;
end
$$;

revoke all on function private.os_island_domain(text) from public, anon, authenticated;

-- The task row of the _in doors: the WORK row plus its domain and weekly item.
create or replace function private.os_island_task_row_in(e public.os_entries)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select private.os_island_task_row(e) || jsonb_build_object(
    'domain',         e.domain,
    'weekly_item_id', coalesce(to_jsonb(nullif(e.payload ->> 'weeklyItemId', '')), 'null'::jsonb)
  )
$$;

revoke all on function private.os_island_task_row_in(public.os_entries) from public, anon, authenticated;

-- A weekly item for the island: its fields, and its progress over the to-dos
-- that name it (any day, done or not).
create or replace function private.os_island_weekly_row(w public.os_weekly_items)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id',           w.id,
    'domain',       w.domain,
    'title',        w.title,
    'start_date',   to_char(w.start_date, 'YYYY-MM-DD'),
    'end_date',     to_char(w.end_date, 'YYYY-MM-DD'),
    'project_id',   coalesce(to_jsonb(w.project_id), 'null'::jsonb),
    'project',      coalesce((select to_jsonb(p.title) from public.os_projects p where p.id = w.project_id), 'null'::jsonb),
    'area',         coalesce(to_jsonb(w.area), 'null'::jsonb),
    'status',       w.status,
    'carried_from', coalesce(to_jsonb(w.carried_from), 'null'::jsonb),
    'todos',        (select count(*) from public.os_entries e
                      where e.type = 'task' and e.domain = w.domain and e.payload ->> 'weeklyItemId' = w.id::text),
    'todos_done',   (select count(*) from public.os_entries e
                      where e.type = 'task' and e.domain = w.domain and e.payload ->> 'weeklyItemId' = w.id::text
                        and e.payload -> 'done' = 'true'::jsonb),
    'updated_at',   w.updated_at
  )
$$;

revoke all on function private.os_island_weekly_row(public.os_weekly_items) from public, anon, authenticated;

-- A weekly item id given for a to-do must exist in the same domain.
create or replace function private.os_island_weekly_ref(p_domain text, p_item uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_item is not null and not exists (
       select 1 from public.os_weekly_items w where w.id = p_item and w.domain = p_domain) then
    raise exception 'weekly item not found' using errcode = 'PT404';
  end if;
end
$$;

revoke all on function private.os_island_weekly_ref(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Tasks of either domain.
-- ---------------------------------------------------------------------------
create or replace function public.os_island_tasks_in(p_domain text, p_since timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d    text;
  rows jsonb;
begin
  perform private.os_island_token_check('read');
  d := private.os_island_domain(p_domain);
  select coalesce(jsonb_agg(private.os_island_task_row_in(e) order by e.created_at), '[]'::jsonb)
    into rows
    from public.os_entries e
   where e.domain = d
     and e.type = 'task'
     and (   coalesce(e.payload -> 'done' = 'true'::jsonb, false) = false
          or private.os_island_ts(e.payload ->> 'completedAt') >= p_since);
  return jsonb_build_object('server_time', now(), 'tasks', rows);
end
$$;

revoke all on function public.os_island_tasks_in(text, timestamptz) from public, authenticated;
grant execute on function public.os_island_tasks_in(text, timestamptz) to anon;

create or replace function public.os_island_task_create_in(
  p_domain      text,
  p_title       text,
  p_priority    text default 'normal',
  p_due         date default null,
  p_weekly_item uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d text;
  t text;
  p jsonb;
  r jsonb;
begin
  perform private.os_island_token_check('write');
  d := private.os_island_domain(p_domain);
  t := btrim(coalesce(p_title, ''));
  if t = '' or length(t) > 500 then
    raise exception 'title must be 1..500 chars' using errcode = 'PT422';
  end if;
  if p_priority is null or p_priority not in ('normal', 'urgent') then
    raise exception 'priority must be normal or urgent' using errcode = 'PT422';
  end if;
  perform private.os_island_weekly_ref(d, p_weekly_item);
  p := jsonb_build_object('title', t, 'priority', p_priority, 'done', false);
  if p_due is not null then
    p := p || jsonb_build_object('dueDate', to_char(p_due, 'YYYY-MM-DD'));
  end if;
  if p_weekly_item is not null then
    p := p || jsonb_build_object('weeklyItemId', p_weekly_item::text);
  end if;
  insert into public.os_entries (type, domain, tags, entry_date, payload)
  values ('task', d, '{}', p_due, p)
  returning private.os_island_task_row_in(os_entries.*) into r;
  return r;
end
$$;

revoke all on function public.os_island_task_create_in(text, text, text, date, uuid) from public, authenticated;
grant execute on function public.os_island_task_create_in(text, text, text, date, uuid) to anon;

-- The WORK patch's allowlist (title, done, dueDate) plus weeklyItemId; the
-- row filter is the given domain.
create or replace function public.os_island_task_patch_in(
  p_domain              text,
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
  d    text;
  cur  public.os_entries%rowtype;
  newp jsonb;
  due  date;
  item uuid;
  k    text;
  r    jsonb;
begin
  perform private.os_island_token_check('write');
  d := private.os_island_domain(p_domain);

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'empty patch' using errcode = 'PT422';
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('title', 'done', 'dueDate', 'weeklyItemId') then
      raise exception 'key not allowed: %', k using errcode = 'PT422';
    end if;
  end loop;

  select * into cur
    from public.os_entries
   where id = p_id and domain = d and type = 'task'
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

  if p_patch ? 'weeklyItemId' then
    if jsonb_typeof(p_patch -> 'weeklyItemId') = 'null' then
      newp := newp - 'weeklyItemId';
    elsif jsonb_typeof(p_patch -> 'weeklyItemId') = 'string' then
      begin
        item := (p_patch ->> 'weeklyItemId')::uuid;
      exception when others then
        raise exception 'weeklyItemId must be an id or null' using errcode = 'PT422';
      end;
      perform private.os_island_weekly_ref(d, item);
      newp := newp || jsonb_build_object('weeklyItemId', item::text);
    else
      raise exception 'weeklyItemId must be an id or null' using errcode = 'PT422';
    end if;
  end if;

  if p_patch ? 'done' then
    if jsonb_typeof(p_patch -> 'done') <> 'boolean' then
      raise exception 'done must be boolean' using errcode = 'PT422';
    end if;
    if (p_patch ->> 'done')::boolean then
      newp := newp || jsonb_build_object(
        'done', true,
        'completedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    else
      newp := (newp - 'completedAt') || jsonb_build_object('done', false);
    end if;
  end if;

  update public.os_entries
     set payload = newp, entry_date = due
   where id = p_id
  returning private.os_island_task_row_in(os_entries.*) into r;
  return r;
end
$$;

revoke all on function public.os_island_task_patch_in(text, uuid, timestamptz, jsonb) from public, authenticated;
grant execute on function public.os_island_task_patch_in(text, uuid, timestamptz, jsonb) to anon;

-- ---------------------------------------------------------------------------
-- 4. Weekly items: read (those overlapping a range), create, patch, carry.
-- ---------------------------------------------------------------------------
create or replace function public.os_island_weekly_items(p_domain text, p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d    text;
  rows jsonb;
begin
  perform private.os_island_token_check('read');
  d := private.os_island_domain(p_domain);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'a range of at most 400 days' using errcode = 'PT422';
  end if;
  select coalesce(jsonb_agg(private.os_island_weekly_row(w) order by w.start_date, w.created_at), '[]'::jsonb)
    into rows
    from public.os_weekly_items w
   where w.domain = d
     and w.start_date <= p_to
     and w.end_date >= p_from;
  return jsonb_build_object('server_time', now(), 'items', rows);
end
$$;

revoke all on function public.os_island_weekly_items(text, date, date) from public, authenticated;
grant execute on function public.os_island_weekly_items(text, date, date) to anon;

create or replace function public.os_island_weekly_create(
  p_domain  text,
  p_title   text,
  p_start   date,
  p_end     date,
  p_project uuid default null,
  p_area    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d text;
  t text;
  a text;
  r jsonb;
begin
  perform private.os_island_token_check('write');
  d := private.os_island_domain(p_domain);
  t := btrim(coalesce(p_title, ''));
  if t = '' or length(t) > 300 then
    raise exception 'title must be 1..300 chars' using errcode = 'PT422';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 92 then
    raise exception 'dates: start on or before end, at most 93 days' using errcode = 'PT422';
  end if;
  a := nullif(btrim(coalesce(p_area, '')), '');
  if a is not null and length(a) > 60 then
    raise exception 'area must be 1..60 chars' using errcode = 'PT422';
  end if;
  if p_project is not null and not exists (
       select 1 from public.os_projects p where p.id = p_project and p.domain = d) then
    raise exception 'project not found' using errcode = 'PT404';
  end if;
  insert into public.os_weekly_items (domain, title, start_date, end_date, project_id, area)
  values (d, t, p_start, p_end, p_project, a)
  returning private.os_island_weekly_row(os_weekly_items.*) into r;
  return r;
end
$$;

revoke all on function public.os_island_weekly_create(text, text, date, date, uuid, text) from public, authenticated;
grant execute on function public.os_island_weekly_create(text, text, date, date, uuid, text) to anon;

-- title, start/end (together), status ('open' | 'done'), area.
create or replace function public.os_island_weekly_patch(
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
  cur public.os_weekly_items%rowtype;
  k   text;
  s   date;
  e   date;
  r   jsonb;
begin
  perform private.os_island_token_check('write');
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'empty patch' using errcode = 'PT422';
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('title', 'start', 'end', 'status', 'area') then
      raise exception 'key not allowed: %', k using errcode = 'PT422';
    end if;
  end loop;
  if (p_patch ? 'start') <> (p_patch ? 'end') then
    raise exception 'start and end go together' using errcode = 'PT422';
  end if;

  select * into cur from public.os_weekly_items where id = p_id for update;
  if not found then
    raise exception 'weekly item not found' using errcode = 'PT404';
  end if;
  if p_expected_updated_at is null or cur.updated_at <> p_expected_updated_at then
    raise exception 'weekly item changed' using errcode = 'PT409';
  end if;

  if p_patch ? 'title' then
    if jsonb_typeof(p_patch -> 'title') <> 'string' or btrim(p_patch ->> 'title') = '' or length(btrim(p_patch ->> 'title')) > 300 then
      raise exception 'title must be 1..300 chars' using errcode = 'PT422';
    end if;
    cur.title := btrim(p_patch ->> 'title');
  end if;
  if p_patch ? 'start' then
    begin
      s := (p_patch ->> 'start')::date;
      e := (p_patch ->> 'end')::date;
    exception when others then
      raise exception 'start and end are YYYY-MM-DD' using errcode = 'PT422';
    end;
    if s is null or e is null or e < s or e - s > 92 then
      raise exception 'dates: start on or before end, at most 93 days' using errcode = 'PT422';
    end if;
    cur.start_date := s;
    cur.end_date := e;
  end if;
  if p_patch ? 'status' then
    if jsonb_typeof(p_patch -> 'status') <> 'string' or p_patch ->> 'status' not in ('open', 'done') then
      raise exception 'status must be open or done (carry with os_island_weekly_carry)' using errcode = 'PT422';
    end if;
    cur.status := p_patch ->> 'status';
  end if;
  if p_patch ? 'area' then
    if jsonb_typeof(p_patch -> 'area') = 'null' then
      cur.area := null;
    elsif jsonb_typeof(p_patch -> 'area') = 'string' and length(btrim(p_patch ->> 'area')) between 1 and 60 then
      cur.area := btrim(p_patch ->> 'area');
    else
      raise exception 'area must be 1..60 chars or null' using errcode = 'PT422';
    end if;
  end if;

  update public.os_weekly_items
     set title = cur.title, start_date = cur.start_date, end_date = cur.end_date, status = cur.status, area = cur.area
   where id = p_id
  returning private.os_island_weekly_row(os_weekly_items.*) into r;
  return r;
end
$$;

revoke all on function public.os_island_weekly_patch(uuid, timestamptz, jsonb) from public, authenticated;
grant execute on function public.os_island_weekly_patch(uuid, timestamptz, jsonb) to anon;

-- Carry: the item becomes 'carried' and a copy starts the Sunday after its
-- end, as long as it was, still open, naming where it came from. Its open
-- to-dos move to the copy; done ones stay with the original.
create or replace function public.os_island_weekly_carry(p_id uuid, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur   public.os_weekly_items%rowtype;
  s     date;
  nid   uuid;
  r     jsonb;
begin
  perform private.os_island_token_check('write');
  select * into cur from public.os_weekly_items where id = p_id for update;
  if not found then
    raise exception 'weekly item not found' using errcode = 'PT404';
  end if;
  if p_expected_updated_at is null or cur.updated_at <> p_expected_updated_at then
    raise exception 'weekly item changed' using errcode = 'PT409';
  end if;
  if cur.status <> 'open' then
    raise exception 'only an open item carries' using errcode = 'PT422';
  end if;
  -- The Sunday after the end (extract(dow): 0 = Sunday).
  s := cur.end_date + (7 - extract(dow from cur.end_date)::int);
  update public.os_weekly_items set status = 'carried' where id = cur.id;
  insert into public.os_weekly_items (domain, title, start_date, end_date, project_id, area, carried_from)
  values (cur.domain, cur.title, s, s + (cur.end_date - cur.start_date), cur.project_id, cur.area, cur.id)
  returning id into nid;
  update public.os_entries
     set payload = payload || jsonb_build_object('weeklyItemId', nid::text)
   where type = 'task'
     and domain = cur.domain
     and payload ->> 'weeklyItemId' = cur.id::text
     and coalesce(payload -> 'done' = 'true'::jsonb, false) = false;
  select private.os_island_weekly_row(w) into r from public.os_weekly_items w where w.id = nid;
  return r;
end
$$;

revoke all on function public.os_island_weekly_carry(uuid, timestamptz) from public, authenticated;
grant execute on function public.os_island_weekly_carry(uuid, timestamptz) to anon;

-- ---------------------------------------------------------------------------
-- 5. Time blocks of either domain. The island shows one 08:30–23:30 grid,
--    but each domain keeps the web's own window (src/logic/timebox.ts):
--    WORK 08:30–18:30, GROWTH 18:30–23:30, so every island block shows in
--    the web (D-33 held). No block may overlap another of either domain on
--    the same day (one person, one hour).
-- ---------------------------------------------------------------------------
create or replace function private.os_island_block_fit_in(p_domain text, p_day date, p_start text, p_end text, p_except uuid)
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
  if p_domain = 'work' and (p_start < '08:30' or p_end > '18:30') then
    raise exception 'WORK blocks run 08:30–18:30' using errcode = 'PT422';
  end if;
  if p_domain = 'growth' and (p_start < '18:30' or p_end > '23:30') then
    raise exception 'GROWTH blocks run 18:30–23:30' using errcode = 'PT422';
  end if;
  if p_domain is null or p_domain not in ('work', 'growth') or p_start >= p_end then
    raise exception 'a domain, and start before end' using errcode = 'PT422';
  end if;
  select (e.payload ->> 'start') || '–' || (e.payload ->> 'end') || ' ' || coalesce(e.payload ->> 'label', '')
    into clash
    from public.os_entries e
   where e.type = 'timeblock'
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

revoke all on function private.os_island_block_fit_in(text, date, text, text, uuid) from public, anon, authenticated;

create or replace function private.os_island_block_row_in(e public.os_entries)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select private.os_island_block_row(e) || jsonb_build_object(
    'domain',         e.domain,
    'weekly_item_id', coalesce(to_jsonb(nullif(e.payload ->> 'weeklyItemId', '')), 'null'::jsonb)
  )
$$;

revoke all on function private.os_island_block_row_in(public.os_entries) from public, anon, authenticated;

create or replace function public.os_island_blocks_in(p_day date)
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
  select coalesce(jsonb_agg(private.os_island_block_row_in(e) order by e.payload ->> 'start', e.created_at), '[]'::jsonb)
    into rows
    from public.os_entries e
   where e.type = 'timeblock'
     and e.entry_date = p_day
     and e.domain in ('work', 'growth');
  return jsonb_build_object('blocks', rows);
end
$$;

revoke all on function public.os_island_blocks_in(date) from public, authenticated;
grant execute on function public.os_island_blocks_in(date) to anon;

-- A block may name a to-do (taskId, as the web does) or a weekly item
-- (weeklyItemId), of its own domain.
create or replace function public.os_island_block_create_in(
  p_domain   text,
  p_day      date,
  p_start    text,
  p_end      text,
  p_label    text,
  p_ref_kind text default null,
  p_ref_id   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d text;
  l text;
  p jsonb;
  r jsonb;
begin
  perform private.os_island_token_check('write');
  d := private.os_island_domain(p_domain);
  if p_day is null then
    raise exception 'p_day required' using errcode = 'PT422';
  end if;
  l := btrim(coalesce(p_label, ''));
  if l = '' or length(l) > 500 then
    raise exception 'label must be 1..500 chars' using errcode = 'PT422';
  end if;
  perform private.os_island_block_fit_in(d, p_day, p_start, p_end, null);
  p := jsonb_build_object('date', to_char(p_day, 'YYYY-MM-DD'), 'start', p_start, 'end', p_end, 'label', l, 'status', 'planned');
  if (p_ref_kind is null) <> (p_ref_id is null) then
    raise exception 'ref kind and id go together' using errcode = 'PT422';
  end if;
  if p_ref_kind = 'task' then
    if not exists (select 1 from public.os_entries t where t.id = p_ref_id and t.type = 'task' and t.domain = d) then
      raise exception 'task not found' using errcode = 'PT404';
    end if;
    p := p || jsonb_build_object('taskId', p_ref_id::text);
  elsif p_ref_kind = 'weekly' then
    perform private.os_island_weekly_ref(d, p_ref_id);
    p := p || jsonb_build_object('weeklyItemId', p_ref_id::text);
  elsif p_ref_kind is not null then
    raise exception 'ref kind must be task or weekly' using errcode = 'PT422';
  end if;
  insert into public.os_entries (type, domain, tags, entry_date, payload)
  values ('timeblock', d, '{}', p_day, p)
  returning private.os_island_block_row_in(os_entries.*) into r;
  return r;
end
$$;

revoke all on function public.os_island_block_create_in(text, date, text, text, text, text, uuid) from public, authenticated;
grant execute on function public.os_island_block_create_in(text, date, text, text, text, text, uuid) to anon;

-- The WORK block patch for either domain, in that domain's window. Ticking
-- a block that names a to-do ticks the to-do too (same domain), as before.
create or replace function public.os_island_block_patch_in(
  p_domain              text,
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
  d    text;
  cur  public.os_entries%rowtype;
  newp jsonb;
  k    text;
  done boolean;
  r    jsonb;
begin
  perform private.os_island_token_check('write');
  d := private.os_island_domain(p_domain);

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
   where id = p_id and domain = d and type = 'timeblock'
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
    perform private.os_island_block_fit_in(d, cur.entry_date, p_patch ->> 'start', p_patch ->> 'end', cur.id);
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

  update public.os_entries
     set payload = newp
   where id = p_id
  returning private.os_island_block_row_in(os_entries.*) into r;

  if done and nullif(cur.payload ->> 'taskId', '') is not null then
    update public.os_entries
       set payload = payload || jsonb_build_object(
             'done', true,
             'completedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
     where id::text = cur.payload ->> 'taskId'
       and domain = d
       and type = 'task'
       and (payload -> 'done') is distinct from 'true'::jsonb;
  end if;

  return r;
end
$$;

revoke all on function public.os_island_block_patch_in(text, uuid, timestamptz, jsonb) from public, authenticated;
grant execute on function public.os_island_block_patch_in(text, uuid, timestamptz, jsonb) to anon;
