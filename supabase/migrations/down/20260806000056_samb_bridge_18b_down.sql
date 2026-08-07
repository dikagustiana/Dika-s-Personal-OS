-- Down-migration for 20260806000056_samb_bridge_18b.
-- Removes exactly one bridge pair: SAMB step 18b → `Sales — Logistic
-- provider`. Scoped by (entity_code, label) AND by the literal item uuid, so
-- it cannot reach 18a, ARBI's steps, or any of the other 45 SAMB pairs — the
-- delete matches at most one row.
--
-- Running this returns `Sales — Logistic provider` to being fed by steps
-- 1, 20 and 21, and returns step 18b to feeding nothing. That is the state
-- the SAMB seed produced, and the state the header of the up-migration
-- argues is inconsistent — so this is an unwind, not a correction.
--
-- Touches no os_finish_line_* row: os_process_step_items is the process
-- feature's own table, and deleting an edge from it cannot change a cell.

delete from public.os_process_step_items
where item_id = '2b7394bf-92f4-4900-b2a6-03353dbe6d98'::uuid
  and step_id in (
    select id from public.os_process_steps
    where entity_code = 'SAMB' and label = '18b'
  );
