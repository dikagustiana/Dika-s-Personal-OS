-- ===========================================================================
-- KGR RPHU PROCESS: SEED. Data only — needs the entity-aware schema
-- (20260806000052) and the KGR entity row (20260807000059), both live.
-- ===========================================================================
-- Contents come verbatim from the curated seed kgr-process-seed.json,
-- derived from SOP Siklus Operasional dan Keuangan v2.1 (composed and
-- revised outside the app; there is deliberately no importer, no export UI
-- and no in-app structure editor). Counts are fixed: 9 lanes (PEMASOK and
-- VETERINER external), 3 tracks (FRESH 2 · FROZEN 1 · KEDUANYA 30 over the
-- steps), 10 phases tiling slots 1..33 exactly once, 40 gates, 33 steps,
-- 101 needs (ADA 8 · SEBAGIAN 32 · BELUM 61), 0 stacked cells. Contains no
-- financial figures.
--
-- THE GATES ARE THE SOP'S OWN [TBC] REGISTER, id TBC-01..TBC-39 and
-- TBC-VOL. Sixteen are referenced by no step — TBC-02, 04, 05, 08, 12, 17,
-- 18, 19, 21, 29, 30, 31, 32, 38, 39 and TBC-VOL — and that is correct, the
-- same convention as SAMB's G03/G07/G09 and ARBI's B12: the register stays
-- aligned with the SOP even where this model (one gate per step) cannot
-- attach a gate, and some of those are cross-SOP (TBC-32 appears in 1.9,
-- 6.4 and 7.4). TBC-13 and TBC-14 are each carried by two steps, which the
-- schema allows: the constraint is one gate per step, not one step per gate.
--
-- NO BRIDGE ROWS, DELIBERATELY. os_process_step_items stays empty for KGR:
-- all 33 KGR workbook accounts are Function COGS with a poultry business,
-- and the row they would anchor to (COGS - Poultry Processing) does not
-- exist in os_finish_line_items yet — it is Kelompok 2 of the reconciliation
-- report, an owner decision. Until then the closing-conditions block simply
-- does not render for KGR cells, which is the correct pre-decision state.
--
-- THE TRACK SHAPE IS HONEST AND NEARLY USELESS AS A FILTER, and it is
-- seeded as-is: FRESH filters to 32 of 33 steps, FROZEN to 31, because at
-- KGR fresh and frozen are two INVENTORY POOLS, not two process paths — one
-- live bird in, one carcass out, split into many SKUs, all entering the
-- fresh pool; frozen is born at steps 25–26 from unsold fresh, then both
-- share the same sales, AR, AP and reporting spine. Whether track should
-- become a tag instead of a filter (or KGR should carry no track at all) is
-- an open owner decision recorded in the PR, not taken here.
--
-- ONE-SHOT, GUARDED AT THE TOP — the ARBI lesson verbatim: the needs guard
-- below matches on (step_id, item) and the item text is app-editable since
-- 20260806000055, so re-running an applied seed would silently duplicate
-- edited rows. If KGR steps exist, this file refuses and rolls back.
--
-- Applied to live via the Supabase apply_migration tool (ledger name
-- kgr_process_seed); this file records it. NEVER apply with
-- `supabase db push`, `migration up`, `db reset`, or `db remote commit` —
-- repo filenames and the live ledger are different numbering schemes, and
-- any of those replays history from zero against production data.
--
-- Down-migration:
-- supabase/migrations/down/20260807000060_kgr_process_seed_down.sql

-- 0. One-shot guard ---------------------------------------------------------
do $$
begin
  if exists (select 1 from public.os_process_steps where entity_code = 'KGR') then
    raise exception
      'Rantai proses % sudah terseed. File ini sekali pakai: penjaga section needs mencocokkan teks yang bisa diedit dari app, jadi menjalankannya ulang akan menduplikasi baris tanpa error. Jalankan down-migration lebih dulu kalau benar-benar mau reseed.', 'KGR';
  end if;
end
$$;

-- 1. Tracks -----------------------------------------------------------------
insert into public.os_process_tracks (entity_code, code, label, ordinal, is_shared) values
  ('KGR', 'FRESH', 'FRESH', 1, false),
  ('KGR', 'FROZEN', 'FROZEN', 2, false),
  ('KGR', 'KEDUANYA', 'BERSAMA', 3, true)
on conflict (entity_code, code) do nothing;

-- 2. Lanes ------------------------------------------------------------------
insert into public.os_process_lanes (entity_code, key, label, description, ordinal, is_external) values
  ('KGR', 'PEMASOK', 'PEMASOK', 'Pemasok live bird — pihak ketiga', 1, true),
  ('KGR', 'PURCHASING', 'PURCHASING', 'Rencana & order live bird', 2, false),
  ('KGR', 'OPERASIONAL', 'OPERASIONAL', 'Jadwal, keputusan, dan otorisasi operasional', 3, false),
  ('KGR', 'GUDANG', 'GUDANG', 'Terima, timbang, simpan, pick, kirim', 4, false),
  ('KGR', 'VETERINER', 'VETERINER', 'Gate kesmavet — dokter hewan berwenang', 5, true),
  ('KGR', 'PRODUKSI', 'PRODUKSI', 'Lini potong, halal, chilling, cut-up', 6, false),
  ('KGR', 'QC', 'QC', 'Pemeriksaan mutu & sanitasi', 7, false),
  ('KGR', 'SALES', 'SALES', 'Order, pengiriman, penagihan awal', 8, false),
  ('KGR', 'ACCOUNTING', 'ACCOUNTING', 'Costing, AP/AR, pelaporan', 9, false)
on conflict (entity_code, key) do nothing;

