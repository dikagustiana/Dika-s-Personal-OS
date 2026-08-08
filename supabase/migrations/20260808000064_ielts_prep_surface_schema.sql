-- ===========================================================================
-- IELTS PREP SURFACE: THE TAXONOMY, THE PRACTICE LOG, AND THE JOIN TO CONTENT.
-- ===========================================================================
-- The existing IELTS tables answer "where is he": os_ielts_results holds
-- full-mock bands, os_ielts_errors holds classified error occurrences, and
-- os_ielts_sessions counts practice. None of them can answer "matching
-- headings: 6 misses in 10 attempts, here is the method for matching
-- headings", because none of them has a QUESTION-TYPE grain and none of them
-- has anything to link to.
--
-- These five tables add that grain and that link.
--
-- ---------------------------------------------------------------------------
-- WHY os_ielts_practice AND NOT os_ielts_session
-- ---------------------------------------------------------------------------
-- The brief specified `ielts_session`. public.os_ielts_sessions ALREADY
-- EXISTS (migration 20260727154318) and means something different: one row
-- per committed error-log paste, created as a side effect of pasting marking
-- feedback, keyed to skills that split writing into task1/task2.
--
-- Two tables named session-something, with different grains and different
-- skill vocabularies, is how a query joins the wrong one eighteen months from
-- now and nobody notices because both return rows. So this one is `practice`:
-- one row per PRACTICE ATTEMPT against a named source, carrying a raw score.
-- The name states the grain, and the two tables can never be confused.
--
-- The os_ prefix is the house convention — every table in this schema carries
-- it, and the RLS split migration (20260728165309) enumerates by predicate,
-- not by name, so an unprefixed table would still get policies but would read
-- as foreign in every table listing.
--
-- ---------------------------------------------------------------------------
-- THE SLUG IS THE JOIN
-- ---------------------------------------------------------------------------
-- os_ielts_topic.slug is BOTH the primary key here AND the path under
-- content/ielts/ in the repo. reading/matching-headings is the row and
-- content/ielts/reading/matching-headings.mdx is the file. That equality is
-- the whole integration: a weakness row knows its slug, so it knows its page.
-- It is enforced by a test (src/logic/ielts/topicContent.test.ts) that fails
-- if any slug lacks a file or any file lacks a slug — the database cannot
-- enforce it because the files are not in the database.
--
-- ---------------------------------------------------------------------------
-- TWO AXES, BECAUSE THE FAILURE MODE DIFFERS BY SKILL
-- ---------------------------------------------------------------------------
-- Listening and reading fail at QUESTION TYPE: you can count how many
-- matching-headings questions were faced and how many were wrong, and the
-- ratio means something. Writing and speaking fail at BAND CRITERION: an
-- essay tagged "opinion question" tells you nothing, an essay tagged
-- "coherence and cohesion" tells you what to practise. So kind is one of
-- question_type / task_type / criterion / overview, and the practice-topic
-- row carries attempted+missed for the countable axis and severity for the
-- one where counting is meaningless.
--
-- `overview` is the fourth kind and exists because the source material
-- demanded it: the Notion study sheets are written per SKILL, so prose that
-- is general to a skill belongs to no question type. It gets a topic row so
-- that content/ielts/<skill>/overview.mdx has a slug on the database side and
-- the parity test stays symmetric. Overview topics are reference-only and are
-- never offered as a weakness tag.
--
-- APPLIED 2026-08-08 via the Supabase apply_migration tool (ledger name
-- `ielts_prep_surface_schema`). NEVER apply with `supabase db push`,
-- `migration up`, `db reset`, or `db remote commit`: this repo's filenames and
-- the live ledger's versions are different numbering schemes, so any of those
-- replays the entire history from 0001_schema.sql against live production
-- data.
--
-- Idempotent throughout. Safe to re-run. Seed lives in the next migration.

