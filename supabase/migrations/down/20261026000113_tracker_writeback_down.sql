-- Down-migration for 20261026000113_tracker_writeback.sql
--
-- Stops the write-back: drops the trigger and its two RPCs, and puts
-- os_tracker_task_payload and os_tracker_sync back as 20261026000111 left
-- them (re-run that migration's two function bodies after this file).
-- Ticks the board already took stay there (they are centang acts in its
-- history). Tasks keep their tracker.writeback blocks; the old sync ignores
-- them. Vault secret tracker_writeback_url is removed.

drop trigger if exists os_tracker_writeback on public.os_entries;
drop function if exists private.os_tracker_writeback_trigger();
drop function if exists public.os_tracker_writeback_entry(uuid);
drop function if exists public.os_tracker_writeback_result(uuid, jsonb);
delete from vault.secrets where name = 'tracker_writeback_url';
-- Then: the create-or-replace of private.os_tracker_task_payload and
-- public.os_tracker_sync from 20261026000111_tracker_sync.sql.
