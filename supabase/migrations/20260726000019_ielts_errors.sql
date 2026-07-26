-- IELTS error occurrences — the log that makes band scores actionable.
--
-- os_ielts_results says WHERE he is. "Reading 6.5" is a fact; "you dropped the
-- Task 1 overview in 4 of 6 attempts" is actionable tomorrow. This table holds
-- the occurrences. PATTERNS ARE NEVER STORED and are never maintained by hand:
-- every class in src/logic/ielts/classify.ts is computed on read, the same
-- principle as overallBand and days-left everywhere else in this app. A stored
-- classification goes stale the moment the next session is logged, and a stale
-- classification is worse than none because it will be trusted.
--
-- THE TAXONOMY IS NOT IN HERE. criterion and failure_mode are `text` with no
-- enum and no check constraint, deliberately — the literal 'UNCLASSIFIED' must
-- be able to reach the table, or a mode the taxonomy is missing is silently
-- forced into the nearest existing one and corrupts the count it feeds.
-- Validation happens in the app against src/logic/ielts/taxonomy.ts, which is
-- the single source of truth for both the prompt and the parser.
--
-- os_ielts_results IS UNTOUCHED and stays full-mock-only. A reading section
-- done standalone without time pressure is not comparable to the same section
-- inside a full mock, and plotting both on one trend line would mislead.
--
-- APPLIED 2026-07-26 via the Supabase apply_migration tool, recorded in the
-- ledger as `ielts_errors`. Applied BEFORE the PR was opened, not after:
-- shipping a frontend against an unapplied migration has happened twice in this
-- project and both times the view was broken in production.
--
-- NEVER apply with `supabase db push`, `migration up`, `db reset`, or
-- `db remote commit`. This repo's filenames and the live ledger's versions are
-- different numbering schemes, so any of those replays the entire history from
-- 0001_schema.sql against live production data.
--
-- Idempotent throughout. Safe to re-run.

create table if not exists public.os_ielts_errors (
  id uuid primary key default gen_random_uuid(),
  -- The session date. Also the session IDENTITY: sessions per skill are
  -- COUNT(DISTINCT date), so two errors logged on one date are one session.
  date date not null,
  -- Five, not four: writing splits into Task 1 and Task 2 because they fail in
  -- completely different ways, even though IELTS bands them together.
  skill text not null check (skill in
    ('listening','reading','writing_task1','writing_task2','speaking')),
  -- Layer 1. Band criterion for writing/speaking; point of failure in the
  -- answer pipeline for listening/reading, which have no band descriptors.
  criterion text not null,
  -- Layer 2, or the literal 'UNCLASSIFIED'. See the note above on why this is
  -- not constrained here.
  failure_mode text not null,
  -- Verbatim, never paraphrased. '[absent: …]' where the problem is something
  -- missing and there is nothing to quote.
  quote text not null,
  note text,
  -- Only meaningful for reading and listening (matching headings, T/F/NG,
  -- summary completion). Metadata about WHERE the error happened, kept
  -- separate from failure_mode, which is WHAT it was.
  question_type text,
  -- THE FIELD THAT MAKES CLASSIFICATION POSSIBLE, and nullable. When a session
  -- rewrites an earlier piece it carries that piece's date. The same mode in
  -- two different essays has not generalised yet; the same mode in one essay
  -- and its own rewrite means direct, specific feedback was not applied. Those
  -- are different problems with different fixes, and without this field they
  -- are indistinguishable.
  revision_of date,
  -- NULLABLE ON PURPOSE. He practises both ways: sometimes a full mock
  -- producing four bands, sometimes a single skill on its own. A Tuesday
  -- reading session logs its errors with no accompanying score row.
  result_id uuid references public.os_ielts_results(id) on delete set null,
  created_at timestamptz not null default now()
);

-- The view reads every error for a skill and groups by date, so this is the
-- shape every query takes.
create index if not exists os_ielts_errors_skill_date_idx
  on public.os_ielts_errors (skill, date);

create index if not exists os_ielts_errors_mode_idx
  on public.os_ielts_errors (skill, failure_mode);

comment on table public.os_ielts_errors is
  'One row per logged error OCCURRENCE. Patterns are derived on read in src/logic/ielts/classify.ts and are never stored — a stored class goes stale the moment the next session is logged.';

comment on column public.os_ielts_errors.failure_mode is
  'Layer 2 taxonomy name, or the literal UNCLASSIFIED. Deliberately not a database enum: UNCLASSIFIED must be able to pass, and an imprecise forced fit corrupts the counts.';

comment on column public.os_ielts_errors.revision_of is
  'Date of the piece this session rewrites. Distinguishes "has not generalised" (same mode, two different pieces) from "feedback not applied" (same mode, a piece and its own rewrite).';

comment on column public.os_ielts_errors.result_id is
  'Null for standalone single-skill sessions, which have no score row. os_ielts_results stays full-mock-only.';

alter table public.os_ielts_errors enable row level security;

-- The same app-key policy every other os_ table carries.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'os_ielts_errors'
      and policyname = 'require app key'
  ) then
    create policy "require app key" on public.os_ielts_errors
      for all to anon, authenticated
      using (public.os_key_valid())
      with check (public.os_key_valid());
  end if;
end
$$;
