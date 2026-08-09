-- ===========================================================================
-- NAME THE WRITING TASK-RESPONSE PAGE FOR BOTH CRITERIA IT ACTUALLY HOLDS.
-- ===========================================================================
-- THE BRIDGE NEEDS NO SCHEMA CHANGE. src/logic/ielts/errorTopicMap.ts maps
-- os_ielts_errors.failure_mode onto os_ielts_topic.slug entirely in code, and
-- os_ielts_errors already carries every column that mapping reads (skill,
-- failure_mode, question_type, date). No table, no column, no index, no
-- policy. This migration exists for one label that the bridge makes wrong.
--
-- WHAT IS WRONG. IELTS bands Task 1 on TASK ACHIEVEMENT and Task 2 on TASK
-- RESPONSE — the same slot in the band descriptor table under two official
-- names. src/logic/ielts/taxonomy.ts follows the official naming and files
-- three writing_task1 modes (data_misreport, coverage_gap,
-- overview_not_synthesised) under 'Task Achievement'.
--
-- os_ielts_topic has ONE row for that slot, labelled 'Task Response'. The page
-- behind it already covers both — content/ielts/writing/criterion-task-
-- response.mdx says in its own text that it is the "Task Achievement / Task
-- Response" column, and two of its three what-costs-marks bullets (skipping
-- the overview, listing data without analysis) are Task 1 failures.
--
-- So the page is right and the label is not. Before the bridge that cost
-- nothing, because nothing routed a Task 1 error there. Now a Task 1 coverage
-- gap surfaces on a weakness row titled "Task Response", which reads as the
-- wrong diagnosis for the right page.
--
-- A SECOND ROW WAS THE ALTERNATIVE AND IS WORSE. writing/criterion-task-
-- achievement would need its own MDX file (topicContent.test.ts fails
-- otherwise), would duplicate the same band-descriptor table, and would split
-- one band slot's evidence across two weakness rows that can never be compared
-- — the opposite of what this bridge is for.
--
-- NOT APPLIED. Every other migration in this directory records the date it was
-- applied via the Supabase apply_migration tool. This one has NOT been applied
-- and is handed over to be applied by hand.
--
-- NEVER apply with `supabase db push`, `migration up`, `db reset`, or
-- `db remote commit`. This repo's filenames and the live ledger's versions are
-- different numbering schemes, so any of those replays the entire history from
-- 0001_schema.sql against live production data.
--
-- Idempotent: the guard matches the old label only, so re-running is a no-op
-- and a fresh database seeded from 20260808000065 is unaffected until that
-- seed is updated alongside it.

update public.os_ielts_topic
   set label = 'Task Achievement / Task Response'
 where slug = 'writing/criterion-task-response'
   and label = 'Task Response';

comment on column public.os_ielts_topic.label is
  'Display name for the weakness row and the method index. Writing''s task-response row names BOTH official criteria because IELTS bands Task 1 as Task Achievement and Task 2 as Task Response against one descriptor column, and src/logic/ielts/errorTopicMap.ts routes both there.';

-- Mirrored in src/logic/ielts/topics.ts and in the seed at
-- 20260808000065_ielts_prep_surface_seed.sql, which the live parity check in
-- REVIEW.md compares against this table:
--
--   select slug || '|' || skill || '|' || kind || '|' || label || '|' || sort_order
--     from public.os_ielts_topic order by slug;
