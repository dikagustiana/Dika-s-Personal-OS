-- ===========================================================================
-- KGR STEP 20 DAN 21: TEKS FINAL, SELURUH PERMUKAAN — BUKAN HANYA CATATAN.
-- ===========================================================================
-- 20260810000073 landed D1 by rewriting `note` and `drivers` on these two
-- steps. It left `risk`, `control` and `docs` exactly as the seed wrote them,
-- which meant the two most consequential steps in the chain carried a note
-- that knew about the interim convention and a control that did not. This
-- file closes that: every editable field on steps 20 and 21 is authored as
-- one artefact rather than a note bolted onto seed prose.
--
-- WHAT IS ACTUALLY NEW HERE, BEYOND TIDYING:
--
--   1. THE PRICE VECTOR GETS A CONTROL, NOT JUST A NEED. 74 added the
--      back-test and its threshold as needs. A need is a statement that data
--      is missing; a control is a statement about what must happen. Step 20's
--      control now says a deviation past the threshold forces a revision of
--      the price list — "bukan penjelasan". Without that word the back-test
--      becomes a report someone reads and files.
--
--   2. SEPARABLE COST IS USED TWICE, AND NOTHING RECONCILED THE TWO USES.
--      This is a gap the interim convention CREATED and nobody had named. At
--      step 20 an ESTIMATE of separable cost is a deduction inside NRV, so it
--      decides the Allocation Ratio. At step 21 the ACTUAL separable cost is
--      added to the SKU. If the estimate and the actual diverge, the ratio was
--      computed on an NRV that was never right — and unlike overhead, which
--      surfaces at step 22 as a variance, nothing here ever fails. Step 21's
--      risk and control now carry it, and the note says plainly that closing
--      it properly needs a new need, which is migration-only and deliberately
--      NOT done in this file.
--
--   3. STEP 21 GETS A GATE. It had none, so the gap spotlight showed it as
--      unblocked while its two needs sat BELUM. TBC-41 (basis pengukuran upah
--      borongan) is the real blocker: if borongan is paid per kilo or per
--      ekor, hours are not the divisor and separable labour cannot be
--      attributed per SKU at all. Pointing a second step at one gate is the
--      house pattern already — TBC-15 serves 19 and 22, TBC-14 serves 36
--      and 38.
--
-- WHAT IS DELIBERATELY NOT CHANGED:
--   `name` on both steps. "7 langkah" is the SOP's own name for the procedure
--   and "setelah alokasi" is the ordering rule in four words; neither is
--   improved by rewording.
--   `coa` on both steps. Step 20 posts allocated joint cost and nothing else;
--   step 21 posts the two separable buckets and Pool B. The estimate-vs-actual
--   reconciliation revises an estimate forward, it does not post a journal —
--   see step 23, a closed batch is not reopened — so it gets no account. An
--   account invented to look complete would be worse than the gap.
--
-- TEXT ONLY, same line as 73: every column written here is one the app can
-- write. No row is added or removed; no slot, lane_key or track is named.
--
-- CONTAINS NO FINANCIAL FIGURES.
--
-- NOT YET APPLIED TO LIVE at the time of committing — unlike 73 and 74, which
-- carry their ledger entries in their headers. This file is authored for a
-- read-through first, because steps 20 and 21 decide every allocation ratio
-- in the entity. Record the ledger entry here when it goes in.
--
-- Down-migration:
-- supabase/migrations/down/20260810000075_kgr_step_20_21_final_text_down.sql

-- 0. Shape guard -------------------------------------------------------------
do $$
declare
  step_count int;
begin
  select count(*) into step_count from public.os_process_steps where entity_code = 'KGR';
  if step_count <> 38 then
    raise exception
      'Rantai % berisi % step, bukan 38. File ini menulis teks final step 20 dan 21 pada bentuk v0.2.', 'KGR', step_count;
  end if;
end
$$;

