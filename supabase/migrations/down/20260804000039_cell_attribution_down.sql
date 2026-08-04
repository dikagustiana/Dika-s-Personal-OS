-- Down-migration for 20260804000039_cell_attribution.
-- Restores the pre-attribution cells table: no trigger, client-written
-- updated_at, no actor columns. DESTROYS the history table and every audit
-- row in it — that is what removing an audit trail means; export it first if
-- it must survive.

drop trigger if exists os_finish_line_cells_write_guard on public.os_finish_line_cells;
drop function if exists public.os_finish_line_cells_write_guard();

drop policy if exists "owner reads history" on public.os_finish_line_cell_history;
drop table if exists public.os_finish_line_cell_history;

drop index if exists public.os_finish_line_cells_actor_idx;
alter table public.os_finish_line_cells drop constraint if exists os_finish_line_cells_actor_kind_chk;
alter table public.os_finish_line_cells drop column if exists actor_kind;
alter table public.os_finish_line_cells drop column if exists actor;
alter table public.os_finish_line_cells drop column if exists changed_at;
