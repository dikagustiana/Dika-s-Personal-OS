-- ===========================================================================
-- KGR TRADING CHAIN: TEN STEPS ON THE SOURCING TRACK THE BUSINESS RUNS TODAY.
-- ===========================================================================
-- The RPA chain documents the business that does not operate yet; trading —
-- buy the finished good when an order needs it — is the one that does. Ten
-- steps, entity KGR, track TRADING, form null. Slots 1–10 DELIBERATELY
-- collide with RPA slots: os_process_steps has no unique (slot, lane_key)
-- and stacking is documented behaviour. Under the TRADING filter only these
-- render at 1–10; under RPA only the slaughter chain; unfiltered they stack.
--
-- Labels T1..T10 keep clear of the numeric RPA labels under the
-- (entity_code, label) unique. Step names are the owner's, verbatim from the
-- sourcing-split brief — no rewording, no invented steps. Fields the brief
-- does not supply stay empty: co, risk, control and note are null and
-- docs/coa/drivers empty — authored in-app later, not made up here.
-- PRODUKSI carries zero trading steps, and that empty lane is the correct
-- picture.
--
-- GATES: ALL NULL, DELIBERATELY. Gate ids stay consistent with a blocker
-- register maintained outside the app, so no new TBC- numbers are minted
-- here. The brief names two candidate REUSES — T2 → TBC-13
-- (budget/authorisation) and T10 → TBC-24 (stock movement) — to be
-- confirmed, not assumed; they are listed in the PR body with the rest that
-- need register numbers from the owner. KGR gates stay 42.
--
-- NEEDS: thirteen rows, the brief's proposed set verbatim, all BELUM.
-- `kind` is NOT NULL so it is classified here by the register's own
-- taxonomy (price lists and master records → MASTER, policies and
-- thresholds → PARAMETER, per-delivery facts → TRANSAKSI); src and owner
-- stay NULL — proposing owners would be inventing them, and the register
-- edits both in-app. The T10 need is load-bearing: without an origin flag
-- on the stock record, step 18's FIFO cannot keep the two cost bases apart
-- and every downstream margin figure is a blend.
--
-- PHASES: five rows, track TRADING, over the slots a trading walk actually
-- reaches (T1–T10 at 1–10 plus the shared spine at 6, 18, 25–28, 32–38).
-- Slots 19–24 and 29–31 are absent BY DESIGN — no trading step is reachable
-- there, and under the new invariant a scoped ribbon may gap. The ten
-- default (track null) phases are not edited. The brief's prose says six
-- rows and its table lists five; the table is the content and is seeded
-- verbatim — the discrepancy is flagged in the PR body, not resolved here.
--
-- One-shot, guarded: refuses if any KGR TRADING step exists. Applied to
-- live via apply_migration as kgr_trading_seed; this file records it.
-- Contains no financial figures. NEVER apply with `supabase db push`,
-- `migration up`, `db reset`, or `db remote commit`.
--
-- Down-migration:
-- supabase/migrations/down/20260820000088_kgr_trading_seed_down.sql

-- 0. One-shot guard ---------------------------------------------------------
do $$
begin
  if exists (select 1 from public.os_process_steps where entity_code = 'KGR' and track = 'TRADING') then
    raise exception
      'Rantai TRADING KGR sudah terseed. File ini sekali pakai: penjaga section needs mencocokkan teks yang bisa diedit dari app, jadi menjalankannya ulang akan menduplikasi baris tanpa error. Jalankan down-migration lebih dulu kalau benar-benar mau reseed.';
  end if;
end
$$;

-- 1. Steps ------------------------------------------------------------------
insert into public.os_process_steps (entity_code, label, slot, lane_key, track, name) values
  ('KGR', 'T1',  1,  'PURCHASING', 'TRADING', 'Permintaan & rencana beli'),
  ('KGR', 'T2',  2,  'PURCHASING', 'TRADING', 'Keputusan buy & pemilihan pemasok'),
  ('KGR', 'T3',  3,  'PURCHASING', 'TRADING', 'Terbitkan PO barang jadi'),
  ('KGR', 'T4',  4,  'PEMASOK',    'TRADING', 'Kirim barang jadi'),
  ('KGR', 'T5',  5,  'GUDANG',     'TRADING', 'Terima & timbang barang jadi'),
  ('KGR', 'T6',  6,  'QC',         'TRADING', 'QC penerimaan — suhu, kemasan, shelf life, kesesuaian SKU'),
  ('KGR', 'T7',  7,  'VETERINER',  'TRADING', 'Verifikasi NKV, halal & sertifikat kesehatan pemasok'),
  ('KGR', 'T8',  8,  'ACCOUNTING', 'TRADING', 'Hitung landed cost — harga beli, freight, handling'),
  ('KGR', 'T9',  9,  'ACCOUNTING', 'TRADING', 'Nilai persediaan masuk pada landed cost'),
  ('KGR', 'T10', 10, 'GUDANG',     'TRADING', 'Putaway ke pool per stream, tandai asal beli')
