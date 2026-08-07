-- ===========================================================================
-- SAMB STEP 18b FEEDS `Sales — Logistic provider`. One bridge pair.
-- ===========================================================================
--
-- ===========================================================================
-- ALREADY APPLIED LIVE. DO NOT APPLY. This file exists to RECORD it.
-- ===========================================================================
-- The pair was written to the database from another session, ledger name
-- `samb_bridge_18b_to_sales_lp`. This file brings the repo level with what
-- the database already holds — the SAMB seed (20260806000051) carries 45
-- bridge pairs, live carries 46, and this is the one.
--
-- The `on conflict do nothing` below makes running it a no-op against data,
-- so nothing breaks if someone does. What DOES break is the record: a second
-- ledger entry for one logical change, and the next session reading that
-- ledger cannot tell which of the two actually did anything. The migration
-- history is the only memory a session without memory has. Leave it alone.
--
-- ===========================================================================
-- WHY THE PAIR BELONGS THERE
-- ===========================================================================
-- Step 18b, "POD & serah terima — barang klien", fed no Finish line row at
-- all, while its twin 18a feeds `Sales — General Trade` as the recognition
-- trigger. The asymmetry was an oversight, not a decision: 18b's own driver
-- reads "SJ terselesaikan per klien → konfirmasi konsumsi layanan", and that
-- confirmation is exactly what feeds the measurement at step 20 and then
-- revenue at step 21. A step whose stated driver is the trigger for a
-- revenue row, attached to no revenue row, is an inconsistency.
--
-- With this pair, `Sales — Logistic provider` is fed by steps 1, 18b, 20
-- and 21.
--
-- ===========================================================================
-- THE FIVE SAMB STEPS THAT STILL FEED NOTHING ARE DELIBERATE. DO NOT BRIDGE.
-- ===========================================================================
--   4, 11, 12  planning, no posting — they shape what happens later but
--              nothing lands in a Finish line row when they happen
--   22         a compliance artefact with no metric attached
--   26         consolidation, which does not map to any single row
-- Bridging any of them would put a step behind a closing condition it cannot
-- actually close, which is worse than the gap.
--
-- Resolved by (entity_code, label) rather than by a hardcoded step uuid: step
-- ids are generated at insert time and differ between the live database and
-- any rebuilt one, while (SAMB, 18b) is stable. The Finish line item is a
-- LITERAL UUID for the opposite reason — three Finish line labels appear
-- twice across sections, so a by-label match would pick the wrong twin.
--
-- Down-migration:
-- supabase/migrations/down/20260806000056_samb_bridge_18b_down.sql

insert into public.os_process_step_items (step_id, item_id)
select s.id, '2b7394bf-92f4-4900-b2a6-03353dbe6d98'::uuid
from public.os_process_steps s
where s.entity_code = 'SAMB' and s.label = '18b'
on conflict (step_id, item_id) do nothing;
