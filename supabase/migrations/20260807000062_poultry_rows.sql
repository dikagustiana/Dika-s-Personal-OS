-- ===========================================================================
-- PAKET D: THE FOUR POULTRY ROWS. THE 66 ACCOUNTS ARE BLOCKED — SEE 5.
-- ===========================================================================
-- Acts on the Kelompok 2 decision from the Paket A reconciliation: of the 17
-- workbook labels with no live counterpart, only FIVE are a genuinely new
-- business dimension and eleven are DISAGGREGATIONS of businesses the account
-- map already carries folded into an existing row (Fullfilment and Trucking
-- into Sales/COGS — Logistic provider; Storing, Distribution and Selling per
-- B2B/B2C/General Trade into their aggregates). Adding those eleven would
-- print the same money twice, once per business and once in its total, so
-- they are deliberately NOT added here — that is a readability decision about
-- the Matrix, separate from completeness of the data.
--
-- What lands: the four poultry P&L rows. Sales and Marketing - Poultry is the
-- fifth new-business label and is held back with the other Selling rows, so
-- the split stays on one axis rather than half-applied.
--
-- LABELS FOLLOW THE LIVE HOUSE STYLE, NOT THE WORKBOOK STRING. Live writes
-- "COGS — Logistic provider": em dash, sentence case. The workbook writes
-- "COGS - Poultry Processing". Matching live keeps the Matrix column internally
-- consistent; the workbook string survives in os_finish_line_account_map.business,
-- which is where the mapping is re-run from.
--
-- ===========================================================================
-- THE 66 ACCOUNTS LOAD UNMAPPED, AND THAT IS THE HONEST RESULT.
-- ===========================================================================
-- cell_id is derived from (function, business, entity_code) by
-- os_finish_line_remap_accounts(). All 33 workbook accounts carry
-- function = COGS and NO BUSINESS — the extract does not say which of them is
-- Poultry Processing and which is Poultry Trading, and the workbook's own
-- subtotal list proves it distinguishes the two. Inventing that split would be
-- fabricating a workbook fact, so business stays null and these rows land in
-- the unmapped list, which is exactly what migration 20260728000029 designed
-- the nullable cell_id for: "Unmapped accounts are stored WITH the rest,
-- carrying cell_id is null, and the unmapped list is exactly that query."
--
-- To finish the wiring later, no schema change is needed: add the business
-- column to these 66 rows and run os_finish_line_remap_accounts().
--
-- driver_type, driver_source, data_ideal and pic stay null for the same
-- reason. The workbook owns them and this extract does not carry them.
--
-- Applied to live via apply_migration. NEVER apply with `supabase db push`,
-- `migration up`, `db reset`, or `db remote commit`.
--
-- Down-migration:
-- supabase/migrations/down/20260807000062_poultry_rows_down.sql

-- 1. Make room in the ordering ----------------------------------------------
-- The workbook puts poultry after General Trade and before Logistic Provider,
-- in both the Sales and the COGS block. sort_order is a plain integer the app
-- only ever orders by, so shifting is safe; a single UPDATE evaluates every
-- row against the pre-statement snapshot, so the ranges cannot collide
-- mid-flight.
update public.os_finish_line_items
   set sort_order = case when sort_order between 104 and 108 then sort_order + 2
                         else sort_order + 4 end
 where kind = 'metric' and sort_order between 104 and 123;

-- 2. The four rows -----------------------------------------------------------
insert into public.os_finish_line_items (item, kind, sort_order, status)
select v.item, 'metric', v.sort_order, 'blocked'
from (values
  ('Sales — Poultry processing', 104),
  ('Sales — Poultry trading',    105),
  ('COGS — Poultry processing',  111),
  ('COGS — Poultry trading',     112)
) as v(item, sort_order)
where not exists (
  select 1 from public.os_finish_line_items i
  where i.item = v.item and i.kind = 'metric'
);

