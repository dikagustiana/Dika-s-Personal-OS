-- Rollback of 20260910000107: the director can no longer attach an
-- evaluation score to a proposal from the app. B-9's before/after scoring
-- loses its only caller; nothing else changes.
drop function if exists public.os_inst_version_set_eval_owner(uuid, text, numeric);
