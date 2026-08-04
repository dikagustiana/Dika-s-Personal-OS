-- ===========================================================================
-- CELL ATTRIBUTION, HISTORY, AND THE WRITE GUARD — THE SQL HALF OF THE SPLIT.
-- ===========================================================================
-- Once a contributor can write `figure`, that state stops carrying one
-- meaning. Two things restore it: the cell row says WHO last touched it
-- (actor_kind on the row, not only in history, so "have I touched this since
-- they submitted it" is one column rather than a history query), and an
-- append-only history carries every state/note change with an actor and a
-- timestamp. A matrix where anyone can write done with no trail is a set of
-- self-reports, not a consolidation status.
--
-- THE TRIGGER IS THE BOUNDARY, NOT THE CLIENT. A contributor holds a real JWT
-- and can call PostgREST directly; guardCellTransition in the client is the
-- fast failure, this trigger is the one that counts. Owner branch first, and
-- the owner passes through with NO transition restriction — the passphrase
-- path must work identically before and after this migration.
--
-- Branches:
--   os_key_valid()  → owner. Any state, any direction. Stamped 'owner'.
--   auth.uid()      → contributor. Must hold membership on the row's entity;
--                     may change ONLY state/note (allowlist built as a jsonb
--                     diff, not a list of equality checks, so columns added
--                     later are covered by default); state change must be
--                     exactly input → figure; same-state writes pass so a
--                     note-only edit is always allowed. Stamped with uid.
--   neither         → raise. A direct connection with no credential does not
--                     write cells any more; states move through the app (or
--                     through a header-carrying session), where they are
--                     attributed.
--
-- updated_at moves INTO the trigger (Phase 0 confirmed the client writes it
-- today and nothing else does): a timestamp the client can backdate is not a
-- timestamp.
--
-- Idempotent throughout. Down-migration lives in the repo:
-- supabase/migrations/down/20260804000039_cell_attribution_down.sql

-- 1. Attribution columns, three-step: 245 rows exist -----------------------
alter table public.os_finish_line_cells
  add column if not exists actor_kind text,
  add column if not exists actor uuid references auth.users(id) on delete set null,
  add column if not exists changed_at timestamptz;

update public.os_finish_line_cells
   set actor_kind = 'owner'
 where actor_kind is null;

alter table public.os_finish_line_cells
  alter column actor_kind set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'os_finish_line_cells_actor_kind_chk'
      and conrelid = 'public.os_finish_line_cells'::regclass
  ) then
    alter table public.os_finish_line_cells
      add constraint os_finish_line_cells_actor_kind_chk
      check (actor_kind in ('owner', 'contributor'));
  end if;
end
$$;

-- Covers the new actor → auth.users FK so user deletion never scans cells.
create index if not exists os_finish_line_cells_actor_idx
  on public.os_finish_line_cells (actor)
  where actor is not null;

comment on column public.os_finish_line_cells.actor_kind is
  'Who last touched this cell: owner (passphrase path) or contributor (JWT). Written by the write-guard trigger, never by a client. Any owner write resets it to owner.';
comment on column public.os_finish_line_cells.actor is
  'auth.users id of the contributor who last touched the cell; null for the owner, whose path carries no uid. Trigger-written.';
comment on column public.os_finish_line_cells.changed_at is
  'When the last touch happened. Trigger-written; the client cannot backdate it.';

-- 2. History: append-only, trigger-written, no FK to cells -----------------
-- History must outlive the row it describes, so cell_id is a bare uuid.
-- actor likewise carries no FK: the uuid stays as a tombstone after a user
-- is deleted, which is exactly what an audit row should do.
create table if not exists public.os_finish_line_cell_history (
  id           uuid primary key default gen_random_uuid(),
  cell_id      uuid not null,
  from_state   text,
  to_state     text,
  note_changed boolean not null default false,
  actor_kind   text not null,
  actor        uuid,
  changed_at   timestamptz not null default now()
);

create index if not exists os_finish_line_cell_history_cell_idx
  on public.os_finish_line_cell_history (cell_id, changed_at desc);

comment on table public.os_finish_line_cell_history is
  'Append-only trail of every cell state/note change: who, when, from, to. Written exclusively by the write-guard trigger. No UPDATE or DELETE policy exists for anyone, including the owner — an editable audit trail is not an audit trail.';

alter table public.os_finish_line_cell_history enable row level security;

-- SELECT for the owner only, v1. No INSERT policy for any client role: the
-- trigger function is SECURITY DEFINER and writes past RLS; a client insert
-- finds no policy and is rejected. No UPDATE, no DELETE, for anyone.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_finish_line_cell_history'
                 and policyname = 'owner reads history') then
    create policy "owner reads history" on public.os_finish_line_cell_history
      for select using ((select public.os_key_valid()));
  end if;
end
$$;

-- 3. The write guard -------------------------------------------------------
create or replace function public.os_finish_line_cells_write_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_entities text[];
  offending text[];
begin
  if public.os_key_valid() then
    -- Owner branch: no transition restriction whatsoever. Stamped, logged,
    -- through.
    new.actor_kind := 'owner';
    new.actor := null;
  else
    if auth.uid() is null then
      raise exception 'finish line cells: writes require the owner key or an authenticated contributor';
    end if;

    member_entities := public.os_member_entities();
    if not (old.entity_code = any (member_entities)) then
      raise exception 'finish line cells: % is not one of your entities', old.entity_code;
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
      and d.key not in ('state', 'note', 'updated_at', 'actor', 'actor_kind', 'changed_at');
    -- (actor/actor_kind/changed_at/updated_at are allowlisted only because the
    -- trigger overwrites them below — a client-supplied value never survives.)
    if offending is not null then
      raise exception 'finish line cells: contributors may only change state and note (blocked: %)',
        array_to_string(offending, ', ');
    end if;

    -- The one transition. Same-state passes, so a note-only edit always works.
    if new.state is distinct from old.state
       and not (old.state = 'input' and new.state = 'figure') then
      raise exception 'finish line cells: a contributor may only move a cell forward from input to figure (attempted % -> %)',
        old.state, new.state;
    end if;

    new.actor_kind := 'contributor';
    new.actor := (select auth.uid());
  end if;

  new.changed_at := now();
  new.updated_at := now();

  if new.state is distinct from old.state or new.note is distinct from old.note then
    insert into public.os_finish_line_cell_history
      (cell_id, from_state, to_state, note_changed, actor_kind, actor, changed_at)
    values
      (new.id, old.state, new.state,
       new.note is distinct from old.note,
       new.actor_kind, new.actor, new.changed_at);
  end if;

  return new;
end;
$$;

revoke all on function public.os_finish_line_cells_write_guard() from public;

drop trigger if exists os_finish_line_cells_write_guard on public.os_finish_line_cells;
create trigger os_finish_line_cells_write_guard
  before update on public.os_finish_line_cells
  for each row execute function public.os_finish_line_cells_write_guard();
