-- ===========================================================================
-- SAMB OPERATIONAL PROCESS: SEED. Data only — schema is 20260806000050.
-- ===========================================================================
-- Contents come verbatim from the curated seed (composed and revised outside
-- the app; there is deliberately no importer, no export UI and no in-app
-- structure editor). Counts are fixed and asserted by the frontend logic
-- tests: 6 lanes, 7 phases, 15 gates, 30 steps, 118 needs. Capitalised
-- passages inside step notes are deliberate emphasis, not shouting; label
-- ordering (21 → 23 → 22) and parallel labels (6a/6b, 15b) are identities,
-- not sequence errors. Contains no financial figures.
--
-- Idempotent: lanes and gates upsert on their natural PKs, steps on the
-- unique label, phases and needs insert only when absent, and the bridge
-- upserts on its composite PK — so a re-run never duplicates rows and never
-- touches hand-entered requested_on dates.
--
-- Section 6 maps steps to Finish line rows by LITERAL UUID, read from the
-- live table on 6 August. It is not a label lookup and must not become one:
-- three Finish line labels appear twice across sections, so a by-label match
-- would pick the wrong twin. See the note above that section. Gates G03, G07
-- and G09 are referenced by no step — deliberate, they keep external blocker
-- numbering consistent.
--
-- NOT APPLIED. Apply via the Supabase apply_migration tool AFTER
-- 20260806000050, per the APPLY BEFORE DEPLOY block in the PR that
-- introduced this file. NEVER apply with `supabase db push`,
-- `migration up`, `db reset`, or `db remote commit`.
--
-- Down-migration:
-- supabase/migrations/down/20260806000051_samb_process_seed_down.sql

-- 1. Lanes ------------------------------------------------------------------
insert into public.os_process_lanes (key, label, description, ordinal, is_external) values
  ('KLIEN', 'KLIEN LP', 'Klien jasa LP — pihak ketiga', 1, true),
  ('PURCHASING', 'PURCHASING', 'Rencana & order ke principal', 2, false),
  ('WAREHOUSE', 'WAREHOUSE', 'Terima, simpan, siapkan, muat', 3, false),
  ('SALES', 'SALES', 'Permintaan customer & janji kirim', 4, false),
  ('FLEET', 'FLEET', 'Angkut & serah terima', 5, false),
  ('FINANCE', 'FINANCE', 'Tagih, tarik, rekon', 6, false)
on conflict (key) do nothing;

-- 2. Gates ------------------------------------------------------------------
insert into public.os_process_gates (id, type, title, sub, owner, unblock) values
  ('G01', 'DATA', 'Isi per karton per SKU', 'Standing blocker #1', 'Commercial / Purchasing', 'Datanya melewati Purchasing tiap kali PO dibuat (step 2). Minta formal, eskalasi kalau menggantung.'),
  ('G02', 'DATA', 'Product master / dimensi karton belum siap', 'Standing blocker #2', 'Commercial / Warehouse', 'Sementara pakai closing value (IDR) per principal sebagai driver interim.'),
  ('G03', 'OOS', 'Split B2B / B2C ASI', 'Standing blocker #3', 'ASI — di luar scope SAMB', 'Bukan rantai operasional SAMB. Dicantumkan agar penomoran blocker tetap konsisten.'),
  ('G04', 'DATA', 'Eliminasi intercompany nunggu rekonsiliasi TB', 'Standing blocker #4', 'Accounting subsidiary', 'Enforce pre-recon per line item di step 19 sebelum submission masuk matrix.'),
  ('G05', 'DECISION', 'Driver COGS LP Fulfillment', 'Standing blocker #5', 'Kamu', 'Pilih satu: pallet position (step 6) · CBM stored (step 7) · pick line count (step 10). Ketiganya sudah lahir di rantai.'),
  ('G06', 'DECISION', 'Mekanisme Distribution Cost Trucking', 'Standing blocker #6', 'Kamu', 'Pilih (a) split internal/LP + benchmark rate, CBM dari estimasi inventory; atau (b) all internal armada, CBM dari Trip Log actual, tanpa Rate Card.'),
  ('G07', 'DECISION', 'Numerator ROCE greenfield', 'Standing blocker #7', 'Kamu', 'Tetapkan definisi numerator. Tidak menyentuh rantai operasional ini — murni model appraisal.'),
  ('G08', 'DECISION', 'Metode Target CBM', 'Open item', 'Kamu', 'Ditetapkan di step 1. Dipakai sebagai denominator kapasitas di hilir.'),
  ('G09', 'DECISION', 'Scope Discount to Distributor', 'Open item', 'Kamu', 'Menentukan apakah masuk pengurang revenue atau biaya komersial. Retur & klaim belum dipetakan sebagai step.'),
  ('G10', 'DECISION', 'Scope AP di baris AR-AP-Finance Salary', 'Open item', 'Kamu', 'Tentukan apakah fungsi AP ikut dialokasi ke Commercial Support atau ke G&A.'),
  ('G11', 'DATA', 'Split AR staff invoicing vs collection', 'Open item', 'HR / Finance', 'Tanpa ini, driver invoice di step 16 ikut menanggung biaya collection dari step 18.'),
  ('G12', 'DATA', 'Status dedikasi Asman Tax', 'Open item', 'HR', 'Konfirmasi porsi dedikasi. Catatan: ''Asman'' belum dikonfirmasi berarti Assistant Manager — jangan diasumsikan.'),
  ('G13', 'DECISION', 'Carve-out COS–LP dari pool bersama', 'Terbuka — risiko double count', 'Kamu', 'Tetapkan apakah biaya melayani barang klien dikarve-out dari pool yang sama sehingga Storing/Distribution Cost tinggal porsi barang sendiri, atau dihitung terpisah. Tanpa keputusan ini, sewa gudang dan biaya armada berisiko terhitung dua kali.'),
  ('G14', 'DATA', 'Kepemilikan Barang tidak ditangkap di luar LP02 Trip Log', 'Blocker baru — jalur LP', 'Warehouse + IT', 'Tambahkan atribut pemilik di GRN, WMS lot/lokasi, picking, dan kolom SJ. Ini join key yang membelah pool bersama antara barang sendiri dan barang klien. Tanpa itu, revenue LP ada tapi dasar biayanya tidak ada.'),
  ('G15', 'DECISION', 'Basis tarif layanan LP', 'Terbuka', 'Kamu', 'Tarif ke pihak ketiga = harga pasar di atas cost-to-serve. Untuk klien afiliasi, tarif pihak ketiga jadi pembanding internal — tetapkan apakah dipakai apa adanya atau disesuaikan, dan dokumentasikan selisihnya.')
on conflict (id) do nothing;

-- 3. Phases -----------------------------------------------------------------
insert into public.os_process_phases (name, slot_from, slot_to)
select v.name, v.slot_from, v.slot_to
from (values
  ('SETUP & PENGADAAN', 1, 3),
  ('INTAKE — TERPISAH', 4, 5),
  ('PENYIMPANAN', 6, 7),
  ('ORDER & OUTBOUND', 8, 12),
  ('PENGIRIMAN', 13, 15),
  ('PENAGIHAN', 16, 18),
  ('KAS & ELIMINASI', 19, 21)
) as v(name, slot_from, slot_to)
where not exists (
  select 1 from public.os_process_phases p
  where p.name = v.name and p.slot_from = v.slot_from and p.slot_to = v.slot_to
);

