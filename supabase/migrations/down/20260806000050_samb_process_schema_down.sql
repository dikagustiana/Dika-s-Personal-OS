-- Down-migration for 20260806000050_samb_process_schema.
-- DESTROYS THE ENTIRE SAMB PROCESS MAP AND DATA REGISTER, including any
-- hand-entered requested_on dates — those exist nowhere else; export first
-- if any need row has ever been edited. Touches nothing on the Finish line:
-- the FK lives on os_process_needs, so dropping these tables cannot alter
-- os_finish_line_* rows or state.

drop policy if exists "require app key to select" on public.os_process_needs;
drop policy if exists "require app key to insert" on public.os_process_needs;
drop policy if exists "require app key to update" on public.os_process_needs;
drop policy if exists "require app key to delete" on public.os_process_needs;
drop table if exists public.os_process_needs;

drop policy if exists "require app key to select" on public.os_process_steps;
drop policy if exists "require app key to insert" on public.os_process_steps;
drop policy if exists "require app key to update" on public.os_process_steps;
drop policy if exists "require app key to delete" on public.os_process_steps;
drop table if exists public.os_process_steps;

drop policy if exists "require app key to select" on public.os_process_phases;
drop policy if exists "require app key to insert" on public.os_process_phases;
drop policy if exists "require app key to update" on public.os_process_phases;
drop policy if exists "require app key to delete" on public.os_process_phases;
drop table if exists public.os_process_phases;

drop policy if exists "require app key to select" on public.os_process_gates;
drop policy if exists "require app key to insert" on public.os_process_gates;
drop policy if exists "require app key to update" on public.os_process_gates;
drop policy if exists "require app key to delete" on public.os_process_gates;
drop table if exists public.os_process_gates;

drop policy if exists "require app key to select" on public.os_process_lanes;
drop policy if exists "require app key to insert" on public.os_process_lanes;
drop policy if exists "require app key to update" on public.os_process_lanes;
drop policy if exists "require app key to delete" on public.os_process_lanes;
drop table if exists public.os_process_lanes;
