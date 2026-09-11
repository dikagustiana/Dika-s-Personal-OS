-- =============================================================================
-- INSTITUTION: the director writes an evaluation score onto a proposal (B-9).
-- =============================================================================
--
-- B-9 asks for the held-fixed set to run against an agent BEFORE and AFTER
-- a version promotion, with both scores stored on the os_inst_agent_versions
-- row. Two functions stand between that and the client, and 102 granted
-- both to service_role alone because the stepper was expected to be a
-- server:
--
--   os_inst_eval_score(uuid)                    scores one run from the rubric
--   os_inst_version_set_eval(uuid,text,numeric) writes the score to the version
--
-- 106 added the key-gated caller for the first. This adds it for the
-- second, on the same terms: os_key_valid() inside, anon and authenticated
-- outside, service_role revoked (the wrapper exists for the director, and
-- the stepper still has the unwrapped function for the day a server does
-- this). The version row itself stays unwritable from the client — the
-- INSERT policy from 104 admits a proposal and nothing else, and the
-- versions guard refuses every UPDATE that is not inside one of these
-- definer functions.
--
-- The rubric is still read by nobody: the score is a number computed inside
-- the database and written to one column.
--
-- Down-migration: down/20260910000107_institution_director_evals_down.sql.

create or replace function public.os_inst_version_set_eval_owner(
  p_version_id uuid,
  p_phase text,
  p_score numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.os_key_valid() then
    raise exception 'B-9: an evaluation score is attached by the director. An agent does not record its own before-and-after.';
  end if;
  perform public.os_inst_version_set_eval(p_version_id, p_phase, p_score);
end;
$$;
revoke all on function public.os_inst_version_set_eval_owner(uuid, text, numeric)
  from public, anon, authenticated, service_role;
grant execute on function public.os_inst_version_set_eval_owner(uuid, text, numeric)
  to anon, authenticated;
