-- ===========================================================================
-- REFERENCES: OUTBOUND LINKS TO THE METHODOLOGY WRITING. One table, no edges.
-- ===========================================================================
-- A reading list shown beside the process map, so someone looking at the
-- chain can go read WHY it is shaped that way. The prose itself lives on
-- dikagustiana.com and stays there; this table holds a title, a link, and at
-- most a one-line note.
--
-- ===========================================================================
-- THIS TABLE REFERENCES NOTHING AND IS REFERENCED BY NOTHING.
-- ===========================================================================
-- The os_process_ prefix says WHERE it renders, not what it points at. There
-- is deliberately NO column linking a reference to a step, a need, a gate, a
-- phase or a Finish line row, and deliberately no bridge table. That is the
-- whole design: these are references, not annotations. A per-step tag would
-- turn one reading list into thirty maintenance obligations, and the first
-- time a step was rewritten the tags would rot silently.
--
-- It is also GROUP-LEVEL: no entity_code, and it does not follow the entity
-- picker. The methodology is the same methodology whichever chain is in view.
--
-- url is NOT NULL because this is a list of links: a row with nothing to open
-- has no reason to exist. An article that has not been written yet simply has
-- no row — never a placeholder row with a null url, which would render as an
-- entry that silently does nothing when clicked.
--
-- note is one line. It is not a home for paragraphs; the canonical text is on
-- the site, and a second copy here is a second thing to keep true.
--
-- Rows are added through the Supabase dashboard. There is no editor in the
-- app, by the same rule the process structure follows.
--
-- RLS: the house pattern from os_process_* — four split policies, every
-- predicate subquery-wrapped so os_key_valid() evaluates once per statement.
--
-- NOT APPLIED. This session has no database access. Apply via the Supabase
-- apply_migration tool per the APPLY BEFORE DEPLOY block in the PR that
-- introduced this file. NEVER apply with `supabase db push`, `migration up`,
-- `db reset`, or `db remote commit` — this repo's filenames and the live
-- ledger's versions are different numbering schemes, so any of those replays
-- the entire history from 0001_schema.sql against production data.
--
-- The frontend ships BEFORE this runs and treats the missing relation
-- (42P01 / PGRST205) as "render nothing at all" — not an empty state, not a
-- message. Nobody needs to be told a reading list is empty.
--
-- Idempotent: create if not exists, policies created only when absent, the
-- seed inserts only when the id is absent so an edited row is never
-- overwritten by a re-run.
--
-- Down-migration:
-- supabase/migrations/down/20260806000054_process_references_down.sql

create table if not exists public.os_process_references (
  id         text primary key,
  title      text not null,
  url        text not null,
  note       text,
  sort_order integer not null
);

comment on table public.os_process_references is
  'Outbound links to the methodology writing on dikagustiana.com, shown as a collapsed block on the process tabs. REFERENCES NOTHING: no step, need, gate, phase or Finish line column, and no bridge table — these are references, not annotations. Group-level: no entity_code, does not follow the entity picker. Rows are added through the Supabase dashboard; the app has no editor for them.';
comment on column public.os_process_references.url is
  'Full link including scheme. NOT NULL on purpose: a reference with nothing to open has no reason to exist, and an unwritten article is an absent row rather than a placeholder that does nothing when clicked.';
comment on column public.os_process_references.note is
  'ONE LINE, optional. Not a home for paragraphs — the canonical text lives on the site.';

alter table public.os_process_references enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_process_references'
                 and policyname = 'require app key to select') then
    create policy "require app key to select" on public.os_process_references
      for select using ((select public.os_key_valid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_process_references'
                 and policyname = 'require app key to insert') then
    create policy "require app key to insert" on public.os_process_references
      for insert with check ((select public.os_key_valid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_process_references'
                 and policyname = 'require app key to update') then
    create policy "require app key to update" on public.os_process_references
      for update using ((select public.os_key_valid()))
      with check ((select public.os_key_valid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_process_references'
                 and policyname = 'require app key to delete') then
    create policy "require app key to delete" on public.os_process_references
      for delete using ((select public.os_key_valid()));
  end if;
end
$$;

-- The one row whose link is verified. No guessed URLs, no placeholder rows:
-- an unverified link in a reference list is worse than a shorter list.
insert into public.os_process_references (id, title, url, note, sort_order)
select
  'driver-tree-construction',
  'Driver Tree Construction',
  'https://dikagustiana.com/finance/analytics/driver-tree-construction',
  'Memetakan logika value creation jadi driver terkuantifikasi yang menghubungkan KPI ke line item',
  1
where not exists (
  select 1 from public.os_process_references r where r.id = 'driver-tree-construction'
);