-- 3. Gates ------------------------------------------------------------------
insert into public.os_process_gates (id, type, title, sub, owner, unblock, entity_code) values
  ('TBC-01', 'DECISION', 'EOD Cutoff — batas akhir penjualan fresh harian', 'Pemicu seluruh SOP 9', 'Direktur + Manajer Operasional', 'Tanpa jam pasti, EOD stock count tidak punya titik mulai dan keputusan disposisi bergeser tiap hari.', 'KGR'),
  ('TBC-02', 'DECISION', 'Lead time pengadaan H-3 / H-2', 'SOP 1.4', 'Manajer Operasional', 'Tetapkan jarak hari yang mengikat antara identifikasi kebutuhan, penerbitan PO, dan jadwal potong.', 'KGR'),
  ('TBC-03', 'DECISION', 'Shelf life fresh (jam) dan ambang aging frozen (hari)', 'SOP 2.4, 4.4', 'Manajer Operasional + QC', 'Menentukan kapan produk wajib keluar dari pool fresh dan kapan frozen masuk uji penurunan nilai.', 'KGR'),
  ('TBC-04', 'DECISION', 'Ambang deviasi yield yang wajib berita acara', 'default 5% relatif', 'Manajer Operasional', 'Di bawah ambang, deviasi lewat tanpa investigasi; di atas, costing tidak boleh difinalisasi.', 'KGR'),
  ('TBC-05', 'DECISION', 'Ambang write-off yang wajib eskalasi Direktur', 'SOP 9', 'Direktur', 'Menentukan siapa yang menanggung keputusan kerugian sisa fresh.', 'KGR'),
  ('TBC-06', 'DECISION', 'Kriteria Layak Blast Freeze — ambang suhu produk', 'SOP 9.4', 'Manajer Operasional + QC', 'Empat kriteria sudah ada; ambang suhunya belum. Tanpa itu keputusan blast freeze jadi penilaian orang.', 'KGR'),
  ('TBC-07', 'DECISION', 'Harga Jual Referensi NRV per SKU, terpisah fresh dan frozen', 'Basis alokasi joint cost', 'Manajer Operasional + Manajer Accounting', 'Ini penentu Allocation Ratio di 7 langkah. Salah di sini, seluruh cost per kg per SKU salah.', 'KGR'),
  ('TBC-08', 'DECISION', 'Format Batch ID', 'SOP 1.3', 'Manajer Accounting + IT', 'Batch ID mengikat PO, timbang masuk lini, yield, costing, dan inventory. Format harus mencegah pemakaian ulang.', 'KGR'),
  ('TBC-09', 'DECISION', 'Materialitas selisih rekonsiliasi yang wajib dijelaskan', 'SOP 8.4', 'Manajer Accounting', 'Tanpa ambang, setiap selisih setara — atau tidak ada yang ditelusuri.', 'KGR'),
  ('TBC-10', 'DECISION', 'Kebijakan provisi piutang formal', 'Sementara: 50% di 91–180 hari', 'Manajer Accounting + Direktur', 'Kebijakan sementara sudah jalan; yang formal belum ditetapkan.', 'KGR'),
  ('TBC-11', 'DECISION', 'Payment terms per pelanggan', 'SOP 6.4', 'Sales + Manajer Accounting', 'Menentukan tanggal jatuh tempo, dan tanpa itu AR aging tidak punya dasar.', 'KGR'),
  ('TBC-12', 'DECISION', 'Batas diskon minimum terhadap HPP', 'SOP 9 repricing', 'Direktur', 'Repricing tanpa batas bawah bisa menjual di bawah biaya tanpa terlihat.', 'KGR'),
  ('TBC-13', 'DECISION', 'Matriks otorisasi PO dan pembayaran', 'SOP 1.4, 7.4', 'Direktur', 'Satu matriks untuk dua siklus; belum ditetapkan nilainya.', 'KGR'),
  ('TBC-14', 'DECISION', 'Tanggal close bulanan dan tenggat submission', 'SOP 8.4', 'Group Project Finance', 'Menentukan seluruh tenggat H+1 sampai H+5 di siklus pelaporan.', 'KGR'),
  ('TBC-15', 'DATA', 'Volume normal bulanan (kg berat hidup) — denominator tarif overhead', 'P2. Indikasi RAB C4.4 tidak konsisten dengan kapasitas terpasang', 'Manajer Operasional + PF', 'Sumber yang benar adalah demand plan, bukan kapasitas terpasang. SOP 2.3 melarang pakai kapasitas terpasang. Tanpa ini seluruh cost per kg tercemar.', 'KGR'),
  ('TBC-16', 'DATA', 'Porsi biaya refrigerasi yang dipisah ke Pool B', 'P1 internal ABF', 'Manajer Accounting + teknik', 'Pool B dibebankan langsung ke SKU frozen; porsinya belum dipisah dari listrik total.', 'KGR'),
  ('TBC-17', 'DATA', 'Estimasi teknik listrik ABF dan cold storage', 'Lampiran C', 'Teknik + Manajer Accounting', 'Komponen Pool B yang belum terukur.', 'KGR'),
  ('TBC-18', 'DECISION', 'Masa amortisasi perlengkapan di bawah threshold kapitalisasi', 'P3, maksimal 12 bulan sejalan masa sewa', 'Manajer Accounting', 'Seluruh item B2 tidak didepresiasi; masa amortisasinya belum dipatok.', 'KGR'),
  ('TBC-19', 'DECISION', 'Ambang mortalitas holding yang jadi write-off', 'SOP 1.7, 2.8', 'Manajer Operasional', 'Memisahkan susut normal yang melebur ke cost dari kerugian yang jadi beban periode.', 'KGR'),
  ('TBC-20', 'DECISION', 'Parameter teknis lini — pemuasaan, scalding, chilling', 'SOP 2.4', 'Supervisor Produksi + QC', 'Jadwal dan suhu belum dipatok, padahal keduanya menentukan yield dan risiko kontaminasi.', 'KGR'),
  ('TBC-21', 'DATA', 'Izin lingkungan dan pengelola limbah berizin', 'SOP 2.4 sub-prosedur limbah', 'Manajer Operasional', 'Manifest limbah dan IPAL harus terkait izin yang sah.', 'KGR'),
  ('TBC-22', 'DECISION', 'Ambang DOA saat penerimaan yang wajib klaim', 'SOP 1.4', 'Manajer Operasional', 'Menentukan kapan klaim ke pemasok wajib diajukan.', 'KGR'),
  ('TBC-23', 'DECISION', 'Ambang penyimpangan cost per kg vs 3 batch terakhir', 'SOP 3.4', 'Manajer Accounting', 'Pemicu investigasi sebelum batch difinalisasi.', 'KGR'),
  ('TBC-24', 'DECISION', 'Ambang discrepancy stok fisik vs sistem', 'SOP 4.7', 'Kepala Gudang', 'Menentukan kapan selisih harian dieskalasi.', 'KGR'),
  ('TBC-25', 'DECISION', 'Frekuensi dan target suhu cold storage & kendaraan chilled', 'SOP 4.7, 5.4', 'QC + Manajer Operasional', 'Pemantauan suhu tanpa target bukan pengendalian.', 'KGR'),
  ('TBC-26', 'DECISION', 'Kanal resmi penerimaan pesanan pelanggan', 'SOP 5.2', 'Manajer Sales', 'Order dari kanal tidak resmi tidak punya jejak dan tidak bisa direkonsiliasi.', 'KGR'),
  ('TBC-27', 'DECISION', 'Pejabat berwenang menyetujui surat jalan', 'SOP 5.4', 'Direktur', 'Barang keluar gudang tanpa otorisasi yang jelas.', 'KGR'),
  ('TBC-28', 'DECISION', 'Batas waktu penerbitan invoice setelah BST', 'SOP 5.4', 'Manajer Accounting', 'Menentukan jarak antara barang diterima pelanggan dan piutang tercatat.', 'KGR'),
  ('TBC-29', 'DECISION', 'Tenggat penyelesaian selisih rekonsiliasi AP', 'SOP 7.4', 'Manajer Accounting', 'Selisih dengan supplier statement tanpa tenggat mengendap.', 'KGR'),
  ('TBC-30', 'DECISION', 'Tenggat EOD — serah stock count dan rekonsiliasi kas', 'SOP 9.4', 'Manajer Operasional', 'Menentukan apakah settlement selesai pada hari yang sama.', 'KGR'),
  ('TBC-31', 'DECISION', 'Mekanisme review Yield Benchmark', 'SOP 2.3', 'Manajer Operasional + Manajer Accounting', 'Benchmark yang tidak pernah ditinjau berubah jadi target, bukan pembanding.', 'KGR'),
  ('TBC-32', 'DECISION', 'Ambang KPI dan mekanisme persetujuan perubahan SOP', 'tersebar di 1.9, 6.4, 7.4', 'Direktur', 'Beberapa KPI dan jadwal mingguan memakai penanda yang sama; perlu dipecah dan dipatok.', 'KGR'),
  ('TBC-33', 'DECISION', 'Sumber dokter hewan berwenang — Dinas via kontrak sewa atau rekrut sendiri', 'P5. Payroll RAB belum memuat dokter hewan', 'Direktur + Manajer Operasional', 'Dua gate veteriner tidak bisa dijalankan tanpa petugas berwenang. Ini gap SDM, bukan administratif.', 'KGR'),
  ('TBC-34', 'DECISION', 'Basis Yield Daging — karkas utuh / parting / boneless, sebelum atau sesudah chilling', 'P4. Angka 57% hanya indikatif', 'Manajer Operasional + Manajer Accounting', 'Basis menentukan arti angka 57%. Benchmark hanya boleh dikunci setelah validasi 5 batch pertama.', 'KGR'),
  ('TBC-35', 'DECISION', 'Ambang kondemnasi normal', 'SOP 2.4', 'Manajer Operasional + Veteriner', 'Di bawah ambang melebur ke joint cost; di atas jadi beban periode. Bucket tidak boleh dilebur ke Waste.', 'KGR'),
  ('TBC-36', 'DECISION', 'Ambang susut berat holding yang normal', 'SOP 2.4', 'Manajer Operasional', 'Di bawah ambang melebur ke cost per kg; di atas wajib berita acara.', 'KGR'),
  ('TBC-37', 'DECISION', 'Interval review kebutuhan harian', 'SOP 1.2', 'Manajer Operasional', 'Identifikasi kebutuhan tanpa interval tetap bergantung ingatan orang.', 'KGR'),
  ('TBC-38', 'DECISION', 'Nilai PO yang wajib co-approval Manajer Accounting', 'SOP 1.4', 'Direktur', 'Live bird ±89% total biaya batch; ambang co-approval belum ditetapkan.', 'KGR'),
  ('TBC-39', 'DECISION', 'Prasyarat go-live keputusan parameter', 'Penutup', 'Direktur', 'Beberapa parameter ditandai prasyarat go-live tanpa daftar yang mengikat.', 'KGR'),
  ('TBC-VOL', 'DATA', 'Volume budgeted yang direkonsiliasi dengan RAB dan kapasitas', 'P2, kembar dengan TBC-15', 'PF + Manajer Operasional', 'Indikasi kapasitas di RAB tidak konsisten dengan kapasitas terpasang dan wajib direkonsiliasi.', 'KGR')
on conflict (id) do nothing;

-- 4. Phases -----------------------------------------------------------------
insert into public.os_process_phases (entity_code, name, slot_from, slot_to)
select 'KGR', v.name, v.slot_from, v.slot_to
from (values
  ('PENGADAAN LIVE BIRD', 1, 6),
  ('PRODUKSI & YIELD', 7, 13),
  ('PERSEDIAAN MASUK', 14, 15),
  ('COSTING BATCH', 16, 18),
  ('REVALUASI', 19, 19),
  ('PENJUALAN', 20, 23),
  ('EOD SETTLEMENT', 24, 26),
  ('PENAGIHAN', 27, 28),
  ('PEMBAYARAN', 29, 30),
  ('PELAPORAN', 31, 33)
) as v(name, slot_from, slot_to)
-- KEYED ON GEOMETRY, NOT ON THE NAME — name is editable from the app since
-- 20260806000055; slot_from/slot_to are not, and a phase IS its span.
where not exists (
  select 1 from public.os_process_phases p
  where p.entity_code = 'KGR'
    and p.slot_from = v.slot_from
    and p.slot_to = v.slot_to
);

