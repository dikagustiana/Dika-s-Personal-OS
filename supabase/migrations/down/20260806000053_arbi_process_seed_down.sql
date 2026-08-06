-- Down-migration for 20260806000053_arbi_process_seed.
-- Empties the ARBI process map only: bridge edges, needs, steps, phases,
-- gates (B01..B12 via entity_code), lanes and tracks that belong to ARBI.
-- DESTROYS HAND-ENTERED requested_on DATES on ARBI needs and any
-- hand-authored ARBI bridge edges — export os_process_needs and
-- os_process_step_items first if either has ever been edited. SAMB rows are
-- untouched: every delete below is scoped by the step's entity or by
-- entity_code. Touches no os_finish_line_* row. Run BEFORE
-- 20260806000052_process_entity_aware_down.sql when unwinding both — the
-- single-entity shape that migration restores cannot hold ARBI's rows.

delete from public.os_process_step_items
where step_id in (select id from public.os_process_steps where entity_code = 'ARBI');

delete from public.os_process_needs
where step_id in (select id from public.os_process_steps where entity_code = 'ARBI');

delete from public.os_process_steps  where entity_code = 'ARBI';
delete from public.os_process_phases where entity_code = 'ARBI';
delete from public.os_process_gates  where entity_code = 'ARBI';
delete from public.os_process_lanes  where entity_code = 'ARBI';
delete from public.os_process_tracks where entity_code = 'ARBI';
