-- Down-migration for 20260807000062_poultry_rows.
--
-- Unwinds Paket D in the mirror order: accounts, then the mapping, then the
-- rows (whose cells cascade), then the ordering.
--
-- Returns os_finish_line_items to 55 and os_finish_line_cells to 343 — the
-- state migration 20260807000059 left. os_finish_line_accounts is untouched
-- at 560 throughout, because the up-migration never added to it.
--
-- The up-migration loaded NO accounts (its section 5 explains why), so there
-- is no account delete here. If accounts for MAM or KGR have since been loaded
-- by a later migration, unwind that one first — deleting the account_map rows
-- below while accounts point at them would leave those accounts unmapped
-- rather than removed, which is a quieter mess than a failure.

-- 1. The mapping. Scoped to the two poultry pairs by name, so the 50 rows that
--    were there before cannot be reached.
delete from public.os_finish_line_account_map
where function = 'COGS' and business in ('Poultry Processing', 'Poultry Trading');

-- 2. The four rows. Cells cascade on item_id, taking the 28 with them, so
--    there is no separate cell delete and none is wanted — a manual one could
--    orphan a row from its cells.
delete from public.os_finish_line_items
where kind = 'metric'
  and item in ('Sales — Poultry processing', 'Sales — Poultry trading',
               'COGS — Poultry processing', 'COGS — Poultry trading');

-- 3. Close the gap the insert opened, exactly inverting the up-migration's
--    shift: what became 106..110 goes back to 104..108, and 113..127 back to
--    109..123.
update public.os_finish_line_items
   set sort_order = case when sort_order between 106 and 110 then sort_order - 2
                         else sort_order - 4 end
 where kind = 'metric' and sort_order between 106 and 127;

-- 4. cell_id is computed in exactly one place; run it so nothing is left
--    pointing at a cell that no longer exists.
select public.os_finish_line_remap_accounts();
