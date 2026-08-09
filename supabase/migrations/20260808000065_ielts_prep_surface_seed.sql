-- ===========================================================================
-- IELTS PREP SURFACE: THE TAXONOMY, THE CONVERSION TABLE, AND THE TARGET.
-- ===========================================================================
-- Seed for the five tables created in 20260808000064.
--
-- Every insert is `on conflict do update`, not `do nothing`. This file is the
-- source of truth for the taxonomy and the conversion table, so re-running it
-- must CORRECT drift, not skip it. That matters most for
-- os_ielts_band_conversion: the values below are indicative and are expected
-- to be corrected against an official Cambridge key, and a `do nothing` seed
-- would silently refuse the correction.
--
-- SORT ORDER NOTE. The version APPLIED to live on 2026-08-08 put the criteria
-- at 100..130, which OVERLAPPED the writing task types at 10..120 and made the
-- method index interleave them. Migration 20260808000067 corrected the live
-- rows; the values below are the corrected ones, so a fresh database gets it
-- right from here and 20260808000067 is then a no-op (it is guarded on
-- sort_order < 200). Do not "restore" the old numbers.
--
-- os_ielts_practice and os_ielts_practice_topic are NOT seeded. They hold his
-- real practice history and start empty.
--
-- APPLIED 2026-08-08 via the Supabase apply_migration tool (ledger name
-- `ielts_prep_surface_seed`). NEVER apply with `supabase db push`,
-- `migration up`, `db reset`, or `db remote commit`.

-- 1. The taxonomy -----------------------------------------------------------
-- sort_order within a skill: overview 0, the question/task types from 10, and
-- the band criteria from 200. The bands must not overlap — see the note above.
insert into public.os_ielts_topic (slug, skill, kind, label, sort_order) values
  -- Skill-general reference prose. Never offered as a weakness tag.
  ('listening/overview', 'listening', 'overview', 'Listening Overview', 0),
  ('reading/overview',   'reading',   'overview', 'Reading Overview',   0),
  ('writing/overview',   'writing',   'overview', 'Writing Overview',   0),
  ('speaking/overview',  'speaking',  'overview', 'Speaking Overview',  0),

  -- Listening: six question types, countable.
  ('listening/form-note-table-completion',  'listening', 'question_type', 'Form, Note & Table Completion', 10),
  ('listening/multiple-choice',             'listening', 'question_type', 'Multiple Choice',               20),
  ('listening/matching',                    'listening', 'question_type', 'Matching',                      30),
  ('listening/plan-map-diagram-labelling',  'listening', 'question_type', 'Plan, Map & Diagram Labelling', 40),
  ('listening/sentence-completion',         'listening', 'question_type', 'Sentence Completion',           50),
  ('listening/short-answer',                'listening', 'question_type', 'Short Answer',                  60),

  -- Reading: twelve question types, countable. The four matching variants are
  -- separate rows because they fail differently — headings is about paragraph
  -- gist, information is about locating a detail, and conflating them hides
  -- which one is actually costing marks.
  ('reading/matching-headings',              'reading', 'question_type', 'Matching Headings',                 10),
  ('reading/matching-information',           'reading', 'question_type', 'Matching Information',              20),
  ('reading/matching-features',              'reading', 'question_type', 'Matching Features',                 30),
  ('reading/matching-sentence-endings',      'reading', 'question_type', 'Matching Sentence Endings',         40),
  ('reading/true-false-notgiven',            'reading', 'question_type', 'True / False / Not Given',          50),
  ('reading/yes-no-notgiven',                'reading', 'question_type', 'Yes / No / Not Given',              60),
  ('reading/sentence-completion',            'reading', 'question_type', 'Sentence Completion',               70),
  ('reading/summary-completion',             'reading', 'question_type', 'Summary Completion',                80),
  ('reading/note-table-flowchart-completion','reading', 'question_type', 'Note, Table & Flow-chart Completion',90),
  ('reading/diagram-label-completion',       'reading', 'question_type', 'Diagram Label Completion',         100),
  ('reading/multiple-choice',                'reading', 'question_type', 'Multiple Choice',                  110),
  ('reading/short-answer',                   'reading', 'question_type', 'Short Answer',                     120),

  -- Writing task types: context, not the tag that carries the diagnosis.
  ('writing/task1-line-graph',       'writing', 'task_type', 'Task 1: Line Graph',       10),
  ('writing/task1-bar-chart',        'writing', 'task_type', 'Task 1: Bar Chart',        20),
  ('writing/task1-pie-chart',        'writing', 'task_type', 'Task 1: Pie Chart',        30),
  ('writing/task1-table',            'writing', 'task_type', 'Task 1: Table',            40),
  ('writing/task1-process-diagram',  'writing', 'task_type', 'Task 1: Process Diagram',  50),
  ('writing/task1-map',              'writing', 'task_type', 'Task 1: Map',              60),
  ('writing/task1-mixed',            'writing', 'task_type', 'Task 1: Mixed Charts',     70),
  ('writing/task2-opinion',          'writing', 'task_type', 'Task 2: Opinion',          80),
  ('writing/task2-discussion',       'writing', 'task_type', 'Task 2: Discussion',       90),
  ('writing/task2-advantages-disadvantages','writing','task_type','Task 2: Advantages & Disadvantages',100),
  ('writing/task2-problem-solution', 'writing', 'task_type', 'Task 2: Problem & Solution',110),
  ('writing/task2-two-part',         'writing', 'task_type', 'Task 2: Two-part Question',120),

  -- Speaking task types: the three parts.
  ('speaking/part1-interview',  'speaking', 'task_type', 'Part 1: Interview',  10),
  ('speaking/part2-long-turn',  'speaking', 'task_type', 'Part 2: Long Turn',  20),
  ('speaking/part3-discussion', 'speaking', 'task_type', 'Part 3: Discussion', 30),

  -- The band descriptors. THESE are what a writing or speaking weakness is
  -- tagged with — "opinion question" diagnoses nothing, "coherence and
  -- cohesion" names the thing to practise.
  -- BOTH official names: IELTS bands Task 1 as Task Achievement and Task 2 as
  -- Task Response against one descriptor column, and errorTopicMap.ts routes
  -- modes from both tasks here. Corrected forward for a live database by
  -- 20260808000068, which is a no-op on a fresh one seeded from this line.
  ('writing/criterion-task-response',      'writing', 'criterion', 'Task Achievement / Task Response', 200),
  ('writing/criterion-coherence-cohesion', 'writing', 'criterion', 'Coherence & Cohesion',          210),
  ('writing/criterion-lexical-resource',   'writing', 'criterion', 'Lexical Resource',              220),
  ('writing/criterion-grammatical-range',  'writing', 'criterion', 'Grammatical Range & Accuracy',  230),

  ('speaking/criterion-fluency-coherence', 'speaking','criterion', 'Fluency & Coherence',           200),
  ('speaking/criterion-lexical-resource',  'speaking','criterion', 'Lexical Resource',              210),
  ('speaking/criterion-grammatical-range', 'speaking','criterion', 'Grammatical Range & Accuracy',  220),
  ('speaking/criterion-pronunciation',     'speaking','criterion', 'Pronunciation',                 230)
