-- Down-migration for 20260806000055_process_text_history.
-- Drops the audit log. DESTROYS EVERY RECORDED EDIT — this table is the only
-- place old values of process text exist, so export it before running this if
-- any edit has been made through the app. Nothing points at it (row_id carries
-- no FK by design), so the drop cannot cascade anywhere.

drop policy if exists "require app key to select" on public.os_process_text_history;
drop policy if exists "require app key to insert" on public.os_process_text_history;
drop table if exists public.os_process_text_history;
