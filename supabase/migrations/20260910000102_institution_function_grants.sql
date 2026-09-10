-- =============================================================================
-- INSTITUTION: function grants, corrected. Applied live as
-- `institution_function_grants` immediately after 100/101.
-- =============================================================================
--
-- WHY THIS FILE EXISTS. Migration 100 ended every function with
-- `revoke all on function ... from public`, and granted the two director
-- RPCs to anon/authenticated and the two scorer functions to service_role.
-- That reads as least-privilege and is not: Supabase's default privileges
-- (and scripts/lib/pg-cluster.sh, which mirrors them) grant EXECUTE on every
-- new function in `public` to anon, authenticated AND service_role as
-- explicit per-role grants. `revoke ... from public` removes the PUBLIC
-- pseudo-role's grant and leaves those three standing. The live check after
-- applying 100 read:
--
--   anon          may execute os_inst_eval_score(uuid)      true   (must be false)
--   authenticated may execute os_inst_eval_score(uuid)      true   (must be false)
--   anon          may execute os_lab_agents_prompt_lock()   true   (must be false)
--
-- and by the same mechanism anon could call os_inst_version_set_eval() and
-- write an eval score onto a proposal — the B-9 shape ("no agent writes an
-- evaluation result") open through the API key. 074 and 077 revoke from
-- public, anon AND authenticated in three statements each; that is the house
-- pattern and it is the pattern here from now on. The SQL suite now asserts
-- the full grant matrix (supabase/tests/institution_guards.sql) so the
-- harness, which sets the same default privileges, goes red on the omission.
--
-- The matrix:
--   nobody         helpers and every trigger function
--   anon, authenticated   the director's RPCs (each re-checks os_key_valid() inside)
--   service_role   the two scorer writes the stepper performs (never anon: an
--                  eval score set from a browser is an agent grading itself
--                  with extra steps)
--
-- Down-migration: down/20260910000102_institution_function_grants_down.sql.

-- ---------------------------------------------------------------------------
-- nobody: helpers
-- ---------------------------------------------------------------------------
revoke all on function public.os_inst_guc_on(text) from public, anon, authenticated, service_role;
revoke all on function public.os_inst_committee_slug() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- nobody: trigger functions
-- ---------------------------------------------------------------------------
revoke all on function public.os_lab_agents_prompt_lock() from public, anon, authenticated, service_role;
revoke all on function public.os_lab_agents_lane_at_birth() from public, anon, authenticated, service_role;
revoke all on function public.os_inst_agent_versions_guard() from public, anon, authenticated, service_role;
revoke all on function public.os_inst_corpus_guard() from public, anon, authenticated, service_role;
revoke all on function public.os_inst_briefs_guard() from public, anon, authenticated, service_role;
revoke all on function public.os_inst_reviews_guard() from public, anon, authenticated, service_role;
revoke all on function public.os_inst_debates_guard() from public, anon, authenticated, service_role;
revoke all on function public.os_inst_submissions_guard() from public, anon, authenticated, service_role;
revoke all on function public.os_inst_evaluations_owner_guard() from public, anon, authenticated, service_role;
revoke all on function public.os_inst_evaluation_runs_guard() from public, anon, authenticated, service_role;
revoke all on function public.os_inst_events_guard() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- the director's RPCs: anon + authenticated (the app speaks as anon with the
-- x-app-key header; each function re-checks os_key_valid() before acting).
-- service_role revoked: the stepper never promotes, rejects, decides or reads
-- a rubric.
-- ---------------------------------------------------------------------------
revoke all on function public.os_inst_version_promote(uuid) from public, anon, authenticated, service_role;
grant execute on function public.os_inst_version_promote(uuid) to anon, authenticated;

revoke all on function public.os_inst_version_reject(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.os_inst_version_reject(uuid, text) to anon, authenticated;

revoke all on function public.os_inst_eval_rubric(uuid) from public, anon, authenticated, service_role;
grant execute on function public.os_inst_eval_rubric(uuid) to anon, authenticated;

revoke all on function public.os_inst_brief_decide(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.os_inst_brief_decide(uuid, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- the scorer: service_role only
-- ---------------------------------------------------------------------------
revoke all on function public.os_inst_eval_score(uuid) from public, anon, authenticated, service_role;
grant execute on function public.os_inst_eval_score(uuid) to service_role;

revoke all on function public.os_inst_version_set_eval(uuid, text, numeric) from public, anon, authenticated, service_role;
grant execute on function public.os_inst_version_set_eval(uuid, text, numeric) to service_role;
