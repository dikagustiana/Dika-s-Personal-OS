-- ===========================================================================
-- THE ACCOUNT NATURAL KEY LEARNS entity_code, AND THE 66 POULTRY ROWS LAND.
-- ===========================================================================
-- Migration 20260807000062 stopped short of loading these: the natural key
-- created by 20260728000029 is
--
--   unique (coalesce(coa_entity,''), coalesce(coa_consol,''), account_name)
--
-- and it does not include entity_code, which arrived later in 20260728000033
-- and never prompted a revisit. One chart entry therefore could not be stated
-- to belong to two entities.
--
-- TWO THINGS FROM THAT REPORT WERE WRONG, AND THE CORRECTION MATTERS.
--   1. coa_entity was never missing from the workbook — it was stripped when
--      the companion file was cleaned of figures. All 33 rows carry one,
--      5100001..5100034, thirty-three distinct values.
--   2. "33 accounts belong to MAM and KGR" came from reading a filled column
--      as ownership. Every one of the 33 is ZERO in both columns at
--      30 June 2026, so a filled column proves nothing about ownership, and
--      the workbook has not decided whose chart this is.
--
-- The conclusion survives both corrections, for a better reason than the one
-- originally given: 33 DISTINCT coa_entity values appearing under two entity
-- columns means MAM and KGR draw on ONE SOURCE CHART. The app stores accounts
-- as detail beneath a cell, and cells exist per (item, entity) — so the same
-- chart line must be representable twice, once per entity. A key without
-- entity_code cannot express that. Widen it.
--
-- ===========================================================================
-- NOTHING USES THIS KEY AS A CONFLICT TARGET. CHECKED, NOT ASSUMED.
-- ===========================================================================
-- The whole repo and every database function were searched:
--   os_finish_line_remap_accounts()  the only DB function touching the table;
--                                    it UPDATEs cell_id and has no on-conflict
--                                    and no reference to the key columns.
--   supabaseRepository.ts            the account paste splits its work into
--                                     by id and a plain
--                                    . No onConflict anywhere.
--   share-view/index.ts              read-only select.
--   collab_rls.sql                   a single-column test insert.
--
-- So import idempotency has never rested on this key. It rests on the app
-- carrying uid=0(root) gid=0(root) groups=0(root) for existing rows and deleting before insert in replace mode,
-- with the unique index acting purely as a GUARD that throws on an accidental
-- duplicate. Widening therefore changes no upsert behaviour — it only relaxes
-- what the guard rejects, which is exactly the intent. Worth knowing, because
-- it means the guard is the only thing standing between a careless re-import
-- and duplicate rows.
--
-- WIDENING ONLY RELAXES, so no existing row can break: every pair the old key
-- separated is still separated by the new one, which is the old columns plus a
-- prefix. Proven by counting 560 before and after rather than by reasoning.
--
-- business, driver_type, driver_source, data_ideal and pic stay NULL. The
-- extract does not carry them and inventing a workbook fact is the rule these
-- columns have been empty under since 20260728000029. The consequence is
-- visible and intended: these 66 land UNMAPPED (cell_id null), joining the 4
-- already unmapped by design, for 70 total.
--
-- Applied to live via apply_migration. NEVER apply with `supabase db push`,
-- `migration up`, `db reset`, or `db remote commit`.
--
-- Down-migration:
-- supabase/migrations/down/20260807000063_widen_account_key_and_load_poultry_down.sql

-- 1. Drop the old key, found BY ITS COLUMN SET rather than by its name -------
-- Naming is not a contract; the column set is. Same approach the entity-aware
-- migration used on os_process_steps. The loop also means a differently-named
-- copy of the same index cannot survive.
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
      and pg_get_indexdef(ix.indexrelid) like '%coa_entity%'
      and pg_get_indexdef(ix.indexrelid) like '%coa_consol%'
      and pg_get_indexdef(ix.indexrelid) like '%account_name%'
      and pg_get_indexdef(ix.indexrelid) not like '%entity_code%'
  loop
    execute format('drop index public.%I', idx.relname);
    raise notice 'dropped narrow account key: %', idx.relname;
  end loop;
end
$$;

-- 2. The widened key ---------------------------------------------------------
-- coalesce() throughout for the same reason the original had it: these columns
-- are nullable and NULL never equals NULL in a unique index, so without it two
-- rows with a null coa_entity would not be compared at all.
create unique index if not exists os_finish_line_accounts_natural_key_v2
  on public.os_finish_line_accounts
     (coalesce(entity_code, ''), coalesce(coa_entity, ''), coalesce(coa_consol, ''), account_name);

-- 3. The 66 rows -------------------------------------------------------------
-- 33 chart lines x 2 entities. on conflict names the NEW key's expression, so
-- running this twice is a no-op rather than a duplicate — which is the whole
-- reason step 2 comes first.
insert into public.os_finish_line_accounts
  (entity_code, coa_entity, coa_consol, account_name, function, nature,
   business, cell_id, sort_order)
select e.code, v.coa_entity, v.coa_consol, v.account_name, v.function, v.nature,
       null, null, v.sort_order