-- 4. Steps ------------------------------------------------------------------
insert into public.os_process_steps (label, slot, lane_key, co, track, name, risk, control, note, gate_id, docs, coa, drivers) values
  ('1', 1, 'SALES', 'Commercial + PF', 'LP', 'Kontrak layanan LP & rate card per klien',
   'Tarif ditetapkan tanpa dasar biaya sehingga layanan dijual di bawah cost-to-serve; layanan berjalan tanpa perjanjian tertulis.', 'Perjanjian tertulis dan limit kredit disetujui sebelum barang pertama masuk; tarif ditinjau berkala terhadap cost-to-serve aktual.', 'Tarif LP harus berdiri di atas cost-to-serve per pallet-day dan per CBM — angka yang keluar dari pool bersama. Kalau pool-nya belum dibelah, tarifnya belum punya dasar.', 'G15',
   '["Perjanjian jasa fulfillment & trucking","LP02 Rate Card Model","Proposal & penawaran tarif"]'::jsonb, '[]'::jsonb, '["Tarif per pallet position per periode","Tarif per CBM per zona"]'::jsonb),
  ('2', 1, 'SALES', 'Demand planning', 'TRADE', 'Demand plan & forecast per principal',
   'Bias forecast: overstock mengunci pallet position, stockout menghapus margin yang tidak bisa diambil kembali. Kalau penyerahan ke Purchasing tidak berdokumen, PO terbit atas penilaian Purchasing sendiri dan forecast-nya jadi hiasan.', 'Review bulanan forecast vs actual dengan tracking error per principal. Demand plan diserahkan ke Purchasing sebagai dokumen bernomor periode, bukan lisan.', 'Belum ada posting akuntansi di step ini — murni perencanaan. Pemiliknya Sales karena yang dibutuhkan pengetahuan pasar dan kalender promo; PF menyediakan modelnya, Purchasing menerima keluarannya.', 'G08',
   '["SAMB_Demand_Forecast_WP_v1.0.xlsx","Historis sales SAP (VBRP)","Rencana promo principal"]'::jsonb, '[]'::jsonb, '["Target CBM — denominator kapasitas","Basis normal capacity (PSAK 14)"]'::jsonb),
  ('3', 2, 'PURCHASING', '', 'TRADE', 'Terbit PO ke principal',
   'PO di luar batas otorisasi; harga tidak sesuai price list; trading term tidak terdokumentasi.', 'Matriks otorisasi PO; harga terkunci ke price list aktif.', 'Price list principal adalah sumber isi-per-karton. Blocker #1 sebetulnya lahir di step ini — datanya sudah lewat tangan Purchasing setiap kali PO dibuat.', 'G01',
   '["PO","Price list principal","Konfirmasi trading term"]'::jsonb, '[]'::jsonb, '["Isi per karton per SKU — LAHIR DI SINI"]'::jsonb),
  ('4', 3, 'PURCHASING', '', 'TRADE', 'Konfirmasi & jadwal kedatangan',
   'Kedatangan menumpuk di hari yang sama → lembur bongkar dan pallet position tidak siap.', 'Slot booking bongkar; konfirmasi kapasitas ke Warehouse sebelum jadwal dikunci.', '', null,
   '["Konfirmasi order principal","Jadwal slot bongkar"]'::jsonb, '[]'::jsonb, '["Rencana CBM inbound — cek kapasitas gudang"]'::jsonb),
  ('5', 3, 'KLIEN', 'Pemilik barang', 'LP', 'Terima instruksi & titipan dari klien LP',
   'Barang titipan masuk tanpa dokumen pemilik sehingga tercatat seolah inventory SAMB — persediaan dan HPP dua-duanya salah saji.', 'Terima titipan hanya dengan berita acara bernomor; kode pemilik wajib diisi sebelum barang masuk rak.', 'Kepala jalur LP. Bedanya dengan step 4: di sini SAMB tidak membeli apa pun, hanya jadi custodian. Tidak ada PO, tidak ada GR/IR, tidak ada harga beli, dan tidak ada inventory di neraca.', 'G14',
   '["Instruksi penitipan barang","SJ klien","Berita acara terima titipan"]'::jsonb, '[{"code":"Neraca","label":"Barang titipan — off-balance, bukan inventory SAMB"}]'::jsonb, '["Volume titipan masuk per klien"]'::jsonb),
  ('6a', 4, 'WAREHOUSE', 'Inbound', 'TRADE', 'Kedatangan & bongkar — barang sendiri',
   'Qty fisik ≠ qty SJ principal; kerusakan saat bongkar tidak tercatat sehingga jadi selisih opname nanti.', 'Dual check tally lawan SJ principal dan PO; berita acara selisih ditandatangani dua pihak sebelum truk principal keluar.', 'Kedatangan lawan PO. Ada penjual, ada harga, ada kewajiban bayar — jadi ada GR/IR di step berikutnya.', null,
   '["SJ principal","Tally sheet bongkar","Referensi PO"]'::jsonb, '[{"code":"6.3.01","label":"Storing — Manpower"}]'::jsonb, '["CBM inbound per kategori → Pool 1 Receiving & Put-Away"]'::jsonb),
  ('6b', 4, 'WAREHOUSE', 'Inbound', 'LP', 'Kedatangan & bongkar — barang klien',
   'Barang klien di-tally dengan form yang sama seperti barang sendiri sehingga tercampur di WMS; tanpa kode pemilik, biaya bongkarnya menempel ke Storing Cost dan bukan ke COS–LP.', 'Form tally terpisah dengan kode klien wajib; barang klien tidak boleh masuk rak sebelum kode pemilik terisi.', 'Tidak ada PO. Tidak ada penjual, tidak ada harga beli, tidak ada kewajiban bayar. Yang lahir di sini adalah kewajiban menjaga barang — bukan utang dagang.', 'G14',
   '["SJ klien LP","Tally sheet bongkar","Referensi instruksi penitipan"]'::jsonb, '[{"code":"6.3.01","label":"Storing — Manpower — carve-out ke COS–LP"}]'::jsonb, '["CBM inbound per klien → Pool 1, porsi COS–LP"]'::jsonb),
  ('7a', 5, 'WAREHOUSE', 'Inbound', 'TRADE', 'Checking & terbit GRN',
   'GRN tidak match PO dan invoice principal; tanggal GRN ≠ tanggal fisik terima sehingga cut-off bulanan bergeser.', 'Three-way match PO – GRN – invoice; cut-off GRN harian, tidak boleh backdate lewat tanggal tutup.', 'Tanpa isi per karton, konversi PC→karton di sini manual atau diestimasi — dan seluruh CBM di hilir mewarisi estimasi itu.', 'G01',
   '["GRN","Entry WMS","Invoice principal","Foto kondisi barang"]'::jsonb, '[{"code":"5.3.xx","label":"Inventory / COGS — Dr Inventory"},{"code":"Neraca","label":"GR/IR clearing"}]'::jsonb, '["Konversi PC → karton → CBM (butuh isi per karton)"]'::jsonb),
  ('7b', 5, 'WAREHOUSE', 'Inbound', 'LP', 'Checking & berita acara terima titipan',
   'Barang titipan masuk ke WMS tanpa penanda off-balance sehingga ikut terhitung sebagai inventory SAMB — persediaan dan HPP dua-duanya salah saji, dan opname tidak akan pernah tie ke TB.', 'Registrasi titipan di ledger terpisah dari inventory; berita acara ditandatangani klien sebagai dasar pertanggungjawaban kuantitas.', 'TIDAK ADA GRN DAN TIDAK ADA GR/IR. Yang terbit adalah pengakuan kuantitas untuk dipertanggungjawabkan, bukan pengakuan aset. Ini pemisahan akuntansi paling tegas di seluruh rantai — dan hari ini dijalankan dengan form yang sama seperti barang sendiri.', 'G14',
   '["Berita acara terima titipan","Entry WMS dengan kode pemilik","Foto kondisi barang"]'::jsonb, '[{"code":"Neraca","label":"Barang titipan — off-balance, bukan inventory SAMB"},{"code":"Memo","label":"Catatan kuantitas & kondisi untuk pertanggungjawaban ke klien"}]'::jsonb, '["CBM titipan masuk per klien → dasar tagih & dasar carve-out"]'::jsonb),
  ('8', 6, 'WAREHOUSE', 'Storage', 'KEDUANYA', 'Put-away ke lokasi & pallet',
   'Lokasi tidak di-update di WMS → stok hantu. Tumpukan melewati max tumpuk SKU → barang bawah rusak.', 'Scan lokasi wajib saat put-away; batas max tumpuk tertulis per SKU di label rak.', 'Max tumpuk aktual per SKU yang dipakai di sini adalah angka yang sama yang dibutuhkan untuk stacking factor — tapi belum pernah ditarik jadi data.', 'G14',
   '["Task put-away WMS","Peta lokasi rak","LP01 — occupancy"]'::jsonb, '[{"code":"6.3.01","label":"Storing — Manpower"},{"code":"6.3.02","label":"Storing — Rental"}]'::jsonb, '["Pallet position terisi → basis pallet-day","CBM inbound → Pool 1","Pallet position per pemilik barang → belah pool bersama"]'::jsonb),
  ('9', 7, 'WAREHOUSE', 'Storage', 'KEDUANYA', 'Penyimpanan, housekeeping & opname',
   'Selisih opname tidak ditelusuri sampai akar; slow-moving dan expired tidak terdeteksi sampai jadi write-off. Stok titipan afiliasi tercampur dengan stok milik sendiri sehingga opname tidak akan pernah tie ke TB.', 'Cycle count berjadwal dengan toleransi tertulis; aging review bulanan dengan pemilik keputusan yang jelas.', 'Inventory days punya dua jalur perhitungan (moneter vs fisik) dan belum dipatok satu. Selama belum, WP storing tidak bisa konsisten antar periode. Selain itu: stok fisik di gudang termasuk barang titipan afiliasi yang bukan inventory SAMB. Kalau WMS tidak membedakan owned vs consigned, selisih opname akan selalu ada dan selalu tak terjelaskan — bukan karena kontrolnya lemah, tapi karena definisinya beda.', 'G02',
   '["Stock report WMS","Berita acara opname","LP01 — occupancy pallet-day","Aging / slow-moving report"]'::jsonb, '[{"code":"6.3.02","label":"Storing — Rental"},{"code":"6.3.03","label":"Storing — Utilities"},{"code":"6.3.01","label":"Storing — Manpower"},{"code":"6.3.06","label":"Storing — Security"},{"code":"6.3.07","label":"Storing — Insurance"},{"code":"6.3.08","label":"Storing — Depreciation"}]'::jsonb, '["CBM × inventory days (space × time) → Pool 2 Storage & Housekeeping","Pallet-day rate — total cost pool ÷ pallet-days","Net CBM movement → cluster sisa account","Pallet-day per pemilik barang → belah pool bersama"]'::jsonb),
  ('10', 8, 'SALES', 'CS', 'TRADE', 'Order masuk dari customer',
   'Order melebihi limit kredit diloloskan manual; order diterima tanpa stok sehingga jadi partial delivery.', 'Credit block otomatis di sistem; ATP check sebelum SO dikonfirmasi.', 'Order count adalah driver yang bisa membalik verdict portfolio: satu order satuan B2C butuh labour hampir sama dengan order bulk.', null,
   '["SO","Credit check","ATP / stock availability check"]'::jsonb, '[]'::jsonb, '["Order count → driver alternatif cost-to-serve (B2C / e-commerce)"]'::jsonb),
  ('11', 8, 'KLIEN', 'Pemilik barang', 'LP', 'Instruksi pengiriman dari klien LP',
   'Barang titipan dikeluarkan atas instruksi lisan sehingga tidak ada jejak otorisasi pemilik.', 'Pengeluaran barang titipan hanya atas DO tertulis dari pemilik; DO diarsip bersama SJ.', '', null,
   '["Delivery order klien","Daftar tujuan kirim"]'::jsonb, '[]'::jsonb, '["Jumlah order layanan per klien"]'::jsonb),
  ('12', 9, 'SALES', 'Sales Admin + Warehouse', 'KEDUANYA', 'Alokasi stok & terbit DO',
   'Alokasi ganda atas stok yang sama; FEFO tidak diikuti sehingga barang tua tertinggal.', 'Alokasi terkunci di WMS saat DO terbit; FEFO di-enforce sistem, bukan kebijaksanaan picker.', '', null,
   '["DO","Picking list"]'::jsonb, '[]'::jsonb, '["Rencana CBM outbound per rute"]'::jsonb),
  ('13', 10, 'WAREHOUSE', 'Outbound', 'KEDUANYA', 'Picking',
   'Salah SKU atau qty; pick dilakukan tanpa scan sehingga stok sistem menyimpang dari fisik.', 'Scan verifikasi per baris pick; sampling QC sebelum packing.', 'Pick line count yang tercatat di step ini adalah salah satu dari tiga kandidat driver LP Fulfillment. Kalau driver-nya dipilih, datanya sudah ada di sini. Tidak dipecah: picking list adalah dokumen kerja internal dengan format yang sama untuk kedua jalur, dan tidak ada posting akuntansi. Yang membedakan hanya atribut pemilik.', 'G05',
   '["Picking list","Konfirmasi pick di WMS"]'::jsonb, '[{"code":"6.3.01","label":"Storing — Manpower"}]'::jsonb, '["CBM outbound per kategori → Pool 3 Picking & Packing","Pick line count → kandidat driver LP Fulfillment","Baris pick per pemilik barang → belah pool bersama"]'::jsonb),
  ('14', 11, 'WAREHOUSE', 'Outbound', 'KEDUANYA', 'Packing & staging',
   'Barang tertukar antar order saat staging; material packing terpakai tanpa pencatatan.', 'Staging dipisah per rute dan per armada; pemakaian material packing dicatat harian.', 'Tidak dipecah: sama seperti step 13 — dokumen internal, tanpa posting. Pembedanya atribut pemilik.', null,
   '["Label pengiriman","Packing list"]'::jsonb, '[{"code":"6.3.01","label":"Storing — Manpower"},{"code":"6.3.10","label":"Storing — Office Supplies / material packing"}]'::jsonb, '["Order count → Pool 3","CBM outbound → Pool 3"]'::jsonb),
  ('15a', 12, 'WAREHOUSE', 'Outbound', 'TRADE', 'Loading & terbit SJ — barang sendiri',
   'SJ terbit tanpa barang benar-benar naik; kolom CBM di SJ dikosongkan karena tidak ada yang memakainya di lapangan.', 'Verifikasi loading vs SJ oleh checker terpisah; SJ bernomor urut dan dipertanggungjawabkan.', 'SAMB sebagai penjual. SJ ini yang jadi dasar pengakuan revenue di POD. TITIK PALING RAPUH: kalau CBM per SJ tidak diisi, LP02 Trip Log kosong dan seluruh alokasi distribution cost kehilangan basisnya — tidak ada cara memperbaikinya di belakang.', null,
   '["SJ SAMB — grain per-SJ","Checklist loading","Feed ke LP02 Trip Log"]'::jsonb, '[{"code":"6.3.01","label":"Storing — Manpower"}]'::jsonb, '["CBM outbound → Pool 4 Loading & Dispatch","CBM per SJ → basis alokasi trucking"]'::jsonb),
  ('15b', 12, 'WAREHOUSE', 'Outbound', 'LP', 'Loading & terbit SJ — barang klien',
   'SJ barang klien diterbitkan dengan format dan seri yang sama seperti SJ penjualan SAMB, sehingga terlihat seolah SAMB yang melakukan penyerahan — implikasinya PPN dan pengakuan revenue tercatat di entitas yang salah.', 'Format SJ terpisah dengan peran SAMB sebagai pengangkut tertulis jelas; seri nomor terpisah dari SJ penjualan; salinan SJ diserahkan ke klien.', 'SAMB BUKAN PENJUAL DI SINI. Kalau SJ-nya seragam dengan SJ penjualan, risikonya bukan cuma alokasi biaya — tapi siapa yang dianggap melakukan penyerahan untuk tujuan PPN. Ini alasan step 15 harus dipecah dan bukan cukup ditandai atribut pemilik.', 'G14',
   '["SJ pengiriman barang klien — SAMB sebagai pengangkut, bukan penjual","Referensi DO klien","Salinan SJ untuk klien","Feed ke LP02 Trip Log"]'::jsonb, '[{"code":"6.3.01","label":"Storing — Manpower — carve-out ke COS–LP"},{"code":"Neraca","label":"Barang titipan berkurang — bukan penjualan"}]'::jsonb, '["CBM outbound per klien → Pool 4, porsi COS–LP","CBM per SJ per klien → dasar tagih trucking"]'::jsonb),
  ('16', 13, 'FLEET', 'Logistics', 'KEDUANYA', 'Trip planning & muat armada',
   'Utilisasi rendah tidak terpantau sehingga terserap diam-diam ke unit cost; trip tercatat tanpa muatan riil.', 'Utilization dihitung otomatis di Trip Log; approval rute sebelum armada keluar.', 'Under-utilisasi adalah variance yang harus dimunculkan, bukan dikubur ke unit cost. Itu sebabnya denominatornya normal capacity. TIDAK BISA DIPECAH: satu trip mengangkut SJ barang sendiri dan SJ barang klien sekaligus — grain-nya per-trip, bukan per-pemilik. Pembelahan biayanya terjadi DI DALAM step ini, lewat Kepemilikan Barang per SJ di Trip Log.', 'G06',
   '["LP02 Trip Log — Trip Key, Armada, Kepemilikan Barang, utilization","LP02 Master Truck","Rencana rute & zona"]'::jsonb, '[{"code":"7.3.04","label":"Distribution — Delivery"},{"code":"7.3.05","label":"Distribution — Maintenance"},{"code":"7.3.08","label":"Distribution — Depreciation"},{"code":"7.3.01","label":"Distribution — Manpower"}]'::jsonb, '["CBM per trip dari Trip Log","Normal / achievable capacity per tipe truk — BUKAN actual","Depresiasi normalized per tipe truk"]'::jsonb),
  ('17', 14, 'FLEET', 'Logistics', 'KEDUANYA', 'Delivery ke customer',
   'BBM dan uang jalan tidak sepadan dengan rute; deviasi rute tidak terdeteksi.', 'Log BBM per trip direkonsiliasi dengan jarak GPS; deviasi di atas ambang wajib penjelasan.', 'Tidak bisa dipecah karena alasan yang sama seperti step 16 — satu perjalanan, muatan campuran. BBM dan uang jalan satu trip melayani dua jenis barang; pembagiannya lewat CBM per SJ per pemilik.', null,
   '["SJ + tanda terima","Log BBM per trip","Data GPS / tracking"]'::jsonb, '[{"code":"7.3.04","label":"Distribution — Delivery: BBM, tol, uang jalan"}]'::jsonb, '["CBM × zona (Zone 1 / 2 / 3)","Backhaul sudah di dalam asumsi tarif round-trip Zone 2 & 3"]'::jsonb),
  ('18a', 15, 'FLEET', 'serah ke Finance', 'TRADE', 'POD & serah terima — barang sendiri',
   'POD hilang sehingga invoice tidak bisa ditagih dan umur AR jalan tanpa dasar; retur di lapangan tidak masuk sistem.', 'Tracking POD dengan SLA pengembalian; retur wajib bernota sebelum truk kembali ditutup.', 'Titik cut-off pengakuan revenue SAMB. Retur masuk kembali sebagai inventory SAMB.', null,
   '["POD bertanda tangan customer","Nota retur / reject"]'::jsonb, '[{"code":"4.3.xx","label":"Revenue — trigger pengakuan"},{"code":"5.3.xx","label":"COGS — trigger pengakuan"}]'::jsonb, '[]'::jsonb),
  ('18b', 15, 'FLEET', 'serah ke Finance', 'LP', 'POD & serah terima — barang klien',
   'POD barang klien tidak dikembalikan ke klien sehingga klien tidak bisa mengakui penjualannya dan SAMB tidak punya bukti jasa selesai; retur titipan dicatat sebagai retur penjualan sehingga ikut masuk inventory SAMB.', 'SLA pengembalian salinan POD ke klien; retur titipan masuk ledger titipan, bukan inventory.', 'TIDAK ADA REVENUE DAN TIDAK ADA COGS yang diakui di sini. Yang selesai adalah jasa — dan POD-nya barang bukti yang harus DISERAHKAN ke klien, bukan cuma diarsip. Ini kewajiban SAMB ke klien, bukan dokumen internal.', 'G14',
   '["POD bertanda tangan penerima","Salinan POD untuk klien","Nota retur titipan"]'::jsonb, '[{"code":"Memo","label":"Penyelesaian jasa — bukan pengakuan penjualan"},{"code":"Neraca","label":"Barang titipan berkurang — off-balance"}]'::jsonb, '["SJ terselesaikan per klien → konfirmasi konsumsi layanan"]'::jsonb),
  ('19', 16, 'FINANCE', 'AR + Tax', 'TRADE', 'Terbit invoice & faktur pajak',
   'Invoice tidak match SJ atau POD; faktur pajak terlambat terbit sehingga timbul eksposur sanksi.', 'Invoice hanya boleh terbit dari POD valid; rekonsiliasi invoice vs faktur pajak bulanan.', 'Semua invoice dicetak fisik — itu sebabnya jumlah invoice cukup jadi driver tunggal untuk people cost dan paper cost sekaligus, tanpa driver kertas terpisah.', 'G11',
   '["Invoice (dicetak fisik)","Faktur pajak / e-Faktur"]'::jsonb, '[{"code":"4.3.xx","label":"Revenue"},{"code":"5.3.xx","label":"COGS"},{"code":"8.1.01","label":"Commercial Support — Manpower"},{"code":"Neraca","label":"PPN keluaran"}]'::jsonb, '["Jumlah invoice created → Commercial Support (people cost DAN paper cost)"]'::jsonb),
  ('20', 16, 'FINANCE', 'PF + Warehouse + Fleet', 'LP', 'Pengukuran konsumsi layanan per klien LP',
   'Tagihan disusun dari estimasi karena konsumsi tidak pernah diukur; revenue LP tidak bisa dipertanggungjawabkan ke volume.', 'Rekap konsumsi ditutup bersamaan dengan tutup buku dan dikonfirmasi klien sebelum ditagih.', 'Pintu dua arah. Angka yang sama menentukan berapa yang DITAGIH ke klien dan berapa biaya pool bersama yang DICARVE-OUT jadi COS–LP. Satu pengukuran, dua kegunaan — dan kalau tidak diukur, dua-duanya jadi taksiran.', 'G14',
   '["Rekap pallet-day per klien","Rekap CBM terkirim per klien","LP01 + LP02 sebagai sumber"]'::jsonb, '[]'::jsonb, '["Pallet-day per klien → dasar tagih fulfillment","CBM × zona per klien → dasar tagih trucking","Baris pick per klien → kandidat driver fulfillment"]'::jsonb),
  ('21', 17, 'FINANCE', 'AR + Tax', 'LP', 'Terbit invoice jasa LP & faktur pajak',
   'Revenue LP diakui tanpa carve-out biayanya, sehingga margin jasa LP terlihat lebih tinggi dari sebenarnya dan Storing Cost menanggung biaya melayani barang milik klien.', 'Invoice hanya terbit dari rekap konsumsi terukur; carve-out COS–LP dibukukan di periode yang sama dengan revenue-nya.', 'DI SINI RISIKO DOUBLE COUNT. Sewa gudang dan biaya armada yang melayani barang klien tidak boleh tetap tinggal di Storing/Distribution Cost sekaligus muncul di COS–LP. Satu pool, satu kali.', 'G13',
   '["Invoice jasa LP","Faktur pajak","Lampiran rekap konsumsi"]'::jsonb, '[{"code":"4.4.xx","label":"Revenue — Logistic Provider"},{"code":"5.4.xx","label":"COS – LP Fulfillment / Trucking — carve-out dari pool bersama"},{"code":"Neraca","label":"PPN keluaran"},{"code":"Neraca","label":"AR jasa LP"}]'::jsonb, '["Tarif × konsumsi terukur per klien"]'::jsonb),
  ('23', 17, 'FINANCE', 'AR', 'TRADE', 'Kirim tagihan & tukar faktur',
   'Tagihan tidak sampai ke customer tetapi umur AR sudah berjalan; tanda terima tidak diarsip.', 'Tanda terima tukar faktur wajib kembali dan diarsip; log dicek terhadap daftar invoice terbit.', '', 'G12',
   '["Tanda terima tukar faktur","Log pengiriman tagihan"]'::jsonb, '[{"code":"8.1.01","label":"Commercial Support — Manpower"},{"code":"8.1.10","label":"Commercial Support — kurir & materai"}]'::jsonb, '["Jumlah invoice created"]'::jsonb),
  ('22', 18, 'FINANCE', 'Tax + PF', 'LP', 'Dokumentasi transfer pricing — khusus klien afiliasi',
   'Tarif ke afiliasi berbeda dari tarif ke pihak ketiga tanpa penjelasan, sehingga selisihnya jadi koreksi.', 'Tarif afiliasi disandarkan pada tarif pihak ketiga untuk layanan sebanding; deviasi didokumentasikan sebab dan besarnya.', 'Keunggulan struktural dari punya klien pihak ketiga: tarif ke pihak ketiga adalah internal comparable TERBAIK untuk uji arm''s length ke afiliasi. PMK-172 menuntut analisis kesebandingan penuh — dan pembandingnya sudah ada di dalam rumah, tidak perlu dicari di pasar.', null,
   '["Transfer pricing documentation","Analisis kesebandingan","Bukti manfaat bagi penerima jasa"]'::jsonb, '[]'::jsonb, '["Tarif ke afiliasi vs tarif ke klien pihak ketiga"]'::jsonb),
  ('24', 19, 'FINANCE', 'AR', 'KEDUANYA', 'Monitoring AR & collection',
   'Overdue tidak ditagih karena tidak ada pemilik; dispute mengendap tanpa follow-up dan berubah jadi write-off.', 'Review aging bulanan dengan pemilik per akun; dunning bertingkat dengan tanggal eskalasi.', 'Biaya manager AR reconciliation masuk G&A, bukan Commercial Support — pemisahannya sengaja, supaya driver invoice tidak menanggung biaya collection.', 'G10',
   '["AR aging","Statement of account","Log dunning"]'::jsonb, '[{"code":"9.1.01","label":"G&A — Manpower: manager AR reconciliation"}]'::jsonb, '["Weeks of credit → rotations = 52 ÷ (weeks stock + weeks credit)"]'::jsonb),
  ('25', 20, 'FINANCE', 'Accounting', 'KEDUANYA', 'Rekon AR & aplikasi pembayaran',
   'Pembayaran masuk tidak teridentifikasi ke invoice; selisih ''Per BS'' vs ''Control'' dibiarkan tanpa penelusuran lalu ikut masuk matrix intercompany.', 'Rekonsiliasi bank–GL harian; pre-recon tiap line item ke akun TB-nya SEBELUM masuk matrix intercompany.', 'Ini pintu terakhir sebelum angka masuk konsolidasi. Kontrol pre-recon di sini yang menentukan apakah matrix intercompany bisa dipakai.', 'G04',
   '["Rekening koran","WP rekonsiliasi AR","Posting GL → TB"]'::jsonb, '[{"code":"Neraca","label":"Kas / bank"},{"code":"Neraca","label":"Penyelesaian AR"}]'::jsonb, '[]'::jsonb),
  ('26', 21, 'FINANCE', 'Accounting + PF', 'LP', 'Rekonsiliasi intercompany & eliminasi',
   'Eliminasi dipaksa simetris padahal IS bukan mirror; unrealized profit atas markup jasa tidak dieliminasi sehingga laba konsolidasi lebih tinggi dari seharusnya.', 'Pre-recon tiap line item ke akun TB-nya sebelum masuk matrix; IS di-match per nomor dokumen, bukan per total.', 'BS adalah mirror simetris — AR di A = AP di B, satu lawan satu. IS tidak. Berlaku HANYA untuk klien LP yang berstatus afiliasi; tagihan ke klien pihak ketiga tidak dieliminasi.', 'G04',
   '["Matrix intercompany 9 entitas — BS & IS","Kertas kerja eliminasi","TB konsolidasi"]'::jsonb, '[{"code":"Elim","label":"Eliminasi revenue ↔ biaya at cost"},{"code":"Elim","label":"Eliminasi unrealized profit atas markup"}]'::jsonb, '[]'::jsonb)
