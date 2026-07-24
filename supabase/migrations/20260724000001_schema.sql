-- Personal OS schema. Maps 1:1 to src/data/types.ts — see REVIEW.md for the
-- mapping table. Single-user tool: no user_id columns anywhere by design.

-- ---------------------------------------------------------------------------
-- os_entries — the Entry discriminated union.
-- Shared fields are real columns; type-specific fields live in payload jsonb
-- with domain-shaped camelCase keys (title, priority, done, completedAt,
-- dueDate, weeklyGoalId, projectId, active, order, text, date, start, end,
-- label, taskId, status). entry_date is promoted so listEntries date filters
-- stay indexable: task -> dueDate, timeblock -> date, braindump -> UTC date
-- of createdAt, habit -> null (habits ignore date filters).
-- ---------------------------------------------------------------------------
create table public.os_entries (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('task', 'habit', 'braindump', 'timeblock')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tags text[] not null default '{}',
  entry_date date,
  payload jsonb not null default '{}'::jsonb
);

create index os_entries_type_idx on public.os_entries (type);
create index os_entries_entry_date_idx on public.os_entries (entry_date);

-- ---------------------------------------------------------------------------
-- os_daily_logs — DailyLog. habits is habitId -> boolean.
-- ---------------------------------------------------------------------------
create table public.os_daily_logs (
  date date primary key,
  habits jsonb not null default '{}'::jsonb,
  score int not null default 0,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- os_weekly_plans — WeeklyPlan. week is an ISO week key like '2026-W30'.
-- goals is a WeeklyGoal[] (id, text, done, projectId?).
-- ---------------------------------------------------------------------------
create table public.os_weekly_plans (
  week text primary key check (week ~ '^\d{4}-W\d{2}$'),
  theme text,
  goals jsonb not null default '[]'::jsonb,
  reviewed_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- os_projects — Project. milestones is a Milestone[] (id, text, done,
-- dueDate?). Column is sort_order rather than "order": PostgREST reserves
-- `order` as its sorting query parameter, so a column literally named order
-- cannot be referenced unambiguously in queries.
-- ---------------------------------------------------------------------------
create table public.os_projects (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  type text not null check (type in ('scholarship', 'study', 'research', 'build', 'other')),
  status text not null check (status in ('active', 'paused', 'done')),
  deadline date,
  target_metric text,
  milestones jsonb not null default '[]'::jsonb,
  sort_order int not null default 0,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance. The client also sets updatedAt explicitly (to match
-- the mock repository's semantics); the trigger is a backstop for any write
-- that forgets.
-- ---------------------------------------------------------------------------
create or replace function public.os_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger os_entries_updated_at
  before update on public.os_entries
  for each row execute function public.os_set_updated_at();

create trigger os_daily_logs_updated_at
  before update on public.os_daily_logs
  for each row execute function public.os_set_updated_at();

create trigger os_weekly_plans_updated_at
  before update on public.os_weekly_plans
  for each row execute function public.os_set_updated_at();

create trigger os_projects_updated_at
  before update on public.os_projects
  for each row execute function public.os_set_updated_at();
