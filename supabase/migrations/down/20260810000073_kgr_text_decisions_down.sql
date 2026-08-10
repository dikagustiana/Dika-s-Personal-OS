-- Down-migration for 20260810000073_kgr_text_decisions.
--
-- Restores every field the up-migration touched to the value 20260807000061
-- seeded — transcribed from that file, not reconstructed from memory. Because
-- the up-migration only ever SET absolute values (it never appended to what
-- was there), this file is a complete inverse: after running it the KGR chain
-- is byte-identical to the seed again.
--
-- WHAT THIS CANNOT UNDO: any text a human edited through the app between the
-- two runs. This file writes the SEED's values, so a hand edit made in the
-- meantime is overwritten rather than preserved. Check
-- os_process_text_history for KGR rows before running.
--
-- Structure is untouched here for the same reason it was untouched going up:
-- no row is added or removed, and slot/lane_key/track/label never appear.

update public.os_process_steps set
  note = 'PERCABANGAN UTAMA RANTAI INI. Karkas bisa jadi barang jadi atau WIP, dan yang menentukan adalah pesanan — bukan proses. Kalau FG, jalurnya berhenti di persediaan. Kalau WIP, dia lanjut ke pemrosesan lebih lanjut dan biayanya jadi separable, bukan joint.'
where entity_code = 'KGR' and label = '13';

update public.os_process_steps set
  name = 'Pemrosesan lanjut karkas → SKU A sampai J',
  note = 'LAPISAN KEDUA. Biaya di sini SEPARABLE — ditambahkan per SKU SETELAH alokasi joint, bukan sebelum. SOP sudah menetapkan pola ini untuk MDM; pola yang sama berlaku untuk seluruh pemrosesan lanjut. Yield pemrosesan lanjut belum punya benchmark sama sekali.'
where entity_code = 'KGR' and label = '14';

update public.os_process_steps set
  note = 'SOP 2.3 MELARANG memakai kapasitas terpasang sebagai denominator, dan indikasi RAB C4.4 tidak konsisten dengan kapasitas itu. Jadi angka yang benar hanya bisa datang dari demand plan — dan demand plan itulah yang belum punya sub-proses di SOP 1.'
where entity_code = 'KGR' and label = '19';

update public.os_process_steps set
  note = 'Bucket Kondemnasi dan Waste TIDAK menerima alokasi — zero NRV. Dan applied overhead Pool B tidak masuk Total Joint Cost di langkah 4 dan 6; dia dibebankan langsung ke SKU frozen berdasarkan kg aktual yang dibekukan. Kalau Pool B ikut dilebur, SKU fresh menanggung biaya pembekuan yang tidak pernah dia pakai.',
  drivers = '["Allocation Ratio = NRV SKU ÷ Total NRV Batch", "Cost per Kg per SKU = Allocated Joint Cost ÷ berat aktual SKU"]'::jsonb
where entity_code = 'KGR' and label = '20';

update public.os_process_steps set
  note = 'URUTANNYA MENGIKAT: alokasi joint dulu, separable sesudah. Pool B pembekuan mengikuti pola yang sama — dibebankan ke SKU frozen berdasarkan kg aktual dibekukan, tidak masuk Total Joint Cost. Membalik urutan ini membuat seluruh cost per kg salah, bukan sebagian.'
where entity_code = 'KGR' and label = '21';

update public.os_process_steps set
  note = 'BST adalah pemicu pengakuan penjualan dan cut-off bulanan: SOP 8 menyatakan penjualan hanya dicatat di bulan berjalan kalau BST diperoleh sebelum atau pada hari terakhir bulan.',
  coa = '[]'::jsonb,
  drivers = '["Kg terkirim per stream"]'::jsonb
where entity_code = 'KGR' and label = '27';

update public.os_process_steps set
  note = 'DI SINI FRESH BERUBAH JADI FROZEN. Ini satu-satunya titik di seluruh rantai di mana stream berganti, dan itu sebabnya step ini milik kedua jalur. Prosedur darurat blast freezer tidak berfungsi juga di sini: tanpa pembekuan, pilihan tinggal repricing cepat atau write-off.',
  drivers = '["Kg per keputusan disposisi"]'::jsonb
where entity_code = 'KGR' and label = '30';

update public.os_process_steps set
  note = 'Pool B TIDAK masuk Total Joint Cost — dia dibebankan langsung ke SKU frozen berdasarkan kg aktual yang dibekukan. Itu keputusan P1 (internal ABF), dan konsekuensinya seluruh akun utang blasting, invoice blasting, dan three-way matching blasting dihapus dari v2.1.',
  coa = '[{"code": "Persediaan", "label": "Transfer pool Fresh ke pool Frozen"}, {"code": "Overhead", "label": "Applied Overhead Pool B — dibebankan langsung ke SKU frozen"}]'::jsonb
where entity_code = 'KGR' and label = '31';

update public.os_process_steps set
  note = 'LCNRV hanya berlaku untuk frozen, dan itu logis: fresh habis dalam hitungan jam sehingga tidak pernah cukup lama untuk turun nilai. Frozen bisa menua berbulan-bulan — dan aging-nya belum diukur sama sekali.'
where entity_code = 'KGR' and label = '37';

update public.os_process_gates set
  unblock = 'Komponen Pool B yang belum terukur.'
where id = 'TBC-17' and entity_code = 'KGR';

update public.os_process_needs set
  item = 'Berat input karkas dan output per SKU A–J'
where item = 'Berat input karkas dan output per SKU hasil cut-up'
  and step_id in (select id from public.os_process_steps where entity_code = 'KGR' and label = '14');

update public.os_process_needs set
  item = 'Komposisi pesanan harian karkas utuh vs olahan',
  src  = 'Sales Order'
where item = 'Komposisi disposisi karkas aktual per batch dalam kg — FG utuh, WIP cut-up, input MDM'
  and step_id in (select id from public.os_process_steps where entity_code = 'KGR' and label = '13');
