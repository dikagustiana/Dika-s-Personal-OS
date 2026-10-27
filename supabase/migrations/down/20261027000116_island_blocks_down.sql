-- Down-migration for 20261027000116_island_blocks.sql
--
-- Drops the island's time-block doors. Blocks ticked from the island stay
-- as written (status done / planned), like any web edit.

drop function if exists public.os_island_block_patch(uuid, timestamptz, boolean);
drop function if exists public.os_island_blocks(date);
drop function if exists private.os_island_block_row(public.os_entries);