on conflict (label) do nothing;

-- 5. Needs ------------------------------------------------------------------
insert into public.os_process_needs (step_id, item, kind, src, owner, status)
select s.id, v.item, v.kind, v.src, v.owner, v.status
from (values
  ('1', 'Perjanjian jasa tertulis per klien LP', 'MASTER', 'Legal / Commercial', 'Sales + FAT', 'BELUM'),
  ('1', 'Master klien LP — badan usaha, term, tarif', 'MASTER', 'Sistem / Sales', 'Sales', 'BELUM'),
  ('1', 'Basis penetapan tarif layanan', 'PARAMETER', 'LP02 Rate Card Model', 'PF', 'SEBAGIAN'),
  ('1', 'Benchmark tarif pasar 3PL', 'REFERENSI', 'Pasar', 'Sales + PF', 'BELUM'),
  ('1', 'Limit kredit per klien LP', 'MASTER', 'Finance', 'Finance AR', 'BELUM'),
  ('2', 'Historis sales per principal per SKU per bulan', 'TRANSAKSI', 'SAP — VBRP', 'IT + FAT', 'ADA'),
  ('2', 'Kalender promo & program principal', 'REFERENSI', 'Principal', 'Sales (Mbak Yani)', 'SEBAGIAN'),
  ('2', 'Target CBM per gudang per periode', 'PARAMETER', 'Kebijakan internal', 'PF', 'BELUM'),
  ('2', 'Kapasitas normal gudang dalam pallet position', 'PARAMETER', 'Survey gudang', 'Warehouse (Pak Deni)', 'BELUM'),
  ('2', 'Lead time principal per SKU', 'MASTER', 'Kesepakatan principal', 'Purchasing', 'BELUM'),
  ('3', 'Price list principal aktif per SKU', 'MASTER', 'Price list principal', 'Purchasing', 'ADA'),
  ('3', 'Isi per karton per SKU', 'MASTER', 'Price list principal', 'Purchasing / Commercial', 'BELUM'),
  ('3', 'Trading term & skema discount per principal', 'REFERENSI', 'Kontrak principal', 'Sales + Purchasing', 'SEBAGIAN'),
  ('3', 'Matriks otorisasi PO', 'PARAMETER', 'Kebijakan internal', 'Management', 'SEBAGIAN'),
  ('4', 'Jadwal slot bongkar harian', 'TRANSAKSI', 'Belum ada sistem', 'Warehouse', 'BELUM'),
  ('4', 'Occupancy gudang harian', 'TRANSAKSI', 'WMS / LP01', 'Warehouse', 'SEBAGIAN'),
  ('5', 'Instruksi penitipan per klien', 'TRANSAKSI', 'Dokumen klien', 'Sales Admin + Warehouse', 'BELUM'),
  ('5', 'Berita acara terima titipan', 'TRANSAKSI', 'Form manual', 'Warehouse Inbound', 'BELUM'),
  ('5', 'Master klien LP sebagai pemilik barang', 'MASTER', 'Sistem', 'Sales', 'BELUM'),
  ('6a', 'Qty terima per SKU per PO', 'TRANSAKSI', 'Tally sheet bongkar', 'Warehouse Inbound', 'ADA'),
  ('6a', 'Jumlah & jam kerja tenaga bongkar', 'TRANSAKSI', 'Absensi / borongan', 'Warehouse + HR', 'BELUM'),
  ('6a', 'Berita acara selisih terima', 'TRANSAKSI', 'Form manual', 'Warehouse Inbound', 'SEBAGIAN'),
  ('6b', 'Qty terima per SKU per instruksi penitipan', 'TRANSAKSI', 'Tally sheet bongkar', 'Warehouse Inbound', 'BELUM'),
  ('6b', 'Jumlah & jam kerja tenaga bongkar per pemilik barang', 'TRANSAKSI', 'Absensi / borongan', 'Warehouse + HR', 'BELUM'),
  ('6b', 'Kepemilikan Barang — kode klien LP', 'TRANSAKSI', 'Tally sheet', 'Warehouse Inbound', 'BELUM'),
  ('7a', 'Nomor & tanggal GRN dengan link ke PO', 'TRANSAKSI', 'SAP', 'FAT', 'ADA'),
  ('7a', 'Faktor konversi PC ↔ karton per SKU', 'MASTER', 'Price list principal', 'Purchasing', 'BELUM'),
  ('7a', 'Harga beli per SKU', 'TRANSAKSI', 'Invoice principal', 'FAT', 'ADA'),
  ('7b', 'Berita acara terima titipan bernomor', 'TRANSAKSI', 'Form manual', 'Warehouse Inbound', 'BELUM'),
  ('7b', 'Kuantitas & kondisi terima per SKU klien', 'TRANSAKSI', 'WMS', 'Warehouse + IT', 'BELUM'),
  ('7b', 'Dimensi karton SKU klien untuk konversi CBM', 'MASTER', 'Data dari klien', 'Sales + Warehouse', 'BELUM'),
  ('8', 'Dimensi karton P × L × T per SKU', 'MASTER', 'Product master / spec principal', 'Commercial', 'BELUM'),
  ('8', 'Max tumpuk aktual per SKU', 'MASTER', 'Observasi gudang', 'Warehouse (Pak Deni)', 'BELUM'),
  ('8', 'Tinggi rak berguna per zona gudang', 'MASTER', 'Ukur gudang', 'Warehouse', 'BELUM'),
  ('8', 'Lokasi / bin per SKU', 'TRANSAKSI', 'WMS', 'Warehouse', 'ADA'),
  ('8', 'Pallet position terpakai per principal', 'TRANSAKSI', 'WMS / LP01', 'Warehouse', 'SEBAGIAN'),
  ('8', 'Kepemilikan Barang — milik SAMB vs titipan afiliasi', 'TRANSAKSI', 'WMS — atribut lot / lokasi', 'Warehouse + IT', 'BELUM'),
  ('9', 'Stok awal & akhir per SKU per periode — qty dan nilai', 'TRANSAKSI', 'SAP / WMS', 'FAT', 'ADA'),
  ('9', 'CBM tersimpan per principal per periode', 'TRANSAKSI', 'Turunan dari dimensi karton', 'PF', 'BELUM'),
  ('9', 'Inventory days per principal', 'PARAMETER', 'Turunan — 2 jalur, belum dipilih', 'PF', 'BELUM'),
  ('9', 'Biaya sewa gudang per periode', 'TRANSAKSI', 'GL', 'FAT', 'ADA'),
  ('9', 'Pallet position tersedia per gudang', 'MASTER', 'Layout gudang', 'Warehouse', 'SEBAGIAN'),
  ('9', 'Headcount & pembagian waktu per 4 activity pool', 'MASTER', 'HR + time study', 'HR + Warehouse', 'BELUM'),
  ('9', 'Hasil opname & selisih per periode', 'TRANSAKSI', 'Berita acara opname', 'Warehouse', 'SEBAGIAN'),
  ('9', 'Aging stok per SKU', 'TRANSAKSI', 'WMS', 'Warehouse', 'SEBAGIAN'),
  ('9', 'Kepemilikan Barang — milik SAMB vs titipan afiliasi', 'TRANSAKSI', 'WMS stock report', 'Warehouse + IT', 'BELUM'),
  ('10', 'SO — customer, SKU, qty, tanggal minta', 'TRANSAKSI', 'SAP', 'Sales / CS', 'ADA'),
  ('10', 'Limit kredit & outstanding AR per customer', 'TRANSAKSI', 'SAP', 'Finance AR', 'ADA'),
  ('10', 'Jumlah order per principal per periode', 'TRANSAKSI', 'Turunan dari SO', 'PF', 'SEBAGIAN'),
  ('10', 'Master customer — channel, zona, alamat kirim', 'MASTER', 'SAP', 'Sales', 'SEBAGIAN'),
  ('11', 'Delivery order dari klien LP', 'TRANSAKSI', 'Dokumen klien', 'Sales Admin', 'BELUM'),
  ('11', 'Alamat & zona tujuan customer klien', 'MASTER', 'Master tujuan', 'Sales + Fleet', 'BELUM'),
  ('12', 'Stok tersedia real-time per SKU', 'TRANSAKSI', 'WMS', 'Warehouse', 'ADA'),
  ('12', 'Tanggal expired per lot & aturan FEFO', 'MASTER', 'WMS', 'Warehouse', 'SEBAGIAN'),
  ('12', 'Rute & zona per customer', 'MASTER', 'Master rute', 'Sales + Fleet', 'SEBAGIAN'),
  ('13', 'Baris pick per DO', 'TRANSAKSI', 'WMS', 'Warehouse Outbound', 'ADA'),
  ('13', 'Jumlah baris pick per periode per principal', 'TRANSAKSI', 'Turunan dari WMS', 'PF', 'BELUM'),
  ('13', 'Jam kerja picker per periode', 'TRANSAKSI', 'Absensi', 'Warehouse + HR', 'BELUM'),
  ('13', 'Kepemilikan Barang — milik SAMB vs titipan afiliasi', 'TRANSAKSI', 'WMS picking', 'Warehouse', 'BELUM'),
  ('14', 'Jumlah order dipacking per periode', 'TRANSAKSI', 'Turunan dari DO', 'PF', 'SEBAGIAN'),
  ('14', 'Pemakaian material packing per periode', 'TRANSAKSI', 'GL / stok material', 'Warehouse + FAT', 'BELUM'),
  ('15a', 'CBM per SJ', 'TRANSAKSI', 'Kolom di SJ → LP02 Trip Log', 'Warehouse Outbound', 'BELUM'),
  ('15a', 'Berat per SJ', 'TRANSAKSI', 'Kolom di SJ', 'Warehouse Outbound', 'BELUM'),
  ('15a', 'Nomor SJ, tanggal, customer, ref DO', 'TRANSAKSI', 'SAP / WMS', 'Warehouse Outbound', 'ADA'),
  ('15a', 'Jam kerja loading per periode', 'TRANSAKSI', 'Absensi', 'Warehouse + HR', 'BELUM'),
  ('15b', 'CBM per SJ barang klien', 'TRANSAKSI', 'Kolom di SJ → LP02 Trip Log', 'Warehouse Outbound', 'BELUM'),
  ('15b', 'Kepemilikan Barang per SJ', 'TRANSAKSI', 'Kolom di SJ', 'Warehouse Outbound', 'BELUM'),
  ('15b', 'Peran SAMB di SJ — pengangkut vs penjual', 'PARAMETER', 'Perjanjian jasa', 'FAT + Tax', 'BELUM'),
  ('15b', 'Nomor seri SJ terpisah dari SJ penjualan', 'MASTER', 'Sistem penomoran', 'Warehouse + IT', 'BELUM'),
  ('16', 'Master truk — nopol, tipe, kapasitas CBM & tonase, tahun, nilai perolehan', 'MASTER', 'LP02 Master Truck', 'Fleet', 'SEBAGIAN'),
  ('16', 'Normal / achievable capacity per tipe truk', 'PARAMETER', 'Konfirmasi operasional', 'Fleet', 'BELUM'),
  ('16', 'Trip log per SJ — Trip Key, armada, kepemilikan barang, CBM, utilization', 'TRANSAKSI', 'LP02 Trip Log', 'Fleet', 'SEBAGIAN'),
  ('16', 'Biaya per akun trucking per periode', 'TRANSAKSI', 'GL', 'FAT', 'ADA'),
  ('16', 'Umur ekonomis & metode depresiasi per tipe truk', 'PARAMETER', 'Kebijakan akuntansi', 'FAT', 'SEBAGIAN'),
  ('16', 'Benchmark rate / rate card per rute', 'REFERENSI', 'Pasar / vendor luar', 'Sales', 'BELUM'),
  ('16', 'Kepemilikan Barang — milik SAMB vs titipan afiliasi', 'TRANSAKSI', 'LP02 Trip Log', 'Fleet', 'SEBAGIAN'),
  ('17', 'Jarak & zona per rute', 'MASTER', 'Master rute', 'Fleet', 'SEBAGIAN'),
  ('17', 'Konsumsi & biaya BBM per trip', 'TRANSAKSI', 'Log BBM', 'Fleet', 'SEBAGIAN'),
  ('17', 'Uang jalan & tol per trip', 'TRANSAKSI', 'Settlement driver', 'Fleet + Finance', 'ADA'),
  ('17', 'Jarak aktual dari GPS', 'TRANSAKSI', 'Sistem GPS', 'Fleet + IT', 'BELUM'),
  ('18a', 'POD — tanggal terima, nama penerima, status', 'TRANSAKSI', 'POD fisik', 'Fleet', 'SEBAGIAN'),
  ('18a', 'Retur / reject — SKU, qty, alasan', 'TRANSAKSI', 'Nota retur', 'Fleet + Sales', 'BELUM'),
  ('18a', 'Tanggal cut-off pengakuan per periode', 'PARAMETER', 'Kalender close', 'FAT', 'ADA'),
  ('18b', 'POD barang klien dengan tanda terima', 'TRANSAKSI', 'POD fisik', 'Fleet', 'BELUM'),
  ('18b', 'Salinan POD dikirim ke klien', 'TRANSAKSI', 'Log pengiriman POD', 'Sales Admin', 'BELUM'),
  ('18b', 'Retur titipan — SKU, qty, alasan', 'TRANSAKSI', 'Nota retur titipan', 'Fleet + Warehouse', 'BELUM'),
  ('19', 'Invoice — nomor, tanggal, customer, nilai, ref SJ', 'TRANSAKSI', 'SAP', 'Finance AR', 'ADA'),
  ('19', 'Jumlah invoice created per periode per principal', 'TRANSAKSI', 'Turunan dari SAP', 'PF', 'SEBAGIAN'),
  ('19', 'Faktur pajak — nomor seri, tanggal, DPP, PPN', 'TRANSAKSI', 'e-Faktur', 'Tax', 'ADA'),
  ('19', 'Headcount & biaya staff invoicing vs collection', 'MASTER', 'HR', 'HR + Finance', 'BELUM'),
  ('19', 'Porsi dedikasi Asman Tax', 'PARAMETER', 'HR', 'HR', 'BELUM'),
  ('20', 'Pallet-day per klien LP per periode', 'TRANSAKSI', 'Turunan WMS + LP01', 'PF', 'BELUM'),
  ('20', 'CBM terkirim per klien per zona', 'TRANSAKSI', 'Turunan LP02 Trip Log', 'PF', 'BELUM'),
  ('20', 'Baris pick per klien per periode', 'TRANSAKSI', 'Turunan WMS', 'PF', 'BELUM'),
  ('21', 'Nomor & nilai invoice jasa LP per klien', 'TRANSAKSI', 'SAP', 'Finance AR', 'SEBAGIAN'),
  ('21', 'Faktur pajak atas jasa LP', 'TRANSAKSI', 'e-Faktur', 'Tax', 'SEBAGIAN'),
  ('21', 'Nomor dokumen referensi — untuk klien berstatus afiliasi', 'TRANSAKSI', 'SAP', 'FAT', 'SEBAGIAN'),
  ('23', 'Tanda terima tukar faktur — tanggal kirim & tanggal diterima', 'TRANSAKSI', 'Log manual AR', 'Finance AR', 'BELUM'),
  ('23', 'Biaya kurir & materai per periode', 'TRANSAKSI', 'GL', 'FAT', 'ADA'),
  ('23', 'Jadwal tukar faktur per customer', 'MASTER', 'Kesepakatan customer', 'Finance AR', 'SEBAGIAN'),
  ('22', 'Daftar klien LP yang berstatus afiliasi', 'MASTER', 'Daftar entitas grup', 'FAT', 'SEBAGIAN'),
  ('22', 'Tarif ke klien pihak ketiga sebagai pembanding internal', 'REFERENSI', 'Rate card & invoice aktual', 'Sales + PF', 'BELUM'),
  ('22', 'Analisis kesebandingan per transaksi afiliasi', 'MASTER', 'Kertas kerja TP', 'Tax + PF', 'BELUM'),
  ('24', 'AR aging per customer per invoice', 'TRANSAKSI', 'SAP', 'Finance AR', 'ADA'),
  ('24', 'Term of payment per customer', 'MASTER', 'Kontrak customer', 'Sales + Finance', 'ADA'),
  ('24', 'Weeks of credit aktual per channel', 'PARAMETER', 'Turunan dari AR aging', 'PF', 'SEBAGIAN'),
  ('24', 'Log dunning & dispute', 'TRANSAKSI', 'Belum ada sistem', 'Finance AR', 'BELUM'),
  ('24', 'Scope fungsi AP di baris AR-AP-Finance Salary', 'PARAMETER', 'Keputusan internal', 'FAT', 'BELUM'),
  ('24', 'AR jasa LP per klien, terpisah dari AR trade', 'TRANSAKSI', 'SAP', 'Finance AR', 'BELUM'),
  ('24', 'Limit kredit & outstanding per klien LP', 'MASTER', 'Finance', 'Finance AR', 'BELUM'),
  ('25', 'Rekening koran harian', 'TRANSAKSI', 'Bank', 'Finance', 'ADA'),
  ('25', 'Mapping COA T.G.FF.DDDD final', 'MASTER', 'Kertas kerja mapping', 'PF + FAT (Mbak Muti)', 'SEBAGIAN'),
  ('25', 'Rekonsiliasi ''Per BS'' vs ''Control'' per akun', 'TRANSAKSI', 'Kertas kerja rekon', 'FAT', 'BELUM'),
  ('25', 'Daftar transaksi afiliasi + nomor dokumen referensi', 'TRANSAKSI', 'GL', 'FAT', 'SEBAGIAN'),
  ('25', 'Sisa inventory unsold dari pembelian afiliasi per entitas', 'TRANSAKSI', 'GL — perlu filter scope', 'FAT', 'BELUM'),
  ('26', 'Saldo AR/AP afiliasi yang sudah direkonsiliasi dua sisi', 'TRANSAKSI', 'Submission entitas', 'FAT', 'SEBAGIAN'),
  ('26', 'Pasangan revenue ↔ biaya per nomor dokumen', 'TRANSAKSI', 'GL kedua entitas', 'FAT', 'BELUM'),
  ('26', 'Markup di atas biaya per jenis layanan', 'PARAMETER', 'LP02 Rate Card vs biaya aktual', 'PF', 'BELUM')
) as v(step_label, item, kind, src, owner, status)
join public.os_process_steps s on s.label = v.step_label
where not exists (
  select 1 from public.os_process_needs n
  where n.step_id = s.id and n.item = v.item
);