on conflict (slug) do update
  set skill = excluded.skill,
      kind  = excluded.kind,
      label = excluded.label,
      sort_order = excluded.sort_order;

-- 2. Raw score to band -----------------------------------------------------
-- INDICATIVE VALUES. These are the commonly published Academic tables. The
-- official conversion VARIES SLIGHTLY BY TEST VERSION — Cambridge prints a
-- different key in each book — so a band derived from these rows is an
-- estimate. Correct them against an official answer key when one is to hand;
-- the `on conflict do update` above and below is what makes that a one-line
-- change. The log form allows a manual band override for the same reason.
--
-- The listening table is independently corroborated by the "Listening &
-- Reading" table on the Notion General Information page, and the reading
-- table by the "Band Score Estimator" on the Notion IELTS READING page, for
-- the ranges those cover.
--
-- One row per raw score 0..40 for both skills. Below 10 the published tables
-- stop, so band is NULL rather than an invented value — the lookup still
-- finds a row and can say "no published band" instead of failing to resolve.
insert into public.os_ielts_band_conversion (skill, raw_score, band)
select 'listening', rs,
       case
         when rs between 39 and 40 then 9.0
         when rs between 37 and 38 then 8.5
         when rs between 35 and 36 then 8.0
         when rs between 32 and 34 then 7.5
         when rs between 30 and 31 then 7.0
         when rs between 26 and 29 then 6.5
         when rs between 23 and 25 then 6.0
         when rs between 18 and 22 then 5.5
         when rs between 16 and 17 then 5.0
         when rs between 13 and 15 then 4.5
         when rs between 10 and 12 then 4.0
         else null
       end
from generate_series(0, 40) as rs
on conflict (skill, raw_score) do update set band = excluded.band;

insert into public.os_ielts_band_conversion (skill, raw_score, band)
select 'reading_academic', rs,
       case
         when rs between 39 and 40 then 9.0
         when rs between 37 and 38 then 8.5
         when rs between 35 and 36 then 8.0
         when rs between 33 and 34 then 7.5
         when rs between 30 and 32 then 7.0
         when rs between 27 and 29 then 6.5
         when rs between 23 and 26 then 6.0
         when rs between 19 and 22 then 5.5
         when rs between 15 and 18 then 5.0
         when rs between 13 and 14 then 4.5
         when rs between 10 and 12 then 4.0
         else null
       end
from generate_series(0, 40) as rs
on conflict (skill, raw_score) do update set band = excluded.band;

-- 3. The target ------------------------------------------------------------
insert into public.os_ielts_config (id, test_date, target_overall, target_floor)
values (true, date '2026-09-20', 7.0, 6.5)
on conflict (id) do update
  set test_date      = excluded.test_date,
      target_overall = excluded.target_overall,
      target_floor   = excluded.target_floor;
