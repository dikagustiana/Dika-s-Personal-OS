-- ===========================================================================
-- ARBI B2C PROCESS: SEED. Data only — the entity-aware schema is
-- 20260806000052 and MUST be applied first.
-- ===========================================================================
-- Contents come verbatim from the curated seed arbi-process-seed.json
-- (composed and revised outside the app; there is deliberately no importer,
-- no export UI and no in-app structure editor). Counts are fixed and
-- asserted by the frontend logic tests: 6 lanes (MARKETPLACE and KURIR
-- external), 3 tracks (FORWARD 15 · REVERSE 2 · KEDUANYA 6), 7 phases
-- tiling slots 1..23, 12 gates, 23 steps, 112 needs, 37 bridge pairs over
-- 15 Finish line rows. Contains no financial figures.
--
-- B12 is referenced by no step — deliberate, the same convention as SAMB's
-- G03/G07/G09: gate numbering stays aligned with the blocker register kept
-- outside the app. Steps 1, 3, 5, 11, 12 and 18 feed no Finish line row
-- yet — recorded in the PR, not an omission to fix here. The return path
-- (steps 18–19) is modelled as a forward continuation, not a loop back
-- into inbound; whether it deserves a visual return edge is an open design
-- decision, also recorded in the PR.
--
-- Section 7 maps steps to Finish line rows by LITERAL UUID, read from the
-- live table on 6 August — never a label lookup (three Finish line labels
-- are duplicated across sections). A uuid that no longer exists raises a
-- foreign-key violation and aborts the whole migration; that is the
-- intended failure, not a robustness gap.
--
-- ===========================================================================
-- ONE-SHOT. THIS IS THE FILE THAT WAS ACTUALLY EXPOSED.
-- ===========================================================================
-- It was written as idempotent — tracks, lanes and gates upserting on their
-- PKs, steps on (entity_code, label), phases and needs inserting only when
-- absent, the bridge upserting on its composite PK. Two of those guards match
-- on TEXT, and since 20260806000055 that text is editable from the app:
--
--   phases  matched (entity_code, name, slot_from, slot_to) — `name` editable
--   needs   matches (step_id, item)                         — `item` editable
--
-- SAMB's seed is protected by accident: 20260806000052 made
-- os_process_phases.entity_code NOT NULL and that file does not supply it, so
-- it aborts. THIS FILE SUPPLIES entity_code EVERYWHERE, so it stays perfectly
-- runnable — and that makes it the real hazard. Edit one need's `item` in the
-- app, re-run this, and 112 becomes 113: no error, no notice, no way to see
-- it except by counting.
--
-- The phases guard below now keys on (entity_code, slot_from, slot_to) —
-- geometry, which the app cannot touch. The NEEDS guard is left exactly as it
-- was, because there is no stable natural key to move it to: item, kind, src,
-- owner and status are all editable and one step has many needs. Adding a
-- seed-key column to carry this one case is schema cost for a hazard whose
-- trigger is manual.
--
-- So the file is guarded at the TOP instead: if ARBI steps already exist it
-- raises and the whole migration rolls back. Loud refusal beats silent
-- duplication.
--
-- NOT APPLIED. Apply via the Supabase apply_migration tool AFTER
-- 20260806000052, per the APPLY BEFORE DEPLOY block in the PR that
-- introduced this file. NEVER apply with `supabase db push`,
-- `migration up`, `db reset`, or `db remote commit`.
--
-- Down-migration:
-- supabase/migrations/down/20260806000053_arbi_process_seed_down.sql

-- 0. One-shot guard ---------------------------------------------------------
-- BEFORE ANY STATEMENT. A migration runs in one transaction, so raising here
-- rolls the whole thing back and nothing below is reached. The message names
-- the reason rather than just "already seeded": whoever hits this needs to
-- know that a re-run duplicates SILENTLY, not that it is merely redundant.
do $$
begin
  if exists (select 1 from public.os_process_steps where entity_code = 'ARBI') then
    raise exception
      'Rantai proses % sudah terseed. File ini sekali pakai: penjaga section phases dan needs mencocokkan teks yang kini bisa diedit dari app, jadi menjalankannya ulang akan menduplikasi baris tanpa error. Jalankan down-migration lebih dulu kalau benar-benar mau reseed.', 'ARBI';
  end if;
end
$$;

-- 1. Tracks -----------------------------------------------------------------
insert into public.os_process_tracks (entity_code, code, label, ordinal, is_shared) values
  ('ARBI', 'FORWARD', 'FORWARD', 1, false),
  ('ARBI', 'REVERSE', 'REVERSE', 2, false),
  ('ARBI', 'KEDUANYA', 'BERSAMA', 3, true)
on conflict (entity_code, code) do nothing;

-- 2. Lanes ------------------------------------------------------------------
insert into public.os_process_lanes (entity_code, key, label, description, ordinal, is_external) values
  ('ARBI', 'MARKETPLACE', 'MARKETPLACE', 'Enam platform — sumber order & pemegang dana', 1, true),
  ('ARBI', 'CHANNEL', 'CHANNEL', 'Master, harga, sync stok, status', 2, false),
  ('ARBI', 'PURCHASING', 'PURCHASING', 'Rencana & order ke principal', 3, false),
  ('ARBI', 'WAREHOUSE', 'WAREHOUSE', 'Terima, simpan, pick, pack, dispatch', 4, false),
  ('ARBI', 'KURIR', 'KURIR', 'Last-mile pihak ketiga', 5, true),
  ('ARBI', 'FINANCE', 'FINANCE', 'Settlement, klaim, pajak, rekon', 6, false)
on conflict (entity_code, key) do nothing;

