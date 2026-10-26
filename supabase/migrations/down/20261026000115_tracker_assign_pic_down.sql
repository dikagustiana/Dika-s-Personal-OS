-- Down-migration for 20261026000115_tracker_assign_pic.sql
--
-- Drops the island's PIC pick and its result RPC. Then re-run, in order, the
-- function bodies of os_tracker_task_payload and os_tracker_sync from
-- 20261026000114_tracker_monitor_due.sql / 20261026000113_tracker_writeback.sql,
-- and os_island_task_row from 20261026000112_island_task_project.sql. PICs
-- already named on the board stay there (ordinary PIC changes in its history).

drop function if exists public.os_island_task_assign(uuid, timestamptz, uuid);
drop function if exists public.os_tracker_assign_result(uuid, jsonb);
