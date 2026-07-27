-- IELTS practice sessions — the denominator, finally its own table.
--
-- THE DEFECT THIS FIXES: sessions were COUNT(DISTINCT date) over
-- os_ielts_errors. A practice session with no errors produced no row, no date,
-- and no session — so the `isolated` class (a slip that did NOT recur across
-- clean sessions, the strongest evidence something stopped happening) was
-- unreachable via clean sessions, and the denominator understated practice:
-- "6 occurrences across 3 sessions" printed when the real figure was 8.
--
-- WHY A TABLE AND NOT A SENTINEL: a NO_ERRORS row in os_ielts_errors puts a
-- non-error in the errors table and every count query thereafter must remember
-- to exclude it — the kind of thing that breaks silently six months later when
-- one query forgets. Sessions are their own fact; they get their own table.
--
-- revision_of LIVES HERE NOW, not on the error row: a revision is a property
-- of the SESSION (this piece rewrites that piece), not of each individual
-- mistake. The error-row column is dropped in migration 20260727000028 —
-- os_ielts_errors held 0 rows when both were applied, so this is a schema
-- change only, no data moved.
--
-- raw_feedback gives the examiner's review a home. It was discarded on every
-- paste before this, and it carries the band estimate, what improved, and what
-- still needs work.
--
-- A session row is created as a SIDE EFFECT of committing a paste — not a
-- second action. A paste yielding zero error rows asks which skill (one tap)
-- and writes the session; that is the clean-session path and the entire point.
--
-- APPLIED 2026-07-27 via the Supabase apply_migration tool, recorded in the
-- ledger as `ielts_sessions`. Applied BEFORE the PR was opened, additive only,
-- so the older deployed frontend is unaffected.
--
-- NEVER apply with `supabase db push`, `migration up`, `db reset`, or
-- `db remote commit`. This repo's filenames and the live ledger's versions are
-- different numbering schemes, so any of those replays the entire history from
-- 0001_schema.sql against live production data.
--
-- Idempotent throughout. Safe to re-run.

create table if not exists public.os_ielts_sessions (
  id           uuid primary key default gen_random_uuid(),
  date         date not null,
  skill        text not null check (skill in
                 ('listening','reading','writing_task1','writing_task2','speaking')),
  revision_of  date,
  raw_feedback text,
  created_at   timestamptz not null default now()
);

-- Session counting reads a skill's dates; same shape as the errors index.
create index if not exists os_ielts_sessions_skill_date_idx
  on public.os_ielts_sessions (skill, date);

comment on table public.os_ielts_sessions is
  'One row per practice session, created as a side effect of committing a paste. Sessions are counted from HERE — never from distinct error dates, which misses clean sessions. Two rows on one date for one skill are one session on read (distinct dates), and both keep their raw_feedback.';

comment on column public.os_ielts_sessions.revision_of is
  'Date of the piece this session rewrites. Session-level on purpose: a revision is a property of the session, not of each individual mistake.';

comment on column public.os_ielts_sessions.raw_feedback is
  'The full pasted marking response — band estimate, what improved, what still needs work. Personal practice content: lives in the database, never in the repo.';

alter table public.os_ielts_sessions enable row level security;

-- The same app-key policy every other os_ table carries.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'os_ielts_sessions'
      and policyname = 'require app key'
  ) then
    create policy "require app key" on public.os_ielts_sessions
      for all to anon, authenticated
      using (public.os_key_valid())
      with check (public.os_key_valid());
  end if;
end
$$;
