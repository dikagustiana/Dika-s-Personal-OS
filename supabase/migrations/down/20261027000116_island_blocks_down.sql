-- Down-migration for 20261027000116_island_blocks.sql
--
-- Drops the island's time-block doors. Blocks planned, edited or ticked from
-- the island stay as written, like any web edit.

drop function if exists public.os_island_block_patch(uuid, timestamptz, jsonb);
drop function if exists public.os_island_block_create(date, text, text, text);
drop function if exists public.os_island_blocks(date);
drop function if exists private.os_island_block_fit(date, text, text, uuid);
drop function if exists private.os_island_block_row(public.os_entries);
