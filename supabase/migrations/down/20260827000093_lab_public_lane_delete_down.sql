-- Down-migration for 20260827000093_lab_public_lane_delete.sql
--
-- Drops the guard that keeps internal-lane agents undeletable from the app.
--
-- Applying this makes every agent deletable by anyone holding the app key,
-- including internal ones cited by run history and by sibling prompts. The
-- foreign key on os_lab_runs.agent_id still refuses to delete an agent that
-- has actually run, so the damage is bounded to never-run internal agents —
-- but "bounded" is not "safe", and the reason 093 exists does not go away.
--
-- It is here because every migration carries a rollback, not because rolling
-- back is advisable.

drop trigger if exists os_lab_agents_delete_guard on public.os_lab_agents;
drop function if exists public.os_lab_agents_delete_guard();