-- 3. Gates ------------------------------------------------------------------
insert into public.os_process_gates (id, type, title, sub, owner, unblock, entity_code) values
  ('B01', 'DATA', 'Dimensi & berat per satuan (pieces)', 'Blocker #1 versi B2C', 'Commercial / Purchasing', 'GT butuh isi per karton. B2C butuh dimensi dan berat SATUAN karena pick-nya per pieces dan ongkirnya per paket. Sumbernya sama — spec dan price list principal — jadi satu permintaan bisa menutup keduanya.', 'ARBI'),
  ('B02', 'DECISION', 'Sumber pembelian ARBI — principal langsung vs beli dari SAMB', 'Menentukan ada tidaknya eliminasi', 'Kamu + FAT', 'Kalau beli dari SAMB, COGS ARBI intercompany dan unrealized profit atas stok yang belum terjual harus dieliminasi. Kalau langsung ke principal, tidak ada eliminasi di jalur pembelian.', 'ARBI'),
  ('B03', 'DATA', 'Stok hidup di lima titik tanpa sumber kebenaran', 'Blocker baru — jalur B2C', 'IT + Channel', 'Tetapkan satu sistem sebagai sumber kebenaran, jadwalkan rekonsiliasi lima titik, dan simpan log kegagalan sync. Tanpa log, selisih hanya bisa disamakan, tidak bisa dijelaskan.', 'ARBI'),
  ('B04', 'DECISION', 'Gudang B2C — FC ARBI sendiri vs titipan di gudang SAMB', 'Menentukan seam ke file GT/LP', 'Kamu + Warehouse', 'Kalau di gudang SAMB, ARBI adalah klien LP afiliasi di file itu dan G13/G14 berlaku dari sisi sebaliknya. Kalau FC sendiri, dua file independen kecuali first-mile. Ini menentukan arsitektur, bukan detail.', 'ARBI'),
  ('B05', 'DECISION', 'Aturan & wewenang disposisi karantina', 'Terbuka', 'Kamu + Warehouse', 'Tetapkan batas umur karantina, pemilik keputusan disposisi, dan dasar penilaian barang layak jual. Tanpa ini stok karantina bernilai buku penuh tanpa batas waktu.', 'ARBI'),
  ('B06', 'DECISION', 'Driver cost-to-serve — order count per priority tier', 'Menajamkan driver order-count e-commerce', 'Kamu', 'Order count telanjang merata-ratakan tier yang dapat picker dedicated dengan tier yang masuk wave normal. Pilih order count per tier, dan perlakukan mix tier sebagai variabel yang bergerak mengikuti jam order per platform.', 'ARBI'),
  ('B07', 'DECISION', 'Titik pengakuan revenue — shipment closed vs delivered', 'Terbuka', 'Kamu + FAT', 'Tiga peristiwa di tiga waktu: uang masuk platform, barang dikirim, barang diterima. Tetapkan satu, tertulis, dan terapkan konsisten termasuk untuk order yang hilang di kurir.', 'ARBI'),
  ('B08', 'DECISION', 'Metode target order count', 'Terbuka', 'Kamu', 'Ditetapkan di step 3 dan dipakai sebagai denominator kapasitas di hilir. Denominatornya pick-hour, bukan CBM — kapasitas orang, bukan kapasitas ruang.', 'ARBI'),
  ('B09', 'DECISION', 'Perlakuan promo & subsidi ongkir', 'Sejajar dengan scope Discount to Distributor di GT', 'Kamu + FAT', 'Tetapkan apakah masuk pengurang revenue atau biaya komersial, dan pisahkan porsi yang ditanggung sendiri dari porsi platform sejak penetapan program.', 'ARBI'),
  ('B10', 'DATA', 'Rincian potongan settlement per order', 'Pengganti blok piutang GT', 'Finance + Channel', 'Minta rincian potongan per order per jenis dari tiap platform. Tanpa itu potongan tidak bisa diuji ke skema yang diperjanjikan, dan B11 tidak punya dasar.', 'ARBI'),
  ('B11', 'DECISION', 'Dasar DPP PPN — GOV vs net payout', 'Bergantung pada B10', 'Tax + FAT', 'Tetapkan tertulis dan konsisten antar platform. Selisih kedua dasar itu sebesar seluruh potongan platform.', 'ARBI'),
  ('B12', 'DATA', 'Arti tipe ASN "PR" dan istilah "ISD"', 'Belum dikonfirmasi — jangan diasumsikan', 'Purchasing + IT', 'PR bisa Purchase Requisition atau Purchase Return, dan akuntansinya beda. ISD di aturan priority tier juga belum diketahui artinya. Dua-duanya cukup satu konfirmasi ke pemilik prosesnya.', 'ARBI')
on conflict (id) do nothing;

-- 4. Phases -----------------------------------------------------------------
insert into public.os_process_phases (entity_code, name, slot_from, slot_to)
select 'ARBI', v.name, v.slot_from, v.slot_to
from (values
  ('SETUP & MASTER', 1, 2),
  ('PENGADAAN', 3, 5),
  ('INBOUND & PENYIMPANAN', 6, 9),
  ('ORDER & OUTBOUND', 10, 14),
  ('PENGIRIMAN', 15, 17),
  ('RETUR', 18, 19),
  ('SETTLEMENT & KAS', 20, 23)
) as v(name, slot_from, slot_to)
-- KEYED ON GEOMETRY, NOT ON THE NAME. `name` is editable from the app since
-- 20260806000055; slot_from and slot_to are not, and a phase IS its span.
-- Matching on the name meant a renamed phase re-inserted as a second row
-- covering the same slots — which then breaks the ribbon's tiling invariant
-- without any error to say so.
where not exists (
  select 1 from public.os_process_phases p
  where p.entity_code = 'ARBI'
    and p.slot_from = v.slot_from and p.slot_to = v.slot_to
);