-- 3. Their cells: 4 rows x 7 entities = 28, all undefined -------------------
-- `undefined`, never `zero`: nobody has looked at these yet, and a zero that
-- means "not examined" is the mistake the SAMB COGS — Logistic provider cell
-- already made. Same shape as migration 20260807000059.
insert into public.os_finish_line_cells (item_id, entity_code, state, note, actor_kind)
select i.id, e.code, 'undefined', null, 'owner'
from public.os_finish_line_items i
cross join public.os_finish_line_entities e
where i.kind = 'metric'
  and i.item in ('Sales — Poultry processing', 'Sales — Poultry trading',
                 'COGS — Poultry processing', 'COGS — Poultry trading')
on conflict (item_id, entity_code) do nothing;

-- 4. Function x Business -> metric -------------------------------------------
-- COGS only. The extract carries no Sales accounts for MAM or KGR, so a
-- Sales-side function name would have to be guessed; the two Sales rows above
-- stand with no mapping until the workbook supplies one. business keeps the
-- WORKBOOK's spelling because that is the string the remap matches on.
insert into public.os_finish_line_account_map (function, business, item_id)
select v.function, v.business, i.id
from (values
  ('COGS', 'Poultry Processing', 'COGS — Poultry processing'),
  ('COGS', 'Poultry Trading',    'COGS — Poultry trading')
) as v(function, business, item)
join public.os_finish_line_items i on i.item = v.item and i.kind = 'metric'
where not exists (
  select 1 from public.os_finish_line_account_map m
  where m.function = v.function and m.business = v.business
);

-- 5. THE 66 ACCOUNTS ARE NOT HERE, AND THAT IS A BLOCKER, NOT AN OMISSION.
-- ===========================================================================
-- They cannot be loaded from the extract as it stands. os_finish_line_accounts
-- carries a natural key
--
--   unique (coalesce(coa_entity,''), coalesce(coa_consol,''), account_name)
--
-- created by 20260728000029 so a re-import REPLACES rather than merges. It
-- does NOT include entity_code — that column arrived later, in
-- 20260728000033, and the key was never revisited. The key works today only
-- because all 560 existing rows carry a per-entity coa_entity: SAMB's
-- "COGS Live Bird" and ASI's differ by that column, not by entity_code.
--
-- The MAM/KGR extract carries coa_consol only. The workbook states the same 33
-- accounts belong to BOTH entities, so loading 33 x 2 gives two rows with
-- coa_entity null and identical (coa_consol, account_name) — a duplicate-key
-- failure on the first pair. Verified on a throwaway cluster:
--
--   ERROR: duplicate key value violates unique constraint
--          "os_finish_line_accounts_natural_key"
--   DETAIL: Key (..., 5.7.47.0002, Separable Cost MDM - Listrik) already exists.
--
-- Two ways forward, and BOTH ARE THE OWNER'S CALL because this table is owned
-- by the workbook and the app never edits it:
--
--   1. The workbook supplies coa_entity for MAM and KGR. The load then works
--      unchanged, 66 rows, no schema change, re-import contract intact. This
--      is the path consistent with how the other five entities already work.
--   2. Extend the natural key to include entity_code. Defensible — the same
--      consolidation account legitimately exists for two entities — and it
--      only RELAXES the constraint, so no existing row breaks. The risk is
--      the loader: it upserts on this key, and changing the key changes what
--      a re-import replaces.
--
-- Inventing a coa_entity was the third option and is refused: it would be
-- fabricating a workbook fact, the same rule that keeps driver_type,
-- driver_source, data_ideal and pic empty.
--
-- Until one of those lands, os_finish_line_accounts stays at 560 and the four
-- poultry rows above carry no account detail — which the Matrix renders as an
-- empty account list, not as a wrong one.

-- 6. Recompute the mapping ---------------------------------------------------
-- cell_id is computed HERE and nowhere else (20260728000029). Nothing should
-- move: the two new account_map pairs match no account yet, by definition of
-- section 5. Running it makes that a checked fact rather than an assumption.
select public.os_finish_line_remap_accounts();
