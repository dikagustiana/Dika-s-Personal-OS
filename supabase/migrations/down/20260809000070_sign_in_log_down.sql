-- Down-migration for 20260809000070_sign_in_log.
-- Drops the sign-in log and the trigger that feeds it. DESTROYS EVERY RECORDED
-- SIGN-IN: this table is the only place they exist. auth.audit_log_entries is
-- empty on this project and auth.users.last_sign_in_at keeps only the most
-- recent one per user, so nothing here is reconstructible afterwards. Export
-- before running this.
--
-- The trigger goes first so no sign-in can attempt a write against a table
-- that is mid-drop. Dropping the trigger cannot itself break authentication:
-- auth.users is otherwise untouched, and the birth-password guard from
-- 20260804000049 is a separate trigger that this file does not name.
--
-- Nothing references os_sign_in_log — user_id carries no foreign key by design
-- — so the drop cannot cascade anywhere.

drop trigger if exists os_record_sign_in on auth.users;
drop function if exists public.os_record_sign_in();

drop policy if exists "owner reads sign-in log" on public.os_sign_in_log;
drop index if exists public.os_sign_in_log_user_idx;
drop table if exists public.os_sign_in_log;