-- 5. Steps ------------------------------------------------------------------
insert into public.os_process_steps (entity_code, label, slot, lane_key, co, track, name, risk, control, note, gate_id, docs, coa, drivers) values
  ('ARBI', '1', 1, 'CHANNEL', 'Marketplace ops', 'FORWARD', 'Setup SKU master, bundle & mapping kurir',
   'SKU bundle aktif di platform tanpa definisi komponen sehingga stok bundle dan stok komponennya terhitung dua kali. Mapping kurir tidak divalidasi ke batas dimensi dan berat kurir sehingga paket ditolak saat handover.', 'Definisi komponen bundle disetujui sebelum SKU bundle diaktifkan di platform; mapping kurir divalidasi terhadap batas dimensi dan berat masing-masing kurir.', 'Blocker #1 di sini lebih dalam daripada di jalur GT. GT butuh isi per karton; B2C butuh dimensi dan berat per SATUAN karena pick-nya per pieces dan ongkirnya dihitung per paket. Ini master data baru, bukan turunan dari isi per karton.', 'B01',
   '["SKU master di OMS","Definisi SKU bundle → komponen","Mapping SKU per platform","Mapping SKU ↔ kurir"]'::jsonb, '[]'::jsonb, '["Dimensi & berat per satuan — LAHIR DI SINI","Isi per karton per SKU"]'::jsonb),
  ('ARBI', '2', 2, 'CHANNEL', 'Marketplace ops', 'FORWARD', 'Harga jual & program promo per platform',
   'Program promo dijalankan tanpa perhitungan dampak ke margin per SKU. Subsidi ongkir ditanggung sendiri tetapi tidak pernah diukur per order sehingga hilang di dalam potongan settlement.', 'Setiap program punya perhitungan dampak margin sebelum diaktifkan; porsi yang ditanggung sendiri dipisah dari porsi platform sejak penetapan program, bukan direkonstruksi dari laporan settlement.', 'Harga tayang bukan harga yang diterima. Selisihnya lahir di sini sebagai kebijakan, dan baru terlihat angkanya di step 20. Kalau perlakuannya tidak ditetapkan sekarang, rekonsiliasi settlement nanti tidak punya pembanding.', 'B09',
   '["Price list per platform","Kalender promo & campaign platform","Skema subsidi ongkir"]'::jsonb, '[{"code":"4.2.xx","label":"Revenue — bruto sebelum potongan"},{"code":"8.1.xx","label":"Selling & Marketing — biaya program, kalau ditetapkan sebagai biaya"}]'::jsonb, '["GOV vs net revenue per platform","Porsi promo & subsidi yang ditanggung sendiri"]'::jsonb),
  ('ARBI', '3', 3, 'CHANNEL', 'Demand planning', 'FORWARD', 'Demand plan & forecast per platform',
   'Lonjakan campaign pada tanggal kembar tidak diantisipasi sehingga order prioritas menumpuk dan picker dedicated tidak cukup. Overstock mengunci kas pada SKU slow moving yang tidak punya jalur keluar selain diskon.', 'Forecast per platform ditinjau bulanan dengan tracking error; rencana headcount picker disandingkan ke kalender campaign sebelum periode berjalan.', 'Denominator kapasitas di B2C adalah kapasitas ORANG (pick-hour), bukan kapasitas RUANG (CBM). Ini pembeda dari jalur GT yang perlu dipegang konsisten sampai ke alokasi biaya.', 'B08',
   '["Forecast per SKU per platform","Historis order OMS","Kalender campaign platform"]'::jsonb, '[]'::jsonb, '["Target order count per tier — denominator kapasitas","Kapasitas normal pick-hour (PSAK 14)"]'::jsonb),
  ('ARBI', '4', 4, 'PURCHASING', '', 'FORWARD', 'Terbit PO ke principal & buat ASN',
   'PO terbit di luar batas otorisasi; ASN tidak dibuat sehingga inbound tidak bisa diverifikasi sistem dan penerimaan jatuh ke pencatatan manual.', 'ASN wajib dibuat sebelum kedatangan dijadwalkan; harga terkunci ke price list aktif; three-way match PO – penerimaan – invoice principal.', 'ASN punya tiga tipe di Flux: PO, PR, Return. Tipe PR belum dikonfirmasi Purchase Requisition atau Purchase Return — akuntansinya beda dan tidak diasumsikan. Lihat B12.', 'B02',
   '["PO","ASN di Flux — tipe PO / PR / Return","Price list principal","Konfirmasi trading term"]'::jsonb, '[]'::jsonb, '["Isi per karton per SKU"]'::jsonb),
  ('ARBI', '5', 5, 'PURCHASING', '', 'FORWARD', 'Konfirmasi kedatangan & slot bongkar',
   'Truk datang setelah cut-off 15:00 sehingga bongkar bergeser ke hari berikutnya. Barang sudah di lokasi tetapi belum jadi stok yang bisa dijual, dan ASN menggantung tanpa yang memantau.', 'Slot booking bongkar dikonfirmasi ke kapasitas gudang sebelum jadwal dikunci; ASN yang belum closed dimonitor harian terhadap SLA.', 'Cut-off 15:00 adalah kebijakan yang sudah ditetapkan, jadi berstatus PARAMETER ADA — bukan data yang perlu dicari. Konsekuensinya operasional: barang yang datang jam 16:00 baru bisa dijual H+1, dan itu masuk ke lead time efektif, bukan lead time principal.', null,
   '["Konfirmasi order principal","Jadwal slot bongkar","Monitoring ASN open"]'::jsonb, '[]'::jsonb, '["Rencana volume inbound per hari"]'::jsonb),
  ('ARBI', '6', 6, 'WAREHOUSE', 'Inbound', 'FORWARD', 'Inbound & good received',
   'Qty fisik berbeda dari ASN; kerusakan saat bongkar tidak dicatat sehingga muncul belakangan sebagai selisih cycle count tanpa sebab yang bisa ditelusuri.', 'Check inbound document dan ASN, lalu physical inspection dan product counting sebelum truk principal keluar; selisih dituangkan dalam berita acara dua pihak.', 'Kontrol penerimaannya sudah berjalan dan terdokumentasi. Yang belum ada bukan kontrolnya, tapi pencatatan jam kerja bongkarnya — dan tanpa itu Pool Receiving tidak punya dasar pembagian.', null,
   '["ASN","SJ principal","Hasil physical inspection & product counting","Berita acara selisih"]'::jsonb, '[{"code":"5.2.xx","label":"Inventory / COGS — Dr Inventory"},{"code":"Neraca","label":"GR/IR clearing"}]'::jsonb, '["Volume inbound per kategori → Pool Receiving & Put-Away"]'::jsonb),
  ('ARBI', '7', 7, 'WAREHOUSE', 'Inbound', 'FORWARD', 'Putaway & ASN closed',
   'ASN ditutup sebelum seluruh baris naik ke rak atau pick face. Stok langsung muncul di OMS dan Jubelio lalu ditayangkan platform, padahal fisiknya belum bisa dipick — order masuk atas stok yang belum siap.', 'Scan lokasi wajib saat putaway; ASN hanya boleh ditutup setelah seluruh baris ter-putaway, bukan setelah barang turun dari truk.', 'Titik paling sensitif di seluruh inbound. ASN closed adalah pemicu sync stok ke OMS dan Jubelio — begitu ditutup, enam platform langsung menawarkan barangnya. Kalau penutupan mendahului kesiapan fisik, akibatnya bukan salah saji persediaan, tapi oversell.', null,
   '["Task putaway Flux","Peta rak & pick face","ASN closed","Sync stok Flux → ERP → OMS → Jubelio → platform"]'::jsonb, '[{"code":"6.2.01","label":"Storing — Manpower"},{"code":"6.2.02","label":"Storing — Rental"}]'::jsonb, '["Pallet position & pick face terisi → basis pallet-day","Volume inbound → Pool Receiving & Put-Away"]'::jsonb),
  ('ARBI', '8', 8, 'WAREHOUSE', 'Storage', 'KEDUANYA', 'Storage',
   'Kalau stok ARBI secara fisik duduk di gudang SAMB tanpa penanda pemilik, kedua entitas tidak akan pernah bisa melakukan opname masing-masing dan selisihnya akan selalu ada tanpa bisa dijelaskan.', 'Kalau gudang bersama: penanda pemilik wajib di level lot dan lokasi, dan opname dijalankan per pemilik, bukan per lokasi fisik.', 'CBM tetap unit yang benar untuk penyimpanan — space × time. Yang salah adalah memakai CBM untuk fulfillment. Dua sisi ini tidak boleh dicampur dalam satu file, dan di B2C perbedaannya jauh lebih tajam daripada di GT.', 'B04',
   '["Stock report Flux","Occupancy report","Aging & slow-moving report"]'::jsonb, '[{"code":"6.2.02","label":"Storing — Rental"},{"code":"6.2.03","label":"Storing — Utilities"},{"code":"6.2.01","label":"Storing — Manpower"},{"code":"6.2.06","label":"Storing — Security"},{"code":"6.2.07","label":"Storing — Insurance"},{"code":"6.2.08","label":"Storing — Depreciation"}]'::jsonb, '["CBM × inventory days (space × time) → Pool Storage & Housekeeping","Pallet-day rate"]'::jsonb),
  ('ARBI', '9', 9, 'WAREHOUSE', 'Storage', 'KEDUANYA', 'Inventory management — cycle count, replenishment, karantina',
   'Stok karantina menumpuk tanpa keputusan disposisi sehingga nilai bukunya tetap penuh padahal sudah tidak layak jual. Replenishment ke pick face tidak jalan sehingga pick gagal padahal stok ada di bulk.', 'Cycle count berjadwal dengan toleransi tertulis dan penelusuran selisih di atas ambang; karantina punya batas umur dan pemilik keputusan disposisi yang jelas.', 'Ini juga pintu masuk jalur retur. Barang retur yang layak jual kembali ke pick face lewat replenishment; yang tidak layak masuk karantina. Jadi kualitas keputusan disposisi di sini yang menentukan berapa banyak retur yang berakhir jadi kerugian — bukan tingkat returnya sendiri.', 'B05',
   '["Cycle count sheet","Task replenishment ke pick face","Register quarantine — damage / expired","Berita acara disposisi"]'::jsonb, '[{"code":"5.2.xx","label":"COGS — write-off & penyisihan"},{"code":"6.2.01","label":"Storing — Manpower"}]'::jsonb, '["Baris cycle count","Volume replenishment ke pick face"]'::jsonb),
  ('ARBI', '10', 10, 'MARKETPLACE', 'Pembeli & platform', 'FORWARD', 'Order masuk dari marketplace',
   'Order masuk atas stok yang sudah tidak sinkron sehingga terjadi oversell dan pembatalan. Order dari SKU yang belum ter-mapping tidak turun ke OMS dan hilang tanpa ada yang tahu.', 'Sync stok terjadwal dengan buffer per platform; order gagal mapping masuk exception queue yang dimonitor harian, bukan menunggu keluhan pembeli.', 'Uang sudah masuk ke platform di titik ini, bukan ke kita. Ini pembeda struktural terbesar dari jalur GT: di GT piutang lahir setelah barang diterima; di B2C kas ada di tangan pihak ketiga sebelum barang bergerak.', null,
   '["Order di enam platform","Jubelio sebagai agregator","Flowing order & update stock ke OMS"]'::jsonb, '[]'::jsonb, '["Order count per platform per tier"]'::jsonb),
  ('ARBI', '11', 11, 'CHANNEL', 'Marketplace ops + IT', 'KEDUANYA', 'Rekonsiliasi stok antar sistem',
   'Stok hidup di lima tempat: Flux, ERP, OMS, Jubelio, dan tayangan platform. Tidak ada satu pun yang otomatis menjadi sumber kebenaran. Kalau divergen, oversell menurunkan rating toko dan understock menghilangkan penjualan yang tidak bisa diambil kembali.', 'Rekonsiliasi lima titik stok berjadwal dengan satu sistem ditetapkan sebagai sumber kebenaran; selisih di atas ambang wajib ditelusuri ke log sync sebelum disamakan.', 'Di jalur GT stok hanya ada di dua tempat dan divergensinya urusan akuntansi. Di sini divergensi stok langsung jadi risiko komersial — oversell menurunkan rating, rating menurunkan traffic, dan traffic tidak bisa dibeli kembali dengan koreksi jurnal. Kontrol ini revenue protection, bukan hygiene.', 'B03',
   '["Stock report Flux","Stok ERP","Stok OMS","Stok Jubelio","Stok tayang per platform"]'::jsonb, '[]'::jsonb, '["Selisih stok antar sistem per SKU"]'::jsonb),
  ('ARBI', '12', 12, 'WAREHOUSE', 'Outbound', 'FORWARD', 'Order management & strategi wave picking',
   'Tier ditentukan oleh platform dan jam order — dua variabel di luar kendali kita. Kalau mix tier bergeser ke prioritas tinggi, kebutuhan picker dedicated naik tanpa peringatan dan biaya per order naik tanpa terlihat di angka rata-rata.', 'Tier di-assign otomatis dari aturan platform dan jam order, bukan penilaian manual; beban per tier dimonitor harian terhadap kapasitas dedicated yang tersedia.', 'INI DRIVER YANG BENAR UNTUK B2C. Prioritas tinggi mendapat picker dan packer dedicated; prioritas rendah masuk wave normal. Jadi biaya picking per order tidak seragam, dan order count telanjang akan merata-ratakan yang justru tidak boleh dirata-ratakan. Yang dibutuhkan order count PER TIER — dan mix tiernya adalah variabel, bukan konstanta.', 'B06',
   '["Order pool OMS","Aturan priority tier P0 / P1 / P2","Mapping wave label","Print wave picking label"]'::jsonb, '[{"code":"6.2.01","label":"Storing — Manpower"}]'::jsonb, '["Order count per priority tier → Pool Picking & Packing","Jumlah wave per hari"]'::jsonb),
  ('ARBI', '13', 13, 'WAREHOUSE', 'Outbound', 'FORWARD', 'Picking',
   'Salah SKU pada order satuan langsung menjadi keluhan dan retur. Berbeda dari GT, tidak ada kunjungan berikutnya untuk mengoreksi — koreksinya berupa retur berbiaya penuh plus penurunan rating.', 'Scan validation code di lokasi rak dan scan product code per baris pick — dua verifikasi, bukan satu.', 'Kontrolnya sudah lebih kuat dari jalur GT: lokasi dan produk keduanya di-scan. Yang belum ada bukan kontrolnya, tapi pemanenan datanya jadi angka biaya.', null,
   '["Scan wave picking label","Scan validation code di lokasi rak","Scan product code","Bawa ke staging location"]'::jsonb, '[{"code":"6.2.01","label":"Storing — Manpower"}]'::jsonb, '["Baris pick per wave","Order count per tier → Pool Picking & Packing"]'::jsonb),
  ('ARBI', '14', 14, 'WAREHOUSE', 'Outbound', 'FORWARD', 'Checking & packing',
   'Barcode kemasan di-scan tetapi konsumsinya tidak dipanen jadi data biaya, sehingga biaya kemasan hanya bisa dilihat sebagai total dan tidak bisa dibebankan ke order, SKU, atau platform yang membuatnya mahal.', 'Scan barcode kemasan per order; rekaman webcam start dan stop per proses packing sebagai bukti kondisi barang saat keluar.', 'Rekaman webcam adalah control artifact untuk sengketa klaim marketplace, dan sengketa klaim adalah salah satu tempat margin B2C bocor. Tapi retensinya belum ditetapkan — kalau lebih pendek dari jendela klaim platform, kontrolnya ada tapi tidak bisa dipakai. Lihat step 21.', null,
   '["Scan wave picking label","Scan product code","Rekaman webcam start & stop","Scan barcode carton box / polymailer","Print & tempel shipping label"]'::jsonb, '[{"code":"6.2.01","label":"Storing — Manpower"},{"code":"6.2.10","label":"Storing — material packing"}]'::jsonb, '["Order count per tier → Pool Picking & Packing","Konsumsi material packing per order"]'::jsonb),
  ('ARBI', '15', 15, 'WAREHOUSE', 'Outbound', 'FORWARD', 'Dispatch & manifest',
   'Paket ditimbang tetapi beratnya tidak direkonsiliasi dengan berat yang ditagih kurir, sehingga kelebihan tagihan ongkir tidak pernah tertangkap padahal datanya ada.', 'Penimbangan per paket sebelum manifest; berat dan dimensi manifest direkonsiliasi terhadap tagihan kurir setiap periode.', 'Di sini B2C justru lebih baik dari GT. Berat aktual per paket DITIMBANG dan tercatat, sementara berat per SJ di jalur GT masih belum ada. Artinya untuk B2C pertanyaan tonase versus volume bisa diuji dengan data, bukan diasumsikan.', null,
   '["Penimbangan paket","Scan invoice / order number di shipping label","Sorting paket per kurir","Manifest per kurir","Print manifest"]'::jsonb, '[{"code":"7.2.04","label":"Distribution — Delivery: ongkir kurir"}]'::jsonb, '["Berat aktual per paket","Jumlah paket per kurir per hari"]'::jsonb),
  ('ARBI', '16', 16, 'KURIR', 'Pihak ketiga', 'FORWARD', 'Handover ke kurir',
   'Paket masuk manifest tetapi tidak diambil kurir. Status di platform sudah berjalan sementara barang masih di gudang, dan selisih hitung tidak diselesaikan sebelum manifest ditutup.', 'Dispatcher dan kurir menghitung ulang dan mencocokkan ke manifest, keduanya menandatangani sebelum manifest ditutup; paket yang tercatat tetapi tidak terangkut direkonsiliasi harian.', 'Titik pindah tanggung jawab. Setelah manifest ditutup, kehilangan paket menjadi klaim ke kurir — dan kemampuan menagih klaim itu bergantung pada manifest bertanda tangan ini plus rekaman packing dari step 14.', null,
   '["Manifest bertanda tangan dispatcher & kurir","Closed manifest","Bukti serah paket"]'::jsonb, '[{"code":"7.2.04","label":"Distribution — Delivery"}]'::jsonb, '["Jumlah paket per kurir per hari"]'::jsonb),
  ('ARBI', '17', 17, 'CHANNEL', 'Marketplace ops', 'FORWARD', 'Shipment order closed & status delivered',
   'Revenue diakui saat shipment ditutup padahal risiko baru berpindah saat barang diterima. Paket yang hilang di kurir sudah tercatat sebagai penjualan dan koreksinya jatuh di periode berikutnya.', 'Pengakuan revenue disandarkan pada satu titik yang ditetapkan dan diterapkan konsisten; order yang belum delivered melewati SLA ditinjau sebelum tutup buku.', 'Pembeda tegas dari jalur GT. Di GT, POD bertanda tangan customer adalah cut-off yang jelas. Di B2C ada tiga peristiwa di tiga waktu berbeda — uang masuk ke platform, barang dikirim, barang diterima — penyerahannya dilakukan kurir, dan bukti terimanya milik kurir. Hanya satu yang boleh jadi titik pengakuan.', 'B07',
   '["Shipment order closed di OMS","Tracking kurir","Update status ke platform","POD digital kurir"]'::jsonb, '[{"code":"4.2.xx","label":"Revenue — trigger pengakuan"},{"code":"5.2.xx","label":"COGS — trigger pengakuan"}]'::jsonb, '["Order delivered per periode"]'::jsonb),
  ('ARBI', '18', 18, 'MARKETPLACE', 'Pembeli & platform', 'REVERSE', 'Retur dari pembeli & ASN Return',
   'Retur masuk tanpa referensi order asal sehingga tidak bisa diatribusikan ke platform, SKU, atau penyebab. Tingkat retur per platform tidak pernah diukur sehingga platform yang returnya mahal tidak terlihat dan tetap diperlakukan sama seperti yang murah.', 'Retur hanya diterima dengan referensi order asal; alasan retur wajib berkode dan bukan teks bebas, supaya bisa diagregasi per platform dan per SKU.', 'Retur masuk lewat pintu yang sama dengan pembelian, sebagai ASN Return di Flux. Jadi jalur fisiknya tidak terpisah dan tidak perlu lane sendiri. Yang butuh perlakuan terpisah adalah keputusan layak jual — dan itu ada di step 9, bukan di sini.', null,
   '["Pengajuan retur di platform","Persetujuan retur","Resi retur","ASN Return di Flux"]'::jsonb, '[{"code":"4.2.xx","label":"Sales return — pengurang revenue"},{"code":"Neraca","label":"Kewajiban pengembalian dana"}]'::jsonb, '["Tingkat retur per platform per SKU","Volume retur masuk"]'::jsonb),
  ('ARBI', '19', 19, 'WAREHOUSE', 'Inbound', 'REVERSE', 'Terima retur & disposisi',
   'Barang retur dimasukkan kembali ke pick face tanpa inspeksi sehingga dikirim ulang lalu diretur lagi — biaya fulfillment terbayar dua kali untuk satu penjualan yang tidak pernah jadi. Write-off diputuskan tanpa dasar penilaian sehingga persediaan overstated.', 'Setiap barang retur diinspeksi dan didisposisi dengan berita acara sebelum masuk kembali ke stok; barang tanpa keputusan disposisi tidak boleh berada di pick face.', 'Konvergensi jalur retur ke jalur normal terjadi di sini: barang layak jual kembali ke step 9 lewat replenishment dan mulai lagi dari sana. Yang tidak layak berhenti di karantina dan menunggu keputusan disposisi.', 'B05',
   '["ASN Return","Inspeksi kondisi barang retur","Berita acara disposisi — layak jual / karantina / write-off"]'::jsonb, '[{"code":"5.2.xx","label":"COGS — write-off barang tidak layak jual"},{"code":"Neraca","label":"Inventory — masuk kembali barang layak jual"}]'::jsonb, '["Volume retur","Baris inspeksi retur"]'::jsonb),
  ('ARBI', '20', 20, 'FINANCE', 'AR + Channel', 'KEDUANYA', 'Rekonsiliasi settlement platform',
   'Potongan platform diterima apa adanya tanpa diuji ke skema yang diperjanjikan. Selisih GOV terhadap payout tidak direkonsiliasi per order sehingga potongan yang salah tidak pernah tertangkap, dan jendela sengketanya lewat sebelum selisihnya diketahui.', 'Rekonsiliasi GOV → potongan → payout per order per platform setiap periode; selisih di atas ambang diajukan sengketa di dalam jendela waktu platform, bukan setelah tutup buku.', 'INI PENGGANTI SELURUH BLOK PIUTANG DI JALUR GT. Tidak ada tukar faktur, tidak ada dunning, tidak ada aging dalam bentuk yang sama. Yang ada: pihak lawan memegang uang kita, memotong sendiri, lalu mengirim rekapnya. Posisi kita bukan penagih tetapi pemeriksa — dan kalau tidak diperiksa per order, tidak ada cara mengetahui potongannya benar. Umur payout menggantikan weeks of credit di rumus rotations.', 'B10',
   '["Laporan settlement per platform","Statement payout","Rincian potongan — komisi, admin fee, subsidi ongkir, promo funding","Rekening koran"]'::jsonb, '[{"code":"4.2.xx","label":"Revenue — bruto"},{"code":"8.1.xx","label":"Selling & Marketing — komisi & admin fee platform"},{"code":"Neraca","label":"Piutang platform — dana tertahan"},{"code":"Neraca","label":"Kas / bank"}]'::jsonb, '["GOV vs net payout per platform","Potongan per order per jenis"]'::jsonb),
  ('ARBI', '21', 21, 'FINANCE', 'AR + Channel', 'KEDUANYA', 'Sengketa klaim & kompensasi',
   'Klaim tidak diajukan di dalam jendela waktu sehingga kerugian menjadi final. Bukti pendukungnya ada di rekaman webcam tetapi sudah terhapus karena retensinya lebih pendek dari jendela klaim.', 'Register klaim dengan tanggal jatuh tempo jendela per platform dan kurir; retensi rekaman packing ditetapkan lebih panjang dari jendela klaim terlama.', 'Dua kontrol yang sudah berjalan di operasi — rekaman webcam di step 14 dan manifest bertanda tangan di step 16 — nilainya baru keluar di sini. Kalau retensi dan registernya tidak diatur, dua kontrol itu ada tetapi tidak bisa dipakai, dan biaya membangunnya sudah keluar.', null,
   '["Pengajuan klaim ke platform & kurir","Bukti rekaman packing","Manifest bertanda tangan","Putusan klaim & kompensasi"]'::jsonb, '[{"code":"4.2.xx","label":"Kompensasi diterima"},{"code":"8.1.xx","label":"Kerugian klaim tidak terpulihkan"}]'::jsonb, '["Jumlah klaim per platform & kurir","Nilai klaim vs nilai pemulihan"]'::jsonb),
  ('ARBI', '22', 22, 'FINANCE', 'Tax', 'FORWARD', 'Faktur pajak & PPN',
   'Faktur pajak atas penjualan ritel diperlakukan tidak konsisten antar platform. DPP disandarkan ke GOV atau ke net payout tanpa dasar yang ditetapkan, sehingga rekonsiliasi PPN terhadap revenue tidak pernah tutup.', 'Perlakuan PPN ditetapkan tertulis dan diterapkan konsisten di semua platform; rekonsiliasi rekap penjualan terhadap faktur pajak dilakukan bulanan.', 'Pertanyaannya bukan teknis pelaporan, tapi angka mana yang jadi dasar. GOV dan net payout berbeda sebesar seluruh potongan platform — dan potongan itu sendiri belum bisa dirinci per order. Jadi B11 bergantung pada B10.', 'B11',
   '["Faktur pajak / e-Faktur","Rekap penjualan per platform","Dokumen PPN keluaran"]'::jsonb, '[{"code":"4.2.xx","label":"Revenue"},{"code":"Neraca","label":"PPN keluaran"}]'::jsonb, '["Jumlah transaksi per periode"]'::jsonb),
  ('ARBI', '23', 23, 'FINANCE', 'Accounting + PF', 'KEDUANYA', 'Rekon kas, GL & intercompany',
   'Kalau ARBI membeli dari SAMB, markupnya menjadi unrealized profit atas stok ARBI yang belum terjual dan harus dieliminasi — scope-nya hanya stok yang berasal dari pembelian afiliasi, bukan seluruh persediaan ARBI. Kalau gudang atau armada SAMB dipakai, biayanya harus punya dasar arm''s length dan bukti manfaat.', 'Pre-recon setiap line item ke akun TB-nya sebelum masuk matrix; transaksi afiliasi diberi nomor dokumen referensi di kedua sisi sehingga IS bisa dicocokkan per dokumen, bukan per total.', 'Seam ke file jalur GT/LP. Kalau gudangnya SAMB, ARBI adalah klien LP berstatus afiliasi di file itu — dan G13/G14 di sana berlaku dari sisi sebaliknya: yang di sana carve-out COS–LP, di sini biaya jasa yang dibayar. Satu pengukuran, dua entitas, dan angkanya harus sama.', 'B02',
   '["Rekening koran","WP rekonsiliasi","Posting GL → TB ARBI","Matrix intercompany"]'::jsonb, '[{"code":"Neraca","label":"Kas / bank"},{"code":"Elim","label":"Eliminasi revenue ↔ biaya at cost"},{"code":"Elim","label":"Eliminasi unrealized profit atas markup"}]'::jsonb, '["Selisih Per BS vs Control per akun"]'::jsonb)
