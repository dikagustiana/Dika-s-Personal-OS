-- v3: IELTS practice-result table + project columns for the Gantt and the
-- monthly-close cycles. No changes to the security model — os_ielts_results
-- reuses the exact same x-app-key RLS policy as every other os_ table.
-- Idempotent throughout. (timeblock `category` needs no migration — it lives
-- in os_entries.payload jsonb already.)

-- ---------------------------------------------------------------------------
-- os_projects: startDate (Gantt bar start), recurring + period (monthly close)
-- ---------------------------------------------------------------------------
alter table public.os_projects
  add column if not exists start_date date;
alter table public.os_projects
  add column if not exists recurring text
  check (recurring is null or recurring = 'monthly');
alter table public.os_projects
  add column if not exists period text;

-- ---------------------------------------------------------------------------
-- os_ielts_results: one row per practice mock. Overall band is derived in the
-- app, never stored.
-- ---------------------------------------------------------------------------
create table if not exists public.os_ielts_results (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  listening numeric(2,1) not null,
  reading numeric(2,1) not null,
  writing numeric(2,1) not null,
  speaking numeric(2,1) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists os_ielts_results_updated_at on public.os_ielts_results;
create trigger os_ielts_results_updated_at
  before update on public.os_ielts_results
  for each row execute function public.os_set_updated_at();

alter table public.os_ielts_results enable row level security;

drop policy if exists "require app key" on public.os_ielts_results;
create policy "require app key" on public.os_ielts_results
  for all to anon, authenticated
  using (public.os_key_valid())
  with check (public.os_key_valid());

-- ---------------------------------------------------------------------------
-- Backfill GROWTH initiative dates + rename Chevening / LPDP -> Chevening, and
-- add the LPDP and Uni Applications initiatives. Guarded so re-runs are inert.
-- ---------------------------------------------------------------------------
update public.os_projects
set title = 'Chevening'
where id = '10000000-0000-4000-8000-000000000001' and title = 'Chevening / LPDP';

update public.os_projects
set start_date = current_date - 45
where id = '10000000-0000-4000-8000-000000000001' and start_date is null;

update public.os_projects
set start_date = current_date - 30
where id = '10000000-0000-4000-8000-000000000002' and start_date is null;

insert into public.os_projects
  (id, domain, title, type, status, start_date, deadline, target_metric, sort_order, milestones)
values
  ('10000000-0000-4000-8000-000000000007', 'growth', 'LPDP', 'scholarship', 'active',
   current_date - 20, current_date + 150, 'Submit a complete LPDP application', 6,
   '[
     {"id": "16000000-0000-4000-8000-000000000001", "text": "Study the current LPDP requirements", "done": false, "status": "not-started", "escalateTo": "none"},
     {"id": "16000000-0000-4000-8000-000000000002", "text": "Draft the study plan essay", "done": false, "status": "not-started", "escalateTo": "none"}
   ]'),
  ('10000000-0000-4000-8000-000000000006', 'growth', 'Uni Applications', 'study', 'active',
   current_date - 10, current_date + 120, 'Three complete applications submitted', 7,
   '[
     {"id": "17000000-0000-4000-8000-000000000001", "text": "Shortlist target programmes", "done": false, "status": "not-started", "escalateTo": "none"},
     {"id": "17000000-0000-4000-8000-000000000002", "text": "Request reference letters", "done": false, "status": "not-started", "escalateTo": "none"}
   ]')
on conflict (id) do nothing;
