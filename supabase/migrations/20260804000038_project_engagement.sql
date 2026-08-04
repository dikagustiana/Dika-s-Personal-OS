-- ===========================================================================
-- ENGAGEMENT ON PROJECTS: THE CLIENT DISCRIMINATOR, LANDING BEFORE ANY INVITE.
-- ===========================================================================
-- Phase 0 found no Gunung Jati data anywhere — and no column that would keep
-- it apart when it arrives. A member policy of bare `domain = 'work'` would
-- expose every future WORK row automatically, including the first Gunung Jati
-- project, plus the owner's meta projects. This column is the boundary, and it
-- lands while nothing is mixed yet, which is the only cheap moment to add it.
--
-- NO DEFAULT, EVER. A default set to a visible value is how a future Gunung
-- Jati project becomes collaborator-visible by forgetting. NOT NULL with no
-- default makes the omission impossible instead of unlikely: every future
-- INSERT must say which engagement it belongs to, and TypeScript requires the
-- field at compile time.
--
-- Three steps because 40 rows already exist: add nullable → backfill →
-- constrain. The backfill is written as generic rules (not a list of 40 ids)
-- so a fresh-database replay of the full migration chain — where the earlier
-- seed migrations insert rows without the column — classifies them the same
-- way and still reaches NOT NULL.
--
-- Classification (verified live before applying; landed exactly 21/19/0):
--   growth                                        → 'internal' (16 rows)
--   work: Decks / Claude skill ecosystem / Meta / PMO → 'internal' (3 rows)
--   work: everything else, incl. Consolidation & group modeling → 'samb' (21)
-- 'Consolidation & group modeling' is deliberately collaborator-visible.
--
-- Idempotent throughout. Down-migration:
-- supabase/migrations/down/20260804000038_project_engagement_down.sql

alter table public.os_projects
  add column if not exists engagement text;

-- Backfill only rows that predate the column; anything inserted after it is
-- NOT NULL-constrained and never passes through here.
update public.os_projects
   set engagement = 'internal'
 where engagement is null
   and (domain = 'growth'
        or title in ('Decks', 'Claude skill ecosystem', 'Meta / PMO'));

update public.os_projects
   set engagement = 'samb'
 where engagement is null
   and domain = 'work';

alter table public.os_projects
  alter column engagement set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'os_projects_engagement_chk'
      and conrelid = 'public.os_projects'::regclass
  ) then
    alter table public.os_projects
      add constraint os_projects_engagement_chk
      check (engagement in ('samb', 'gunungjati', 'internal'));
  end if;
end
$$;

comment on column public.os_projects.engagement is
  'Client scope. samb = the SAMB group engagement (collaborator-readable under the member policy); gunungjati = the other client, invisible to SAMB collaborators; internal = the owner''s own projects and everything GROWTH. NOT NULL with no default: every insert must decide, nothing becomes visible by omission.';

-- The member policy filters on (domain, engagement); partial index keeps that
-- read from scanning GROWTH rows it can never return.
create index if not exists os_projects_engagement_idx
  on public.os_projects (engagement)
  where domain = 'work';