-- ===========================================================================
-- STEP 20 — NRV-based joint costing
-- ===========================================================================
-- risk    now names four failures, not two: stale prices, undocumented zero
--         by-product values, an interim convention with no end date, and a
--         price vector nothing ever tests.
-- control answers each in the same order, and the back-test clause is the one
--         that closes the review's residual risk.
-- docs    gains the back-test working paper and the SOP addendum, so the
--         interim convention has a document and not only a sentence.
-- drivers leads with the NRV formula itself, with the interim zero visible
--         inside it — a reader should not have to open the note to see which
--         term is currently switched off.
update public.os_process_steps set
  risk = 'Harga referensi tidak diperbarui sehingga Allocation Ratio menyimpang dari nilai jual sebenarnya dan cost per kg salah di seluruh SKU sekaligus; by-product diberi nilai nol tanpa dasar tertulis; konvensi interim biaya menjual nol berjalan terus tanpa tanggal berakhir sehingga yang sementara mengeras jadi permanen; dan harga referensi ditetapkan internal tanpa pernah diuji terhadap harga terealisasi, sehingga alokasi yang salah tidak pernah memunculkan selisih di rekonsiliasi mana pun.',
  control = 'Harga referensi diperbarui minimal bulanan sebelum closing, bertanggal efektif, disetujui bersama Manajer Operasional dan Manajer Accounting, terpisah fresh dan frozen; nilai nol untuk by-product wajib dokumentasi alasan dan persetujuan formal; harga referensi di-back-test terhadap harga jual terealisasi per SKU setiap periode dan penyimpangan di atas ambang wajib memicu revisi daftar harga, bukan penjelasan; konvensi interim biaya menjual nol ditinjau setiap closing dan gugur otomatis begitu estimasi biaya menjual di step 37 tersedia.',
  note = 'Bucket Kondemnasi dan Waste TIDAK menerima alokasi — zero NRV. Applied overhead Pool B juga tidak masuk Total Joint Cost di langkah 4 dan 6; dia dibebankan langsung ke SKU frozen, karena kalau ikut dilebur, SKU fresh menanggung biaya pembekuan yang tidak pernah dia pakai. METODENYA NRV DAN TETAP NRV. Usulan mengganti ke Sales Value at Split-off ditolak bukan karena kerapian: formulanya memakai harga SKU — konsep hilir yang baru lahir di step 14 — sedangkan SVAS menuntut harga pada KONDISI split-off, yang untuk Output MDM tidak ada karena kerangka harus di-deboning dulu sebelum jadi barang dagang. Hasilnya bukan SVAS melainkan NRV yang salah label, ditambah ongkos aplikasi yang tidak lagi sinkron dengan SOP v2.1. KONVENSI INTERIM SAMPAI DICABUT DI STEP 37: biaya menjual diperlakukan nol, tapi deduksi separable cost TETAP dipakai memakai estimasi teknik dari step 21 — menolkan dua-duanya meruntuhkan NRV jadi SVAS lewat pintu belakang. Yang berubah hanya nilai satu input: perubahan estimasi, bukan perubahan kebijakan yang menuntut penerapan retrospektif. Adendum bertanggal ke SOP v2.1 mencatat konvensi ini dan syarat pencabutannya; versi SOP tidak di-bump karena metodenya memang tidak berubah. Tujuh langkahnya sendiri hidup di SOP v2.1 dan tidak dicerminkan di aplikasi — yang ada di sini keputusan arsitekturalnya, bukan prosedur langkah demi langkah.',
  docs = '["Batch Costing Sheet", "Daftar Harga Jual Referensi NRV per SKU", "Yield Report final", "Kertas kerja back-test harga referensi vs harga terealisasi", "Adendum SOP v2.1 — konvensi interim biaya menjual nol"]'::jsonb,
  drivers = '["NRV SKU = harga referensi − separable cost (estimasi teknik) − biaya menjual (nol, interim)", "Allocation Ratio = NRV SKU ÷ Total NRV Batch", "Cost per Kg per SKU = Allocated Joint Cost ÷ berat aktual SKU", "Bauran aktual FG vs WIP dari step 13 → himpunan SKU yang masuk denominator", "Harga referensi vs harga terealisasi per SKU → pemicu revisi daftar harga"]'::jsonb
