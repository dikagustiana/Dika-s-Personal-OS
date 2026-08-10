-- ===========================================================================
-- KGR: LIMA NEED BARU YANG DIMINTA KEPUTUSAN D4, D5, DAN RISIKO SISA D1.
-- ===========================================================================
-- This is the ONLY structural change in the D1-D5 batch. Adding a need is
-- migration-only — os_process_needs rows are created and destroyed by SQL,
-- never by the app, which can edit a need's text but cannot mint one. So this
-- file is deliberately separate from 20260810000073: that one is text and can
-- be replayed against any v0.2 chain, this one changes what the chain HAS.
--
-- IT LANDS AFTER THE TESTS ON PURPOSE. src/logic/kgrSeedParity.test.ts went in
-- with 73, so by the time this file runs the KGR chain finally has CI. That
-- ordering is the whole point: structure is the layer that can break 38 steps
-- silently, and it should never have been the layer with no coverage.
--
-- WHY THESE FIVE, AND NOT MORE:
--
--   Step 20 gets a back-test and its threshold. This is the residual risk the
--   review closed on. Every allocation ratio is decided by a price vector set
--   internally, and NOTHING in the 38 steps feeds realized prices back to test
--   it. Compare overhead: a wrong Pool A rate surfaces at step 22 as a
--   variance that grows. A wrong reference price surfaces nowhere — it moves
--   cost between SKUs without changing total cost, so no reconciliation ever
--   fails. The pair mirrors step 22's own shape: a measurement plus the
--   threshold that forces action, because a back-test nobody must act on is a
--   report, not a control.
--
--   Step 27 gets the freight cost and the delivery term. D5 put freight-out at
--   step 27 as a SELLING cost — the COA landed in 73, but a COA with no data
--   behind it is a label. The delivery term is its precondition and its
--   reverser in one: if customers collect ex-works, KGR bears no freight and
--   the step 27 COA should go back to empty.
--
--   Step 30 gets the cold storage estimate. D4 made holding a period expense,
--   which means it never enters inventory cost — but the disposition choice at
--   step 30 still has to weigh it, because the blast-freeze path carries it and
--   repricing and write-off do not. Not capitalized is not the same as not
--   relevant.
--
-- WHAT IS NOT HERE. No need was added for separable cost per SKU or for the
-- NRV reference price: those already exist at steps 21 and 20 and are BELUM.
-- The batch adds what has no home, and edits what has one — 73 did the latter.
--
-- COUNTS MOVE: KGR goes from 117 needs to 122, ADA 9 · SEBAGIAN 34 ·
-- BELUM 74 becomes ADA 9 · SEBAGIAN 34 · BELUM 79. The header of
-- 20260807000061 still describes what THAT file seeds and is left unedited,
-- the house rule for an applied file. Nothing in the app pins a need count —
-- process.ts derives needCount and needBelum from the rows — so no test
-- assertion moves with this. kgrSeedParity.test.ts pins these five by name.
--
-- CONTAINS NO FINANCIAL FIGURES.
--
-- APPLIED TO LIVE as one ledger entry: kgr_decision_needs. Verified after:
-- 122 needs with 79 BELUM, against 117 and 74 before — five added, none
-- edited. Steps, gates and phases unmoved at 38 / 42 / 10.
--
-- Down-migration:
-- supabase/migrations/down/20260810000074_kgr_decision_needs_down.sql

-- 0. Shape guard -------------------------------------------------------------
do $$
declare
  step_count int;
begin
  select count(*) into step_count from public.os_process_steps where entity_code = 'KGR';
  if step_count <> 38 then
    raise exception
      'Rantai % berisi % step, bukan 38. File ini menambah need ke slot 20, 27, dan 30 pada bentuk v0.2; periksa kenapa bentuknya berubah sebelum melanjutkan.', 'KGR', step_count;
  end if;
end
$$;

-- 1. The five needs ----------------------------------------------------------
-- Idempotent on (step_id, item), the same guard shape the seed uses. Re-running
-- inserts nothing rather than duplicating, which matters because item is
-- app-editable: once someone rewords one of these, the guard stops matching it
-- and a replay WOULD duplicate. Check before replaying.
insert into public.os_process_needs (step_id, item, kind, src, owner, status)
select s.id, v.item, v.kind, v.src, v.owner, v.status
from (values
  -- D1's residual risk: the price vector has no feedback loop.
  ('20', 'Back-test harga referensi terhadap harga jual terealisasi per SKU per periode', 'TRANSAKSI', 'Sub-ledger penjualan vs Daftar Harga Jual Referensi NRV', 'Manajer Accounting', 'BELUM'),
  ('20', 'Ambang penyimpangan harga referensi vs terealisasi yang wajib revisi', 'PARAMETER', 'Kebijakan internal', 'Manajer Accounting + Manajer Operasional', 'BELUM'),
  -- D5: freight-out has a COA as of migration 73; this is the data behind it.
  ('27', 'Biaya angkut keluar per pengiriman — armada sendiri atau jasa pihak ketiga/entity grup', 'TRANSAKSI', 'Belum ada — sumbernya mengikuti keputusan armada', 'Manajer Accounting + Manajer Operasional', 'BELUM'),
  ('27', 'Syarat penyerahan per pelanggan — franco gudang pembeli atau ambil sendiri', 'MASTER', 'Kontrak pelanggan', 'Sales + Manajer Accounting', 'BELUM'),
  -- D4: expensed, but still decision-relevant at the disposition call.
  ('30', 'Estimasi biaya simpan cold storage per satuan waktu — input keputusan disposisi, bukan biaya persediaan', 'PARAMETER', 'Estimasi teknik — pecahan cold storage dari TBC-17', 'Teknik + Manajer Accounting', 'BELUM')
) as v(step_label, item, kind, src, owner, status)
join public.os_process_steps s on s.entity_code = 'KGR' and s.label = v.step_label
where not exists (
  select 1 from public.os_process_needs n
  where n.step_id = s.id and n.item = v.item
);
