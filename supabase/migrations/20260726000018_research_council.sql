-- Council transcripts for the research review loops.
--
-- Table shape ported from the website's
-- supabase/migrations/20260704080000_create_council_sessions.sql, with three
-- deliberate departures:
--
--  1. RLS uses the app-key policy every other Personal OS table carries, NOT
--     the website's has_role(auth.uid(), 'admin') — this app has no user_roles
--     table and no auth users. Porting that predicate would have produced a
--     policy that can never be satisfied, i.e. a table nothing can read.
--
--  2. project_id is NULLABLE. A scope council runs before a project exists;
--     that is the whole point of the scope mode.
--
--  3. APPEND-ONLY, matching os_research_cycles and os_research_log. There is
--     no update path and no delete path in the repository layer, and none
--     should be added. A transcript is evidence of what was said when, and
--     against WHAT — rewriting it destroys the only reason to keep it.
--
-- input_snapshot stores the FRAMED input verbatim, not a project reference, so
-- a verdict can always be read against what the council actually saw rather
-- than against what the project looks like today.
--
-- APPLIED 2026-07-26 via the Supabase apply_migration tool, recorded in the
-- ledger as `research_council`. Applied BEFORE the PR was opened, not after:
-- shipping a frontend against an unapplied migration is exactly what broke
-- GROWTH → Research earlier today.
--
-- Idempotent throughout: create table if not exists, create index if not
-- exists, and the policy is created only when absent. Safe to re-run.
--
-- NEVER apply with `supabase db push`, `migration up`, `db reset`, or
-- `db remote commit`. This repo's filenames and the live ledger's versions are
-- different numbering schemes, so any of those replays the entire history from
-- 0001_schema.sql against live production data.

create table if not exists public.os_research_council_sessions (
  id uuid primary key default gen_random_uuid(),
  -- Nullable on purpose (see 2 above). Cascade so deleting a research project
  -- takes its transcripts with it.
  project_id uuid references public.os_projects(id) on delete cascade,
  mode text not null check (mode in ('method', 'scope', 'contra')),
  input_snapshot text not null default '',
  -- The seats as they were AT RUN TIME, system prompts included. personas.ts
  -- is editable, so without this a transcript from before an edit could not be
  -- read against the prompts that actually produced it.
  advisors_config jsonb not null default '[]'::jsonb,
  advisor_responses jsonb not null default '[]'::jsonb,
  peer_reviews jsonb not null default '[]'::jsonb,
  -- Nullable: a chairman that fails after the advisors and peers succeeded
  -- still leaves a transcript worth keeping. Ten completions should not be
  -- thrown away because the eleventh failed.
  verdict jsonb,
  created_at timestamptz not null default now()
);

create index if not exists os_research_council_sessions_project_idx
  on public.os_research_council_sessions (project_id, created_at desc);

-- Scope sessions have no project, so they would be invisible to the index
-- above. History for them is listed by mode and date.
create index if not exists os_research_council_sessions_mode_idx
  on public.os_research_council_sessions (mode, created_at desc);

comment on table public.os_research_council_sessions is
  'APPEND-ONLY council transcripts. No update or delete path exists in the repository layer, deliberately — a transcript is evidence of what was said when. project_id is null for scope sessions, which run before a project exists.';

comment on column public.os_research_council_sessions.input_snapshot is
  'The FRAMED input, verbatim. A verdict must be readable against what the council saw, not against the project as it stands later.';

comment on column public.os_research_council_sessions.verdict is
  'Null when the chairman stage failed. The advisor and peer stages are still worth keeping on their own.';

alter table public.os_research_council_sessions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'os_research_council_sessions'
      and policyname = 'require app key'
  ) then
    create policy "require app key" on public.os_research_council_sessions
      for all to anon, authenticated
      using (public.os_key_valid())
      with check (public.os_key_valid());
  end if;
end
$$;
