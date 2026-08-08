-- Down-migration for 20260807000061_kgr_process_seed_v2.
--
-- Removes the ENTIRE KGR chain, not just the five steps v0.2 added. The
-- up-migration is a replacement: it deleted v0.1 and inserted v0.2, so there
-- is no v0.1 left underneath to fall back to and nothing here can restore it.
--
-- TO GET BACK TO v0.1, run this file and then 20260807000060 — whose own
-- one-shot guard passes once these deletes have left zero KGR steps. That is
-- the whole reason 60 is kept in the repo unedited rather than replaced in
-- place: it is still the executable definition of the shape it seeded.
--
-- Order matters and mirrors the up-migration. Steps cascade to needs and to
-- os_process_step_items; gates are referenced BY steps, so gates go after
-- steps. Every statement is scoped to entity_code = 'KGR', so SAMB and ARBI
-- cannot be reached from here.
--
-- What this does NOT touch, deliberately:
--   os_finish_line_entities   the KGR row stays. It was added by
--                             20260807000059 and owns the Matrix column and
--                             49 cells; unwinding a process seed must not
--                             remove an entity from the Finish line.
--   os_finish_line_cells      the 49 KGR cells stay `undefined`.
--   os_process_step_items     empty for KGR either way — no bridge was ever
--                             authored, so there is nothing to unwind.
--
-- After running this the Swimlane entity picker drops back to SAMB and ARBI,
-- because it is built from `distinct entity_code` over os_process_steps. That
-- is correct behaviour, not a regression.

delete from public.os_process_steps  where entity_code = 'KGR';
delete from public.os_process_gates  where entity_code = 'KGR';
delete from public.os_process_phases where entity_code = 'KGR';
delete from public.os_process_lanes  where entity_code = 'KGR';
delete from public.os_process_tracks where entity_code = 'KGR';
