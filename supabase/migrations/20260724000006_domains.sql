-- Two fully separate workspaces (WORK = day job, GROWTH = self-development).
-- Every user-owned record gains a domain; daily logs and weekly plans become
-- keyed by (date|week, domain) so each workspace carries its own score and
-- plan. No security/RLS changes — the passphrase model is untouched.
--
-- Domain assignment for existing rows: everything defaults to 'work', except
-- the original seeded habits and projects (IELTS / Chevening / research /
-- website — fixed UUIDs), which are GROWTH-flavored and are re-assigned to
-- 'growth'. Idempotent throughout: add column if not exists, updates keyed on
-- fixed IDs, drop+re-add PK pairs, seed inserts on conflict do nothing.

-- ---------------------------------------------------------------------------
-- os_entries
-- ---------------------------------------------------------------------------
alter table public.os_entries
  add column if not exists domain text not null default 'work'
  check (domain in ('work', 'growth'));

create index if not exists os_entries_domain_type_idx
  on public.os_entries (domain, type);

update public.os_entries
set domain = 'growth'
where id in (
  '20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000004',
  '20000000-0000-4000-8000-000000000005'
) and domain <> 'growth';

-- ---------------------------------------------------------------------------
-- os_daily_logs: identity changes from (date) to (date, domain)
-- ---------------------------------------------------------------------------
alter table public.os_daily_logs
  add column if not exists domain text not null default 'work'
  check (domain in ('work', 'growth'));

alter table public.os_daily_logs drop constraint if exists os_daily_logs_pkey;
alter table public.os_daily_logs add primary key (date, domain);

-- ---------------------------------------------------------------------------
-- os_weekly_plans: identity changes from (week) to (week, domain)
-- ---------------------------------------------------------------------------
alter table public.os_weekly_plans
  add column if not exists domain text not null default 'work'
  check (domain in ('work', 'growth'));

alter table public.os_weekly_plans drop constraint if exists os_weekly_plans_pkey;
alter table public.os_weekly_plans add primary key (week, domain);

-- ---------------------------------------------------------------------------
-- os_projects
-- ---------------------------------------------------------------------------
alter table public.os_projects
  add column if not exists domain text not null default 'work'
  check (domain in ('work', 'growth'));

update public.os_projects
set domain = 'growth'
where id in (
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000004'
) and domain <> 'growth';

-- Milestone shape backfill (status from done, escalateTo 'none') — the same
-- statement as migration 20260724000005; repeated here idempotently so this
-- migration alone leaves any database in the v2 shape. coalesce preserves
-- values the app has already written.
update public.os_projects
set milestones = (
  select coalesce(
    jsonb_agg(
      m || jsonb_build_object(
        'status',
        coalesce(
          m ->> 'status',
          case when (m ->> 'done')::boolean then 'done' else 'not-started' end
        ),
        'escalateTo',
        coalesce(m ->> 'escalateTo', 'none')
      )
      order by ord
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(milestones) with ordinality as t(m, ord)
)
where milestones <> '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- WORK seed, so the WORK workspace is not empty on first load (habits and
-- projects have no creation UI). Mirrors src/data/seed.ts fixed UUIDs.
-- ---------------------------------------------------------------------------
insert into public.os_entries (id, type, domain, tags, payload) values
  ('20000000-0000-4000-8000-000000000006', 'habit', 'work', '{work}',
   '{"title": "Zero documents require approval by 15:00", "active": true, "order": 1}')
on conflict (id) do nothing;

insert into public.os_projects (id, domain, title, type, status, target_metric, sort_order, milestones) values
  ('10000000-0000-4000-8000-000000000005', 'work', 'SAMB — Finance Ops', 'other', 'active',
   'Close the month with zero open items', 1,
   '[
     {"id": "15000000-0000-4000-8000-000000000001", "text": "Rebuild the WORK project list here", "done": false, "status": "not-started", "escalateTo": "none"}
   ]')
on conflict (id) do nothing;