from (values
  ('5100004', '5.7.01.0001', 'COGS Live Bird', 'COGS', 'Cost of Sales - Inventory', 1),
  ('5100005', '5.7.01.0002', 'COGS Other Products', 'COGS', 'Cost of Sales - Inventory', 2),
  ('5100001', '5.7.01.0003', 'COGS - KGR', 'COGS', 'Cost of Sales - Inventory', 3),
  ('5100008', '5.7.04.0001', 'Other COGS Packaging', 'COGS', 'Packing Material', 4),
  ('5100033', '5.7.08.0001', 'Rugi Repricing Persediaan', 'COGS', 'Inventory Adjustment', 5),
  ('5100034', '5.7.08.0002', 'Write-off Persediaan Harian', 'COGS', 'Inventory Adjustment', 6),
  ('5100012', '5.7.10.0001', 'Other COGS - Storage Expenses', 'COGS', 'DC & Logistic', 7),
  ('5100013', '5.7.10.0002', 'Other COGS - Handling In', 'COGS', 'DC & Logistic', 8),
  ('5100014', '5.7.10.0003', 'Other COGS - Handling Out', 'COGS', 'DC & Logistic', 9),
  ('5100003', '5.7.10.0004', 'OTHER COGS - Logistic Cost - KGR', 'COGS', 'DC & Logistic', 10),
  ('5100032', '5.7.11.0001', 'Biaya Langsung Lain per Batch', 'COGS', 'Other COGS / Misc', 11),
  ('5100009', '5.7.26.0001', 'Other COGS Blasting', 'COGS', 'Blasting/Freezing', 12),
  ('5100006', '5.7.30.0001', 'Other COGS Labor', 'COGS', 'Manpower Cost', 13),
  ('5100015', '5.7.30.0002', 'TKL Produksi - Tenaga Tetap', 'COGS', 'Manpower Cost', 14),
  ('5100016', '5.7.30.0003', 'TKL Produksi - Tenaga Borongan', 'COGS', 'Manpower Cost', 15),
  ('5100002', '5.7.33.0001', 'OTHER COGS - Freight In - KGR', 'COGS', 'Delivery cost', 16),
  ('5100007', '5.7.33.0002', 'Other COGS Expedition', 'COGS', 'Delivery cost', 17),
  ('5100010', '5.7.33.0003', 'Other COGS Highway, Parking & Oil For Delivery', 'COGS', 'Delivery cost', 18),
  ('5100017', '5.7.40.0001', 'Overhead Produksi Umum Dibebankan - Pool A', 'COGS', 'Applied Overhead - Pool A', 19),
  ('5100018', '5.7.41.0001', 'Overhead Produksi Umum Aktual - Pool A', 'COGS', 'Overhead Aktual - Pool A', 20),
  ('5100019', '5.7.42.0001', 'Selisih Overhead Pool A (Over/Under Applied)', 'COGS', 'Selisih Overhead - Pool A', 21),
  ('5100020', '5.7.43.0001', 'Overhead Pembekuan Dibebankan - Pool B', 'COGS', 'Applied Overhead - Pool B', 22),
  ('5100021', '5.7.44.0001', 'Overhead Pembekuan Aktual - Pool B', 'COGS', 'Overhead Aktual - Pool B', 23),
  ('5100022', '5.7.45.0001', 'Selisih Overhead Pool B (Over/Under Applied)', 'COGS', 'Selisih Overhead - Pool B', 24),
  ('5100023', '5.7.46.0001', 'Separable Cost - Cut-up', 'COGS', 'Separable Cost - Cut-up', 25),
  ('5100024', '5.7.47.0001', 'Separable Cost MDM - TKL', 'COGS', 'Separable Cost - MDM', 26),
  ('5100025', '5.7.47.0002', 'Separable Cost MDM - Listrik', 'COGS', 'Separable Cost - MDM', 27),
  ('5100026', '5.7.47.0003', 'Separable Cost MDM - Depresiasi Mesin', 'COGS', 'Separable Cost - MDM', 28),
  ('5100027', '5.7.47.0004', 'Separable Cost MDM - Biaya Proses Lain', 'COGS', 'Separable Cost - MDM', 29),
  ('5100028', '5.7.48.0001', 'Biaya Kondemnasi', 'COGS', 'Kondemnasi & Waste', 30),
  ('5100029', '5.7.48.0002', 'Biaya Waste Proses', 'COGS', 'Kondemnasi & Waste', 31),
  ('5100030', '5.7.49.0001', 'Susut Proses Cut-up', 'COGS', 'Susut Proses', 32),
  ('5100031', '5.7.49.0002', 'Susut Penyimpanan & Aging', 'COGS', 'Susut Proses', 33)
) as v(coa_entity, coa_consol, account_name, function, nature, sort_order)
cross join (values ('MAM'), ('KGR')) as e(code)
on conflict (coalesce(entity_code, ''), coalesce(coa_entity, ''), coalesce(coa_consol, ''), account_name)
do nothing;

-- 4. Recompute the mapping ---------------------------------------------------
-- cell_id is computed HERE and nowhere else (20260728000029). These 66 carry
-- no business, so they stay unmapped; running it makes that a checked fact.
select public.os_finish_line_remap_accounts();
