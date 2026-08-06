-- Down-migration for 20260806000051_samb_process_seed.
-- Empties the SAMB process map: the step → Finish line bridge, needs, steps,
-- phases, gates, lanes. DESTROYS HAND-ENTERED requested_on DATES and any
-- hand-authored bridge edges — those exist nowhere else; export
-- os_process_needs and os_process_step_items first if either has ever been
-- edited. Touches no os_finish_line_* row: every FK points AT the Finish
-- line from this side, so deleting here removes edges only and cannot alter
-- a Finish line row or cell state. Run BEFORE
-- 20260806000050_samb_process_schema_down.sql when unwinding both (that one
-- drops the tables outright, which subsumes this).

delete from public.os_process_step_items;
delete from public.os_process_needs;
delete from public.os_process_steps;
delete from public.os_process_phases;
delete from public.os_process_gates;
delete from public.os_process_lanes;
