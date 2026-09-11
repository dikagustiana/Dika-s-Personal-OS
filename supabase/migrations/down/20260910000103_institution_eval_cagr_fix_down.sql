-- Rollback of 20260910000103: restores the wrong figure and the token-bounded
-- number rubric seeded by 20260910000101. Here for symmetry; re-applying a
-- known-wrong expected answer to the held-fixed set is not something to want.
select set_config('app.inst_seed', 'on', false);

update public.os_inst_evaluations
   set expected_answer = 'Average annual growth about 4.2% (CAGR 4.23%); a forecast should carry a range based on residual spread or scenario bounds, never a point alone.'
 where slug = 'eval-range-not-point';

update private.os_inst_evaluation_rubrics r
   set rubric = '{"mustContain": ["range", "%"], "mustContainNumbers": ["4.2"], "mustNotContain": [], "weights": {"contain": 0.5, "numbers": 0.5}}'::jsonb
  from public.os_inst_evaluations e
 where e.id = r.evaluation_id and e.slug = 'eval-range-not-point';

select set_config('app.inst_seed', 'off', false);
