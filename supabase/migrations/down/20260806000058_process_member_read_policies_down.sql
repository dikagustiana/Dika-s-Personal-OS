-- Down-migration for 20260806000058_process_member_read_policies.
--
-- Run this FIRST when unwinding, BEFORE
-- 20260806000057_grant_member_entities_to_anon_down.sql. These eight policies
-- are the only reason `anon` ever calls os_member_entities(), so they have to
-- go before the grant does; reversing the order reproduces the outage the two
-- up-migrations exist to document.
--
-- Returns all nine os_process_* tables to the owner-only baseline: the four
-- `require app key to …` policies per table, untouched throughout, exactly as
-- migrations 20260806000050 and 20260806000052 left them. Contributors lose
-- the process map entirely and the app renders it as zero rows without error
-- — which is the empty-state contract FinishLineSwimlane and FinishLineNeeds
-- hold, and which the per-role suite pins.
--
-- os_process_text_history is absent from this list because it was never given
-- a member policy. See the up-migration's header for why.
--
-- Drops nothing else: no table, no function, no grant, and no row.

drop policy if exists "member reads own-entity rows"   on public.os_process_steps;
drop policy if exists "member reads own-entity rows"   on public.os_process_lanes;
drop policy if exists "member reads own-entity rows"   on public.os_process_phases;
drop policy if exists "member reads own-entity rows"   on public.os_process_tracks;
drop policy if exists "member reads own-entity gates"  on public.os_process_gates;
drop policy if exists "member reads own-entity needs"  on public.os_process_needs;
drop policy if exists "member reads own-entity bridge" on public.os_process_step_items;
drop policy if exists "member reads references"        on public.os_process_references;
