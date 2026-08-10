-- ===========================================================================
-- KGR: KEPUTUSAN BIAYA D1-D5 JADI TEKS. TIDAK ADA STRUKTUR YANG BERGERAK.
-- ===========================================================================
-- Every statement here writes a column the app itself can write: name, risk,
-- control, note, docs, coa, drivers on steps; item/kind/src/owner/status on
-- needs; title/sub/owner/unblock on gates. Nothing touches slot, lane_key,
-- track, entity_code, any id, or the SET of rows. That is the same line
-- src/logic/processTextEdit.ts draws, and this file stays on the editable
-- side of it deliberately — the decisions below change what the map SAYS,
-- never what it IS.
--
-- WHY A MIGRATION AND NOT THE APP. Text edited in the app would diverge from
-- 20260807000061, and that seed's value is that it is byte-identical to live.
-- Routing the change through a file keeps the two readable as one artefact.
-- The cost is that this file cannot be replayed onto a chain someone has
-- since edited by hand, which is why the guard below is a SHAPE guard.
--
-- THE DECISIONS, IN ONE LINE EACH:
--   D1  NRV stays the method. The interim convention zeroes the COST-TO-SELL
--       term only; the separable-cost deduction stays, on engineering
--       estimates. Zeroing both would collapse NRV into Sales Value at
--       Split-off, and the prices in play are downstream SKU prices, not
--       split-off-condition prices — so the result would not even be SVAS.
--       Steps 20, 21, 37.
--   D2  Step 14 keeps a placeholder but loses the letter range, and KRK/HJA
--       are refused: both live at split-off (12/13), and listing them at 14
--       double-counts the same physical mass in step 20's denominator.
--       Steps 13, 14 + need 14.
--   D3  The FG/WIP split is an actual measured per batch, not a standing
--       parameter — it feeds the allocation ratio, not just inventory
--       classification. Need 13, steps 13, 19, 20.
--   D4  Cold storage holding is a period expense. Pool B stops at the
--       freezing event. Steps 30, 31, 37 + gate TBC-17.
--   D5  Freight-out is real and belongs at step 27 as a SELLING cost — never
--       in joint or separable cost. Step 27.
--
-- SAFE TO APPLY: checked against live immediately before writing this file —
-- 38 steps, 117 needs (ADA 9 · SEBAGIAN 34 · BELUM 74), 42 gates, 9 lanes,
-- 10 phases, 3 tracks, zero bridge rows, zero requested_on, and zero rows in
-- os_process_text_history for any KGR step. No human edit is overwritten by
-- anything below. Re-check those before ever replaying this.
--
-- CONTAINS NO FINANCIAL FIGURES, same house rule as the seed it amends.
--
-- APPLIED TO LIVE as one ledger entry: kgr_text_decisions. Verified after:
-- step 14 renamed, step 27 COA went 0 to 3, step 31 COA went 2 to 3, the
-- interim convention present on 20 and its retirement on 37, and 38 steps /
-- 42 gates / 10 phases unmoved. os_process_text_history stayed empty for KGR
-- — that table is written by the app layer, not a trigger, so a migration
-- does not pollute the "zero human edits" signal the header above relies on.
--
-- Down-migration:
-- supabase/migrations/down/20260810000073_kgr_text_decisions_down.sql

-- 0. Shape guard -------------------------------------------------------------
-- Keys on the v0.2 shape rather than on "KGR exists": these UPDATEs address
-- steps by label, and a chain of a different size means the labels no longer
-- mean what this file assumes.
do $$
declare
  step_count int;
begin
  select count(*) into step_count from public.os_process_steps where entity_code = 'KGR';
  if step_count <> 38 then
    raise exception
      'Rantai % berisi % step, bukan 38. File ini menulis teks keputusan D1-D5 di atas bentuk v0.2; jalankan 20260807000061 lebih dulu atau periksa kenapa bentuknya berubah.', 'KGR', step_count;
  end if;
