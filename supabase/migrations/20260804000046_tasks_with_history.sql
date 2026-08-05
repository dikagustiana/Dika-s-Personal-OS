-- ===========================================================================
-- TASKS WITH HISTORY: BORN AUDITED, THE NOTE-HISTORY LESSON APPLIED EARLY.
-- ===========================================================================
-- os_tasks is the first table members INSERT into. Attribution lives on the
-- row (actor_kind/actor, same as cells: any owner write resets actor_kind to
-- 'owner', so "have I touched this since they did" stays one column), and
-- history stores CONTENT, not flags — from_value/to_value per changed field,
-- '' for empty, so null can only ever mean a pre-migration row. Because this
-- table and its history are created together, that null case cannot exist:
-- every field of every task has a complete chain from birth, which is what
-- lets the standing chain check catch ANY out-of-band write, including the
-- first one.
--
-- THE TRIGGER IS THE BOUNDARY, NOT THE CLIENT — same split as cells. RLS says
-- which rows a member may touch (their granted projects); the trigger says
-- what a touch may be, because a policy cannot express column immutability,
-- cross-row checks, or attribution stamping.
--
-- Branches:
--   os_key_valid()  → owner. Unrestricted, including moving a task between
--                     projects — structural acts are the owner's. Stamped
--                     'owner'; supplied attribution values are overwritten.
--   auth.uid()      → member of the task's project (os_member_projects()).
--                     INSERT only into granted projects; UPDATE may change
--                     ONLY {title, detail, status, due_date, assignee,
--                     sort_order} (allowlist built as a jsonb diff of the
--                     whole row, so columns added later are covered by
--                     default); project_id is immutable — moving a task is a
--                     structural act, even between two granted projects; a
--                     CHANGED assignee must be a member of the task's project
--                     (checked only on change, so a later-revoked assignee
--                     never wedges the row; the owner carries no uid, so
--                     "assigned to the owner" is representable only as null).
--                     Stamped with uid.
--   neither         → raise. Same posture as cells: a bare SQL-editor UPDATE
--                     fails loudly; tasks move through the app or a
--                     header-carrying session (README, "Writing Finish Line
--                     cells"), where they are attributed.
--
-- No DELETE path for members exists anywhere in this file: status 'done' or
-- 'cancelled', never removal, so history stays meaningful. ('cancelled' is in
-- the check for exactly this reason — it is the terminal state that replaces
-- deletion.) sort_order changes write no history row: reordering is
-- presentation, not content.
--
-- The share read-only key does NOT read tasks or task history. The key was
-- issued for the surface that existed when it was issued; widening an
-- already-issued credential to new content types silently is a permission
-- grant, not a default (same stance as os_entity_members / os_project_members
-- on membership). Owner SELECT is os_key_valid() only.
--
-- APPLIED 2026-08-05 via the Supabase apply_migration tool (ledger name
-- `tasks_with_history`). NEVER apply with `supabase db push`, `migration up`,
-- `db reset`, or `db remote commit`.
--
-- Idempotent throughout. Down-migration:
-- supabase/migrations/down/20260804000046_tasks_with_history_down.sql
-- (run FIRST when unwinding slice 1: its policies call os_member_projects()).

-- 1. The task table ---------------------------------------------------------
create table if not exists public.os_tasks (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.os_projects(id) on delete cascade,
  title       text not null,
  detail      text not null default '',
  status      text not null default 'open'
              check (status in ('open', 'in_progress', 'blocked', 'done', 'cancelled')),
  due_date    date,
  assignee    uuid references auth.users(id) on delete set null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  created_by_kind text not null check (created_by_kind in ('owner', 'contributor')),
  created_by  uuid,
  actor_kind  text not null check (actor_kind in ('owner', 'contributor')),
  actor       uuid references auth.users(id) on delete set null,
  changed_at  timestamptz
);

-- Policies and the app filter on project_id; the two auth.users FKs get
-- covering partial indexes so user deletion never scans tasks.
create index if not exists os_tasks_project_idx
  on public.os_tasks (project_id);
create index if not exists os_tasks_assignee_idx
  on public.os_tasks (assignee)
  where assignee is not null;
create index if not exists os_tasks_actor_idx
  on public.os_tasks (actor)
  where actor is not null;

comment on table public.os_tasks is
  'Tasks inside a project — the first member-writable, member-creatable table. Every write passes the write-guard trigger, which stamps attribution and appends content history. Members never DELETE: status done or cancelled instead, so history stays meaningful.';
comment on column public.os_tasks.created_by_kind is
  'Who created the task: owner (passphrase path) or contributor (JWT). Trigger-written; a supplied value is overwritten.';
comment on column public.os_tasks.created_by is
  'auth.users id of the creating contributor; null for the owner, whose path carries no uid. No FK: the creator is a historical fact and the uuid stays as a tombstone after user deletion.';
comment on column public.os_tasks.actor_kind is
  'Who last touched this task: owner or contributor. Trigger-written; any owner write resets it to owner.';
comment on column public.os_tasks.actor is
  'auth.users id of the contributor who last touched the task; null for the owner. Trigger-written.';
comment on column public.os_tasks.changed_at is
  'When the last touch happened. Trigger-written; the client cannot backdate it.';

alter table public.os_tasks enable row level security;

-- Owner: the house pattern, os_key_valid() on all four commands. SELECT does
-- NOT accept the share read key (see header). Members: SELECT/INSERT/UPDATE
-- inside granted projects, wrapped as an InitPlan with the uuid[] cast — and
-- deliberately NO delete policy for authenticated.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_tasks'
                 and policyname = 'require app key to select') then
    create policy "require app key to select" on public.os_tasks
      for select using ((select public.os_key_valid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_tasks'
                 and policyname = 'require app key to insert') then
    create policy "require app key to insert" on public.os_tasks
      for insert with check ((select public.os_key_valid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_tasks'
                 and policyname = 'require app key to update') then
    create policy "require app key to update" on public.os_tasks
      for update using ((select public.os_key_valid()))
      with check ((select public.os_key_valid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_tasks'
                 and policyname = 'require app key to delete') then
    create policy "require app key to delete" on public.os_tasks
      for delete using ((select public.os_key_valid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_tasks'
                 and policyname = 'member reads tasks in granted projects') then
    create policy "member reads tasks in granted projects" on public.os_tasks
      for select to authenticated
      using (project_id = any ((select public.os_member_projects())::uuid[]));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_tasks'
                 and policyname = 'member inserts tasks in granted projects') then
    create policy "member inserts tasks in granted projects" on public.os_tasks
      for insert to authenticated
      with check (project_id = any ((select public.os_member_projects())::uuid[]));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_tasks'
                 and policyname = 'member updates tasks in granted projects') then
    create policy "member updates tasks in granted projects" on public.os_tasks
      for update to authenticated
      using (project_id = any ((select public.os_member_projects())::uuid[]))
      with check (project_id = any ((select public.os_member_projects())::uuid[]));
  end if;
end
$$;

-- 2. History: append-only, trigger-written, content on both sides ----------
-- No FK to tasks and no FK on actor: history outlives the row it describes
-- and the user who wrote it — uuids stay as tombstones, which is exactly
-- what an audit row should do. One row per changed field; '' means empty,
-- and because table and history are born together, a null value column can
-- never legitimately exist (tripwire, not a state).
create table if not exists public.os_task_history (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null,
  field       text not null check (field in ('title', 'detail', 'status', 'due_date', 'assignee')),
  from_value  text not null,
  to_value    text not null,
  actor_kind  text not null,
  actor       uuid,
  changed_at  timestamptz not null default now()
);

create index if not exists os_task_history_task_idx
  on public.os_task_history (task_id, changed_at desc);

comment on table public.os_task_history is
  'Append-only trail of every task content change: who, when, field, full value on both sides ('''' = empty). Written exclusively by the write-guard trigger, including birth rows on INSERT so every field''s chain starts at ''''. No UPDATE or DELETE policy exists for anyone, including the owner — an editable audit trail is not an audit trail.';

alter table public.os_task_history enable row level security;

-- SELECT for the owner only in this slice (members get no history access, and
-- the share read key none either). No INSERT policy for any client role: the
-- trigger is SECURITY DEFINER and writes past RLS; a client insert finds no
-- policy and is rejected. No UPDATE, no DELETE, for anyone.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_task_history'
                 and policyname = 'owner reads history') then
    create policy "owner reads history" on public.os_task_history
      for select using ((select public.os_key_valid()));
  end if;
end
$$;

-- 3. The write guard --------------------------------------------------------
create or replace function public.os_tasks_write_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_projects uuid[];
  offending text[];
begin
  if public.os_key_valid() then
    -- Owner branch: unrestricted, including project_id. Stamped, logged,
    -- through.
    new.actor_kind := 'owner';
    new.actor := null;
    if tg_op = 'INSERT' then
      new.created_by_kind := 'owner';
      new.created_by := null;
    end if;
  else
    if auth.uid() is null then
      raise exception 'tasks: writes require the owner key or an authenticated project member';
    end if;

    member_projects := public.os_member_projects();

    if tg_op = 'INSERT' then
      if not (new.project_id = any (member_projects)) then
        raise exception 'tasks: % is not one of your projects', new.project_id;
      end if;
      new.created_by_kind := 'contributor';
      new.created_by := (select auth.uid());
      -- A timestamp the client can backdate is not a timestamp (the
      -- changed_at rule, applied to birth as well).
      new.created_at := now();
    else
      if not (old.project_id = any (member_projects)) then
        raise exception 'tasks: % is not one of your projects', old.project_id;
      end if;

      -- Immutable for members even between two granted projects: moving a
      -- task is a structural act.
      if new.project_id is distinct from old.project_id then
        raise exception 'tasks: a member may not move a task between projects';
      end if;

      -- Column allowlist as a DIFF of the whole row, not a list of equality
      -- checks — a list silently stops covering columns added later.
      select array_agg(d.key order by d.key) into offending
      from (
        select coalesce(o.key, n.key) as key, o.value as ov, n.value as nv
        from jsonb_each(to_jsonb(old)) as o(key, value)
        full join jsonb_each(to_jsonb(new)) as n(key, value) on n.key = o.key
      ) as d
      where d.ov is distinct from d.nv
        and d.key not in ('title', 'detail', 'status', 'due_date', 'assignee',
                          'sort_order', 'actor', 'actor_kind', 'changed_at');
      -- (actor/actor_kind/changed_at are allowlisted only because the trigger
      -- overwrites them below — a client-supplied value never survives.)
      if offending is not null then
        raise exception 'tasks: members may only change task content (blocked: %)',
          array_to_string(offending, ', ');
      end if;
    end if;

    -- A changed assignee must hold membership on this task's project. Only on
    -- change: an assignee revoked later must not wedge unrelated edits.
    if new.assignee is not null
       and (tg_op = 'INSERT' or new.assignee is distinct from old.assignee)
       and not exists (
         select 1 from public.os_project_members m
         where m.user_id = new.assignee
           and m.project_id = new.project_id
       ) then
      raise exception 'tasks: assignee must be a member of the task''s project';
    end if;

    new.actor_kind := 'contributor';
    new.actor := (select auth.uid());
  end if;

  new.changed_at := now();

  if tg_op = 'INSERT' then
    -- Birth rows for all five content fields, from '' — so the chain check
    -- covers every field from the first moment and a live value with no
    -- history behind it is always a finding.
    insert into public.os_task_history
      (task_id, field, from_value, to_value, actor_kind, actor, changed_at)
    values
      (new.id, 'title',    '', new.title,                        new.actor_kind, new.actor, new.changed_at),
      (new.id, 'detail',   '', new.detail,                       new.actor_kind, new.actor, new.changed_at),
      (new.id, 'status',   '', new.status,                       new.actor_kind, new.actor, new.changed_at),
      (new.id, 'due_date', '', coalesce(new.due_date::text, ''), new.actor_kind, new.actor, new.changed_at),
      (new.id, 'assignee', '', coalesce(new.assignee::text, ''), new.actor_kind, new.actor, new.changed_at);
  else
    insert into public.os_task_history
      (task_id, field, from_value, to_value, actor_kind, actor, changed_at)
    select new.id, v.field, v.from_value, v.to_value,
           new.actor_kind, new.actor, new.changed_at
    from (values
      ('title',    old.title,                        new.title),
      ('detail',   old.detail,                       new.detail),
      ('status',   old.status,                       new.status),
      ('due_date', coalesce(old.due_date::text, ''), coalesce(new.due_date::text, '')),
      ('assignee', coalesce(old.assignee::text, ''), coalesce(new.assignee::text, ''))
    ) as v(field, from_value, to_value)
    where v.from_value is distinct from v.to_value;
  end if;

  return new;
end;
$$;

-- A trigger function is invoked by the trigger machinery, which does not
-- check the caller's EXECUTE privilege — no client role needs, or should
-- have, any grant on it (the 20260804000041 lesson, applied at birth this
-- time instead of after the advisor flags it).
revoke all on function public.os_tasks_write_guard() from public;
revoke all on function public.os_tasks_write_guard() from anon;
revoke all on function public.os_tasks_write_guard() from authenticated;

drop trigger if exists os_tasks_write_guard on public.os_tasks;
create trigger os_tasks_write_guard
  before insert or update on public.os_tasks
  for each row execute function public.os_tasks_write_guard();
