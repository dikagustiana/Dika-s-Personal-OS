-- ===========================================================================
-- MAM & KGR AS ENTITIES: two new Finish line columns, every cell undefined.
-- ===========================================================================
-- The Working Trial Balance (30 June 2026) carries seven entity columns:
-- SAMB, ASI, ARBI, KNI, KDU, MAM, KGR. The matrix carried five. This adds
-- MAM and KGR to os_finish_line_entities — sort_order continuing the
-- workbook's column order — and creates their cells against the 49 metric
-- rows that already exist: 98 new cells, 49 x 7 = 343 in total after this.
--
-- WHY undefined AND NOT zero. `zero` asserts the value is genuinely nil.
-- These 98 (line item x entity) pairs have not been examined at all, and
-- `undefined` is the state that says so. SAMB's `COGS — Logistic provider`
-- cell sat at `zero` while twelve of its closing conditions read BELUM, and
-- it scanned as finished — that mistake is not being repeated 98 cells at a
-- time. `note` stays empty for the same reason: nothing is known yet.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO:
--   * No accounts. os_finish_line_accounts stays at its five entities — the
--     33 MAM/KGR workbook accounts land only after the owner's decision on
--     the row reconciliation (reported separately, decided by the owner).
--   * No metric rows added or renamed. Same reconciliation, same owner.
--   * No os_entity_members rows. Nobody is granted MAM or KGR by default;
--     both columns stay owner-only until provisioned through the panel.
--   * No process chain. MAM stays out of the Swimlane picker (it is built
--     from distinct entity_code over os_process_steps); KGR's chain is its
--     own seed, after this file.
--
-- Cells are created for kind='metric' rows only, matching the existing
-- 245 = 49 x 5. The write guard on os_finish_line_cells fires BEFORE UPDATE
-- only, so these INSERTs do not pass through it; actor_kind is NOT NULL
-- with no default and is supplied as 'owner', like the 245 rows it joins.
--
-- Idempotent on stable keys — entities on the PK (code), cells on the
-- unique (item_id, entity_code) — not on editable text, so a re-run inserts
-- nothing and edits nothing. Contains no financial figures.
--
-- Down-migration:
-- supabase/migrations/down/20260807000059_mam_kgr_entities_down.sql

-- 1. The two entities, continuing the workbook's column order after KDU (5).
insert into public.os_finish_line_entities (code, label, sort_order) values
  ('MAM', 'MAM', 6),
  ('KGR', 'KGR', 7)
on conflict (code) do nothing;

-- 2. Their cells: 49 metric rows x 2 entities = 98, all undefined, no note.
insert into public.os_finish_line_cells (item_id, entity_code, state, note, actor_kind)
select i.id, e.code, 'undefined', null, 'owner'
from public.os_finish_line_items i
cross join (values ('MAM'), ('KGR')) as e(code)
where i.kind = 'metric'
on conflict (item_id, entity_code) do nothing;
