-- Rollback of 20260910000102_institution_function_grants.
--
-- Restores the grant state migration 100 left behind on a Supabase project:
-- the default-privilege EXECUTE grants to anon, authenticated and
-- service_role on every function, minus the PUBLIC pseudo-role. This
-- re-opens the gap 102 closed (anon scoring evaluations); it exists for
-- symmetry with the other down files, not because anyone should want it.
grant execute on function public.os_inst_guc_on(text) to anon, authenticated, service_role;
grant execute on function public.os_inst_committee_slug() to anon, authenticated, service_role;
grant execute on function public.os_lab_agents_prompt_lock() to anon, authenticated, service_role;
grant execute on function public.os_lab_agents_lane_at_birth() to anon, authenticated, service_role;
grant execute on function public.os_inst_agent_versions_guard() to anon, authenticated, service_role;
grant execute on function public.os_inst_corpus_guard() to anon, authenticated, service_role;
grant execute on function public.os_inst_briefs_guard() to anon, authenticated, service_role;
grant execute on function public.os_inst_reviews_guard() to anon, authenticated, service_role;
grant execute on function public.os_inst_debates_guard() to anon, authenticated, service_role;
grant execute on function public.os_inst_submissions_guard() to anon, authenticated, service_role;
grant execute on function public.os_inst_evaluations_owner_guard() to anon, authenticated, service_role;
grant execute on function public.os_inst_evaluation_runs_guard() to anon, authenticated, service_role;
grant execute on function public.os_inst_events_guard() to anon, authenticated, service_role;
grant execute on function public.os_inst_version_promote(uuid) to anon, authenticated, service_role;
grant execute on function public.os_inst_version_reject(uuid, text) to anon, authenticated, service_role;
grant execute on function public.os_inst_eval_rubric(uuid) to anon, authenticated, service_role;
grant execute on function public.os_inst_brief_decide(uuid, text, text) to anon, authenticated, service_role;
grant execute on function public.os_inst_eval_score(uuid) to anon, authenticated, service_role;
grant execute on function public.os_inst_version_set_eval(uuid, text, numeric) to anon, authenticated, service_role;