-- 5. Steps ------------------------------------------------------------------
insert into public.os_process_steps (entity_code, label, slot, lane_key, co, track, name, risk, control, note, gate_id, docs, coa, drivers) values
  ('KGR', '1', 1, 'PURCHASING', 'Staff Purchasing', 'KEDUANYA', 'Identifikasi kebutuhan & rencana pembelian',
   'Kebutuhan diidentifikasi tanpa interval tetap sehingga bergantung ingatan orang; proyeksi penjualan tidak dikonfirmasi Sales sehingga volume beli tidak berdasar.',
   'Review harian terjadwal atas laporan stok dan proyeksi terkini; rencana pembelian dikonfirmasi Manajer Operasional pada hari yang sama.',
   'DI SINI SUMBER TBC-15 SEHARUSNYA LAHIR. Denominator tarif overhead adalah volume normal bulanan, dan sumber yang benar adalah demand plan — bukan kapasitas terpasang, yang justru dilarang SOP 2.3. Hari ini demand plan hanya satu baris di SOP 1.2 tanpa sub-proses, tanpa daftar dokumen, dan tanpa RACI.',
   'TBC-37', '["Laporan stok harian","Sales Forecast Mingguan","Rencana pembelian"]'::jsonb, '[]'::jsonb, '["Proyeksi kebutuhan kg berat hidup H-3","Volume normal bulanan → denominator tarif overhead"]'::jsonb),
  ('KGR', '2', 2, 'PURCHASING', 'Staff Purchasing', 'KEDUANYA', 'Terbit PO & Batch ID, review anggaran',
   'PO di luar batas otorisasi; Batch ID duplikat atau dipakai ulang sehingga costing dua batch tercampur.',
   'PO disetujui sesuai matriks otorisasi; review anggaran Manajer Accounting tertulis pada lembar PO; sistem mencegah pemakaian ulang Batch ID yang sudah close.',
   'Batch ID diterbitkan di sini dan hanya diaktifkan saat penerimaan — tidak diterbitkan ulang. Dia yang mengikat PO, timbang masuk lini, yield, costing, dan inventory jadi satu rantai yang bisa dilacak.',
   'TBC-13', '["Purchase Order (memuat Batch ID)","Daftar Pemasok Aktif","Lembar Review PO Manajer Accounting"]'::jsonb, '[]'::jsonb, '["Nilai PO → matriks otorisasi","Batch ID → pengikat seluruh siklus"]'::jsonb),
  ('KGR', '3', 3, 'PEMASOK', 'Pemasok live bird', 'KEDUANYA', 'Kirim live bird',
   'Kiriman datang di luar jadwal yang disepakati sehingga live bird menunggu di kendaraan dan mortalitas naik sebelum penerimaan.',
   'Konfirmasi tertulis H-1 memuat jumlah ekor, estimasi berat, waktu tiba, dan Batch ID.',
   'Lane eksternal. KGR tidak mengendalikan langkah ini, tapi mutu dan ketepatan waktunya menentukan DOA dan susut holding di hilir.',
   null, '["Surat Jalan Pemasok","Konfirmasi pengiriman tertulis"]'::jsonb, '[]'::jsonb, '["Jumlah ekor & estimasi berat kiriman"]'::jsonb),
  ('KGR', '4', 4, 'GUDANG', 'Staff Gudang', 'KEDUANYA', 'Terima & timbang live bird',
   'Selisih berat aktual vs surat jalan tidak terdeteksi sehingga tagihan melebihi barang yang benar-benar diterima.',
   'Toleransi timbang ≤ 2%; selisih di atas 2% dieskalasi ke Manajer Operasional dan dikonfirmasi ke pemasok pada hari yang sama untuk keputusan pengurangan tagihan.',
   'Toleransi 2% sudah ditetapkan di SOP, jadi ini salah satu kontrol yang sudah punya angka — beda dari sebagian besar ambang lain yang masih TBC.',
   null, '["Berita Acara Penerimaan Live Bird","Surat Jalan Pemasok","Catatan timbangan terkalibrasi"]'::jsonb, '[{"code":"Persediaan","label":"Persediaan Live Bird / WIP per Batch"}]'::jsonb, '["Berat aktual diterima → dasar nilai persediaan","Selisih timbang vs surat jalan"]'::jsonb),
  ('KGR', '5', 5, 'QC', 'Staff QC / Operasional', 'KEDUANYA', 'Quality check & verifikasi DOA',
   'DOA dicatat tanpa ambang sehingga klaim ke pemasok bergantung inisiatif; live bird tidak layak lolos ke holding dan mati sebelum potong.',
   'Quality check wajib sebelum penerimaan final; penolakan disertai berita acara dua pihak; DOA di atas ambang dilaporkan hari yang sama untuk keputusan klaim.',
   'DOA saat penerimaan diposting di SOP 1; mortalitas selama holding diposting di SOP 2. Keduanya beban periode — tidak dilebur ke cost per kg. Batas peristiwanya sengaja dipisah.',
   'TBC-22', '["Form Quality Check Live Bird","Berita Acara Retur atau Penolakan"]'::jsonb, '[{"code":"Beban","label":"Beban Kerugian Persediaan — DOA"}]'::jsonb, '["Tingkat DOA → klaim ke pemasok","Berat/ekor ditolak"]'::jsonb),
  ('KGR', '6', 6, 'ACCOUNTING', 'Staff Accounting', 'KEDUANYA', 'Catat utang usaha atau accrual',
   'Utang dicatat melebihi penerimaan aktual; accrual tidak diselesaikan saat invoice datang sehingga dobel tercatat.',
   'Finance hanya mencatat berdasarkan BA Penerimaan bertandatangan; clearing accrual mengikuti pola akun asal (Dr Akrual / Cr Utang Usaha) di SOP 7; accrual belum selesai masuk AP reconciliation bulanan.',
   'Live bird ±89% total biaya batch dan dibebankan langsung ke batch — tidak pernah lewat overhead pool. Kesalahan di sini tidak bisa diserap alokasi.',
   null, '["Invoice Pemasok","Faktur Pajak","BA Penerimaan bertandatangan"]'::jsonb, '[{"code":"Persediaan","label":"Persediaan Live Bird / WIP per Batch"},{"code":"Neraca","label":"Utang Usaha Pemasok Live Bird"},{"code":"Neraca","label":"Akrual Biaya Pembelian Live Bird — bila invoice belum diterima"}]'::jsonb, '["Nilai aktual diterima setelah koreksi berat, retur, dan klaim"]'::jsonb),
  ('KGR', '7', 7, 'PRODUKSI', 'Supervisor Produksi', 'KEDUANYA', 'Pemuasaan & sanitasi pra-operasi',
   'Lini jalan sebelum sanitasi lulus; pemuasaan tidak terjadwal sehingga isi saluran cerna menaikkan risiko kontaminasi saat eviscerasi dan yield bergerak tanpa sebab yang bisa dilacak.',
   'Lini tidak boleh jalan sebelum sanitasi pra-operasi lulus dan terdokumentasi; jadwal pemuasaan dicatat per batch.',
   'Pemuasaan bukan formalitas: dia menurunkan risiko kontaminasi dan menstabilkan yield. Jadwal spesifiknya belum dipatok, jadi salah satu variabel yang menggerakkan benchmark masih bebas.',
   'TBC-20', '["Catatan Holding per Batch","Checklist sanitasi pra-operasi","Catatan kalibrasi alat"]'::jsonb, '[{"code":"Overhead","label":"Overhead Produksi — Pool A"}]'::jsonb, '["Jam pemuasaan → stabilitas yield"]'::jsonb),
  ('KGR', '8', 8, 'VETERINER', 'Dokter hewan berwenang', 'KEDUANYA', 'Inspeksi antemortem — gate kesmavet 1',
   'Gate dijalankan tanpa petugas berwenang sehingga status halal dan kesmavet tidak punya dasar; ternak tidak layak masuk lini.',
   'Ternak tidak layak dipisahkan sebelum lini; hasil inspeksi dicatat per batch dan ditandatangani petugas berwenang.',
   'Ini gap SDM, bukan administratif. Payroll RAB saat ini tidak memuat dokter hewan, sementara dua gate veteriner adalah syarat NKV. Tanpa keputusan sumbernya, gate ini ada di SOP tapi tidak ada di lapangan.',
   'TBC-33', '["Form Antemortem per Batch"]'::jsonb, '[]'::jsonb, '["Ekor layak potong vs ditunda vs ditolak"]'::jsonb),
  ('KGR', '9', 9, 'GUDANG', 'Staff Gudang', 'KEDUANYA', 'Timbang masuk lini',
   'Berat masuk lini tidak ditimbang terpisah sehingga yield dihitung dari berat terima — susut holding tersembunyi di dalam yield dan terlihat seperti masalah proses.',
   'Timbang masuk lini pada timbangan terkalibrasi per Batch ID; selisih terhadap berat terima dicatat sebagai susut holding; di atas ambang wajib berita acara.',
   'ANGKA PALING PENTING DI SELURUH RANTAI. Kg berat hidup masuk lini adalah basis seluruh persentase yield DAN denominator applied overhead Pool A. Satu angka, dua kegunaan — dan kalau tidak ditimbang terpisah, dua-duanya salah bersamaan.',
   'TBC-36', '["Catatan Timbang Masuk Lini per Batch"]'::jsonb, '[]'::jsonb, '["Kg berat hidup masuk lini → BASIS YIELD dan denominator Pool A"]'::jsonb),
  ('KGR', '10', 10, 'PRODUKSI', 'Juleha + Penyelia Halal', 'KEDUANYA', 'Pemotongan halal, bleeding, scalding, plucking, eviscerasi',
   'Karkas masuk tahap berikutnya sebelum kematian sempurna diverifikasi sehingga status halal gugur; kontaminasi silang antara area kotor dan bersih.',
   'Karkas tidak boleh lanjut sebelum kematian sempurna diverifikasi dan dicatat per shift oleh Penyelia Halal; pemisahan alur, alat, dan personel antara area kotor dan area bersih.',
   'Urutan lini di SOP bersifat wajib, bukan anjuran. Verifikasi kematian sempurna adalah satu-satunya kontrol yang kegagalannya tidak bisa diperbaiki di hilir — produk sudah tidak halal dan tidak ada rework.',
   null, '["Catatan verifikasi kematian sempurna per shift","Catatan downtime lini","Log suhu proses"]'::jsonb, '[{"code":"Overhead","label":"Overhead Produksi — Pool A"},{"code":"WIP","label":"Tenaga Kerja Langsung per Batch"}]'::jsonb, '["Jam kerja langsung per shift → TKL per batch"]'::jsonb),
  ('KGR', '11', 11, 'VETERINER', 'Petugas veteriner', 'KEDUANYA', 'Inspeksi post-mortem & kondemnasi — gate kesmavet 2',
   'Kondemnasi dilebur ke bucket Waste sehingga hilang sebagai informasi dan tidak bisa dibedakan dari susut proses; pemusnahan tanpa berita acara veteriner.',
   'Kondemnasi dipisahkan ke wadah khusus berlabel dan dicatat per Batch ID; pemusnahan dengan berita acara ditandatangani petugas veteriner dan Supervisor Produksi.',
   'Kondemnasi punya bucket sendiri dan TIDAK dilebur ke Waste — itu keputusan yang sudah dikunci di SOP. Di bawah ambang normal dia melebur ke joint cost batch (mengurangi output); di atas ambang jadi beban periode.',
   'TBC-35', '["Form Post-mortem & Kondemnasi per Batch","Berita Acara Pemusnahan","Manifest Limbah"]'::jsonb, '[{"code":"Beban","label":"Beban Kondemnasi di atas batas normal — beban periode"}]'::jsonb, '["Kg kondemnasi → bucket tersendiri, bukan Waste"]'::jsonb),
  ('KGR', '12', 12, 'PRODUKSI', 'Supervisor Produksi', 'KEDUANYA', 'Chilling, cut-up, grading & timbang output per SKU',
   'Suhu inti tidak mencapai target dalam jendela waktu sehingga shelf life fresh berkurang tanpa tercatat; berat output per SKU ditimbang tidak independen.',
   'Penimbangan output per SKU oleh penimbang fisik independen pada timbangan terkalibrasi; suhu inti dan jendela waktu chilling dipantau dan dicatat.',
   'DI SINI SATU BATCH PECAH JADI BANYAK SKU. Semua SKU keluar dari satu input yang sama, jadi tidak ada biaya yang bisa ditelusuri langsung ke satu SKU — itu sebabnya alokasi NRV di SOP 3 diperlukan, bukan dipilih.',
   'TBC-03', '["Catatan suhu inti karkas","Timbangan output per SKU","Label tanggal produksi & kedaluwarsa"]'::jsonb, '[{"code":"Overhead","label":"Overhead Produksi — Pool A"}]'::jsonb, '["Kg aktual per SKU → basis 7 langkah NRV","Shelf life per stream → label kedaluwarsa"]'::jsonb),
  ('KGR', '13', 13, 'OPERASIONAL', 'Manajer Operasional', 'KEDUANYA', 'Verifikasi yield terhadap benchmark',
   'Benchmark dipakai sebagai target dan bukan pembanding sehingga deviasi ditutup di lapangan; costing difinalisasi di atas yield yang belum diinvestigasi.',
   'Deviasi di atas ambang wajib Berita Acara Deviasi Yield dan investigasi internal sebelum costing difinalisasi; Yield Report final ditandatangani Manajer Operasional dan direview analitis Finance.',
   'Angka 57% untuk Daging hanya indikatif dan basisnya belum ditetapkan — jadi persentase itu belum punya arti yang bisa diuji. SOP sudah benar menahannya: benchmark hanya dikunci setelah validasi 5 batch pertama. Yield Report final adalah sinyal formal bahwa costing boleh mulai.',
   'TBC-34', '["Yield Report final bertandatangan","Berita Acara Deviasi Yield"]'::jsonb, '[]'::jsonb, '["% aktual per kategori vs Yield Benchmark","Deviasi relatif per kategori"]'::jsonb),
  ('KGR', '14', 14, 'GUDANG', 'Staff Gudang', 'FRESH', 'Inventory receipt ke pool Fresh',
   'Receipt dicatat tanpa Batch ID sehingga traceability ke batch dan ke costing terputus; estimated cost tidak pernah di-true-up.',
   'Batch ID wajib pada setiap inventory receipt; nilai memakai estimated cost sampai costing SOP 3 final, lalu di-true-up.',
   'Produk masuk pool Fresh dulu — semuanya. Frozen tidak lahir di sini; dia lahir di SOP 9 dari sisa fresh yang tidak terjual. Itu sebabnya seluruh output awal ber-track FRESH.',
   null, '["Inventory receipt per SKU per Batch ID"]'::jsonb, '[{"code":"Persediaan","label":"Persediaan Barang Jadi — pool Fresh, estimated cost"}]'::jsonb, '["Kg per SKU masuk pool fresh"]'::jsonb),
  ('KGR', '15', 15, 'GUDANG', 'Staff Gudang', 'KEDUANYA', 'Daily stock movement & FIFO per stream',
   'Mutasi tidak dicatat per stream sehingga fresh dan frozen bercampur dan FIFO tidak bisa ditegakkan; discrepancy harian tanpa ambang mengendap sampai opname bulanan.',
   'Mutasi dicatat real-time per transaksi dengan Batch ID, SKU, dan stream; FIFO per stream; discrepancy di atas ambang dilaporkan ke Kepala Gudang hari yang sama.',
   'Dua pool, dua FIFO. Fresh berurutan berdasarkan batch produksi; frozen berdasarkan tanggal blast freeze. Mencampur keduanya membuat aging frozen tidak bisa dihitung.',
   'TBC-24', '["Daily Stock Movement Report","Kartu stok per Batch ID"]'::jsonb, '[]'::jsonb, '["Mutasi harian per stream","FIFO per stream"]'::jsonb),
  ('KGR', '16', 16, 'ACCOUNTING', 'Cost Accounting', 'KEDUANYA', 'Buka batch costing sheet & akumulasi biaya',
   'Tarif overhead dihitung atas kapasitas terpasang dan bukan volume normal sehingga cost per kg tercemar di seluruh SKU; overhead aktual dibebankan langsung ke batch tanpa akun kontrol.',
   'Denominator wajib volume normal/budgeted bulanan, bukan kapasitas terpasang; overhead aktual dikumpulkan di akun kontrol dan direkonsiliasi terpisah, tidak dibebankan langsung ke batch.',
   'SOP 2.3 MELARANG memakai kapasitas terpasang sebagai denominator, dan indikasi RAB C4.4 tidak konsisten dengan kapasitas itu. Jadi angka yang benar hanya bisa datang dari demand plan — dan demand plan itulah yang belum punya sub-proses di SOP 1.',
   'TBC-15', '["Batch Costing Sheet","Rekap Biaya Konversi","Catatan jam kerja / output shift"]'::jsonb, '[{"code":"WIP","label":"WIP per Batch — live bird cost"},{"code":"WIP","label":"WIP per Batch — TKL"},{"code":"Overhead","label":"Applied Overhead Pool A = tarif × kg masuk lini"}]'::jsonb, '["Tarif Pool A × kg berat hidup masuk lini","TKL dari catatan shift"]'::jsonb),
  ('KGR', '17', 17, 'ACCOUNTING', 'Cost Accounting', 'KEDUANYA', 'NRV-based joint costing — 7 langkah',
   'Harga referensi tidak diperbarui sehingga Allocation Ratio menyimpang dari nilai jual sebenarnya dan cost per kg salah di seluruh SKU sekaligus; by-product diberi nilai nol tanpa dasar.',
   'Harga referensi diperbarui minimal bulanan sebelum closing, bertanggal efektif, disetujui bersama Manajer Operasional dan Manajer Accounting, terpisah fresh dan frozen; nilai nol wajib dokumentasi alasan dan persetujuan formal.',
   'Bucket Kondemnasi dan Waste TIDAK menerima alokasi — zero NRV. Dan applied overhead Pool B tidak masuk Total Joint Cost di langkah 4 dan 6; dia dibebankan langsung ke SKU frozen berdasarkan kg aktual yang dibekukan. Kalau Pool B ikut dilebur, SKU fresh menanggung biaya pembekuan yang tidak pernah dia pakai.',
   'TBC-07', '["Batch Costing Sheet","Daftar Harga Jual Referensi NRV per SKU","Yield Report final"]'::jsonb, '[{"code":"WIP","label":"Allocated Joint Cost per SKU"}]'::jsonb, '["Allocation Ratio = NRV SKU ÷ Total NRV Batch","Cost per Kg per SKU = Allocated Joint Cost ÷ berat aktual SKU"]'::jsonb),
  ('KGR', '18', 18, 'ACCOUNTING', 'Manajer Accounting', 'KEDUANYA', 'Review kewajaran & finalisasi batch',
   'Batch difinalisasi dengan cost per kg yang menyimpang tanpa investigasi; selisih rekonsiliasi dibiarkan tidak nol sehingga sub-ledger dan GL bercabang.',
   'Gate checklist wajib lengkap sebelum finalisasi: invoice atau accrual ada, Yield Report final bertandatangan termasuk bucket Kondemnasi, dan Rekap Biaya Konversi ada; selisih rekonsiliasi harus NOL sebelum batch dinyatakan closed.',
   'Selisih rekonsiliasi harus nol — bukan di bawah materialitas, tapi nol. Itu ambang yang lebih keras dari biasanya, dan benar untuk costing per batch: batch yang closed tidak bisa dibuka lagi tanpa merusak traceability.',
   'TBC-23', '["Gate checklist finalisasi","Rekonsiliasi costing sheet vs sub-ledger vs GL"]'::jsonb, '[]'::jsonb, '["Cost per kg vs 3 batch terakhir","Margin penjualan aktual batch sebelumnya"]'::jsonb),
  ('KGR', '19', 19, 'ACCOUNTING', 'Staff Accounting', 'KEDUANYA', 'Update nilai persediaan ke aktual & true-up COGS',
   'Nilai persediaan tertinggal di estimated cost sehingga neraca dan HPP dua-duanya salah; true-up tidak dilakukan atas unit yang sudah terjual sebelum costing final.',
   'Revaluasi dan true-up dijalankan segera setelah costing final; keduanya direkonsiliasi ke GL sebelum closing.',
   'Produk sudah bisa dijual sebelum costing-nya final — itu kenyataan operasional, bukan kelemahan. Yang penting true-up-nya dijalankan, karena tanpa itu HPP unit yang terjual paling awal tidak pernah dikoreksi.',
   null, '["Jurnal revaluasi persediaan","Jurnal true-up COGS"]'::jsonb, '[{"code":"Persediaan","label":"Persediaan Barang Jadi — dari estimated ke actual cost"},{"code":"HPP","label":"True-up HPP unit yang sudah terjual"}]'::jsonb, '["Selisih estimated vs actual cost per SKU"]'::jsonb),
  ('KGR', '20', 20, 'SALES', 'Admin Sales', 'KEDUANYA', 'Order masuk & stock availability check per stream',
   'Order diterima lewat kanal tidak resmi sehingga tidak punya jejak; order fresh dikonfirmasi tanpa memeriksa sisa shelf life sehingga tidak bisa dipenuhi.',
   'Stock availability check pada pool sesuai stream sebelum order dikonfirmasi: fresh terhadap produksi hari berjalan dan sisa shelf life jam, frozen terhadap stok cold storage dan aging.',
   'Pemeriksaan ketersediaan fresh berbeda mendasar dari frozen: fresh dibatasi jam, frozen dibatasi aging. Satu prosedur tidak bisa melayani keduanya.',
   'TBC-26', '["Sales Order","Stock Availability Check per stream"]'::jsonb, '[]'::jsonb, '["Order per stream","Sisa shelf life fresh saat order"]'::jsonb),
  ('KGR', '21', 21, 'GUDANG', 'Staff Gudang', 'KEDUANYA', 'Picking FIFO per stream, packing & surat jalan',
   'Barang keluar gudang tanpa otorisasi yang jelas; Batch ID tidak dicantumkan sehingga traceability dari pelanggan kembali ke batch terputus.',
   'Surat jalan disetujui pejabat berwenang sebelum barang keluar; Batch ID wajib tercantum; picking FIFO per stream — fresh dari batch produksi paling awal hari itu, frozen dari tanggal blast freeze paling awal.',
   'Batch ID di surat jalan adalah satu-satunya jalan pulang dari keluhan pelanggan ke batch, yield, dan pemasoknya. Tanpa itu recall tidak bisa dijalankan.',
   'TBC-27', '["Surat Jalan (memuat Batch ID & stream)","Packing list per stream"]'::jsonb, '[]'::jsonb, '["Kg keluar per stream per SKU"]'::jsonb),
  ('KGR', '22', 22, 'SALES', 'Driver / Pengirim', 'KEDUANYA', 'Pengiriman & Bukti Serah Terima',
   'BST tidak diperoleh sebelum driver kembali sehingga penjualan tidak bisa diakui dan piutang tidak punya dasar; rantai dingin terputus dalam perjalanan tanpa tercatat.',
   'BST wajib diperoleh sebelum driver kembali; fresh dikirim dengan kendaraan berpendingin atau boks berinsulasi menjaga suhu chilled; frozen dijaga tetap beku.',
   'BST adalah pemicu pengakuan penjualan dan cut-off bulanan: SOP 8 menyatakan penjualan hanya dicatat di bulan berjalan kalau BST diperoleh sebelum atau pada hari terakhir bulan.',
   'TBC-25', '["Bukti Serah Terima (BST)","Catatan suhu kendaraan"]'::jsonb, '[]'::jsonb, '["Kg terkirim per stream"]'::jsonb),
  ('KGR', '23', 23, 'ACCOUNTING', 'Staff Billing', 'KEDUANYA', 'Terbit invoice',
   'Invoice terbit tanpa BST valid; stream tidak dicantumkan sehingga pendapatan dan HPP tidak bisa dipisah per stream di pelaporan segmental.',
   'Invoice hanya terbit dari BST yang sudah diterima; stream dan Batch ID wajib tercantum pada invoice.',
   'Stream wajib ada di invoice karena SOP 8 menuntut P&L segmental Fresh vs Frozen. Kalau stream tidak dicatat di dokumen sumbernya, laporan segmental hanya bisa diperkirakan.',
   'TBC-28', '["Invoice","Faktur Pajak bila berlaku"]'::jsonb, '[{"code":"Pendapatan","label":"Pendapatan Penjualan — per stream"},{"code":"HPP","label":"HPP — per stream"},{"code":"Neraca","label":"Piutang Usaha"},{"code":"Neraca","label":"PPN keluaran bila berlaku"}]'::jsonb, '["Nilai invoice per stream per SKU"]'::jsonb),
  ('KGR', '24', 24, 'GUDANG', 'Staff Gudang', 'FRESH', 'EOD stock count sisa fresh',
   'Tanpa jam cutoff yang pasti, penghitungan mulai kapan saja dan keputusan disposisi bergeser setiap hari; sisa fresh melewati shelf life sebelum diputuskan.',
   'EOD stock count dimulai pada EOD Cutoff yang ditetapkan; hasil diserahkan ke Manajer Operasional dalam tenggat, lengkap dengan catatan kondisi fisik.',
   'Sisa fresh adalah selisih antara demand plan dan kenyataan, diukur setiap hari. Shelf life fresh dalam hitungan jam, jadi kesalahan demand plan tidak bisa ditunda ke besok — dia langsung jadi keputusan disposisi malam ini.',
   'TBC-01', '["EOD Stock Count Sheet"]'::jsonb, '[]'::jsonb, '["Kg sisa fresh per SKU pada EOD Cutoff"]'::jsonb),
  ('KGR', '25', 25, 'OPERASIONAL', 'Manajer Operasional', 'KEDUANYA', 'Keputusan disposisi — blast freeze, repricing, atau write-off',
   'Keputusan disposisi jadi penilaian orang karena ambangnya belum ada; repricing menjual di bawah HPP tanpa terlihat; write-off diputuskan tanpa eskalasi.',
   'Setiap sisa stok ditetapkan satu dari tiga disposisi dengan dasar tertulis; repricing dalam batas diskon yang disetujui; write-off dengan berita acara dan eskalasi di atas ambang.',
   'DI SINI FRESH BERUBAH JADI FROZEN. Ini satu-satunya titik di seluruh rantai di mana stream berganti, dan itu sebabnya step ini milik kedua jalur. Prosedur darurat blast freezer tidak berfungsi juga di sini: tanpa pembekuan, pilihan tinggal repricing cepat atau write-off.',
   'TBC-06', '["Kriteria Layak Blast Freeze","Repricing Authorization Form","Berita Acara Write-off"]'::jsonb, '[{"code":"Beban","label":"Beban Kerugian Persediaan — write-off"}]'::jsonb, '["Kg per keputusan disposisi"]'::jsonb),
  ('KGR', '26', 26, 'GUDANG', 'Staff Gudang', 'FROZEN', 'Eksekusi blast freeze & applied overhead Pool B',
   'Overhead pembekuan dilebur ke joint cost sehingga SKU fresh menanggung biaya pembekuan yang tidak pernah dia pakai; tanggal pembekuan tidak dicatat sehingga aging frozen tidak punya titik mulai.',
   'Blast Freeze Transfer Record menjadi dasar jurnal transfer, applied overhead Pool B, tanggal mulai aging frozen, dan label kedaluwarsa baru; label dicetak ulang berbasis tanggal pembekuan.',
   'Pool B TIDAK masuk Total Joint Cost — dia dibebankan langsung ke SKU frozen berdasarkan kg aktual yang dibekukan. Itu keputusan P1 (internal ABF), dan konsekuensinya seluruh akun utang blasting, invoice blasting, dan three-way matching blasting dihapus dari v2.1.',
   'TBC-16', '["Blast Freeze Transfer Record","Label kedaluwarsa baru berbasis tanggal pembekuan"]'::jsonb, '[{"code":"Persediaan","label":"Transfer pool Fresh ke pool Frozen"},{"code":"Overhead","label":"Applied Overhead Pool B — dibebankan langsung ke SKU frozen"}]'::jsonb, '["Kg aktual dibekukan → dasar applied Pool B","Tanggal pembekuan → mulai aging frozen"]'::jsonb),
  ('KGR', '27', 27, 'ACCOUNTING', 'Staff Accounting', 'KEDUANYA', 'Catat piutang & AR aging',
   'Piutang dicatat tanpa tanggal jatuh tempo yang berdasar sehingga aging tidak bisa dihitung; stream tidak dicatat sehingga piutang per stream tidak bisa dianalisis.',
   'Piutang dicatat pada hari invoice diterbitkan lengkap dengan tanggal jatuh tempo, nomor surat jalan, Batch ID, stream, dan nomor SO; AR Aging disusun mingguan dengan review terdokumentasi.',
   'Enam bucket aging sudah ditetapkan di SOP, tapi payment terms per pelanggan belum. Aging tanpa terms adalah penghitungan hari tanpa tanggal jatuh tempo yang sah.',
   'TBC-11', '["AR Aging Report — enam bucket","Kartu piutang per pelanggan"]'::jsonb, '[{"code":"Neraca","label":"Piutang Usaha per pelanggan"}]'::jsonb, '["Umur piutang per bucket","Payment terms per pelanggan"]'::jsonb),
  ('KGR', '28', 28, 'ACCOUNTING', 'Staff Accounting', 'KEDUANYA', 'Follow-up, eskalasi & collection',
   'Overdue tidak ditagih karena tidak ada pemilik dan tenggat; provisi memakai kebijakan sementara tanpa dasar formal sehingga penurunan nilai tidak bisa dipertahankan.',
   'Reminder 3 hari kerja sebelum jatuh tempo; follow-up berjenjang per bucket dengan tenggat; credit hold atas keputusan Manajer Accounting; eskalasi ke Direktur pada bucket 61–90 dengan memo berisi riwayat dan rekomendasi.',
   'Kebijakan provisi sementara sudah berjalan — 50% di 91–180 hari, 100% di atas 180 hari. Itu bukan ketiadaan kebijakan, tapi kebijakan yang belum diformalkan; bedanya penting saat diaudit.',
   'TBC-10', '["Form Follow-up Collection","Memo eskalasi Direktur"]'::jsonb, '[{"code":"Beban","label":"Provisi Penurunan Nilai Piutang"}]'::jsonb, '["Umur overdue per bucket → tingkat provisi"]'::jsonb),
  ('KGR', '29', 29, 'ACCOUNTING', 'Staff Accounting', 'KEDUANYA', 'Three-way matching & catat utang usaha',
   'Akrual dikreditkan ke akun beban dan bukan ke akun asalnya sehingga beban tercatat dua kali; selisih dengan supplier statement mengendap tanpa tenggat.',
   'Three-way matching per jenis vendor sebelum AP dicatat; clearing akrual wajib mengikuti akun asal (Dr Akrual / Cr Utang Usaha), bukan dikreditkan ke beban; rekonsiliasi AP ledger vs supplier statement berkala.',
   'Pola clearing akrual ini disebut berulang di SOP 1, 7, dan 8 — dan itu disengaja. Mengkredit akrual ke akun beban adalah kesalahan yang tidak terlihat di neraca tapi menggandakan beban di laba rugi.',
   null, '["Invoice vendor","PO / kontrak","BA Penerimaan atau meter reading"]'::jsonb, '[{"code":"Neraca","label":"Utang Usaha Vendor"},{"code":"Neraca","label":"Clearing Akrual — Dr Akrual / Cr Utang Usaha"}]'::jsonb, '["Nilai terverifikasi per vendor"]'::jsonb),
  ('KGR', '30', 30, 'ACCOUNTING', 'Manajer Accounting', 'KEDUANYA', 'Payment proposal & eksekusi dual authorization',
   'Pembayaran dieksekusi tanpa dual authorization; urgent payment jadi jalur biasa karena tidak dicatat terpisah.',
   'Pembayaran melalui rekening perusahaan dengan dual authorization maker–releaser; bukti transfer disimpan; AP di-clear pada hari pembayaran; urgent payment dicatat pada payment register khusus di luar siklus mingguan.',
   'Matriks otorisasi yang sama dipakai untuk PO di SOP 1 dan pembayaran di sini. Satu keputusan menutup dua siklus — dan selama belum ditetapkan, dua-duanya bergantung kebiasaan.',
   'TBC-13', '["AP Aging","Payment Proposal","Bukti transfer","Payment register urgent"]'::jsonb, '[{"code":"Neraca","label":"Utang Usaha Vendor"},{"code":"Neraca","label":"Bank"}]'::jsonb, '["Nilai jatuh tempo per vendor → prioritas pembayaran"]'::jsonb),
  ('KGR', '31', 31, 'ACCOUNTING', 'Staff Accounting', 'KEDUANYA', 'Cut-off penjualan & pembelian',
   'Penjualan dicatat tanpa BST sehingga pendapatan diakui sebelum penyerahan; pembelian akhir bulan tidak di-accrual sehingga persediaan dan utang dua-duanya understated.',
   'Penjualan dicatat di bulan berjalan hanya kalau BST diperoleh sebelum atau pada hari terakhir bulan; live bird diterima tanpa invoice wajib di-accrual pada bulan penerimaan.',
   'Cut-off adalah satu-satunya kontrol yang menentukan periode, dan dia bekerja lewat dokumen bukan lewat niat: BST untuk penjualan, BA Penerimaan untuk pembelian.',
   'TBC-14', '["Monthly close checklist","Rekap cut-off penjualan dan pembelian"]'::jsonb, '[]'::jsonb, '["BST sebelum akhir bulan → pengakuan penjualan","Live bird diterima sebelum akhir bulan → pengakuan pembelian"]'::jsonb),
  ('KGR', '32', 32, 'ACCOUNTING', 'Manajer Accounting', 'KEDUANYA', 'Rekonsiliasi & uji LCNRV frozen',
   'Frozen dicatat di atas nilai realisasi bersihnya sehingga persediaan overstated; rekonsiliasi per stream tidak dilakukan sehingga selisih fresh dan frozen saling menutupi.',
   'Uji LCNRV wajib bulanan untuk setiap SKU frozen; rekonsiliasi inventory valuation, HPP, pendapatan, piutang, dan utang dilakukan per stream; selisih di atas materialitas wajib diinvestigasi dan dijelaskan.',
   'LCNRV hanya berlaku untuk frozen, dan itu logis: fresh habis dalam hitungan jam sehingga tidak pernah cukup lama untuk turun nilai. Frozen bisa menua berbulan-bulan — dan aging-nya belum diukur sama sekali.',
   'TBC-09', '["Rekonsiliasi inventory valuation per stream","Laporan Aging Frozen","Kertas kerja LCNRV"]'::jsonb, '[{"code":"Beban","label":"Penurunan Nilai Persediaan — LCNRV frozen"}]'::jsonb, '["Cost per kg tercatat vs NRV kini per SKU frozen"]'::jsonb),
  ('KGR', '33', 33, 'ACCOUNTING', 'Manajer Accounting', 'KEDUANYA', 'P&L segmental Fresh vs Frozen & submission',
   'Margin per stream tidak terpisah sehingga keputusan bauran fresh dan frozen diambil tanpa dasar; koreksi pasca-submission dilakukan tanpa mekanisme formal.',
   'P&L segmental Fresh vs Frozen wajib; Manajer Accounting mereview margin per SKU dan per stream; koreksi pasca-submission hanya via mekanisme adjustment formal yang disetujui Manajer Accounting dan Group Project Finance.',
   'Seluruh pemisahan stream di sepanjang rantai — pool, FIFO, label, invoice, rekonsiliasi — bermuara di satu laporan ini. Kalau stream tidak dicatat di dokumen sumbernya, laporan segmental hanya bisa diperkirakan, dan keputusan bauran kehilangan dasarnya.',
   'TBC-14', '["Laporan laba rugi","Neraca","P&L segmental Fresh vs Frozen"]'::jsonb, '[]'::jsonb, '["Pendapatan, HPP, dan margin per stream","Margin per SKU"]'::jsonb)