on conflict (entity_code, label) do nothing;

-- 6. Needs ------------------------------------------------------------------
insert into public.os_process_needs (step_id, item, kind, src, owner, status)
select s.id, v.item, v.kind, v.src, v.owner, v.status
from (values
  ('1', 'Dimensi satuan P × L × T per SKU', 'MASTER', 'Spec principal', 'Commercial', 'BELUM'),
  ('1', 'Berat satuan per SKU', 'MASTER', 'Spec principal', 'Commercial', 'BELUM'),
  ('1', 'Isi per karton per SKU', 'MASTER', 'Price list principal', 'Purchasing / Commercial', 'BELUM'),
  ('1', 'Definisi bundle → komponen SKU', 'MASTER', 'OMS', 'Channel', 'SEBAGIAN'),
  ('1', 'Mapping SKU per platform', 'MASTER', 'OMS / Jubelio', 'Channel', 'ADA'),
  ('1', 'Mapping SKU ↔ kurir yang diizinkan', 'MASTER', 'OMS', 'Channel', 'ADA'),
  ('2', 'Harga jual per SKU per platform', 'MASTER', 'OMS', 'Channel', 'ADA'),
  ('2', 'Skema promo & pihak yang menanggung', 'REFERENSI', 'Perjanjian platform', 'Channel', 'SEBAGIAN'),
  ('2', 'Porsi subsidi ongkir ditanggung sendiri vs platform', 'PARAMETER', 'Perjanjian platform', 'Channel + FAT', 'BELUM'),
  ('2', 'Dampak margin per SKU per program', 'PARAMETER', 'Turunan', 'PF', 'BELUM'),
  ('3', 'Historis order per SKU per platform per bulan', 'TRANSAKSI', 'OMS', 'Channel + IT', 'ADA'),
  ('3', 'Kalender campaign & tanggal kembar per platform', 'REFERENSI', 'Platform', 'Channel', 'SEBAGIAN'),
  ('3', 'Target order count per periode', 'PARAMETER', 'Kebijakan internal', 'PF', 'BELUM'),
  ('3', 'Kapasitas normal pick-hour per hari', 'PARAMETER', 'Time study', 'Warehouse', 'BELUM'),
  ('3', 'Lead time principal per SKU', 'MASTER', 'Kesepakatan principal', 'Purchasing', 'BELUM'),
  ('4', 'Price list principal aktif per SKU', 'MASTER', 'Price list principal', 'Purchasing', 'ADA'),
  ('4', 'Isi per karton per SKU', 'MASTER', 'Price list principal', 'Purchasing', 'BELUM'),
  ('4', 'Trading term & skema discount per principal', 'REFERENSI', 'Kontrak principal', 'Purchasing', 'SEBAGIAN'),
  ('4', 'Matriks otorisasi PO', 'PARAMETER', 'Kebijakan internal', 'Management', 'SEBAGIAN'),
  ('4', 'Sumber pembelian — principal langsung vs beli dari SAMB', 'PARAMETER', 'Keputusan internal', 'Kamu + FAT', 'BELUM'),
  ('5', 'Cut-off inbound 15:00', 'PARAMETER', 'Kebijakan operasional', 'Warehouse', 'ADA'),
  ('5', 'Jadwal slot bongkar harian', 'TRANSAKSI', 'Belum ada sistem', 'Warehouse', 'BELUM'),
  ('5', 'Occupancy gudang harian', 'TRANSAKSI', 'Flux', 'Warehouse', 'SEBAGIAN'),
  ('5', 'Daftar ASN open melewati SLA', 'TRANSAKSI', 'Flux', 'Warehouse', 'SEBAGIAN'),
  ('6', 'Qty terima per SKU per ASN', 'TRANSAKSI', 'Flux', 'Warehouse Inbound', 'ADA'),
  ('6', 'Hasil physical inspection & product counting', 'TRANSAKSI', 'Dokumen inbound', 'Warehouse Inbound', 'ADA'),
  ('6', 'Berita acara selisih terima', 'TRANSAKSI', 'Form manual', 'Warehouse Inbound', 'SEBAGIAN'),
  ('6', 'Jam kerja tenaga bongkar', 'TRANSAKSI', 'Absensi / borongan', 'Warehouse + HR', 'BELUM'),
  ('6', 'Harga beli per SKU', 'TRANSAKSI', 'Invoice principal', 'FAT', 'ADA'),
  ('7', 'Lokasi rak / pick face per SKU', 'TRANSAKSI', 'Flux', 'Warehouse', 'ADA'),
  ('7', 'Dimensi karton P × L × T per SKU', 'MASTER', 'Spec principal', 'Commercial', 'BELUM'),
  ('7', 'Max tumpuk aktual per SKU', 'MASTER', 'Observasi gudang', 'Warehouse', 'BELUM'),
  ('7', 'Tinggi rak berguna per zona', 'MASTER', 'Ukur gudang', 'Warehouse', 'BELUM'),
  ('7', 'Pallet position tersedia per zona', 'MASTER', 'Layout gudang', 'Warehouse', 'SEBAGIAN'),
  ('7', 'Waktu antara ASN closed dan barang siap di pick face', 'TRANSAKSI', 'Flux', 'Warehouse + IT', 'BELUM'),
  ('8', 'Stok awal & akhir per SKU per periode — qty dan nilai', 'TRANSAKSI', 'Flux / ERP', 'FAT', 'ADA'),
  ('8', 'CBM tersimpan per SKU per periode', 'TRANSAKSI', 'Turunan dari dimensi karton', 'PF', 'BELUM'),
  ('8', 'Inventory days per SKU / kategori', 'PARAMETER', 'Turunan — 2 jalur, belum dipilih', 'PF', 'BELUM'),
  ('8', 'Biaya sewa gudang per periode', 'TRANSAKSI', 'GL', 'FAT', 'ADA'),
  ('8', 'Headcount & pembagian waktu per activity pool', 'MASTER', 'HR + time study', 'HR + Warehouse', 'BELUM'),
  ('8', 'Status kepemilikan gudang — FC sendiri vs titipan di gudang SAMB', 'PARAMETER', 'Keputusan internal', 'Kamu + Warehouse', 'BELUM'),
  ('8', 'Aging stok per SKU', 'TRANSAKSI', 'Flux', 'Warehouse', 'SEBAGIAN'),
  ('9', 'Hasil cycle count & selisih per periode', 'TRANSAKSI', 'Flux', 'Warehouse', 'SEBAGIAN'),
  ('9', 'Min–max pick face per SKU', 'PARAMETER', 'Kebijakan operasional', 'Warehouse', 'BELUM'),
  ('9', 'Register karantina — damage, expired, sebab', 'TRANSAKSI', 'Flux', 'Warehouse', 'SEBAGIAN'),
  ('9', 'Aturan & wewenang disposisi karantina', 'PARAMETER', 'Kebijakan internal', 'Kamu + Warehouse', 'BELUM'),
  ('9', 'Nilai & umur stok karantina', 'TRANSAKSI', 'Turunan', 'FAT', 'BELUM'),
  ('9', 'Tanggal expired per lot', 'MASTER', 'Flux', 'Warehouse', 'SEBAGIAN'),
  ('10', 'Order header & line per platform', 'TRANSAKSI', 'OMS', 'Channel + IT', 'ADA'),
  ('10', 'Jam order per order', 'TRANSAKSI', 'OMS', 'Channel + IT', 'ADA'),
  ('10', 'Platform asal order', 'TRANSAKSI', 'OMS', 'Channel + IT', 'ADA'),
  ('10', 'Status pembayaran dari platform', 'TRANSAKSI', 'Platform / Jubelio', 'Channel', 'SEBAGIAN'),
  ('10', 'Order gagal mapping SKU', 'TRANSAKSI', 'OMS exception', 'Channel + IT', 'BELUM'),
  ('11', 'Snapshot stok per sistem pada waktu yang sama', 'TRANSAKSI', 'Lima sistem', 'IT', 'BELUM'),
  ('11', 'Log sync & kegagalan sync', 'TRANSAKSI', 'Middleware', 'IT', 'BELUM'),
  ('11', 'Buffer stok per platform', 'PARAMETER', 'Kebijakan internal', 'Channel', 'BELUM'),
  ('11', 'Sistem yang ditetapkan sebagai sumber kebenaran', 'PARAMETER', 'Keputusan internal', 'Kamu + IT', 'BELUM'),
  ('12', 'Jam cut-off per platform per tier', 'PARAMETER', 'Aturan internal — sudah ditetapkan', 'Channel', 'ADA'),
  ('12', 'Priority tier per order', 'TRANSAKSI', 'OMS', 'Channel + IT', 'SEBAGIAN'),
  ('12', 'Jumlah order per tier per periode', 'TRANSAKSI', 'Turunan OMS', 'PF', 'BELUM'),
  ('12', 'Headcount dedicated picker & packer vs wave normal', 'MASTER', 'HR + Warehouse', 'HR + Warehouse', 'BELUM'),
  ('12', 'Jam kerja picker & packer per tier', 'TRANSAKSI', 'Absensi', 'Warehouse + HR', 'BELUM'),
  ('13', 'Baris pick per order', 'TRANSAKSI', 'Flux', 'Warehouse Outbound', 'ADA'),
  ('13', 'Scan log validasi lokasi & produk', 'TRANSAKSI', 'Flux', 'Warehouse Outbound', 'ADA'),
  ('13', 'Jumlah baris pick per periode per tier', 'TRANSAKSI', 'Turunan Flux', 'PF', 'BELUM'),
  ('13', 'Jam kerja picker per periode', 'TRANSAKSI', 'Absensi', 'Warehouse + HR', 'BELUM'),
  ('14', 'Konsumsi material packing per order', 'TRANSAKSI', 'Scan barcode kemasan', 'Warehouse + FAT', 'BELUM'),
  ('14', 'Biaya per jenis kemasan', 'MASTER', 'Pembelian kemasan', 'Purchasing', 'BELUM'),
  ('14', 'Rekaman webcam per order', 'TRANSAKSI', 'Sistem rekaman', 'Warehouse + IT', 'ADA'),
  ('14', 'Retensi & aturan akses rekaman', 'PARAMETER', 'Kebijakan internal', 'Kamu + IT', 'BELUM'),
  ('15', 'Berat aktual per paket', 'TRANSAKSI', 'Timbangan di dispatch', 'Warehouse Outbound', 'ADA'),
  ('15', 'Dimensi paket terkirim', 'TRANSAKSI', 'Dispatch', 'Warehouse Outbound', 'SEBAGIAN'),
  ('15', 'Tarif kurir per zona per berat', 'MASTER', 'Perjanjian kurir', 'Channel + Finance', 'SEBAGIAN'),
  ('15', 'Tagihan kurir per periode per paket', 'TRANSAKSI', 'Invoice kurir', 'FAT', 'SEBAGIAN'),
  ('15', 'Porsi ongkir ditanggung sendiri', 'PARAMETER', 'Skema platform', 'Channel + FAT', 'BELUM'),
  ('16', 'Manifest closed bertanda tangan dua pihak', 'TRANSAKSI', 'Manifest fisik', 'Warehouse Outbound', 'ADA'),
  ('16', 'Selisih hitung dispatcher vs kurir', 'TRANSAKSI', 'Manifest', 'Warehouse Outbound', 'SEBAGIAN'),
  ('16', 'SLA pickup per kurir', 'REFERENSI', 'Perjanjian kurir', 'Channel', 'SEBAGIAN'),
  ('16', 'Paket masuk manifest tapi tidak terangkut', 'TRANSAKSI', 'Rekonsiliasi manifest', 'Warehouse + Channel', 'BELUM'),
  ('17', 'Status delivered per order dari kurir', 'TRANSAKSI', 'API kurir / platform', 'Channel + IT', 'SEBAGIAN'),
  ('17', 'Tanggal kirim dan tanggal delivered per order', 'TRANSAKSI', 'Tracking', 'Channel + IT', 'SEBAGIAN'),
  ('17', 'Titik pengakuan revenue yang ditetapkan', 'PARAMETER', 'Kebijakan akuntansi', 'Kamu + FAT', 'BELUM'),
  ('17', 'Tanggal cut-off pengakuan per periode', 'PARAMETER', 'Kalender close', 'FAT', 'ADA'),
  ('17', 'Order tidak delivered melewati SLA', 'TRANSAKSI', 'Tracking', 'Channel', 'BELUM'),
  ('18', 'Pengajuan & alasan retur per order', 'TRANSAKSI', 'Platform / OMS', 'Channel', 'SEBAGIAN'),
  ('18', 'Kode alasan retur yang terstandar', 'MASTER', 'Kebijakan internal', 'Channel', 'BELUM'),
  ('18', 'Tingkat retur per platform per SKU', 'TRANSAKSI', 'Turunan OMS', 'PF', 'BELUM'),
  ('18', 'Biaya ongkir retur & pihak yang menanggung', 'PARAMETER', 'Perjanjian platform', 'Channel + FAT', 'BELUM'),
  ('18', 'Jendela waktu retur per platform', 'REFERENSI', 'Perjanjian platform', 'Channel', 'SEBAGIAN'),
  ('19', 'Hasil inspeksi kondisi per barang retur', 'TRANSAKSI', 'Form inspeksi', 'Warehouse Inbound', 'BELUM'),
  ('19', 'Keputusan disposisi per barang retur', 'TRANSAKSI', 'Berita acara', 'Warehouse Inbound', 'BELUM'),
  ('19', 'Nilai pemulihan barang layak jual', 'PARAMETER', 'Kebijakan penilaian', 'FAT', 'BELUM'),
  ('19', 'Jam kerja penanganan retur', 'TRANSAKSI', 'Absensi', 'Warehouse + HR', 'BELUM'),
  ('20', 'Laporan settlement per platform per periode', 'TRANSAKSI', 'Platform', 'Finance AR', 'SEBAGIAN'),
  ('20', 'Rincian potongan per order per jenis', 'TRANSAKSI', 'Platform', 'Finance AR + Channel', 'BELUM'),
  ('20', 'Skema komisi & admin fee per platform', 'MASTER', 'Perjanjian platform', 'Channel', 'SEBAGIAN'),
  ('20', 'Umur payout per platform', 'PARAMETER', 'Perjanjian platform', 'Finance', 'BELUM'),
  ('20', 'Rekonsiliasi GOV → potongan → payout per order', 'TRANSAKSI', 'Kertas kerja rekon', 'Finance AR', 'BELUM'),
  ('20', 'Saldo dana tertahan per platform per tanggal', 'TRANSAKSI', 'Dashboard platform', 'Finance AR', 'BELUM'),
  ('21', 'Register klaim & statusnya', 'TRANSAKSI', 'Belum ada sistem', 'Finance AR + Channel', 'BELUM'),
  ('21', 'Jendela waktu klaim per platform & kurir', 'REFERENSI', 'Perjanjian', 'Channel', 'BELUM'),
  ('21', 'Tingkat keberhasilan klaim', 'TRANSAKSI', 'Turunan register', 'PF', 'BELUM'),
  ('21', 'Bukti pendukung per klaim', 'TRANSAKSI', 'Rekaman & manifest', 'Warehouse + Channel', 'SEBAGIAN'),
  ('22', 'Rekap penjualan per periode per platform', 'TRANSAKSI', 'OMS / ERP', 'FAT', 'SEBAGIAN'),
  ('22', 'Perlakuan PPN atas transaksi marketplace', 'PARAMETER', 'Kebijakan pajak', 'Tax + FAT', 'BELUM'),
  ('22', 'Dasar DPP — GOV vs net payout', 'PARAMETER', 'Keputusan internal', 'Tax + FAT', 'BELUM'),
  ('22', 'Identitas pembeli untuk faktur', 'TRANSAKSI', 'Platform', 'Tax', 'BELUM'),
  ('23', 'Mapping COA T.G.FF.DDDD untuk ARBI', 'MASTER', 'Kertas kerja mapping', 'PF + FAT', 'SEBAGIAN'),
  ('23', 'Rekonsiliasi Per BS vs Control per akun', 'TRANSAKSI', 'Kertas kerja rekon', 'FAT', 'BELUM'),
  ('23', 'Daftar transaksi afiliasi + nomor dokumen referensi', 'TRANSAKSI', 'GL', 'FAT', 'SEBAGIAN'),
  ('23', 'Sisa inventory unsold dari pembelian afiliasi', 'TRANSAKSI', 'GL — perlu filter scope', 'FAT', 'BELUM'),
  ('23', 'Tarif jasa dari SAMB kalau gudang atau armada dipakai', 'PARAMETER', 'Perjanjian intercompany', 'Kamu + FAT', 'BELUM')
) as v(step_label, item, kind, src, owner, status)
join public.os_process_steps s on s.entity_code = 'ARBI' and s.label = v.step_label
-- DELIBERATELY UNCHANGED, and this is the reason the file needed a top-level
-- guard at all. `item` is editable from the app, so this predicate can miss
-- and insert a duplicate — but there is nothing better to move it to: item,
-- kind, src, owner and status are ALL editable, and one step carries many
-- needs, so no combination of them is a stable natural key. A seed-key column
-- would fix it and is not worth a schema change for a hazard whose only
-- trigger is someone re-running an applied migration by hand. Section 0
-- makes that impossible instead.
where not exists (
  select 1 from public.os_process_needs n
  where n.step_id = s.id and n.item = v.item
);

