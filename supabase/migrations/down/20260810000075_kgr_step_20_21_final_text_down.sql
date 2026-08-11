-- Down-migration for 20260810000075_kgr_step_20_21_final_text.
--
-- Restores steps 20 and 21 to their POST-73 state, not to the seed. That is
-- the correct target: 73 is a separate migration with its own down file, and
-- unwinding 75 must not silently unwind D1's note as well. Run this file and
-- then down/20260810000073 to get back to the seed.
--
-- Field by field, this puts back:
--   risk, control, docs   the values 20260807000061 seeded and 73 left alone
--   note                  the values 20260810000073 wrote
--   drivers               step 20's three-item list from 73; step 21's
--                         two-item list from the seed
--   gate_id               step 21 back to null, which is what it was before
--                         75 pointed it at TBC-41
--
-- Nothing structural is touched, going down or up.

update public.os_process_steps set
  risk = 'Harga referensi tidak diperbarui sehingga Allocation Ratio menyimpang dari nilai jual sebenarnya dan cost per kg salah di seluruh SKU sekaligus; by-product diberi nilai nol tanpa dasar.',
  control = 'Harga referensi diperbarui minimal bulanan sebelum closing, bertanggal efektif, disetujui bersama Manajer Operasional dan Manajer Accounting, terpisah fresh dan frozen; nilai nol wajib dokumentasi alasan dan persetujuan formal.',
  note = 'Bucket Kondemnasi dan Waste TIDAK menerima alokasi — zero NRV. Dan applied overhead Pool B tidak masuk Total Joint Cost di langkah 4 dan 6; dia dibebankan langsung ke SKU frozen berdasarkan kg aktual yang dibekukan. Kalau Pool B ikut dilebur, SKU fresh menanggung biaya pembekuan yang tidak pernah dia pakai. KONVENSI INTERIM, BERLAKU SAMPAI DICABUT DI STEP 37: selama estimasi biaya menjual per SKU belum ada, suku itu diperlakukan nol di dalam NRV — sementara deduksi separable cost TETAP dipakai memakai estimasi teknik. Menolkan dua-duanya akan meruntuhkan NRV jadi Sales Value at Split-off, dan itu ditolak dengan alasan yang lebih keras daripada kerapian: harga yang dipakai di sini adalah harga SKU hilir, sedangkan SVAS menuntut harga pada kondisi split-off — yang untuk Output MDM tidak ada, karena kerangka harus di-deboning dulu sebelum jadi barang dagang. Jadi mengganti metodenya tidak menghasilkan SVAS, melainkan NRV yang salah label. Yang berubah di sini hanya nilai satu input, dan itu perubahan estimasi — bukan perubahan kebijakan yang menuntut penerapan retrospektif.',
  docs = '["Batch Costing Sheet", "Daftar Harga Jual Referensi NRV per SKU", "Yield Report final"]'::jsonb,
  drivers = '["Allocation Ratio = NRV SKU ÷ Total NRV Batch", "Cost per Kg per SKU = Allocated Joint Cost ÷ berat aktual SKU", "Bauran aktual FG vs WIP dari step 13 → himpunan SKU yang masuk denominator"]'::jsonb
where entity_code = 'KGR' and label = '20';

update public.os_process_steps set
  gate_id = null,
  risk = 'Separable cost ikut dilebur ke joint pool sehingga cost per kg seluruh kategori bergeser — kategori yang tidak diproses menanggung biaya, dan yang diproses terlihat lebih murah dari sebenarnya.',
  control = 'Separable cost dibebankan hanya ke SKU yang benar-benar melewati prosesnya, setelah alokasi joint selesai dan sebelum batch difinalisasi.',
  note = 'URUTANNYA MENGIKAT: alokasi joint dulu, separable sesudah. Pool B pembekuan mengikuti pola yang sama — dibebankan ke SKU frozen berdasarkan kg aktual dibekukan, tidak masuk Total Joint Cost. Membalik urutan ini membuat seluruh cost per kg salah, bukan sebagian. Sampai separable cost per SKU benar-benar ter-track, angkanya diisi estimasi teknik per jenis proses dan direkonsiliasi ke aktual begitu tracking-nya jalan. Estimasi kasar tetap lebih benar daripada nol, dan asimetrinya yang jadi alasan: cut-up dan MDM memikul proses lanjut yang nyata, sedangkan Ceker, Usus, dan Kepala nyaris tidak melewati apa pun. Menolkan suku ini akan sistematis meng-over-alokasi joint cost ke stream yang diproses dan meringankan yang tidak — persis distorsi yang merusak margin per SKU dan keputusan disposisi di step 30.',
  docs = '["Batch Costing Sheet — bagian separable", "Rekap biaya pemrosesan lanjut dan MDM"]'::jsonb,
  drivers = '["Separable cost ÷ kg output SKU terkait", "Cost per kg SKU = allocated joint + separable"]'::jsonb
where entity_code = 'KGR' and label = '21';
