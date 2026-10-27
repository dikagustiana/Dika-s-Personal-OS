-- Down-migration for 20261028000117_island_growth_weekly.sql
--
-- Drops the _in doors, the weekly-item doors and the weekly items table.
-- DESTRUCTIVE for weekly items: export them first if any exist
-- (select * from public.os_weekly_items). To-dos keep their weeklyItemId key
-- as a dangling string, which the web ignores; blocks planned from the island
-- in either domain stay as written.

drop function if exists public.os_island_block_patch_in(text, uuid, timestamptz, jsonb);
drop function if exists public.os_island_block_create_in(text, date, text, text, text, text, uuid);
drop function if exists public.os_island_blocks_in(date);
drop function if exists private.os_island_block_row_in(public.os_entries);
drop function if exists private.os_island_block_fit_in(text, date, text, text, uuid);
drop function if exists public.os_island_weekly_carry(uuid, timestamptz);
drop function if exists public.os_island_weekly_patch(uuid, timestamptz, jsonb);
drop function if exists public.os_island_weekly_create(text, text, date, date, uuid, text);
drop function if exists public.os_island_weekly_items(text, date, date);
drop function if exists public.os_island_task_patch_in(text, uuid, timestamptz, jsonb);
drop function if exists public.os_island_task_create_in(text, text, text, date, uuid);
drop function if exists public.os_island_tasks_in(text, timestamptz);
drop function if exists private.os_island_weekly_ref(text, uuid);
drop function if exists private.os_island_weekly_row(public.os_weekly_items);
drop function if exists private.os_island_task_row_in(public.os_entries);
drop function if exists private.os_island_domain(text);
drop table if exists public.os_weekly_items;
drop function if exists private.os_weekly_item_project_check();
