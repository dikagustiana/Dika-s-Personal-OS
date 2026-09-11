-- =============================================================================
-- INSTITUTION: the director's client may write the pipeline's own rows.
-- =============================================================================
--
-- WHY THIS CHANGES 099. Migration 099 made every institution table
-- select-only from the client, on the assumption that a server-side stepper
-- would own every write. The run then measured the alternative and chose it
-- (DECISIONS.md D-12): the Lab already executes ONE agent call per request
-- with the browser driving the chain, because every billable call in this
-- codebase is user-initiated and explicitly confirmed and there is no cron
-- in the subsystem. The institution follows that precedent, so the stepper
-- is the director's own client and needs to write the rows it decides.
--
-- WHAT THIS DOES NOT OPEN. The write policies below are gated on
-- public.os_key_valid() — the director's x-app-key, the same gate every
-- other table in this app uses — and they cover ONLY the pipeline's
-- bookkeeping: assignments, reviews, submissions, debates, briefs, version
-- proposals, evaluation runs and events. Four tables stay closed to the
-- client and are written by the service role alone:
--
--   os_inst_corpus         the archive. If the client could insert a record,
--                          a draft could become an "output" without passing
--                          the tool layer's synthesize gate, which is where
--                          B-8 and G-NUMBER are enforced. The only way to
--                          add to the corpus stays the tool layer.
--   os_inst_egress_blocks  the B-4 audit trail. A blocked call is written by
--                          the thing that blocked it; a client that could
--                          write here could also write a clean history.
--   os_inst_evaluations    B-9. Director-owned, and the owner guard already
--                          demands the key — the policy simply matches it.
--   private.os_inst_evaluation_rubrics   unreachable from any client role.
--
-- WHAT STILL HOLDS WITH THE KEY PRESENT. The guards that carry the
-- institution's rules do not depend on the key, so the director's client
-- cannot write around them any more than an agent can:
--   * a review is never by its own author, a lead review is by that lead,
--     and a committee review is by the committee (os_inst_reviews_guard);
--   * a version row is born 'proposed' with a rationale and a diff, and
--     nothing but os_inst_version_promote() makes one active
--     (os_inst_agent_versions_guard) — so the client may PROPOSE and cannot
--     promote except through the key-gated function, which is B-1 exactly;
--   * an agent carrying authored_by_agent_id may never be born internal
--     (os_lab_agents_lane_at_birth) — the lead-authoring path always sets
--     it, so an authored agent is public whoever holds the key (B-3);
--   * an evaluation score is written only by os_inst_eval_score()
--     (os_inst_evaluation_runs_guard), and an answer is frozen once
--     recorded;
--   * os_inst_events is append-only.
--
-- Reviews, events and version proposals get INSERT only, never UPDATE: a
-- review that can be edited after the fact is not a review, an event log
-- that can be rewritten is not a log, and a version row changes only
-- through os_inst_version_promote()/_reject() (B-1).
--
-- THE GRANTS COME FIRST, AND THEY ARE REVOKES. Measured on the live project
-- before writing this file: anon and authenticated held SELECT, INSERT,
-- UPDATE **and DELETE** on all thirteen os_inst_* tables, from Supabase's
-- default privileges — 099 created the tables and only added a select
-- policy. Nothing was writable because RLS refused it, which is exactly the
-- shape that turns one careless permissive policy into a data-loss bug, and
-- it is the same finding as the function grants in 102 (DECISIONS.md D-08).
-- So this migration revokes every write from both client roles on every
-- institution table first, and then grants back precisely what the stepper
-- uses. DELETE is granted nowhere: nothing in the pipeline deletes.
--
-- Down-migration: down/20260910000104_institution_director_writes_down.sql.

do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      -- table,                       insert, update, delete
      ('os_inst_briefs',              true,  true,  false),
      ('os_inst_assignments',         true,  true,  false),
      ('os_inst_reviews',             true,  false, false),
      ('os_inst_submissions',         true,  true,  false),
      ('os_inst_debates',             true,  true,  false),
      ('os_inst_agent_versions',      true,  false, false),
      ('os_inst_evaluation_runs',     true,  false, false),
      ('os_inst_events',              true,  false, false)
    ) as t(tbl, can_insert, can_update, can_delete)
  loop
    if spec.can_insert and not exists (
      select 1 from pg_policies where schemaname = 'public' and tablename = spec.tbl
        and policyname = 'require app key to insert') then
      execute format(
        'create policy "require app key to insert" on public.%I
           for insert with check ((select public.os_key_valid()))', spec.tbl);
    end if;
    if spec.can_update and not exists (
      select 1 from pg_policies where schemaname = 'public' and tablename = spec.tbl
        and policyname = 'require app key to update') then
      execute format(
        'create policy "require app key to update" on public.%I
           for update using ((select public.os_key_valid()))
           with check ((select public.os_key_valid()))', spec.tbl);
    end if;
  end loop;
end
$$;

-- Every write, off, on every institution table. Then back on for exactly
-- the eight the stepper writes. SELECT is untouched: the select policy from
-- 099 is what decides reads.
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'os_inst_departments', 'os_inst_department_members', 'os_inst_agent_versions',
    'os_inst_briefs', 'os_inst_corpus', 'os_inst_assignments', 'os_inst_reviews',
    'os_inst_submissions', 'os_inst_debates', 'os_inst_evaluations',
    'os_inst_evaluation_runs', 'os_inst_egress_blocks', 'os_inst_events'
  ] loop
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', tbl);
  end loop;
end
$$;

-- PostgREST needs the table grant as well as the policy; anon is the role
-- the app speaks as (the key is a header, not a role).
grant insert on public.os_inst_briefs, public.os_inst_assignments, public.os_inst_reviews,
                 public.os_inst_submissions, public.os_inst_debates, public.os_inst_agent_versions,
                 public.os_inst_evaluation_runs, public.os_inst_events
  to anon, authenticated;
grant update on public.os_inst_briefs, public.os_inst_assignments,
                 public.os_inst_submissions, public.os_inst_debates
  to anon, authenticated;
