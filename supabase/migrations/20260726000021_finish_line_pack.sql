-- Finish line, rebuilt: render the pack, not a register.
--
-- The view stops describing the target and starts SHOWING it — the pack
-- rendered as a document, every value `xxx`, every untrusted line expandable.
-- Two structural changes carry that:
--
--  1. HIERARCHY. Every row of the pack becomes a row in os_finish_line_items —
--     blocks, sections, and lines. parent_id gives the nesting, kind says the
--     level. target_state becomes nullable because MOST LINES HAVE NO GAP: a
--     line that is fine is just structure — a label, a position, and
--     status 'trusted'. The gap fields are an annotation on a line of the
--     document, not the record itself.
--
--  2. MILESTONE-LEVEL LINKS. (item_id, project_id) was not precise enough to
--     be useful — one WORK parent holds 50 milestones, and pointing a gap at
--     the project tells the owner almost nothing. The real pairing is
--     gap ↔ milestone. milestone_id is TEXT and carries NO foreign key,
--     because milestones live inside os_projects.milestones as jsonb array
--     elements, not as rows — nothing in the database can enforce that the id
--     still exists. THE APP THEREFORE HANDLES THE ORPHAN EXPLICITLY: a link
--     whose milestone_id is missing from the project's current array renders
--     as a BROKEN LINK — named, visible, resolvable — never silently dropped.
--     Silently dropping it produces a gap that looks unowned when it is not,
--     or one that looks owned after the milestone that would close it was
--     deleted.
--
-- MIGRATION NUMBER 20260726000021 WAS ASSIGNED, NOT COMPUTED — other sessions
-- are running in parallel and "the next free slot" is how two sessions pick
-- the same prefix.
--
-- APPLIED 2026-07-26 via the Supabase apply_migration tool, recorded in the
-- ledger as `finish_line_pack`. The same session first applied the
-- committed-but-unapplied 20260726000020 (ledger `finish_line_target`), which
-- the session that wrote it could not run for lack of database access.
--
-- NEVER apply with `supabase db push`, `migration up`, `db reset`, or
-- `db remote commit`. This repo's filenames and the live ledger's versions are
-- different numbering schemes, so any of those replays the entire history from
-- 0001_schema.sql against live production data.
--
-- NOTHING IS SEEDED HERE. The pack skeleton — block names, section names,
-- line labels — is loaded by the owner's session with database access, from
-- the workbook. The repo is public; the real labels do not enter it.
--
-- Idempotent throughout. Safe to re-run.

-- ---------------------------------------------------------------------------
-- Hierarchy
-- ---------------------------------------------------------------------------

alter table public.os_finish_line_items
  add column if not exists parent_id uuid
    references public.os_finish_line_items(id) on delete cascade;

alter table public.os_finish_line_items
  add column if not exists kind text not null default 'line'
    check (kind in ('block', 'section', 'line'));

-- Most lines have no gap: structure-only rows carry a label, a position and a
-- status. Requiring a target on every row would force boilerplate onto the
-- hundreds of lines that are fine.
alter table public.os_finish_line_items alter column target_state drop not null;

create index if not exists os_finish_line_items_parent_idx
  on public.os_finish_line_items (parent_id, sort_order);

comment on column public.os_finish_line_items.parent_id is
  'Pack nesting: a section belongs to a block, a line to a section (or directly to a block). Cascade — deleting a block takes its sections and lines with it.';

comment on column public.os_finish_line_items.kind is
  'What level of the pack this row is. Blocks and sections are structure; the gap annotation (target/current/interim/blocks/links) belongs on lines.';

-- ---------------------------------------------------------------------------
-- Milestone-level links
-- ---------------------------------------------------------------------------

alter table public.os_finish_line_item_projects
  add column if not exists id uuid default gen_random_uuid();

alter table public.os_finish_line_item_projects
  add column if not exists milestone_id text;

-- Belt and braces: a volatile default rewrites the table and fills existing
-- rows, but an id must never be null before it becomes the primary key.
update public.os_finish_line_item_projects set id = gen_random_uuid() where id is null;
alter table public.os_finish_line_item_projects alter column id set not null;

-- Replace the composite primary key with the surrogate id, so the same
-- (item, project) pair can carry one project-level link (milestone_id null)
-- alongside several milestone-level ones.
do $$
declare
  pk_name text;
  pk_def text;
begin
  select conname, pg_get_constraintdef(oid) into pk_name, pk_def
  from pg_constraint
  where conrelid = 'public.os_finish_line_item_projects'::regclass
    and contype = 'p';

  if pk_name is not null and pk_def like '%item_id%' then
    execute format(
      'alter table public.os_finish_line_item_projects drop constraint %I',
      pk_name
    );
    alter table public.os_finish_line_item_projects
      add constraint os_finish_line_item_projects_pkey primary key (id);
  elsif pk_name is null then
    alter table public.os_finish_line_item_projects
      add constraint os_finish_line_item_projects_pkey primary key (id);
  end if;
end
$$;

-- One milestone cannot be linked twice to the same item, while a project-level
-- link (milestone_id null → '') still coexists with milestone-level ones.
-- A unique INDEX rather than a constraint because the key holds an expression.
create unique index if not exists os_finish_line_item_projects_unique_link
  on public.os_finish_line_item_projects (item_id, project_id, coalesce(milestone_id, ''));

comment on column public.os_finish_line_item_projects.milestone_id is
  'Milestone id inside os_projects.milestones (jsonb array element) — TEXT with no FK because milestones are not rows and nothing here can enforce the id still exists. Null = project-level link. The app renders a dangling id as a BROKEN link, never drops it silently.';
