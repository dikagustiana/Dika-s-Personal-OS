-- v4 A2: a Website/Research project can name the piece currently in progress
-- (working_title), and a Website piece belongs to a DDS site section
-- (category). Both are nullable columns on os_projects, matching the v3
-- real-column pattern for project fields. Idempotent; no security changes.

alter table public.os_projects
  add column if not exists working_title text;

alter table public.os_projects
  add column if not exists category text
  check (
    category is null
    or category in (
      'finance',
      'accounting',
      'green-transition',
      'development-finance',
      'critical-thinking',
      'next-big-thing',
      'books'
    )
  );
