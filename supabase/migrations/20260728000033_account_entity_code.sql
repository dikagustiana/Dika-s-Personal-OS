-- ===========================================================================
-- AN ACCOUNT GETS ITS OWN ENTITY, AND THE REMAP FUNCTION STOPS BEING A TRAP.
-- ===========================================================================
-- os_finish_line_remap_accounts() is documented as the blessed way to
-- re-resolve account-to-cell mapping after editing the mapping table. It
-- joined the cell's entity_code against accounts.coa_entity — but coa_entity
-- holds a chart-of-accounts number, never an entity code, so the join could
-- never match. Measured in a rolled-back transaction before this migration:
-- mapped 0, unmapped 560. Running it for real would have stripped cell_id
-- from every mapped account and emptied the whole Finish line. Nothing calls
-- it, so there was no passive danger — it sat there as a trap documented as
-- safe, which is the most dangerous state a function can be in.
--
-- The root cause is a missing column: the account row never stored its
-- entity. The workbook's Entity column resolved cell_id at load time and was
-- then discarded. That works for mapped accounts, because the cell carries
-- the entity, and fails for anything without a cell — which is also why the
-- unmapped accounts reached no screen.
--
-- Three steps, in order: add the column, backfill it losslessly from the
-- cells, then repair the function to join on it.

-- 1. The column ----------------------------------------------------------
alter table public.os_finish_line_accounts
  add column if not exists entity_code text;

comment on column public.os_finish_line_accounts.entity_code is
  'The consolidation entity this account belongs to. Distinct from coa_entity, '
  'which is a chart-of-accounts number. Set from the workbook Entity column on '
  'paste; backfilled from the cell for rows loaded before this column existed. '
  'Null means the account has no entity recorded and must be classified in the '
  'workbook — surfaced in the unmapped list, never guessed at.';

-- 2. Backfill, losslessly ------------------------------------------------
-- Only from the cell, which is authoritative for a mapped account's entity.
-- Rows with no cell keep null: their entity exists only in the workbook, and
-- inferring it from the COA number — which does encode one by convention —
-- would embed a guess in data that then looks authoritative.
update public.os_finish_line_accounts a
   set entity_code = c.entity_code
  from public.os_finish_line_cells c
 where a.cell_id = c.id
   and a.entity_code is distinct from c.entity_code;

-- 3. Repair the function -------------------------------------------------
-- The ONLY change is the join column: c.entity_code = a.entity_code, where
-- it read a.coa_entity. Everything else — the two-statement shape, the
-- null-out pass, the returned counts, the search_path — is untouched.
--
-- An account with a null entity_code can never match, which is correct: it
-- has no entity, so no cell can claim it, and it stays unmapped rather than
-- being attached to an arbitrary entity's cell.
create or replace function public.os_finish_line_remap_accounts()
returns table(mapped bigint, unmapped bigint)
language plpgsql
set search_path to 'public'
as $function$
begin
  update public.os_finish_line_accounts a
     set cell_id = c.id
    from public.os_finish_line_account_map m
    join public.os_finish_line_cells c on c.item_id = m.item_id
   where a.function = m.function
     and a.business = m.business
     and c.entity_code = a.entity_code
     and a.cell_id is distinct from c.id;

  update public.os_finish_line_accounts a
     set cell_id = null
   where a.cell_id is not null
     and not exists (
       select 1
         from public.os_finish_line_account_map m
         join public.os_finish_line_cells c on c.item_id = m.item_id
        where a.function = m.function
          and a.business = m.business
          and c.entity_code = a.entity_code
          and c.id = a.cell_id
     );

  return query
    select count(*) filter (where cell_id is not null),
           count(*) filter (where cell_id is null)
      from public.os_finish_line_accounts;
end
$function$;