on conflict (entity_code, label) do nothing;

-- 2. Needs — the brief's proposed set, all BELUM, resolved to KGR TRADING
--    steps by (entity_code, label) — the entity filter that keeps them off
--    SAMB and ARBI, as every needs seed before this one.
insert into public.os_process_needs (step_id, item, kind, status)
select s.id, v.item, v.kind, 'BELUM'
from (values
  ('T2',  'Price list pemasok per SKU',                              'MASTER'),
  ('T2',  'Daftar pemasok terverifikasi',                            'MASTER'),
  ('T3',  'Format PO barang jadi',                                   'PARAMETER'),
  ('T3',  'Termin & lead time per pemasok',                          'MASTER'),
  ('T5',  'Timbangan terima terkalibrasi',                           'MASTER'),
  ('T5',  'Berat sesuai surat jalan per SKU',                        'TRANSAKSI'),
  ('T6',  'Standar suhu terima per stream',                          'PARAMETER'),
  ('T6',  'Minimum sisa shelf life saat terima',                     'PARAMETER'),
  ('T7',  'Register NKV & sertifikat halal pemasok yang masih berlaku', 'MASTER'),
  ('T8',  'Komponen landed cost yang boleh dikapitalisasi',          'PARAMETER'),
  ('T8',  'Tarif freight per rute',                                  'PARAMETER'),
  ('T9',  'Kebijakan penilaian persediaan barang beli',              'PARAMETER'),
  ('T10', 'Penanda asal (beli vs potong) di master stok',            'MASTER')
) as v(step_label, item, kind)
join public.os_process_steps s on s.entity_code = 'KGR' and s.label = v.step_label
where not exists (
  select 1 from public.os_process_needs n
  where n.step_id = s.id and n.item = v.item
);

-- 3. Trading phases — keyed on geometry AND track, the seed-guard rule with
--    the new column folded in.
insert into public.os_process_phases (entity_code, name, slot_from, slot_to, track)
select 'KGR', v.name, v.slot_from, v.slot_to, 'TRADING'
from (values
  ('PENGADAAN & PENERIMAAN', 1, 18),
  ('PENJUALAN', 25, 28),
  ('PENAGIHAN', 32, 33),
  ('PEMBAYARAN', 34, 35),
  ('PELAPORAN', 36, 38)
) as v(name, slot_from, slot_to)
where not exists (
  select 1 from public.os_process_phases p
  where p.entity_code = 'KGR'
    and p.track = 'TRADING'
    and p.slot_from = v.slot_from
    and p.slot_to = v.slot_to
);

-- 4. Post-conditions --------------------------------------------------------
do $$
declare
  n_steps integer;
  n_trading integer;
  n_needs integer;
  n_phases integer;
  n_gates integer;
begin
  select count(*) into n_steps from public.os_process_steps where entity_code = 'KGR';
  select count(*) into n_trading from public.os_process_steps where entity_code = 'KGR' and track = 'TRADING';
  select count(*) into n_needs from public.os_process_needs n
    join public.os_process_steps s on s.id = n.step_id where s.entity_code = 'KGR' and s.track = 'TRADING';
  select count(*) into n_phases from public.os_process_phases where entity_code = 'KGR' and track = 'TRADING';
  select count(*) into n_gates from public.os_process_gates where entity_code = 'KGR';
  if n_steps <> 48 or n_trading <> 10 or n_needs <> 13 or n_phases <> 5 or n_gates <> 42 then
    raise exception
      'Trading seed gagal post-condition: KGR % step (harus 48), TRADING % (harus 10), needs TRADING % (harus 13), fase TRADING % (harus 5), gate % (harus 42 — tidak ada TBC baru).',
      n_steps, n_trading, n_needs, n_phases, n_gates;
  end if;
end
$$;
