-- Finish line: the target for the group financial pack, what it currently is,
-- and which project closes each gap.
--
-- THE UNIT IS THE GAP ITEM, NOT THE PROJECT. The 21 WORK projects are
-- tributaries into one consolidated deliverable; one gap can block several
-- parts of that pack and one project can close several gaps. A per-project
-- table cannot express either direction, which is why there are two tables
-- here and why the second one is a genuine many-to-many. Do NOT collapse it to
-- a single project_id column on the item — that would silently drop the
-- one-gap-many-projects case and flatten the thing the view exists to show.
--
-- MIGRATION NUMBER 20260726000020 WAS ASSIGNED, NOT COMPUTED. A parallel
-- session holds …019. Picking "the next free slot" off `main` would have made
-- both sessions choose the same prefix.
--
-- NOT YET APPLIED AS OF THIS COMMIT, and that is a statement of fact rather
-- than an intention. The session that wrote this had no Supabase MCP tool and
-- no database credentials attached, so it could not run the statements. Every
-- earlier migration here records the opposite (`APPLIED 2026-07-26 via the
-- Supabase apply_migration tool`); this one deliberately does not, because
-- writing that line without having run anything is how a frontend ships
-- against a schema that does not exist — which has already happened twice in
-- this project.
--
-- TO APPLY: run the statements below verbatim through the Supabase
-- apply_migration tool (or the SQL editor), recorded in the ledger as
-- `finish_line_target`, then replace this paragraph with the APPLIED line the
-- other migrations carry. Check the DATABASE, not this comment.
--
-- Until then WORK → Finish line renders an explicit "could not be read" row
-- with a Retry, NOT an empty list — an empty list would read as "no gaps",
-- which is the one wrong thing this view can say.
--
-- NEVER apply with `supabase db push`, `migration up`, `db reset`, or
-- `db remote commit`. This repo's filenames and the live ledger's versions are
-- different numbering schemes, so any of those replays the entire history from
-- 0001_schema.sql against live production data.
--
-- Idempotent throughout: create table if not exists, create index if not
-- exists, and each policy is created only when absent. Safe to re-run.
--
-- NOTHING IS SEEDED HERE, DELIBERATELY. The repo is public and the real gap
-- items name entities, internal drivers and open methodology decisions. They
-- are entered through the UI or loaded by a session with database access.

create table if not exists public.os_finish_line_items (
  id uuid primary key default gen_random_uuid(),
  -- FREE TEXT, NOT AN ENUM, on purpose. The target keeps growing — new
  -- business blocks, new schedules, new ratios — and an enum would need a
  -- migration every time the pack gains a section. That friction is exactly
  -- what stops a list like this being maintained.
  area text not null,
  item text not null,
  -- What must be true for this part of the pack to be trustworthy.
  target_state text not null,
  -- What it actually is today. Null while nobody has written it down.
  current_state text,
  -- THE FIELD THAT DOES THE MOST WORK AND IS EASIEST TO LEAVE OUT.
  -- The proxy standing in while the real input is unavailable. "We have no
  -- number" and "we have a number resting on a driver known to be wrong" are
  -- different situations: the second one gets quoted back in a board meeting.
  -- Anything downstream of a non-null interim is provisional, and the view
  -- says so rather than rendering it like a settled value.
  interim text,
  -- The downstream consequence: what else stops being trustworthy while this
  -- is open. This is what makes ordering possible — an item holding up five
  -- parts of the pack outranks one holding up a footnote.
  blocks text,
  status text not null default 'blocked'
    check (status in ('blocked', 'in-progress', 'trusted')),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The many-to-many. One driver decision can unblock three business blocks;
-- one project can close several gaps.
--
-- Both sides cascade, and the asymmetry matters: deleting a PROJECT removes
-- its links and leaves the gap item standing, now unowned — which is the row
-- the view ranks first, because something known to be broken that nobody owns
-- is worse than something broken with an owner. Deleting the ITEM takes its
-- links with it, since the links mean nothing without it.
create table if not exists public.os_finish_line_item_projects (
  item_id uuid not null references public.os_finish_line_items(id) on delete cascade,
  project_id uuid not null references public.os_projects(id) on delete cascade,
  primary key (item_id, project_id)
);

create index if not exists os_finish_line_items_area_idx
  on public.os_finish_line_items (area, sort_order);

-- The primary key already covers (item_id, project_id); this covers the other
-- direction — "which gaps does this project close".
create index if not exists os_finish_line_item_projects_project_idx
  on public.os_finish_line_item_projects (project_id);

comment on table public.os_finish_line_items is
  'Gap items against the target for the group financial pack. A hand-maintained REPRESENTATION of a target that lives in a workbook outside this app: when the pack gains a section or a gap closes in Excel, this table does not know. Acceptable because the items are structural and slow-moving, several of them open for months. There is deliberately no importer and no sync.';

comment on column public.os_finish_line_items.area is
  'Free text, not an enum. The target keeps growing; an enum would need a migration per new section and the list would stop being maintained.';

comment on column public.os_finish_line_items.interim is
  'The proxy standing in while the real input is unavailable. Non-null means everything downstream is provisional — a figure resting on a known-wrong driver is not a smaller version of a correct figure, it is a different kind of thing.';

comment on column public.os_finish_line_items.blocks is
  'What else stops being trustworthy while this is open. Ordering is derived from this plus status and links — there is deliberately no stored priority or rank column.';

comment on table public.os_finish_line_item_projects is
  'MANY-TO-MANY ON PURPOSE. One gap can need several projects; one project can close several gaps. Never collapse this to a single project_id on the item.';

-- updated_at maintenance, same backstop the core tables carry (see
-- 20260724000001_schema.sql). Guarded rather than `create or replace trigger`
-- so the migration re-runs on any Postgres version.
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'os_finish_line_items_updated_at'
      and tgrelid = 'public.os_finish_line_items'::regclass
  ) then
    create trigger os_finish_line_items_updated_at
      before update on public.os_finish_line_items
      for each row execute function public.os_set_updated_at();
  end if;
end
$$;

alter table public.os_finish_line_items enable row level security;
alter table public.os_finish_line_item_projects enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'os_finish_line_items'
      and policyname = 'require app key'
  ) then
    create policy "require app key" on public.os_finish_line_items
      for all to anon, authenticated
      using (public.os_key_valid())
      with check (public.os_key_valid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'os_finish_line_item_projects'
      and policyname = 'require app key'
  ) then
    create policy "require app key" on public.os_finish_line_item_projects
      for all to anon, authenticated
      using (public.os_key_valid())
      with check (public.os_key_valid());
  end if;
end
$$;