-- 6. The step → Finish line bridge ------------------------------------------
-- Many-to-many, one row per (step, Finish line row). LITERAL UUIDS, NEVER A
-- LABEL LOOKUP: three Finish line labels are duplicated across sections
-- (Storing cost, Distribution cost and Commercials and support each appear
-- once under Laba rugi with accounts behind them and once under Margin
-- layering & cost-to-serve as a derived metric), so matching by label would
-- silently pick the wrong one or map both. These ids were read from the live
-- table on 6 August. The two Margin-layering twins are deliberately NOT
-- mapped — derived metrics with no accounts underneath.
--
-- step_id IS resolved by label, because step uuids are generated by
-- gen_random_uuid() when section 4 runs; the join drops nothing, since every
-- label below is asserted present in the seed.
--
-- A uuid that does not exist in os_finish_line_items raises a foreign-key
-- violation and aborts the whole migration. That is the intended failure:
-- the mapping is a claim about live rows, and a claim that no longer holds
-- must stop the apply rather than seed a partial map.
--
-- 45 pairs across 17 Finish line rows. Steps 4, 11, 12, 18b, 22 and 26 feed
-- no row yet — recorded in the PR, not an omission to fix here.
insert into public.os_process_step_items (step_id, item_id)
select s.id, v.item_id::uuid
from (values
  -- Sales — General Trade
  ('2', '634e675f-4681-4307-b831-6cad1e7d80fa'),
  ('10', '634e675f-4681-4307-b831-6cad1e7d80fa'),
  ('18a', '634e675f-4681-4307-b831-6cad1e7d80fa'),
  ('19', '634e675f-4681-4307-b831-6cad1e7d80fa'),
  -- Sales — Logistic provider
  ('1', '2b7394bf-92f4-4900-b2a6-03353dbe6d98'),
  ('20', '2b7394bf-92f4-4900-b2a6-03353dbe6d98'),
  ('21', '2b7394bf-92f4-4900-b2a6-03353dbe6d98'),
  -- COGS — General Trade
  ('7a', '2e4c8392-8c03-488b-b30c-d633b5b00ea3'),
  ('9', '2e4c8392-8c03-488b-b30c-d633b5b00ea3'),
  -- COGS — Logistic provider
  ('5', '768beb21-1151-4a1f-924a-c1c3f5001348'),
  ('6b', '768beb21-1151-4a1f-924a-c1c3f5001348'),
  ('7b', '768beb21-1151-4a1f-924a-c1c3f5001348'),
  ('20', '768beb21-1151-4a1f-924a-c1c3f5001348'),
  ('21', '768beb21-1151-4a1f-924a-c1c3f5001348'),
  -- Storing cost
  ('6a', '10b151a5-5c45-454c-a13b-ffbc786ec645'),
  ('8', '10b151a5-5c45-454c-a13b-ffbc786ec645'),
  ('9', '10b151a5-5c45-454c-a13b-ffbc786ec645'),
  ('13', '10b151a5-5c45-454c-a13b-ffbc786ec645'),
  ('14', '10b151a5-5c45-454c-a13b-ffbc786ec645'),
  ('15a', '10b151a5-5c45-454c-a13b-ffbc786ec645'),
  -- Distribution cost
  ('15a', '7d040e4a-7bf4-425a-b171-a46245d8158c'),
  ('16', '7d040e4a-7bf4-425a-b171-a46245d8158c'),
  ('17', '7d040e4a-7bf4-425a-b171-a46245d8158c'),
  -- Commercials and support
  ('19', '390d42f8-4add-4f23-b59f-1c8aed3bc5e1'),
  ('23', '390d42f8-4add-4f23-b59f-1c8aed3bc5e1'),
  ('24', '390d42f8-4add-4f23-b59f-1c8aed3bc5e1'),
  -- Revenue / CBM
  ('3', '8f95868d-0cdd-4590-beb0-244777dad99e'),
  ('7a', '8f95868d-0cdd-4590-beb0-244777dad99e'),
  -- Pallet utilisation
  ('8', '1054d85e-83b7-4ae9-bdd6-1aa48bbde597'),
  ('9', '1054d85e-83b7-4ae9-bdd6-1aa48bbde597'),
  ('16', '1054d85e-83b7-4ae9-bdd6-1aa48bbde597'),
  -- Volume delivered
  ('15a', 'eeabd2b2-85af-4d86-8940-d7191203592b'),
  ('15b', 'eeabd2b2-85af-4d86-8940-d7191203592b'),
  -- Cartons delivered
  ('3', 'f656f8d2-73e8-4835-b7b0-2b4c7429844f'),
  ('7a', 'f656f8d2-73e8-4835-b7b0-2b4c7429844f'),
  -- Delivery trips
  ('16', '1df8ea55-0e61-4f4f-a0df-c55e5cea42a6'),
  ('17', '1df8ea55-0e61-4f4f-a0df-c55e5cea42a6'),
  -- Pallet positions used
  ('8', 'd0199bc1-d9e9-4b24-9d6c-b3ebead0cb60'),
  ('9', 'd0199bc1-d9e9-4b24-9d6c-b3ebead0cb60'),
  -- Inventories
  ('7a', '873b8990-305d-426b-b43d-9effc2398957'),
  ('9', '873b8990-305d-426b-b43d-9effc2398957'),
  -- Trade payable
  ('7a', '39eac155-d88e-4536-a42f-f5d4c3698cea'),
  -- Trade receivable
  ('24', '5af36fdd-bc29-4372-9d5a-cd77afda0dfb'),
  ('25', '5af36fdd-bc29-4372-9d5a-cd77afda0dfb'),
  -- DSO
  ('24', 'd5b2d207-b46d-4761-b5d4-b2eb16969c57')
) as v(step_label, item_id)
join public.os_process_steps s on s.label = v.step_label
on conflict (step_id, item_id) do nothing;
