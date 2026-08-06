-- Down-migration for 20260806000051_samb_process_seed.
-- Empties the SAMB process map: needs (cascade from steps), steps, phases,
-- gates, lanes. DESTROYS HAND-ENTERED requested_on DATES and any
-- hand-corrected finish_line_item_id mappings — those exist nowhere else;
-- export os_process_needs first if any row has ever been edited. Touches no
-- os_finish_line_* row: the FK sits on os_process_needs, so deleting here
-- cannot alter Finish line rows or cell state. Run BEFORE
-- 20260806000050_samb_process_schema_down.sql when unwinding both (that one
-- drops the tables outright, which subsumes this).

delete from public.os_process_needs;
delete from public.os_process_steps;
delete from public.os_process_phases;
delete from public.os_process_gates;
delete from public.os_process_lanes;