where entity_code = 'KGR' and label = '20';

-- ===========================================================================
-- STEP 21 — separable cost per SKU, after the allocation
-- ===========================================================================
-- gate_id  null becomes TBC-41. See the header: the step was drawn unblocked
--          while both its needs sat BELUM.
-- risk     gains the estimate-vs-actual divergence, which is the gap the
--          interim convention created and nobody had written down.
-- control  reconciles the two uses forward, never backward — a closed batch
--          is not reopened, which is step 23's rule and stays intact.
-- docs     gains the estimate working paper and the reconciliation.
-- drivers  corrects the cost build-up to include Pool B for frozen SKUs.
update public.os_process_steps set
  gate_id = 'TBC-41',
  risk = 'Separable cost ikut dilebur ke joint pool sehingga cost per kg seluruh kategori bergeser — kategori yang tidak diproses menanggung biaya, dan yang diproses terlihat lebih murah dari sebenarnya; separable cost dibebankan ke SKU yang tidak pernah melewati prosesnya karena pemetaan proses ke SKU belum ada; dan estimasi teknik yang dipakai sebagai deduksi NRV di step 20 menyimpang dari biaya aktual yang dibebankan di sini tanpa ada yang mempertemukan keduanya, sehingga Allocation Ratio terlanjur dihitung di atas NRV yang tidak pernah benar dan tidak ada satu pun rekonsiliasi yang gagal karenanya.',
  control = 'Separable cost dibebankan hanya ke SKU yang benar-benar melewati prosesnya, setelah alokasi joint selesai dan sebelum batch difinalisasi; estimasi teknik yang dipakai di step 20 dibandingkan dengan biaya aktual periode berjalan, dan selisih di atas ambang wajib memicu revisi estimasi untuk batch berikutnya — bukan koreksi mundur atas batch yang sudah closed.',
  note = 'URUTANNYA MENGIKAT: alokasi joint dulu, separable sesudah. Pool B pembekuan mengikuti pola yang sama — dibebankan ke SKU frozen berdasarkan kg aktual dibekukan, tidak masuk Total Joint Cost. Membalik urutan ini membuat seluruh cost per kg salah, bukan sebagian. SEPARABLE COST DIPAKAI DUA KALI DENGAN DUA PERAN, dan itu konsekuensi langsung dari konvensi interim di step 20. Di sana dia deduksi DI DALAM NRV, jadi dia ikut menentukan Allocation Ratio; di sini dia penambah biaya ke SKU yang melewatinya. Angka pertama estimasi, angka kedua aktual — dan selama keduanya tidak pernah dipertemukan, rasio alokasi berdiri di atas NRV yang tidak teruji. Overhead punya step 22 untuk persoalan yang sama persis; separable belum punya padanannya, dan menutupnya butuh need baru, yang migration-only. Sampai tracking per SKU jalan, angkanya diisi estimasi teknik per jenis proses. Estimasi kasar tetap lebih benar daripada nol: cut-up dan MDM memikul proses yang nyata sementara Ceker, Usus, dan Kepala nyaris tidak melewati apa pun, jadi menolkannya meng-over-alokasi joint cost ke stream yang diproses secara sistematis — dan itu persis distorsi yang merusak margin per SKU dan keputusan disposisi di step 30.',
  docs = '["Batch Costing Sheet — bagian separable", "Rekap biaya pemrosesan lanjut dan MDM", "Kertas kerja estimasi teknik separable cost per jenis proses", "Rekonsiliasi estimasi vs aktual separable cost per periode"]'::jsonb,
  drivers = '["Separable cost ÷ kg output SKU terkait", "Cost per kg SKU = allocated joint + separable + Pool B bila frozen", "Estimasi separable yang dipakai di step 20 vs aktual di sini → pemicu revisi estimasi"]'::jsonb
where entity_code = 'KGR' and label = '21';
