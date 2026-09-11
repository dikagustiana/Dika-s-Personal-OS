-- =============================================================================
-- INSTITUTION: a wrong answer in the held-fixed evaluation set, corrected.
-- =============================================================================
--
-- FOUND BY THE SANDBOX. src/logic/institution/sandbox.test.ts computed
-- (118/100)^(1/4) - 1 = 4.2246% and disagreed with eval-range-not-point,
-- seeded in 20260910000101, which stated "CAGR 4.23%". Two faults in one row:
--
--   1. expected_answer carried an arithmetically wrong figure. An evaluation
--      is the instrument that tells a real upgrade from drift (B-9); an
--      instrument with a wrong reading on it measures nothing.
--   2. the rubric asked for the number token "4.2" through
--      mustContainNumbers, whose matcher is token-bounded —
--      (^|[^0-9.,])4\.2($|[^0-9]) — so "4.22%", the correct answer, would
--      have FAILED the numeric component while "4.2%" passed. An agent that
--      rounded harder scored better than one that was right.
--
-- The fix moves the figure into mustContain (a substring test, so both
-- "4.2%" and "4.2246" satisfy it) and restates the expected answer. The
-- rubric weights are unchanged.
--
-- WHY A MIGRATION. B-9: no agent writes to the evaluation set and no agent
-- reads a rubric. The director owns it. A migration is the deliberate act
-- with a diff this repo already uses for exactly this — the same
-- app.inst_seed gate as the seed, and the guard refuses these two statements
-- to anyone else.
--
-- Down-migration: down/20260910000103_institution_eval_cagr_fix_down.sql.

select set_config('app.inst_seed', 'on', false);

update public.os_inst_evaluations
   set expected_answer = 'Average annual growth about 4.2% (CAGR (118/100)^(1/4) - 1 = 4.2246%, i.e. 4.22%); a forecast should carry a range based on residual spread or scenario bounds, never a point alone.'
 where slug = 'eval-range-not-point';

update private.os_inst_evaluation_rubrics r
   set rubric = '{"mustContain": ["range", "4.2"], "mustNotContain": [], "weights": {"contain": 1}}'::jsonb
  from public.os_inst_evaluations e
 where e.id = r.evaluation_id and e.slug = 'eval-range-not-point';

select set_config('app.inst_seed', 'off', false);