-- 1. The taxonomy -----------------------------------------------------------
create table if not exists public.os_ielts_topic (
  -- Equals the path under content/ielts/. Not a uuid on purpose: a synthetic
  -- key would need a second lookup to find the file, and then the two could
  -- disagree.
  slug       text primary key,
  skill      text not null check (skill in ('listening','reading','writing','speaking')),
  kind       text not null check (kind in ('question_type','task_type','criterion','overview')),
  label      text not null,
  sort_order int  not null,
  -- The slug's first segment must BE the skill. Without this a row could
  -- claim skill='reading' with slug='listening/matching', and the file that
  -- satisfies the parity test would sit in the wrong folder.
  constraint os_ielts_topic_slug_matches_skill
    check (slug like skill || '/%')
);

create index if not exists os_ielts_topic_skill_sort_idx
  on public.os_ielts_topic (skill, sort_order);

comment on table public.os_ielts_topic is
  'The tagging taxonomy AND the content index. slug equals the path under content/ielts/ in the repo — reading/matching-headings is content/ielts/reading/matching-headings.mdx. Parity is enforced by test, not by the database, because the files are not here.';

comment on column public.os_ielts_topic.kind is
  'question_type (listening/reading — countable), task_type and criterion (writing/speaking — criterion is what you tag, task_type is context), overview (skill-general reference prose, never offered as a weakness tag).';

-- 2. The practice log -------------------------------------------------------
create table if not exists public.os_ielts_practice (
  id               uuid primary key default gen_random_uuid(),
  skill            text not null check (skill in ('listening','reading','writing','speaking')),
  -- Free text by design. 'Cambridge 18 Test 2', 'IELTS Liz mock', a URL. An
  -- enum here would need maintaining every time he opens a new book.
  source           text not null check (length(trim(source)) > 0),
  attempted_on     date not null,
  timed            boolean not null default true,
  raw_score        int null check (raw_score between 0 and 40),
  band             numeric(2,1) null check (band >= 0 and band <= 9),
  duration_minutes int null check (duration_minutes > 0),
  notes            text,
  created_at       timestamptz not null default now(),
  -- Writing and speaking have no raw score — there is nothing out of 40 to
  -- count. Storing one would invite the band-conversion lookup to fire on a
  -- skill it has no table for and return a confidently wrong band.
  constraint os_ielts_practice_raw_score_only_for_countable_skills
    check (raw_score is null or skill in ('listening','reading'))
);

create index if not exists os_ielts_practice_skill_date_idx
  on public.os_ielts_practice (skill, attempted_on desc);

comment on table public.os_ielts_practice is
  'One row per practice attempt against a named source. DISTINCT FROM os_ielts_sessions, which is one row per committed error-log paste and splits writing into task1/task2 — different grain, different skill vocabulary, deliberately different name.';

comment on column public.os_ielts_practice.band is
  'Derived from os_ielts_band_conversion for listening/reading, entered by hand for writing/speaking. Stored either way: a derived value that is never stored cannot be overridden, and the official conversion varies by test version.';

-- 3. The weakness tags ------------------------------------------------------
create table if not exists public.os_ielts_practice_topic (
  practice_id uuid not null references public.os_ielts_practice(id) on delete cascade,
  topic_slug  text not null references public.os_ielts_topic(slug),
  -- Listening/reading: how many questions of this type were faced, and how
  -- many of those were wrong.
  attempted   int null check (attempted >= 0),
  missed      int null check (missed >= 0),
  -- Writing/speaking: 1..3, because "you were wrong on 4 of 11 coherence
  -- questions" is not a sentence that means anything.
  severity    int null check (severity between 1 and 3),
  primary key (practice_id, topic_slug),
  -- Cannot miss more than were faced. Caught here rather than in the form,
  -- because the ratio this feeds is the entire weakness view.
  constraint os_ielts_practice_topic_missed_within_attempted
    check (missed is null or attempted is null or missed <= attempted),
  -- A tag that carries no measurement is a tag that ranks as nothing. Refuse
  -- it at the boundary rather than letting it dilute the weakness table.
  constraint os_ielts_practice_topic_has_a_measurement
    check (attempted is not null or severity is not null)
);

create index if not exists os_ielts_practice_topic_slug_idx
  on public.os_ielts_practice_topic (topic_slug);

