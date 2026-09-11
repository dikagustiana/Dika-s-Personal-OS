-- Rollback of 20260910000106.
--
-- The committee's AGENT ROW is not deleted: os_lab_agents_delete_guard
-- refuses to delete an internal agent, because its runs, reviews and the
-- prompts that name it would be orphaned. Removing the committee is a
-- decision with consequences, not a rollback step; if it is really wanted,
-- deactivate it (is_active = false) and say so in a migration of its own.
revoke insert on public.os_inst_department_members from anon, authenticated;
drop policy if exists "require app key to insert" on public.os_inst_department_members;
drop function if exists public.os_inst_eval_score_owner(uuid);