on conflict (entity_code, label) do nothing;

-- 6. Needs — the data register ------------------------------------------------
insert into public.os_process_needs (step_id, item, kind, src, owner, status)
select s.id, v.item, v.kind, v.src, v.owner, v.status
from (values
  ('1', 'Proyeksi penjualan per SKU per stream', 'TRANSAKSI', 'Sales Forecast Mingguan', 'Tim Sales', 'SEBAGIAN'),
  ('1', 'Stok live bird dan kapasitas RPA harian', 'TRANSAKSI', 'Laporan stok harian', 'Staff Gudang', 'SEBAGIAN'),
  ('1', 'Volume normal/budgeted bulanan kg berat hidup', 'PARAMETER', 'Demand plan — belum ada', 'Manajer Operasional + PF', 'BELUM'),
  ('1', 'Interval review kebutuhan harian', 'PARAMETER', 'Kebijakan internal', 'Manajer Operasional', 'BELUM'),
  ('2', 'Format Batch ID', 'PARAMETER', 'Kebijakan internal', 'Manajer Accounting + IT', 'BELUM'),
  ('2', 'Matriks Otorisasi PO', 'PARAMETER', 'Kebijakan internal', 'Direktur', 'BELUM'),
  ('2', 'Nilai PO yang wajib co-approval Manajer Accounting', 'PARAMETER', 'Kebijakan internal', 'Direktur', 'BELUM'),
  ('2', 'Daftar Pemasok Aktif yang disetujui', 'MASTER', 'Seleksi pemasok', 'Staff Purchasing', 'SEBAGIAN'),
  ('3', 'Konfirmasi pengiriman tertulis H-1', 'TRANSAKSI', 'WhatsApp / email / surat', 'Staff Purchasing', 'SEBAGIAN'),
  ('3', 'Surat jalan pemasok dengan berat kiriman', 'TRANSAKSI', 'Dokumen pemasok', 'Pemasok', 'ADA'),
  ('4', 'Berat aktual diterima per Batch ID', 'TRANSAKSI', 'Timbangan terkalibrasi', 'Staff Gudang', 'ADA'),
  ('4', 'Sertifikat kalibrasi timbangan', 'MASTER', 'Vendor kalibrasi', 'Staff Gudang', 'SEBAGIAN'),
  ('4', 'Jam kerja tenaga bongkar & terima', 'TRANSAKSI', 'Absensi', 'Staff Gudang + HR', 'BELUM'),
  ('5', 'Tingkat DOA per penerimaan', 'TRANSAKSI', 'Form Quality Check', 'Staff QC', 'SEBAGIAN'),
  ('5', 'Ambang DOA yang wajib klaim', 'PARAMETER', 'Kebijakan internal', 'Manajer Operasional', 'BELUM'),
  ('5', 'Spesifikasi mutu live bird yang disepakati', 'REFERENSI', 'Kontrak pemasok', 'Staff Purchasing', 'SEBAGIAN'),
  ('6', 'BA Penerimaan bertandatangan', 'TRANSAKSI', 'Dokumen gudang', 'Staff Gudang', 'ADA'),
  ('6', 'Invoice pemasok', 'TRANSAKSI', 'Pemasok', 'Pemasok', 'SEBAGIAN'),
  ('6', 'Daftar accrual belum selesai', 'TRANSAKSI', 'AP reconciliation', 'Staff Accounting', 'BELUM'),
  ('7', 'Jadwal pemuasaan 8–12 jam per batch', 'PARAMETER', 'Kebijakan operasional', 'Supervisor Produksi', 'BELUM'),
  ('7', 'Checklist sanitasi lulus sebelum lini jalan', 'TRANSAKSI', 'Form sanitasi', 'Staff QC / Sanitasi', 'SEBAGIAN'),
  ('7', 'Mortalitas selama holding per batch', 'TRANSAKSI', 'Catatan Holding', 'Staff Gudang', 'SEBAGIAN'),
  ('8', 'Petugas veteriner berwenang yang tersedia', 'MASTER', 'Dinas via kontrak sewa atau rekrut sendiri', 'Direktur + Manajer Operasional', 'BELUM'),
  ('8', 'Form Antemortem per Batch', 'TRANSAKSI', 'Dokumen veteriner', 'Dokter hewan', 'BELUM'),
  ('9', 'Berat masuk lini per Batch ID', 'TRANSAKSI', 'Timbangan terkalibrasi', 'Staff Gudang', 'ADA'),
  ('9', 'Susut berat holding per batch', 'TRANSAKSI', 'Selisih terima vs masuk lini', 'Staff Gudang', 'SEBAGIAN'),
  ('9', 'Ambang susut holding normal', 'PARAMETER', 'Kebijakan internal', 'Manajer Operasional', 'BELUM'),
  ('10', 'Sertifikat Juleha dan Penyelia Halal aktif', 'MASTER', 'Lembaga sertifikasi', 'Manajer Operasional', 'SEBAGIAN'),
  ('10', 'Catatan verifikasi kematian sempurna per shift', 'TRANSAKSI', 'Penyelia Halal', 'Penyelia Halal', 'SEBAGIAN'),
  ('10', 'Jam kerja langsung dan output per shift', 'TRANSAKSI', 'Catatan shift', 'Supervisor Produksi', 'BELUM'),
  ('10', 'Parameter suhu & durasi scalding', 'PARAMETER', 'Kebijakan teknis', 'Supervisor Produksi + QC', 'BELUM'),
  ('11', 'Kg kondemnasi per Batch ID', 'TRANSAKSI', 'Form Post-mortem', 'Petugas veteriner', 'BELUM'),
  ('11', 'Ambang kondemnasi normal', 'PARAMETER', 'Kebijakan internal', 'Manajer Operasional + Veteriner', 'BELUM'),
  ('11', 'Izin pengelola limbah dan izin lingkungan', 'MASTER', 'Instansi berwenang', 'Manajer Operasional', 'BELUM'),
  ('12', 'Berat aktual per SKU per Batch ID', 'TRANSAKSI', 'Timbangan terkalibrasi', 'Staff Operasional + Staff Gudang', 'ADA'),
  ('12', 'Suhu inti karkas ≤ 4°C dalam jendela waktu', 'TRANSAKSI', 'Log suhu', 'Staff QC', 'SEBAGIAN'),
  ('12', 'Shelf life fresh dalam jam', 'PARAMETER', 'Kebijakan mutu', 'Manajer Operasional + QC', 'BELUM'),
  ('12', 'Jendela waktu chilling dan target suhu ruang', 'PARAMETER', 'Standar kesmavet', 'Supervisor Produksi', 'BELUM'),
  ('13', 'Basis Yield Daging — karkas utuh / parting / boneless, sebelum atau sesudah chilling', 'PARAMETER', 'Keputusan manajemen', 'Manajer Operasional + Manajer Accounting', 'BELUM'),
  ('13', 'Ambang deviasi yield yang wajib berita acara', 'PARAMETER', 'Kebijakan internal', 'Manajer Operasional', 'BELUM'),
  ('13', 'Data yield 5 batch pertama untuk validasi benchmark', 'TRANSAKSI', 'Yield Report', 'Supervisor Produksi', 'BELUM'),
  ('13', 'Mekanisme review benchmark berkala', 'PARAMETER', 'Kebijakan internal', 'Manajer Operasional + Manajer Accounting', 'BELUM'),
  ('14', 'Inventory receipt per SKU per Batch ID', 'TRANSAKSI', 'Sistem gudang', 'Staff Gudang', 'ADA'),
  ('14', 'Estimated cost per SKU sebelum costing final', 'PARAMETER', 'Turunan', 'Staff Accounting', 'SEBAGIAN'),
  ('15', 'Mutasi harian per Batch ID per SKU per stream', 'TRANSAKSI', 'Sistem gudang', 'Staff Gudang', 'SEBAGIAN'),
  ('15', 'Ambang discrepancy fisik vs sistem', 'PARAMETER', 'Kebijakan internal', 'Kepala Gudang', 'BELUM'),
  ('15', 'Hasil opname bulanan dengan counter independen', 'TRANSAKSI', 'Berita acara opname', 'Staff Gudang + Finance/IA', 'SEBAGIAN'),
  ('16', 'Tarif overhead Pool A', 'PARAMETER', 'Volume normal bulanan ÷ overhead anggaran', 'PF + Manajer Accounting', 'BELUM'),
  ('16', 'Volume normal bulanan sebagai denominator', 'PARAMETER', 'Demand plan — belum ada', 'Manajer Operasional + PF', 'BELUM'),
  ('16', 'Jam kerja langsung dan output per shift', 'TRANSAKSI', 'Catatan shift', 'Supervisor Produksi', 'BELUM'),
  ('16', 'Porsi refrigerasi yang dipisah ke Pool B', 'PARAMETER', 'Estimasi teknik', 'Manajer Accounting + teknik', 'BELUM'),
  ('17', 'Harga Jual Referensi NRV per SKU, terpisah fresh dan frozen', 'PARAMETER', 'Daftar harga referensi', 'Manajer Operasional + Manajer Accounting', 'BELUM'),
  ('17', 'Berat aktual per SKU dari Yield Report final', 'TRANSAKSI', 'Yield Report', 'Manajer Operasional', 'ADA'),
  ('17', 'Dasar dan persetujuan harga referensi nol untuk by-product', 'PARAMETER', 'Memo persetujuan', 'Manajer Accounting', 'BELUM'),
  ('18', 'Ambang penyimpangan cost per kg vs 3 batch terakhir', 'PARAMETER', 'Kebijakan internal', 'Manajer Accounting', 'BELUM'),
  ('18', 'Cost per kg batch sebelumnya periode sama', 'TRANSAKSI', 'Batch Costing Sheet', 'Staff Accounting', 'SEBAGIAN'),
  ('18', 'Materialitas selisih rekonsiliasi', 'PARAMETER', 'Kebijakan internal', 'Manajer Accounting', 'BELUM'),
  ('19', 'Cost per kg final per SKU dari SOP 3', 'TRANSAKSI', 'Batch Costing Sheet', 'Staff Accounting', 'SEBAGIAN'),
  ('19', 'Daftar unit sudah terjual sebelum costing final', 'TRANSAKSI', 'Sub-ledger penjualan', 'Staff Accounting', 'SEBAGIAN'),
  ('20', 'Kanal resmi penerimaan pesanan', 'PARAMETER', 'Kebijakan internal', 'Manajer Sales', 'BELUM'),
  ('20', 'Stok tersedia per stream real-time', 'TRANSAKSI', 'Sistem gudang', 'Staff Gudang', 'SEBAGIAN'),
  ('20', 'Payment terms per pelanggan', 'MASTER', 'Kontrak pelanggan', 'Sales + Manajer Accounting', 'BELUM'),
  ('21', 'Pejabat berwenang menyetujui surat jalan', 'PARAMETER', 'Kebijakan internal', 'Direktur', 'BELUM'),
  ('21', 'Batch ID pada setiap surat jalan', 'TRANSAKSI', 'Surat jalan', 'Staff Gudang', 'SEBAGIAN'),
  ('21', 'Standar kemasan per stream', 'MASTER', 'Kebijakan mutu', 'QC + Manajer Operasional', 'SEBAGIAN'),
  ('22', 'BST bertandatangan pelanggan', 'TRANSAKSI', 'Dokumen pengiriman', 'Driver', 'SEBAGIAN'),
  ('22', 'Target dan pemantauan suhu kendaraan chilled', 'PARAMETER', 'Standar mutu', 'QC + Manajer Operasional', 'BELUM'),
  ('22', 'Catatan penolakan saat pengiriman', 'TRANSAKSI', 'Form penolakan', 'Driver', 'BELUM'),
  ('23', 'Batas waktu penerbitan invoice setelah BST', 'PARAMETER', 'Kebijakan internal', 'Manajer Accounting', 'BELUM'),
  ('23', 'Matriks PPN per jenis produk', 'REFERENSI', 'Ketentuan pajak', 'Tax + Manajer Accounting', 'SEBAGIAN'),
  ('24', 'EOD Cutoff — jam batas akhir penjualan fresh', 'PARAMETER', 'Kebijakan internal', 'Direktur + Manajer Operasional', 'BELUM'),
  ('24', 'Tenggat serah stock count setelah cutoff', 'PARAMETER', 'Kebijakan internal', 'Manajer Operasional', 'BELUM'),
  ('24', 'Kondisi fisik per SKU sisa', 'TRANSAKSI', 'EOD Stock Count Sheet', 'Staff Gudang', 'SEBAGIAN'),
  ('25', 'Ambang suhu produk pada Kriteria Layak Blast Freeze', 'PARAMETER', 'Kebijakan mutu', 'Manajer Operasional + QC', 'BELUM'),
  ('25', 'Batas diskon minimum terhadap HPP', 'PARAMETER', 'Kebijakan internal', 'Direktur', 'BELUM'),
  ('25', 'Ambang write-off yang wajib eskalasi Direktur', 'PARAMETER', 'Kebijakan internal', 'Direktur', 'BELUM'),
  ('26', 'Kg aktual dibekukan per SKU per Batch ID', 'TRANSAKSI', 'Blast Freeze Transfer Record', 'Staff Gudang', 'BELUM'),
  ('26', 'Tarif Pool B per kg', 'PARAMETER', 'Overhead pembekuan ÷ volume dibekukan', 'Manajer Accounting + PF', 'BELUM'),
  ('26', 'Estimasi teknik listrik ABF dan cold storage', 'PARAMETER', 'Estimasi teknik', 'Teknik + Manajer Accounting', 'BELUM'),
  ('27', 'Payment terms per pelanggan', 'MASTER', 'Kontrak pelanggan', 'Sales + Manajer Accounting', 'BELUM'),
  ('27', 'Stream dan Batch ID pada catatan piutang', 'TRANSAKSI', 'Sistem akuntansi', 'Staff Accounting', 'SEBAGIAN'),
  ('27', 'Jadwal review AR aging mingguan', 'PARAMETER', 'Kebijakan internal', 'Manajer Accounting', 'BELUM'),
  ('28', 'Kebijakan provisi piutang formal', 'PARAMETER', 'Kebijakan akuntansi', 'Manajer Accounting + Direktur', 'BELUM'),
  ('28', 'Riwayat komunikasi penagihan per pelanggan', 'TRANSAKSI', 'Form Follow-up', 'Staff Accounting', 'BELUM'),
  ('28', 'Ambang dan tenggat eskalasi per bucket', 'PARAMETER', 'Kebijakan internal', 'Direktur', 'BELUM'),
  ('29', 'Kelengkapan dokumen per invoice vendor', 'TRANSAKSI', 'Checklist verifikasi', 'Staff Accounting', 'SEBAGIAN'),
  ('29', 'Daftar akrual terbuka dari SOP 1 dan SOP 8', 'TRANSAKSI', 'Sub-ledger akrual', 'Staff Accounting', 'BELUM'),
  ('29', 'Tenggat penyelesaian selisih dengan supplier statement', 'PARAMETER', 'Kebijakan internal', 'Manajer Accounting', 'BELUM'),
  ('30', 'Matriks otorisasi pembayaran', 'PARAMETER', 'Kebijakan internal', 'Direktur', 'BELUM'),
  ('30', 'Posisi kas harian', 'TRANSAKSI', 'Rekening bank', 'Staff Finance', 'ADA'),
  ('30', 'Daftar vendor prioritas dan urgensi', 'PARAMETER', 'Kebijakan internal', 'Manajer Accounting', 'SEBAGIAN'),
  ('31', 'Tanggal close bulanan yang ditetapkan', 'PARAMETER', 'Group Project Finance', 'Group Project Finance', 'BELUM'),
  ('31', 'Daftar BST yang diperoleh sebelum akhir bulan', 'TRANSAKSI', 'Dokumen pengiriman', 'Admin Sales', 'SEBAGIAN'),
  ('31', 'Daftar penerimaan live bird tanpa invoice pada akhir bulan', 'TRANSAKSI', 'BA Penerimaan', 'Staff Gudang', 'SEBAGIAN'),
  ('32', 'Harga jual referensi frozen terkini', 'PARAMETER', 'Daftar harga referensi', 'Manajer Operasional + Manajer Accounting', 'BELUM'),
  ('32', 'Estimasi biaya menjual per SKU', 'PARAMETER', 'Turunan', 'Staff Accounting', 'BELUM'),
  ('32', 'Materialitas selisih rekonsiliasi', 'PARAMETER', 'Kebijakan internal', 'Manajer Accounting', 'BELUM'),
  ('32', 'Aging frozen per SKU per tanggal pembekuan', 'TRANSAKSI', 'Laporan Aging Frozen', 'Staff Gudang', 'BELUM'),
  ('33', 'Pendapatan dan HPP terpisah per stream', 'TRANSAKSI', 'Sub-ledger', 'Staff Accounting', 'SEBAGIAN'),
  ('33', 'Tenggat submission ke Group Project Finance', 'PARAMETER', 'Group Project Finance', 'Group Project Finance', 'BELUM'),
  ('33', 'Mekanisme adjustment formal pasca-submission', 'PARAMETER', 'Kebijakan internal', 'Manajer Accounting + GPF', 'BELUM')
) as v(step_label, item, kind, src, owner, status)
join public.os_process_steps s on s.entity_code = 'KGR' and s.label = v.step_label
-- The (step_id, item) guard matches app-editable text — the reason the
-- one-shot guard at the top exists. Left as-is deliberately: there is no
-- stable natural key to move it to (see the ARBI seed header).
where not exists (
  select 1 from public.os_process_needs n
  where n.step_id = s.id and n.item = v.item
);

-- 7. NO bridge section. os_process_step_items stays empty for KGR until the
-- poultry rows exist and the mapping is authored — see the header.