comment on table public.os_ielts_practice_topic is
  'What went wrong, per topic, per practice attempt. attempted/missed for the countable skills; severity 1..3 for writing and speaking. The weakness view is sum(missed)/sum(attempted) grouped by topic_slug, and every row deep-links to its MDX page by that slug.';

-- 4. Raw score to band ------------------------------------------------------
-- INDICATIVE, NOT OFFICIAL. These are the commonly published Academic tables.
-- The real conversion varies by test version — Cambridge prints a different
-- key in each book — so treat a band derived here as an estimate and correct
-- these rows against an official answer key when one is to hand. The UI
-- allows a manual override for exactly this reason.
create table if not exists public.os_ielts_band_conversion (
  skill     text not null check (skill in ('listening','reading_academic')),
  raw_score int  not null check (raw_score between 0 and 40),
  -- NULLABLE, against the brief's `not null`, and deliberately. The brief
  -- also says "below 10, leave null rather than guessing" — the two cannot
  -- both hold. Null wins: a row for every raw score 0..40 means the lookup
  -- always finds its row and can distinguish "no published band for this
  -- score" from "this score is not in the table", which a missing row cannot.
  band      numeric(2,1) null check (band >= 0 and band <= 9),
  primary key (skill, raw_score)
);

comment on table public.os_ielts_band_conversion is
  'INDICATIVE Academic conversion, not official — the published tables vary slightly by test version. Correct against a Cambridge answer key. Band is null below raw 10 because the published tables stop there; a null band means the UI asks for a manual entry rather than inventing one.';

-- 5. The target ------------------------------------------------------------
create table if not exists public.os_ielts_config (
  -- The single-row pattern this schema already uses for private.os_read_key:
  -- a boolean primary key that must be true admits exactly one row, so a
  -- second insert fails loudly instead of creating an ambiguous second target.
  id             boolean primary key default true check (id),
  test_date      date not null,
  target_overall numeric(2,1) null check (target_overall >= 0 and target_overall <= 9),
  target_floor   numeric(2,1) null check (target_floor >= 0 and target_floor <= 9)
);

comment on table public.os_ielts_config is
  'At most one row. target_floor is the PER-SKILL minimum and is the number that actually gates admission: an average of 7.0 built on a 5.5 in writing fails a 6.5 floor. The dashboard surfaces the skill furthest below this floor, never the average.';

-- 6. RLS: the house pattern, four policies per table -----------------------
-- SELECT accepts either the owner key or the read-only key; INSERT, UPDATE
-- and DELETE stay owner-only (migration 20260729040353). Every predicate is
-- wrapped in a scalar subquery so it is an InitPlan evaluated once per
-- statement — unwrapped, os_key_valid()'s bcrypt runs per row and produced a
-- live 500 (20260728155549). No `to` clause, matching every other os_ table:
-- the owner's own requests arrive as anon carrying an x-app-key header.
--
-- Single-user: no member policies, no grants, no sharing. GROWTH is
-- owner-only by three-layer guard (20260805091141) and nothing here widens it.
do $$
declare
  t text;
begin
  foreach t in array array[
    'os_ielts_topic',
    'os_ielts_practice',
    'os_ielts_practice_topic',
    'os_ielts_band_conversion',
    'os_ielts_config'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);

    if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = t and policyname = 'require app key to select') then
      execute format(
        'create policy "require app key to select" on public.%I for select
           using ((select public.os_key_valid()) or (select public.os_read_key_valid()))', t);
    end if;

    if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = t and policyname = 'require app key to insert') then
      execute format(
        'create policy "require app key to insert" on public.%I for insert
           with check ((select public.os_key_valid()))', t);
    end if;

    if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = t and policyname = 'require app key to update') then
      execute format(
        'create policy "require app key to update" on public.%I for update
           using ((select public.os_key_valid()))
           with check ((select public.os_key_valid()))', t);
    end if;

    if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = t and policyname = 'require app key to delete') then
      execute format(
        'create policy "require app key to delete" on public.%I for delete
           using ((select public.os_key_valid()))', t);
    end if;
  end loop;
end $$;