-- 7. The step → Finish line bridge ------------------------------------------
-- LITERAL UUIDS, resolved to ARBI steps by (entity_code, label). 37 pairs
-- across 15 Finish line rows; several rows (Storing cost, Distribution
-- cost, COGS — Logistic provider, ...) are the SAME rows SAMB's bridge
-- feeds — their cells differ by entity_code, and the frontend joins
-- through the step's entity to keep the two chains apart.
insert into public.os_process_step_items (step_id, item_id)
select s.id, v.item_id::uuid
from (values
  -- Sales — B2C
  ('2', 'd664376d-e4a3-45fa-a0fa-c844f14851ed'),
  ('10', 'd664376d-e4a3-45fa-a0fa-c844f14851ed'),
  ('17', 'd664376d-e4a3-45fa-a0fa-c844f14851ed'),
  ('20', 'd664376d-e4a3-45fa-a0fa-c844f14851ed'),
  -- COGS — B2C
  ('6', '6e599653-470e-4e6a-b73c-f1f308cf4717'),
  ('7', '6e599653-470e-4e6a-b73c-f1f308cf4717'),
  ('9', '6e599653-470e-4e6a-b73c-f1f308cf4717'),
  -- COGS — Logistic provider
  ('8', '768beb21-1151-4a1f-924a-c1c3f5001348'),
  ('15', '768beb21-1151-4a1f-924a-c1c3f5001348'),
  -- Storing cost
  ('6', '10b151a5-5c45-454c-a13b-ffbc786ec645'),
  ('7', '10b151a5-5c45-454c-a13b-ffbc786ec645'),
  ('8', '10b151a5-5c45-454c-a13b-ffbc786ec645'),
  ('9', '10b151a5-5c45-454c-a13b-ffbc786ec645'),
  ('13', '10b151a5-5c45-454c-a13b-ffbc786ec645'),
  ('14', '10b151a5-5c45-454c-a13b-ffbc786ec645'),
  -- Distribution cost
  ('15', '7d040e4a-7bf4-425a-b171-a46245d8158c'),
  ('16', '7d040e4a-7bf4-425a-b171-a46245d8158c'),
  ('17', '7d040e4a-7bf4-425a-b171-a46245d8158c'),
  -- Commercials and support
  ('20', '390d42f8-4add-4f23-b59f-1c8aed3bc5e1'),
  ('21', '390d42f8-4add-4f23-b59f-1c8aed3bc5e1'),
  ('22', '390d42f8-4add-4f23-b59f-1c8aed3bc5e1'),
  -- Trade receivable
  ('20', '5af36fdd-bc29-4372-9d5a-cd77afda0dfb'),
  ('23', '5af36fdd-bc29-4372-9d5a-cd77afda0dfb'),
  -- Inventories
  ('7', '873b8990-305d-426b-b43d-9effc2398957'),
  ('9', '873b8990-305d-426b-b43d-9effc2398957'),
  ('19', '873b8990-305d-426b-b43d-9effc2398957'),
  -- Trade payable
  ('4', '39eac155-d88e-4536-a42f-f5d4c3698cea'),
  ('6', '39eac155-d88e-4536-a42f-f5d4c3698cea'),
  -- Volume delivered
  ('15', 'eeabd2b2-85af-4d86-8940-d7191203592b'),
  ('16', 'eeabd2b2-85af-4d86-8940-d7191203592b'),
  -- Pallet positions used
  ('8', 'd0199bc1-d9e9-4b24-9d6c-b3ebead0cb60'),
  ('9', 'd0199bc1-d9e9-4b24-9d6c-b3ebead0cb60'),
  -- DSO
  ('20', 'd5b2d207-b46d-4761-b5d4-b2eb16969c57'),
  ('23', 'd5b2d207-b46d-4761-b5d4-b2eb16969c57'),
  -- DIO
  ('9', '0314cc30-2faf-4bba-ad81-d879f9fbffa9'),
  -- DPO
  ('4', 'a3c6b28b-ccfd-46ea-88f1-916abebdc1cd'),
  -- Cash & equivalents
  ('23', 'cd4eeebe-31dc-428b-9188-27b3c034d2fc')
) as v(step_label, item_id)
join public.os_process_steps s on s.entity_code = 'ARBI' and s.label = v.step_label
on conflict (step_id, item_id) do nothing;