end
$$;

-- ===========================================================================
-- D1. NRV DIPERTAHANKAN, DENGAN KONVENSI INTERIM YANG HANYA MENOLKAN SATU SUKU
-- ===========================================================================

-- Step 20 — the primary home. The NRV is computed here, so the convention
-- that changes one of its inputs is documented here, not downstream.
update public.os_process_steps set
  note = 'Bucket Kondemnasi dan Waste TIDAK menerima alokasi — zero NRV. Dan applied overhead Pool B tidak masuk Total Joint Cost di langkah 4 dan 6; dia dibebankan langsung ke SKU frozen berdasarkan kg aktual yang dibekukan. Kalau Pool B ikut dilebur, SKU fresh menanggung biaya pembekuan yang tidak pernah dia pakai. KONVENSI INTERIM, BERLAKU SAMPAI DICABUT DI STEP 37: selama estimasi biaya menjual per SKU belum ada, suku itu diperlakukan nol di dalam NRV — sementara deduksi separable cost TETAP dipakai memakai estimasi teknik. Menolkan dua-duanya akan meruntuhkan NRV jadi Sales Value at Split-off, dan itu ditolak dengan alasan yang lebih keras daripada kerapian: harga yang dipakai di sini adalah harga SKU hilir, sedangkan SVAS menuntut harga pada kondisi split-off — yang untuk Output MDM tidak ada, karena kerangka harus di-deboning dulu sebelum jadi barang dagang. Jadi mengganti metodenya tidak menghasilkan SVAS, melainkan NRV yang salah label. Yang berubah di sini hanya nilai satu input, dan itu perubahan estimasi — bukan perubahan kebijakan yang menuntut penerapan retrospektif.',
  drivers = '["Allocation Ratio = NRV SKU ÷ Total NRV Batch", "Cost per Kg per SKU = Allocated Joint Cost ÷ berat aktual SKU", "Bauran aktual FG vs WIP dari step 13 → himpunan SKU yang masuk denominator"]'::jsonb
where entity_code = 'KGR' and label = '20';

-- Step 21 — the deduction that must NOT be zeroed, and why.
update public.os_process_steps set
  note = 'URUTANNYA MENGIKAT: alokasi joint dulu, separable sesudah. Pool B pembekuan mengikuti pola yang sama — dibebankan ke SKU frozen berdasarkan kg aktual dibekukan, tidak masuk Total Joint Cost. Membalik urutan ini membuat seluruh cost per kg salah, bukan sebagian. Sampai separable cost per SKU benar-benar ter-track, angkanya diisi estimasi teknik per jenis proses dan direkonsiliasi ke aktual begitu tracking-nya jalan. Estimasi kasar tetap lebih benar daripada nol, dan asimetrinya yang jadi alasan: cut-up dan MDM memikul proses lanjut yang nyata, sedangkan Ceker, Usus, dan Kepala nyaris tidak melewati apa pun. Menolkan suku ini akan sistematis meng-over-alokasi joint cost ke stream yang diproses dan meringankan yang tidak — persis distorsi yang merusak margin per SKU dan keputusan disposisi di step 30.'
where entity_code = 'KGR' and label = '21';

-- ===========================================================================
-- D2. STEP 14 KEHILANGAN DERET HURUF, DAN KRK/HJA DITOLAK DARI SITU
-- ===========================================================================

