-- Down-migration for 20260807000063_widen_account_key_and_load_poultry.
--
-- ===========================================================================
-- THE ORDER IS LOAD-BEARING AND IT IS THE REVERSE OF THE UP-MIGRATION.
-- ===========================================================================
-- Restoring the narrow key WHILE the 66 rows are present fails, and fails
-- correctly: the narrow key cannot distinguish MAM's copy of a chart line from
-- KGR's, so the 33 pairs are duplicates under it. That is the entire reason
-- the key was widened. So the rows go first, then the key.
--
-- Reversing these two steps produces
--
--   ERROR: could not create unique index "os_finish_line_accounts_natural_key"
--   DETAIL: Key (...)=(5100004, 5.7.01.0001, COGS Live Bird) is duplicated.
--
-- which is recoverable but alarming; doing it in this order never raises it.
--
-- SAFE ONLY WHILE THE 66 ARE UNTOUCHED. They land with business null and
-- cell_id null by design. The delete below matches on entity_code, so it
-- cannot tell a row someone has since mapped from a freshly loaded one. Check
-- first:
--
--   select count(*) from public.os_finish_line_accounts
--   where entity_code in ('MAM','KGR') and (business is not null or cell_id is not null);
--
-- Anything but zero means someone has done mapping work and this file is the
-- wrong tool.
--
-- Touches no cell, no item, no account_map row, and no os_process_* table.

-- 1. The 66 rows. Scoped to the two entities, so the other 560 are untouched.
delete from public.os_finish_line_accounts
where entity_code in ('MAM', 'KGR');

-- 2. Drop the widened key, found by column set rather than by name — the same
--    reasoning as the up-migration: a name is not a contract.
do $$
declare idx record;
begin
  for idx in
    select i.relname
    from pg_index ix
    join pg_class i on i.oid = ix.indexrelid
    join pg_class t on t.oid = ix.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'os_finish_line_accounts'
      and ix.indisunique and not ix.indisprimary
      and pg_get_indexdef(ix.indexrelid) like '%entity_code%'
      and pg_get_indexdef(ix.indexrelid) like '%coa_entity%'
      and pg_get_indexdef(ix.indexrelid) like '%coa_consol%'
      and pg_get_indexdef(ix.indexrelid) like '%account_name%'
  loop
    execute format('drop index public.%I', idx.relname);
    raise notice 'dropped widened account key: %', idx.relname;
  end loop;
end
$$;

-- 3. Restore the narrow key exactly as 20260728000029 created it, name and
--    all, so a replay of that migration's `if not exists` stays a no-op.
create unique index if not exists os_finish_line_accounts_natural_key
  on public.os_finish_line_accounts
     (coalesce(coa_entity, ''), coalesce(coa_consol, ''), account_name);

-- 4. cell_id is computed in exactly one place; run it so nothing is left
--    pointing at a row that no longer exists.
select public.os_finish_line_remap_accounts();
