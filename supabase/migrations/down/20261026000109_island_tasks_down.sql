-- Down-migration for 20261026000109_island_tasks.sql
--
-- Drops the island's three RPCs, its helpers and its token table, in reverse
-- order. The tasks the island created are ordinary os_entries rows and stay:
-- they belong to the owner, not to the island, and the SPA reads them the
-- same as any task it wrote itself. Dropping the token table revokes every
-- island token at once; the island answers with "token rejected".

drop function if exists public.os_island_task_patch(uuid, timestamptz, jsonb);
drop function if exists public.os_island_task_create(text, text, date);
drop function if exists public.os_island_tasks(timestamptz);
drop function if exists private.os_island_task_row(public.os_entries);
drop function if exists private.os_island_token_check(text);
drop function if exists private.os_island_token_mint(text, text);
drop table if exists private.os_island_tokens;