update public.os_process_steps set
  name = 'Pemrosesan lanjut karkas → SKU hasil cut-up',
  note = 'LAPISAN KEDUA. Biaya di sini SEPARABLE — ditambahkan per SKU SETELAH alokasi joint, bukan sebelum. SOP sudah menetapkan pola ini untuk MDM; pola yang sama berlaku untuk seluruh pemrosesan lanjut. Yield pemrosesan lanjut belum punya benchmark sama sekali. DAFTAR SKU-NYA SENGAJA BELUM DIISI. Deret "A sampai J" hanya penampung dan jumlahnya tidak pernah punya sumber — mengunci sepuluh nama sekarang menanamkan presisi palsu ke denominator Total NRV Batch di step 20, karena denominator itu adalah penjumlahan atas himpunan SKU. Yang sudah pasti: KRK dan HJA TIDAK masuk sini. Karkas adalah produk split-off yang didisposisi di step 13, dan Hati & Ampela sudah jadi kategori split-off di step 12; menaruh keduanya di sini membuat massa fisik yang sama terhitung dua kali di denominator alokasi, dan rasio SELURUH bucket lain ikut salah tanpa satu pun error yang kelihatan. Itu kesalahan costing, bukan kesalahan penamaan. BLD dan BLP masih kandidat, dan kepanjangan keempat singkatan itu belum dikonfirmasi siapa pun — lihat TBC-40. Penamaan tidak memblokir apa pun: yang mengikat perhitungan adalah HIMPUNAN SKU dan BERATNYA, bukan labelnya.'
where entity_code = 'KGR' and label = '14';

update public.os_process_needs set
  item = 'Berat input karkas dan output per SKU hasil cut-up'
where item = 'Berat input karkas dan output per SKU A–J'
  and step_id in (select id from public.os_process_steps where entity_code = 'KGR' and label = '14');

-- ===========================================================================
-- D3. KOMPOSISI FG vs WIP ADALAH PENGUKURAN HARIAN, BUKAN PARAMETER TETAP
-- ===========================================================================

-- Step 13 carries both D2's boundary and D3's measurement rule, because both
-- are statements about what this step decides.
update public.os_process_steps set
  note = 'PERCABANGAN UTAMA RANTAI INI. Karkas bisa jadi barang jadi atau WIP, dan yang menentukan adalah pesanan — bukan proses. Kalau FG, jalurnya berhenti di persediaan. Kalau WIP, dia lanjut ke pemrosesan lebih lanjut dan biayanya jadi separable, bukan joint. Karkas utuh dan jeroan didisposisi DI SINI dan tidak dinamai ulang jadi SKU di step 14 — step 14 hanya menampung output cut-up. Komposisinya juga bukan parameter tetap, dan alasannya lebih dalam daripada klasifikasi persediaan: dia input langsung ke rasio alokasi step 20. NRV karkas utuh berbeda dari NRV agregat SKU cut-up setelah dikurangi separable cost, jadi bauran yang bergeser menggeser Total NRV Batch — dan denominator yang bergeser menggeser alokasi SELURUH kategori, termasuk Ceker dan Usus yang tidak ada hubungannya dengan cut-up. Karena itu yang direkam adalah aktual per batch, bukan standar. Membekukannya jadi parameter mengubah pengukuran menjadi asumsi, dan asumsi menuntut justifikasi serta review berkala sementara pengukuran cukup menuntut dokumen sumber.'
where entity_code = 'KGR' and label = '13';

update public.os_process_needs set
  item = 'Komposisi disposisi karkas aktual per batch dalam kg — FG utuh, WIP cut-up, input MDM',
  src  = 'Sales Order + Instruksi disposisi tertulis per batch'
where item = 'Komposisi pesanan harian karkas utuh vs olahan'
  and step_id in (select id from public.os_process_steps where entity_code = 'KGR' and label = '13');

-- Step 19 — the costing sheet is where that measurement lands.
update public.os_process_steps set
  note = 'SOP 2.3 MELARANG memakai kapasitas terpasang sebagai denominator, dan indikasi RAB C4.4 tidak konsisten dengan kapasitas itu. Jadi angka yang benar hanya bisa datang dari demand plan — dan demand plan itulah yang belum punya sub-proses di SOP 1. Batch costing sheet juga menampung disposisi aktual karkas hari itu dari step 13 — FG utuh, WIP cut-up, dan input MDM. Itu bukan catatan produksi yang numpang lewat: dia yang menentukan himpunan SKU yang masuk denominator NRV di step 20, jadi dia data costing dan diperlakukan begitu.'
