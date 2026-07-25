-- Project hierarchy, soft links, entity tags, and document lists.
--
-- Four columns on os_projects, plus four new optional keys inside the
-- existing milestones jsonb (pic, startDate, endDate, documents) which need
-- no DDL — the Milestone shape has always lived in jsonb.
--
-- NOTHING IS BACKFILLED. Every existing row keeps parent_id NULL, entity_tag
-- NULL, and empty arrays for linked_projects/documents; every existing
-- milestone keeps exactly the keys it already has. Guessing a parent, an
-- entity, a PIC or a date is precisely what this migration must not do — the
-- owner assigns them from the UI this migration exists to enable.
--
-- parent_id       one level of true hierarchy. A project may never be its own
--                 parent (check constraint). ON DELETE SET NULL: deleting a
--                 parent promotes its children back to the top level rather
--                 than blocking the delete or cascading it into data loss.
-- linked_projects { projectId: string, note?: string }[] — SOFT pointers.
--                 Informational only; nothing in the app reads these to gate
--                 a status change, and nothing ever should (see §4.1 of the
--                 brief: this is not a project-management tool).
-- entity_tag      free text, deliberately not an enum — used for filtering
--                 and grouping in the Projects list.
-- documents       { label, url, addedAt }[] — project-level reference links.
--                 Links only: no binary is ever stored by this app, and the
--                 "upload" affordance in the UI takes a label and a URL.
--
-- Idempotent throughout: re-running against a database that already has this
-- migration is a no-op (add column if not exists, guarded constraint adds,
-- create index if not exists). No RLS change — os_projects already carries
-- the "require app key" policy, which covers every column of the table.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.os_projects
  add column if not exists parent_id uuid;

alter table public.os_projects
  add column if not exists linked_projects jsonb not null default '[]'::jsonb;

alter table public.os_projects
  add column if not exists entity_tag text;

alter table public.os_projects
  add column if not exists documents jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- Constraints. Added through pg_constraint guards because `alter table ... add
-- constraint` has no IF NOT EXISTS form, and this file has to survive a
-- second run untouched.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'os_projects_parent_id_fkey'
      and conrelid = 'public.os_projects'::regclass
  ) then
    alter table public.os_projects
      add constraint os_projects_parent_id_fkey
      foreign key (parent_id) references public.os_projects (id)
      on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'os_projects_parent_id_not_self'
      and conrelid = 'public.os_projects'::regclass
  ) then
    alter table public.os_projects
      add constraint os_projects_parent_id_not_self
      check (parent_id is null or parent_id <> id);
  end if;

  -- Both jsonb columns are arrays by contract; a bare object or scalar would
  -- crash every reader. The default already satisfies this, so no existing
  -- row can fail the constraint.
  if not exists (
    select 1
    from pg_constraint
    where conname = 'os_projects_linked_projects_is_array'
      and conrelid = 'public.os_projects'::regclass
  ) then
    alter table public.os_projects
      add constraint os_projects_linked_projects_is_array
      check (jsonb_typeof(linked_projects) = 'array');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'os_projects_documents_is_array'
      and conrelid = 'public.os_projects'::regclass
  ) then
    alter table public.os_projects
      add constraint os_projects_documents_is_array
      check (jsonb_typeof(documents) = 'array');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Indexes. The child lookup runs on every Projects render; entity_tag drives
-- the list filter.
-- ---------------------------------------------------------------------------
create index if not exists os_projects_parent_id_idx
  on public.os_projects (parent_id)
  where parent_id is not null;

create index if not exists os_projects_entity_tag_idx
  on public.os_projects (entity_tag)
  where entity_tag is not null;

-- ---------------------------------------------------------------------------
-- Post-apply verification. Not run by the migration — paste it into the SQL
-- editor afterwards. Every count must equal the total project count, and
-- `drifted` must be 0; anything else means a row was touched, which this
-- migration must never do.
--
--   select
--     count(*)                                            as projects,
--     count(*) filter (where parent_id is null)           as parent_null,
--     count(*) filter (where entity_tag is null)          as entity_tag_null,
--     count(*) filter (where linked_projects = '[]'::jsonb) as links_empty,
--     count(*) filter (where documents = '[]'::jsonb)     as documents_empty,
--     count(*) filter (
--       where parent_id is not null
--          or entity_tag is not null
--          or linked_projects <> '[]'::jsonb
--          or documents <> '[]'::jsonb
--     )                                                   as drifted
--   from public.os_projects;
--
-- And that no milestone gained a key it did not have before:
--
--   select count(*) as milestones_with_new_keys
--   from public.os_projects p,
--        jsonb_array_elements(p.milestones) as m(milestone)
--   where milestone ?| array['pic', 'startDate', 'endDate', 'documents'];
-- ---------------------------------------------------------------------------
