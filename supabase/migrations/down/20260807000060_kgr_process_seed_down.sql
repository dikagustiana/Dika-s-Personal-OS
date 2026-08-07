-- Down-migration for 20260807000060_kgr_process_seed.
-- Empties the KGR process map only: needs, steps, phases, gates
-- (TBC-01..TBC-39, TBC-VOL via entity_code), lanes and tracks that belong
-- to KGR. There are no KGR bridge edges to delete by design — but the first
-- delete still sweeps os_process_step_items through the step join, so any
-- hand-authored edge added after the seed goes with the steps it hangs off.
-- DESTROYS HAND-ENTERED requested_on DATES on KGR needs — export
-- os_process_needs first if it has ever been edited. SAMB and ARBI rows are
-- untouched: every delete below is scoped by the step's entity or by
-- entity_code. Touches no os_finish_line_* row.

delete from public.os_process_step_items
where step_id in (select id from public.os_process_steps where entity_code = 'KGR');

delete from public.os_process_needs
where step_id in (select id from public.os_process_steps where entity_code = 'KGR');

delete from public.os_process_steps  where entity_code = 'KGR';
delete from public.os_process_phases where entity_code = 'KGR';
delete from public.os_process_gates  where entity_code = 'KGR';
delete from public.os_process_lanes  where entity_code = 'KGR';
delete from public.os_process_tracks where entity_code = 'KGR';