where entity_code = 'KGR' and label = '19';

-- ===========================================================================
-- D4. BIAYA SIMPAN COLD STORAGE JADI BEBAN PERIODE. POOL B BERHENTI DI ABF.
-- ===========================================================================

update public.os_process_steps set
  note = 'Pool B TIDAK masuk Total Joint Cost — dia dibebankan langsung ke SKU frozen berdasarkan kg aktual yang dibekukan. Itu keputusan P1 (internal ABF), dan konsekuensinya seluruh akun utang blasting, invoice blasting, dan three-way matching blasting dihapus dari v2.1. RUANG LINGKUP POOL B BERHENTI DI PERISTIWA PEMBEKUAN. Biaya simpan cold storage yang berjalan sesudahnya TIDAK dikapitalisasi dan tidak masuk applied Pool B — dia beban periode. Alasannya sama persis dengan alasan Pool B dipisah dari joint cost, yaitu kausalitas manfaat: ABF mengubah produk dari fresh jadi frozen sehingga dia konversi dan sah masuk nilai persediaan, sedangkan penyimpanan barang jadi yang menunggu terjual bukan konversi melainkan preservasi. Mengapitalisasinya juga akan menaikkan nilai tercatat persis saat uji LCNRV di step 37 menurunkannya, karena biaya simpan naik seiring umur sementara NRV turun seiring umur — kapitalisasi hari ini, penurunan nilai besok, berulang. Dan basis kg-hari akan menukar basis Pool B yang bersih, satu peristiwa terukur, dengan akrual berjalan yang menuntut pelacakan umur per SKU.',
  coa = '[{"code": "Persediaan", "label": "Transfer pool Fresh ke pool Frozen"}, {"code": "Overhead", "label": "Applied Overhead Pool B — dibebankan langsung ke SKU frozen"}, {"code": "Beban", "label": "Biaya Simpan Cold Storage — beban periode, di luar applied Pool B"}]'::jsonb
where entity_code = 'KGR' and label = '31';

update public.os_process_steps set
  note = 'DI SINI FRESH BERUBAH JADI FROZEN. Ini satu-satunya titik di seluruh rantai di mana stream berganti, dan itu sebabnya step ini milik kedua jalur. Prosedur darurat blast freezer tidak berfungsi juga di sini: tanpa pembekuan, pilihan tinggal repricing cepat atau write-off. Ekspektasi biaya simpan sampai perkiraan tanggal jual adalah input keputusan DI SINI — jalur blast freeze memikulnya, jalur repricing dan write-off tidak. Dia tetap beban periode dan tidak pernah masuk nilai persediaan (lihat step 31), tapi mengabaikannya saat memilih membuat jalur beku terlihat lebih murah dari yang sebenarnya. Biaya yang tidak dikapitalisasi tetap biaya yang nyata pada saat keputusan diambil.',
  drivers = '["Kg per keputusan disposisi", "Ekspektasi biaya simpan per jalur disposisi → pembanding beku vs repricing vs write-off"]'::jsonb
where entity_code = 'KGR' and label = '30';

-- Gate TBC-17 covers two estimates that D4 sends to two different fates.
-- Referenced by no step, same as 15 other TBC rows — that is the seed's
-- convention, and the text still has to be right.
update public.os_process_gates set
  unblock = 'Dua angka dengan dua nasib berbeda, dan memisahkannya adalah inti gate ini. Porsi ABF masuk tarif Pool B dan ikut ke nilai persediaan lewat step 31; porsi cold storage jadi beban periode dan hanya dipakai sebagai input keputusan disposisi di step 30. Selama keduanya menyatu, tarif Pool B kemasukan biaya simpan dan setiap SKU frozen menanggung penyimpanan yang belum tentu dia pakai.'
where id = 'TBC-17' and entity_code = 'KGR';

