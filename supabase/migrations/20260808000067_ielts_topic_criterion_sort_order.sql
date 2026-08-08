-- ===========================================================================
-- SEPARATE THE CRITERION SORT BAND FROM THE TASK-TYPE SORT BAND.
-- ===========================================================================
-- The seed as first APPLIED put writing task types at 10..120 and writing
-- criteria at 100..130. Those ranges OVERLAP, so the method index interleaved
-- them:
--
--     Task 2: Advantages & Disadvantages   (100)
--     Task Response                        (100)   <- a criterion, mid-list
--     Task 2: Problem & Solution           (110)
--     Coherence & Cohesion                 (110)   <- and another
--     Task 2: Two-part Question            (120)
--     Lexical Resource                     (120)
--
-- Found by looking at the rendered index, not by any test — the sort is
-- valid, just wrong, and nothing about it is type-incorrect. A regression
-- guard now exists in src/logic/ielts/topicContent.test.ts.
--
-- Criteria move to 200.. so the intended reading order holds: overview first,
-- then the task or question types, then the band descriptors. Speaking gets
-- the same treatment even though its task types only reach 30, because a rule
-- that holds for one skill and not the other is the kind of asymmetry someone
-- later "fixes" in the wrong direction.
--
-- 20260808000065 in this repo already carries the CORRECTED numbers, so on a
-- fresh database this migration matches zero rows and is a no-op. The guard
-- `sort_order < 200` is what makes that true and also makes re-running safe.
--
-- Mirrored in src/logic/ielts/topics.ts, which the live parity check compares
-- against this table.
--
-- APPLIED 2026-08-08 via the Supabase apply_migration tool (ledger name
-- `ielts_topic_criterion_sort_order`). NEVER apply with `supabase db push`,
-- `migration up`, `db reset`, or `db remote commit`.
--
-- Idempotent: re-running sets the same values.

update public.os_ielts_topic
   set sort_order = sort_order + 100
 where kind = 'criterion'
   and sort_order < 200;

comment on column public.os_ielts_topic.sort_order is
  'Reading order WITHIN a skill: 0 overview, 10.. question/task types, 200.. band criteria. The bands must not overlap or the method index interleaves criteria into the task-type list.';