-- ===========================================================================
-- D5. ONGKOS ANGKUT KELUAR PUNYA RUMAH DI STEP 27 — SEBAGAI BIAYA MENJUAL
-- ===========================================================================

update public.os_process_steps set
  note = 'BST adalah pemicu pengakuan penjualan dan cut-off bulanan: SOP 8 menyatakan penjualan hanya dicatat di bulan berjalan kalau BST diperoleh sebelum atau pada hari terakhir bulan. STEP INI SEBELUMNYA TIDAK PUNYA SATU PUN COA, dan itu lubang pencatatan — bukan batas lingkup. Ongkos angkut keluar memang TIDAK pernah masuk nilai persediaan: dia biaya menjual, jadi ketiadaannya di arsitektur joint cost dan separable cost sudah benar dan harus tetap begitu. Yang salah adalah ketiadaannya di titik dia terjadi dan terbukti, padahal dokumen sumbernya — BST — justru ada di sini. Kalau armadanya milik entity lain di grup, biayanya tidak hilang: dia jadi transaksi antar-entity yang menuntut harga transfer, pengungkapan pihak berelasi, dan eliminasi konsolidasi — lebih berat daripada satu baris beban, bukan lebih ringan. Ini juga gap yang sama dengan need biaya menjual di step 37 dilihat dari ujung lain: ongkos angkut adalah komponen terbesar dan paling terestimasi dari biaya menjual, jadi menutup COA di sini yang membuat estimasi step 37 bisa dibangun — dan estimasi itu yang mencabut konvensi interim di step 20. PRASYARATNYA SATU PERTANYAAN: syarat penyerahan. Kalau ex-works dan pembeli mengambil sendiri, atau kalau entity logistik grup menagih langsung ke pelanggan, KGR tidak menanggung ongkos angkut dan COA di sini memang seharusnya kosong lagi.',
  coa = '[{"code": "Beban", "label": "Beban Angkut Keluar — biaya menjual, tidak pernah masuk nilai persediaan"}, {"code": "Beban", "label": "Beban Jasa Ekspedisi — pihak ketiga atau entity grup"}, {"code": "Neraca", "label": "Utang Jasa Angkut — pihak berelasi bila armada milik entity grup"}]'::jsonb,
  drivers = '["Kg terkirim per stream", "Biaya angkut per pengiriman → komponen terbesar estimasi biaya menjual di step 37", "Syarat penyerahan per pelanggan → menentukan apakah ongkos angkut ditanggung KGR"]'::jsonb
where entity_code = 'KGR' and label = '27';

-- ===========================================================================
-- D1 + D4 + D5 BERTEMU DI STEP 37. DITULIS TERAKHIR KARENA DIA YANG MENUTUP.
-- ===========================================================================

update public.os_process_steps set
  note = 'LCNRV hanya berlaku untuk frozen, dan itu logis: fresh habis dalam hitungan jam sehingga tidak pernah cukup lama untuk turun nilai. Frozen bisa menua berbulan-bulan — dan aging-nya belum diukur sama sekali. DI SINI KONVENSI INTERIM STEP 20 DICABUT. Estimasi biaya menjual per SKU dibutuhkan dua kali — sebagai deduksi NRV di step 20 dan sebagai pembanding NRV di uji ini — jadi begitu dia ada, suku nol di step 20 berhenti berlaku dan catatannya wajib dihapus di sana. Itu sebabnya membunuh NRV demi menghindari input ini tidak menghemat apa pun: dia tetap wajib dibangun untuk uji ini. Komponen terbesarnya ongkos angkut keluar, yang dokumen sumbernya ada di step 27. Dan nilai tercatat yang diuji di sini sudah memuat biaya pembekuan Pool B tapi TIDAK memuat biaya simpan cold storage — konsisten dengan step 31, dan itu yang mencegah uji ini berubah jadi lingkaran di mana biaya yang baru dikapitalisasi langsung diturunkan lagi.'
where entity_code = 'KGR' and label = '37';
