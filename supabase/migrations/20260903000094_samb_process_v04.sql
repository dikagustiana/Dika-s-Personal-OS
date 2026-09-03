-- ===========================================================================
-- SAMB PROCESS v0.4: THE THIRD-ROUND FINDINGS REACH THE SWIMLANE. DATA ONLY.
-- ===========================================================================
-- Raises the SAMB operational chain from seed v0.3 (20260806000051, plus the
-- 18b bridge pair recorded by 20260806000056) to v0.4. Emitted from the
-- curated seed src/logic/process/sambProcessSeed.json, which stays the
-- source of truth: every literal below is that file's v0.3 or v0.4 value,
-- not retyped prose. No schema change — no column, table or constraint is
-- touched; os_process_* keep the shape 20260806000050/52/86 gave them.
--
-- WHAT CHANGED, AND WHY
-- Between v0.3 and this file the chain was worked three rounds outside the
-- app: 21 workpapers (one per missing piece of information), a billing
-- reconciliation workbook, and a coherent dummy world pushed through the
-- budget so that whatever was broken surfaced as a figure that did not fit,
-- a cell with no source, or a test that had never existed. What reached the
-- swimlane:
--
--   * Six gates rewritten where their premise proved wrong. G05 no longer
--     asks for ONE driver: three pools are split ONCE each with their own
--     consumption driver (space → pallet position, handling → carton
--     equivalents in + out, truck → CBM tested against tonnage), never by
--     revenue share. G13 records the method and narrows to two questions,
--     physical location and billing entity. G01 states the measured
--     consequence of missing cartons-per-SKU (the whole per-CBM basis
--     shifts; the warehouse fit test cannot run). G06 gains two corrections
--     to the trucking mechanism. G15 records that LP tariffs are several
--     driver classes, mostly sold as one bundled price. G09 points at the
--     returns step that now exists.
--   * Five new gates G16–G20: the handling unit, the normal-capacity unit
--     per fleet class, the entity that owns the rented-warehouse cost and
--     bills its clients, snapshot-vs-monthly workpapers, and a name for the
--     billing difference against the books.
--   * Twelve steps get their drivers rewritten to the driver classes that
--     are actually used to bill and to split the pools (1, 6a, 9, 13, 15a,
--     15b, 16, 17, 19, 20, 21, 26). Step 13's note drops the old G05
--     premise with them. Step 21 moves from G13 to G15: the carve-out is a
--     closing journal (step 28), not part of invoicing.
--   * Three new steps: 18c (returns, rejects and claims to principals — the
--     box meta.scope v0.3 itself said was missing), 27 (LP billing
--     reconciled against the books) and 28 (pool allocation and COS–LP
--     carve-out at close — where G13 actually lives).
--   * Thirteen new needs (twelve on the new steps, one on 15a) and eleven
--     existing needs re-pointed at the workpaper that now collects them,
--     five of those moving status.
--   * docs on 26 steps gain the name of their workpaper — until now not one
--     step named the instrument that collects its needs.
--   * Five bridge pairs: 18c → Sales — General Trade · 27 → Sales —
--     Logistic provider · 28 → COGS — Logistic provider, Storing cost,
--     Distribution cost. By LITERAL Finish line UUID, as every SAMB bridge
--     row before it — three Finish line labels are duplicated across
--     sections, so a by-label match would pick the wrong twin.
--
-- Counts after this file: 6 lanes · 7 phases · 20 gates · 33 steps ·
-- 131 needs · 51 bridge pairs. Phase tiling is unchanged — slots 15, 19 and
-- 21 were already covered. Contains no financial figures and no third-party
-- names; workpaper codes (WH01, LP09, …) are identifiers, not data.
--
-- STEP 28 SITS AT SLOT 21, NOT THE BRIEF'S SLOT 20. Slot 20 already holds
-- step 25 and both are KEDUANYA: two shared steps on one slot make every
-- walk ambiguous (process.ts duplicateChainSlots fires and the canvas stops
-- drawing arrows rather than guess an order). Slot 21 keeps the step inside
-- KAS & ELIMINASI, beside 26 as a legal branch+shared pair. Flagged in the
-- PR as the process owner's call; moving it later is one slot number here
-- and in the JSON, nothing else.
--
-- GATES REFERENCED BY NO STEP — DELIBERATE, DO NOT TIDY. After this file
-- they are G03, G07 (as before) and G16, G17, G18, G19. Gate numbering is
-- kept consistent with the blocker register maintained outside the app, and
-- the brief attached only G09 → 18c, G20 → 27, G13 → 28 and G15 → 21.
-- G16–G18 are cited inside driver text (steps 13, 16, 20) but each of those
-- steps already carries its own gate. G09 stops being unreferenced.
--
-- ===========================================================================
-- TEXT IS EDITABLE FROM THE APP, SO EVERY UPDATE HERE IS CONDITIONAL.
-- ===========================================================================
-- Since 20260806000055 a step's name/co/risk/control/note/gate_id/docs/coa/
-- drivers, a need's item/kind/src/owner/status and a gate's title/sub/
-- owner/unblock can be edited in-app. A plain `update … set` would silently
-- overwrite whatever the owner typed since 6 August. So each of the 61 text
-- updates in section 7 carries `and <col> = <v0.3 value>` and lands only
-- while the column still holds the seed text. Rows that no longer match are
-- LEFT AS THEY ARE and listed in one raise notice at the end of that block,
-- for a manual decision. Silently overwriting a person's edit is worse than
-- skipping it.
--
-- ONE-SHOT. Section 0 refuses unless the database is exactly at v0.3 + 56
-- (15 SAMB gates, 30 steps, 118 needs, 46 bridge pairs, no G16..G20). A
-- re-run would fail loudly on the gate and step PKs, but the needs insert
-- resolves its steps by label and would duplicate SILENTLY — so the guard
-- speaks first, and says why. Every structural insert below is plain, with
-- no `on conflict do nothing`, so anything the guard did not foresee fails
-- loudly instead of skipping.
--
-- NOT APPLIED. This session has no database access.
-- APPLY BEFORE DEPLOY:
--   1. Confirm the pre-state on live: 15 SAMB gates, 30 steps, 118 needs,
--      46 bridge pairs, and no gate id in G16..G20. The guard checks the
--      same, but reading it first is cheaper than reading an exception.
--   2. Apply this file ONCE with the Supabase apply_migration tool, proposed
--      ledger name `samb_process_v04`. Read the notice it raises: the list
--      of skipped text updates is the owner's to-do, not a failure.
--   3. Merge the PR after the apply, so the fixture (20/33/131/51) and
--      production agree from the first deploy. Nothing in the frontend reads
--      these rows differently — the app renders whatever the tables hold —
--      so the order is about the tests telling the truth, not about a crash.
-- NEVER apply with `supabase db push`, `migration up`, `db reset` or
-- `db remote commit` — this repo's filenames and the live ledger's versions
-- are different numbering schemes, so any of those replays the entire
-- history from 0001_schema.sql against live production data.
--
-- Down-migration:
-- supabase/migrations/down/20260903000094_samb_process_v04_down.sql
-- It reverses the inserts and, under the same conditional rule, the text
-- updates. It cannot restore edits made from the app between apply and
-- rollback.
--
-- NOT a fix for os_process_gates having no resolved state. G05 and G13 now
-- say "method set, remaining question X" inside `sub`, which is prose doing
-- a status column's job. A `status` column or a decisions table is proposed
-- in the PR as separate work and deliberately NOT added here.

-- 0. Pre-state guard ---------------------------------------------------------
-- BEFORE ANY STATEMENT. Exactly v0.3 + 56, or refuse and say what was found.
do $$
declare
  n_gates  integer;
  n_steps  integer;
  n_needs  integer;
  n_bridge integer;
  n_new    integer;
begin
  select count(*) into n_gates  from public.os_process_gates where entity_code = 'SAMB';
  select count(*) into n_steps  from public.os_process_steps where entity_code = 'SAMB';
  select count(*) into n_needs  from public.os_process_needs n
                                join public.os_process_steps s on s.id = n.step_id
                                where s.entity_code = 'SAMB';
  select count(*) into n_bridge from public.os_process_step_items i
                                join public.os_process_steps s on s.id = i.step_id
                                where s.entity_code = 'SAMB';
  select count(*) into n_new    from public.os_process_gates
                                where id in ('G16', 'G17', 'G18', 'G19', 'G20');
  if n_new > 0 then
    raise exception
      'samb_process_v04 menolak jalan: gate G16..G20 sudah ada (% baris) — file ini sudah pernah diterapkan. Sekali pakai: insert needs dan bridge di bawah mencari step lewat label, jadi menjalankannya ulang akan menduplikasi baris tanpa error. Jalankan down-migration lebih dulu kalau benar-benar mau mengulang.',
      n_new;
  end if;
  if n_gates <> 15 or n_steps <> 30 or n_needs <> 118 or n_bridge <> 46 then
    raise exception
      'samb_process_v04 menolak jalan: pra-state SAMB bukan v0.3 + 56 (15 gate, 30 step, 118 need, 46 pasangan bridge) — ditemukan % gate, % step, % need, % pasangan. Periksa dulu apa yang berubah sebelum menaikkan versi di atasnya.',
      n_gates, n_steps, n_needs, n_bridge;
  end if;
end
$$;

-- 1. New gates ---------------------------------------------------------------
-- Numbering continues from G15. entity_code is SAMB on all five; the column
-- stays nullable in the schema for a future cross-entity gate, not for these.
insert into public.os_process_gates (id, type, title, sub, owner, unblock, entity_code) values
  ('G16', 'DECISION', 'Satuan driver handling', 'Blocker baru — putaran 3', 'Kamu (PF) + Warehouse', 'Karton bukan satuan kerja yang setara: karton antar pemilik barang berbeda volume jauh, sehingga share handling yang dihitung atas karton dan atas CBM masuk-keluar memberi hasil yang berbeda material. Carve-out handling bisa terlalu besar atau terlalu kecil hanya karena satuannya. Tetapkan satu: pallet-movement (masuk + keluar), CBM masuk-keluar per kelas, atau tetap karton dengan bobot per kelas dari WH03.', 'SAMB'),
  ('G17', 'DECISION', 'Satuan kapasitas normal armada per kelas', 'Blocker baru — putaran 3', 'Kamu (PF) + Fleet', 'PSAK 14 mengalokasi biaya tetap atas kapasitas normal, dan satuan kapasitas itu belum ditetapkan. Pada basis CBM, varians kapasitas tak terpakai membesar dengan cara yang menunjukkan satuannya salah untuk kelas armada trade. Tetapkan per kelas: drop per hari untuk armada kecil dan menengah, tonase untuk produk padat, CBM untuk armada besar. FLT01 sudah punya kolom CBM dan tonase; kolom drop perlu ditambahkan.', 'SAMB'),
  ('G18', 'DATA', 'Entitas pemilik biaya gudang sewa & penagih klien LP01', 'Blocker baru — dua semesta klien', 'FAT + GA + Legal', 'Neraca percobaan SAMB hanya memuat sewa gudang trading, sementara gudang sewa tempat barang klien LP01 berada tidak punya biaya yang terlihat di mana pun; dan tidak satu nama klien di daftar okupansi gudang sewa yang muncul di daftar klien yang ditagih. Dua semesta klien, satu akun revenue. Konfirmasi dua hal: gudang mana yang ada di kontrak SAMB, dan entitas mana yang menerbitkan invoice untuk klien di gudang sewa. Jawabannya menentukan POOL MANA YANG DIBELAH, bukan hanya angkanya.', 'SAMB'),
  ('G19', 'DECISION', 'Basis periode workpaper: potret atau deret bulanan', 'Open item — putaran 3', 'Kamu (PF)', 'Workpaper volume hari ini potret satu periode acuan, sedangkan budget butuh dua belas bulan; hanya LP09 yang berkolom bulan. Menjembatani satu angka workpaper ke dua belas bulan memakai aturan tetap/mengikuti-volume — itu asumsi, bukan pengukuran. Tetapkan: workpaper rekap (WH01, WH04, WH05, FAT05, SLS01, LP07) diberi kolom per bulan, sedangkan register transaksi (LP05, LP06, FAT06) tetap satu berkas per periode.', 'SAMB'),
  ('G20', 'DATA', 'Nama untuk selisih billing LP lawan buku', 'Blocker baru — putaran 3', 'FAT + PF', 'Jumlah dasar tagih per komponen tidak sama dengan akun revenue jasa LP di buku, dan selisihnya belum punya penjelasan maupun pemilik. Sampai bernama, selisih itu TIDAK DIANGGARKAN — bukan disembunyikan di tarif. Arsip billing periode terakhir juga belum masuk, sehingga tidak bisa dibedakan apakah selisihnya membesar atau tagihannya memang naik. Rekonsiliasinya di step 27.', 'SAMB');

-- 2. New steps ---------------------------------------------------------------
-- Structure (label, slot, lane_key, track) is migration-only by design; the
-- text columns are the seed's v0.4 values and become editable the moment
-- they land. Gates referenced: G09 (18c), G20 (27, inserted above), G13 (28).
insert into public.os_process_steps (entity_code, label, slot, lane_key, co, track, name, risk, control, note, gate_id, docs, coa, drivers) values
  ('SAMB', '18c', 15, 'WAREHOUSE', 'Warehouse + Sales Admin', 'KEDUANYA', 'Retur, reject & klaim ke principal',
   'Barang kembali diterima tanpa nota bernomor, sehingga tidak pernah sampai ke Sales Return maupun ke klaim ke principal — nilainya hilang dua kali: barangnya sudah kembali, penggantiannya tidak pernah ditagih. Retur barang klien tercampur dengan retur barang sendiri karena kolom Kepemilikan Barang tidak ada di nota.', 'Nota retur bernomor untuk setiap barang kembali, dengan kolom Kepemilikan Barang dan kode alasan; barang layak jual dipisah dari write-off sebelum kembali ke rak; rekap bulanan per principal direkonsiliasi ke akun Sales Return dan ke daftar klaim yang diajukan.', 'Kotak ini sebelumnya tidak ada, dan meta.scope v0.3 menyebutnya sendiri. Registernya sekarang tersedia di WH05. Muara akuntansinya DUA dan berangkat dari satu nota: Sales Return untuk yang ditanggung SAMB, klaim ke principal untuk yang ditanggung principal — jadi kalau kolom ''siapa menanggung'' kosong, dua-duanya salah.', 'G09',
   '["WH05 register POD, retur & reject","Nota retur bernomor","Rekap retur per principal"]'::jsonb, '[{"code":"4.3.xx","label":"Sales Return — pengurang revenue"},{"code":"Laba rugi","label":"Claim Discount — klaim ke principal"}]'::jsonb, '["Nilai retur sebagai porsi penjualan per principal","Qty retur per alasan","Porsi layak jual lawan write-off","Porsi yang diklaim ke principal"]'::jsonb),
  ('SAMB', '27', 19, 'FINANCE', 'PF + FAT', 'LP', 'Rekonsiliasi billing LP lawan buku',
   'Revenue jasa LP diakui dari buku tanpa pernah dicocokkan ke dasar tagih per komponen, sehingga selisihnya tidak pernah bernama dan ikut terbawa ke budget sebagai pendapatan berulang yang tidak punya dasar tagih.', 'Setiap bulan dasar tagih per klien per komponen dijumlah dan dicocokkan ke akun revenue jasa LP di buku; selisih di atas ambang diberi nama dan pemilik sebelum tutup buku; selisih yang belum bernama tidak dianggarkan.', 'Di sinilah dua semesta klien terlihat: klien yang menerima tagihan dan klien yang menempati gudang sewa tidak bertemu di satu nama pun, sementara keduanya bermuara ke satu akun revenue. Rekonsiliasi bulanan inilah yang memaksa pertanyaan itu keluar, bukan analisis terpisah.', 'G20',
   '["LP09 rekonsiliasi billing LP, driver per klien & carve-out","Arsip billing per klien per bulan","Buku akun revenue jasa LP"]'::jsonb, '[{"code":"4.4.xx","label":"Sales — Logistic provider"}]'::jsonb, '["Dasar tagih per klien per komponen","Porsi klien afiliasi di dalamnya","Selisih dasar tagih lawan buku per bulan"]'::jsonb),
  ('SAMB', '28', 21, 'FINANCE', 'PF + Accounting', 'KEDUANYA', 'Alokasi pool biaya & carve-out COS–LP (tutup buku)',
   'Biaya melayani barang klien tetap tinggal di Storing dan Distribution sementara COGS-LP dibukukan terpisah, sehingga biaya yang sama terhitung dua kali dan marjin jasa LP terbaca penuh; atau sebaliknya pool dibelah dengan revenue share, sehingga cost-to-serve per CBM tidak pernah bisa dipertanggungjawabkan ke luar.', 'Tiga pool ditetapkan sebelum alokasi (ruang, handling, truk), masing-masing dibelah SEKALI dengan driver konsumsi fisiknya; jumlah yang masuk COGS-LP dikeluarkan lewat baris ''dikeluarkan ke COGS-LP'' di pool asalnya; kontrol bulanan memeriksa carve-out sama dengan pengurangan pool, dan laba operasi tidak berubah oleh reklas.', 'Inilah tempat G13 sebenarnya — bukan step 21. Carve-out adalah jurnal tutup buku, bukan bagian dari penerbitan invoice. Buku tidak punya dan tidak akan punya akun biaya LP: klien dilayani oleh ruang, tenaga handling dan truk yang SAMA dengan barang sendiri. Satu-satunya cara yang mengikuti realita adalah membelah pool dengan driver konsumsi — bukan persentase flat, bukan revenue share.', 'G13',
   '["LP09 rekonsiliasi billing LP — sheet Konsumsi & Carve-out","LP08 invoice jasa LP & carve-out COS–LP","WH02 time study manpower gudang & activity pool"]'::jsonb, '[{"code":"5.4.xx","label":"COGS — Logistic provider"},{"code":"6.3.xx","label":"Storing — dikeluarkan ke COGS-LP"},{"code":"7.3.xx","label":"Distribution — dikeluarkan ke COGS-LP"}]'::jsonb, '["Pool ruang × porsi pallet position klien","Pool handling × porsi karton-ekuivalen klien","Pool truk × porsi CBM klien, diuji atas basis tonase","Bobot pool handling dari time study"]'::jsonb);

-- 3. New needs ---------------------------------------------------------------
-- Twelve on the three new steps, one on 15a. Resolved to their step by
-- (entity_code, label) — step ids are generated at insert time and differ
-- between live and any rebuilt cluster, while (SAMB, label) is stable.
insert into public.os_process_needs (step_id, item, kind, src, owner, status)
select s.id, v.item, v.kind, v.src, v.owner, v.status
from (values
  ('18c', 'Nota retur bernomor dengan kolom Kepemilikan Barang', 'TRANSAKSI', 'WH05 register POD, retur & reject', 'Warehouse + Sales Admin', 'BELUM'),
  ('18c', 'Kode alasan retur yang dipakai bersama', 'MASTER', 'Kebijakan internal', 'Sales + Warehouse', 'BELUM'),
  ('18c', 'Hak retur & batas waktu per principal', 'REFERENSI', 'Kontrak principal → MD02', 'Commercial', 'SEBAGIAN'),
  ('27', 'Arsip billing LP per klien per bulan', 'TRANSAKSI', 'Arsip billing → LP09', 'PF', 'ADA'),
  ('27', 'Arsip billing periode terakhir', 'TRANSAKSI', 'Arsip billing', 'PF + Finance AR', 'BELUM'),
  ('27', 'Penjelasan selisih dasar tagih lawan buku per bulan', 'REFERENSI', 'Penelusuran FAT', 'FAT', 'BELUM'),
  ('27', 'Padanan nama klien yang ditagih lawan klien gudang sewa', 'MASTER', 'Daftar okupansi + arsip billing', 'Sales + PF', 'BELUM'),
  ('28', 'Total pallet position terisi seluruh gudang per bulan', 'TRANSAKSI', 'WMS → WH01', 'Warehouse', 'BELUM'),
  ('28', 'Total karton keluar + masuk gudang per bulan', 'TRANSAKSI', 'WMS → WH04', 'Warehouse', 'BELUM'),
  ('28', 'Total CBM & tonase dikirim per bulan', 'TRANSAKSI', 'Trip Log → WH04', 'Fleet', 'BELUM'),
  ('28', 'Bobot empat activity pool dari time study', 'PARAMETER', 'WH02 Time Study', 'Warehouse + HR', 'BELUM'),
  ('28', 'Payroll per departemen per bulan', 'TRANSAKSI', 'Salary Details', 'HRD', 'ADA'),
  ('15a', 'Karton & berat per SJ', 'TRANSAKSI', 'Kolom di SJ → WH04 sheet Rekap Outbound', 'Warehouse Outbound', 'BELUM')
) as v(step_label, item, kind, src, owner, status)
join public.os_process_steps s on s.entity_code = 'SAMB' and s.label = v.step_label;

-- 4. The step → Finish line bridge ------------------------------------------
-- Finish line rows by LITERAL UUID (the same ids 20260806000051 section 6 and
-- 20260806000056 use — read from live on 6 August). Never a label match.
-- processModel.test.ts parses these rows and pins them against the fixture.
insert into public.os_process_step_items (step_id, item_id)
select s.id, v.item_id::uuid
from (values
  ('18c', '634e675f-4681-4307-b831-6cad1e7d80fa'),
  ('27', '2b7394bf-92f4-4900-b2a6-03353dbe6d98'),
  ('28', '768beb21-1151-4a1f-924a-c1c3f5001348'),
  ('28', '10b151a5-5c45-454c-a13b-ffbc786ec645'),
  ('28', '7d040e4a-7bf4-425a-b171-a46245d8158c')
) as v(step_label, item_id)
join public.os_process_steps s on s.entity_code = 'SAMB' and s.label = v.step_label;

-- 5. Post-conditions on the structure ---------------------------------------
-- The counts the frontend fixture and process_entity_checks.sql pin. Refused
-- in-transaction rather than discovered later.
do $$
declare
  n_gates  integer;
  n_steps  integer;
  n_needs  integer;
  n_bridge integer;
begin
  select count(*) into n_gates  from public.os_process_gates where entity_code = 'SAMB';
  select count(*) into n_steps  from public.os_process_steps where entity_code = 'SAMB';
  select count(*) into n_needs  from public.os_process_needs n
                                join public.os_process_steps s on s.id = n.step_id
                                where s.entity_code = 'SAMB';
  select count(*) into n_bridge from public.os_process_step_items i
                                join public.os_process_steps s on s.id = i.step_id
                                where s.entity_code = 'SAMB';
  if n_gates <> 20 or n_steps <> 33 or n_needs <> 131 or n_bridge <> 51 then
    raise exception
      'samb_process_v04 gagal post-condition: gate % (harus 20), step % (harus 33), need % (harus 131), bridge % (harus 51).',
      n_gates, n_steps, n_needs, n_bridge;
  end if;
end
$$;

-- 6. Text updates, each conditional on the v0.3 value --------------------------
-- 61 updates in one block: gate text, step drivers/note/gate_id, step docs,
-- need status/src. A column that no longer holds the seed text was edited
-- from the app; it is skipped and named in the notice at the end. Nothing
-- in this block changes a count.
do $$
declare
  hit     integer;
  skipped text[] := '{}';
begin
  -- Gates (10 column updates, v0.3 → v0.4) --
  update public.os_process_gates
     set sub = 'Standing blocker #1 — konsekuensinya kini terukur'
   where entity_code = 'SAMB' and id = 'G01'
     and sub = 'Standing blocker #1';   -- only while still the v0.3 text
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_gates G01 · sub'); end if;

  update public.os_process_gates
     set unblock = 'Datanya melewati Purchasing tiap kali PO dibuat (step 3). Minta formal, eskalasi kalau menggantung. Tanpa isi per karton, basis volume budget terpaksa memakai kapasitas armada alih-alih volume fisik dari dimensi karton — SELURUH metrik per CBM bergeser, dan uji muat gudang (step 9) tidak bisa dijalankan. Jalan tercepat: minta price list lewat MD02 sheet Annex SKU, mulai dari principal dengan SKU terbanyak. Satu blocker ini menutup G16 dan perbandingan cost-to-serve per karton sekaligus.'
   where entity_code = 'SAMB' and id = 'G01'
     and unblock = 'Datanya melewati Purchasing tiap kali PO dibuat (step 2). Minta formal, eskalasi kalau menggantung.';   -- only while still the v0.3 text
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_gates G01 · unblock'); end if;

  update public.os_process_gates
     set title = 'Driver COGS-LP per pool (bukan satu driver)'
   where entity_code = 'SAMB' and id = 'G05'
     and title = 'Driver COGS LP Fulfillment';   -- only while still the v0.3 text
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_gates G05 · title'); end if;

  update public.os_process_gates
     set sub = 'Metode ditetapkan — sisa satu keputusan satuan, lihat G16'
   where entity_code = 'SAMB' and id = 'G05'
     and sub = 'Standing blocker #5';   -- only while still the v0.3 text
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_gates G05 · sub'); end if;

  update public.os_process_gates
     set unblock = 'Premis lama — pilih satu dari pallet position, CBM stored, atau pick line — ditinggalkan. Tiga pool dibelah masing-masing SEKALI dengan driver konsumsinya sendiri: ruang → pallet position; handling → karton-ekuivalen masuk + keluar; truk → CBM, diuji atas basis tonase. Bukan revenue share, bukan persentase flat. Yang dibelah harus KELUAR dari pool asalnya (step 28), sehingga reklas ini netral terhadap laba operasi. Yang belum diputus: satuan handling — G16.'
   where entity_code = 'SAMB' and id = 'G05'
     and unblock = 'Pilih satu: pallet position (step 6) · CBM stored (step 7) · pick line count (step 10). Ketiganya sudah lahir di rantai.';   -- only while still the v0.3 text
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_gates G05 · unblock'); end if;

  update public.os_process_gates
     set unblock = 'Pilih (a) split internal/LP + benchmark rate, CBM dari estimasi inventory; atau (b) all internal armada, CBM dari Trip Log actual, tanpa Rate Card. Dua koreksi, apa pun pilihannya: pembilang biaya delivery WAJIB memuat CBM barang klien karena truk yang sama mengangkut keduanya — carve-out truk membelah pool yang sudah memuatnya, bukan menambah pool baru; dan satuan kapasitas normal per kelas armada belum ditetapkan (G17), karena pada basis CBM utilisasinya terbaca rendah dengan cara yang lebih menunjukkan armada trade dibatasi jumlah drop dan tonase daripada volume.'
   where entity_code = 'SAMB' and id = 'G06'
     and unblock = 'Pilih (a) split internal/LP + benchmark rate, CBM dari estimasi inventory; atau (b) all internal armada, CBM dari Trip Log actual, tanpa Rate Card.';   -- only while still the v0.3 text
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_gates G06 · unblock'); end if;

  update public.os_process_gates
     set unblock = 'Menentukan apakah masuk pengurang revenue atau biaya komersial. Retur & klaim sekarang dipetakan di step 18c.'
   where entity_code = 'SAMB' and id = 'G09'
     and unblock = 'Menentukan apakah masuk pengurang revenue atau biaya komersial. Retur & klaim belum dipetakan sebagai step.';   -- only while still the v0.3 text
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_gates G09 · unblock'); end if;

  update public.os_process_gates
     set sub = 'Metode ditetapkan — sisa dua pertanyaan: lokasi fisik dan entitas penagih'
   where entity_code = 'SAMB' and id = 'G13'
     and sub = 'Terbuka — risiko double count';   -- only while still the v0.3 text
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_gates G13 · sub'); end if;

  update public.os_process_gates
     set unblock = 'Metodenya: carve-out per pool dengan driver konsumsi fisik, masing-masing sekali, dibukukan SAAT TUTUP BUKU di step 28 — bukan saat invoice di step 21. Jumlah yang masuk COGS-LP dikeluarkan lewat baris ''dikeluarkan ke COGS-LP'' di pool asalnya, jadi laba operasi tidak berubah oleh reklas (gross profit turun, opex turun). Yang masih terbuka: (a) apakah barang klien yang ditagih benar berada di gudang trading — kalau tidak, pool yang dibelah salah; (b) entitas mana yang menagih klien di gudang sewa (G18).'
   where entity_code = 'SAMB' and id = 'G13'
     and unblock = 'Tetapkan apakah biaya melayani barang klien dikarve-out dari pool yang sama sehingga Storing/Distribution Cost tinggal porsi barang sendiri, atau dihitung terpisah. Tanpa keputusan ini, sewa gudang dan biaya armada berisiko terhitung dua kali.';   -- only while still the v0.3 text
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_gates G13 · unblock'); end if;

  update public.os_process_gates
     set unblock = 'Tarif ke pihak ketiga = harga pasar di atas cost-to-serve. Untuk klien afiliasi, tarif pihak ketiga jadi pembanding internal — tetapkan apakah dipakai apa adanya atau disesuaikan, dan dokumentasikan selisihnya. Tarif LP bukan dua angka: ada beberapa kelas driver yang hidup berdampingan — pallet position × waktu, nilai persediaan, karton keluar, persentase nilai penjualan, pallet/karton masuk-keluar, CBM per zona — dan sebagian besar tagihan berbentuk SATU HARGA BUNDEL yang memuat penyimpanan, pick/pack, pengiriman, dan biaya komersial sekaligus. Karena bundel itu satu harga, pemisahan revenue LP ke channel COA Fulfillment dan Trucking adalah KEPUTUSAN, bukan pembacaan data; skenarionya disiapkan di LP09 sheet Split.'
   where entity_code = 'SAMB' and id = 'G15'
     and unblock = 'Tarif ke pihak ketiga = harga pasar di atas cost-to-serve. Untuk klien afiliasi, tarif pihak ketiga jadi pembanding internal — tetapkan apakah dipakai apa adanya atau disesuaikan, dan dokumentasikan selisihnya.';   -- only while still the v0.3 text
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_gates G15 · unblock'); end if;

  -- Steps: drivers, one note, one gate_id (14) --
  update public.os_process_steps
     set drivers = '["Tarif per pallet position per periode — hanya berlaku untuk sebagian klien","Tarif per karton keluar di dalam distribution fee bundel","Persentase nilai penjualan principal di dalam bundel yang sama","Persentase nilai persediaan — stok awal dan barang masuk","Tarif handling per pallet atau per karton masuk-keluar","Tarif per CBM per zona","Floor, ratchet dan take-or-pay per klien"]'::jsonb
   where entity_code = 'SAMB' and label = '1'
     and drivers = '["Tarif per pallet position per periode","Tarif per CBM per zona"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 1 · drivers'); end if;

  update public.os_process_steps
     set drivers = '["CBM inbound per kategori → Pool 1 Receiving & Put-Away","Upah bongkar dibayar per karton — biaya variabel yang mengikuti volume, bukan biaya tetap"]'::jsonb
   where entity_code = 'SAMB' and label = '6a'
     and drivers = '["CBM inbound per kategori → Pool 1 Receiving & Put-Away"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 6a · drivers'); end if;

  update public.os_process_steps
     set drivers = '["CBM × inventory days (space × time) → Pool 2 Storage & Housekeeping","Pallet-day rate — total cost pool ÷ pallet-days","Net CBM movement → cluster sisa account","Pallet-day per pemilik barang → belah pool bersama","Sewa gudang menjadi depresiasi hak-guna aset + bunga sejak PSAK 73 berlaku — tarif kontrak per PP tidak boleh ditambahkan di atas depresiasi","Uji muat: stok CBM × faktor tumpuk ÷ m³ per pallet position, dibandingkan dengan PP tersedia"]'::jsonb
   where entity_code = 'SAMB' and label = '9'
     and drivers = '["CBM × inventory days (space × time) → Pool 2 Storage & Housekeeping","Pallet-day rate — total cost pool ÷ pallet-days","Net CBM movement → cluster sisa account","Pallet-day per pemilik barang → belah pool bersama"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 9 · drivers'); end if;

  update public.os_process_steps
     set drivers = '["CBM outbound per kategori → Pool 3 Picking & Packing","Baris pick per pemilik barang → membelah Pool 3","Karton keluar per pemilik barang → driver handling, satuannya belum ditetapkan (G16)"]'::jsonb
   where entity_code = 'SAMB' and label = '13'
     and drivers = '["CBM outbound per kategori → Pool 3 Picking & Packing","Pick line count → kandidat driver LP Fulfillment","Baris pick per pemilik barang → belah pool bersama"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 13 · drivers'); end if;

  update public.os_process_steps
     set note = 'Baris pick per pemilik barang yang tercatat di step ini adalah driver yang membelah Pool 3 — bukan lagi salah satu dari tiga kandidat driver tunggal (premis G05 yang lama). Karton keluar per pemilik barang lahir di sini juga, dan satuannya menunggu G16. Tidak dipecah: picking list adalah dokumen kerja internal dengan format yang sama untuk kedua jalur, dan tidak ada posting akuntansi. Yang membedakan hanya atribut pemilik.'
   where entity_code = 'SAMB' and label = '13'
     and note = 'Pick line count yang tercatat di step ini adalah salah satu dari tiga kandidat driver LP Fulfillment. Kalau driver-nya dipilih, datanya sudah ada di sini. Tidak dipecah: picking list adalah dokumen kerja internal dengan format yang sama untuk kedua jalur, dan tidak ada posting akuntansi. Yang membedakan hanya atribut pemilik.';   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 13 · note'); end if;

  update public.os_process_steps
     set drivers = '["CBM outbound → Pool 4 Loading & Dispatch","CBM per SJ → basis alokasi trucking","Karton per SJ → satuan upah borongan DAN penyebut share handling","Berat per SJ → tonase mengikat sebelum CBM untuk produk padat"]'::jsonb
   where entity_code = 'SAMB' and label = '15a'
     and drivers = '["CBM outbound → Pool 4 Loading & Dispatch","CBM per SJ → basis alokasi trucking"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 15a · drivers'); end if;

  update public.os_process_steps
     set drivers = '["CBM outbound per klien → Pool 4, porsi COS–LP","CBM per SJ per klien → dasar tagih trucking","Karton dan berat per SJ per klien → penyebut handling dan uji basis tonase"]'::jsonb
   where entity_code = 'SAMB' and label = '15b'
     and drivers = '["CBM outbound per klien → Pool 4, porsi COS–LP","CBM per SJ per klien → dasar tagih trucking"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 15b · drivers'); end if;

  update public.os_process_steps
     set drivers = '["CBM per trip dari Trip Log","Kapasitas NORMAL per tipe armada — satuannya belum ditetapkan (G17): drop per hari, tonase, atau CBM","Depresiasi normalized per tipe truk","Varians kapasitas tak terpakai — disurfacing, tidak dikubur ke unit cost"]'::jsonb
   where entity_code = 'SAMB' and label = '16'
     and drivers = '["CBM per trip dari Trip Log","Normal / achievable capacity per tipe truk — BUKAN actual","Depresiasi normalized per tipe truk"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 16 · drivers'); end if;

  update public.os_process_steps
     set drivers = '["CBM × zona (Zone 1 / 2 / 3)","Backhaul sudah di dalam asumsi tarif round-trip Zone 2 & 3","CBM barang sendiri DAN barang klien di satu pembilang — truk yang sama mengangkut keduanya"]'::jsonb
   where entity_code = 'SAMB' and label = '17'
     and drivers = '["CBM × zona (Zone 1 / 2 / 3)","Backhaul sudah di dalam asumsi tarif round-trip Zone 2 & 3"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 17 · drivers'); end if;

  update public.os_process_steps
     set drivers = '["Jumlah invoice created → Commercial Support (people cost DAN paper cost)","Headcount AR × porsi waktu ke invoicing → biaya orang Commercial Support; mekanismenya di FAT05 sheet Headcount AR"]'::jsonb
   where entity_code = 'SAMB' and label = '19'
     and drivers = '["Jumlah invoice created → Commercial Support (people cost DAN paper cost)"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 19 · drivers'); end if;

  update public.os_process_steps
     set drivers = '["Pallet-day per klien → dasar tagih fulfillment, berlaku hanya untuk sebagian klien","Nilai persediaan klien → dasar tagih storage untuk sebagian klien lain","Karton keluar atau persentase nilai penjualan → distribution fee bundel","Pallet atau karton masuk + keluar → handling","CBM × zona per klien → trucking eksplisit, porsi terkecil","PERINGATAN: klien di gudang sewa dan klien yang ditagih adalah dua himpunan terpisah (G18)"]'::jsonb
   where entity_code = 'SAMB' and label = '20'
     and drivers = '["Pallet-day per klien → dasar tagih fulfillment","CBM × zona per klien → dasar tagih trucking","Baris pick per klien → kandidat driver fulfillment"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 20 · drivers'); end if;

  update public.os_process_steps
     set drivers = '["Tarif × konsumsi terukur per klien","Selisih antara dasar tagih dan akun revenue di buku dibawa sebagai baris tersendiri — bukan disembunyikan di tarif (G20)"]'::jsonb
   where entity_code = 'SAMB' and label = '21'
     and drivers = '["Tarif × konsumsi terukur per klien"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 21 · drivers'); end if;

  update public.os_process_steps
     set gate_id = 'G15'
   where entity_code = 'SAMB' and label = '21'
     and gate_id = 'G13';   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 21 · gate_id'); end if;

  update public.os_process_steps
     set drivers = '["Pasangan revenue ↔ biaya AT COST per nomor dokumen — laba rugi bukan cermin","Markup di atas cost dieliminasi terpisah sebagai laba belum terealisasi","Kolom pasangan diisi bertanda cermin — tanpa konvensi tanda, semua baris terbaca selisih"]'::jsonb
   where entity_code = 'SAMB' and label = '26'
     and drivers = '[]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 26 · drivers'); end if;

  -- Steps: docs — the workpaper names (26) --
  update public.os_process_steps
     set docs = '["Perjanjian jasa fulfillment & trucking","LP02 Rate Card Model","Proposal & penawaran tarif","LP04 master klien LP, komitmen kapasitas & tarif"]'::jsonb
   where entity_code = 'SAMB' and label = '1'
     and docs = '["Perjanjian jasa fulfillment & trucking","LP02 Rate Card Model","Proposal & penawaran tarif"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 1 · docs'); end if;

  update public.os_process_steps
     set docs = '["SAMB_Demand_Forecast_WP_v1.0.xlsx","Historis sales SAP (VBRP)","Rencana promo principal","SLS01 rekap order count & AOV"]'::jsonb
   where entity_code = 'SAMB' and label = '2'
     and docs = '["SAMB_Demand_Forecast_WP_v1.0.xlsx","Historis sales SAP (VBRP)","Rencana promo principal"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 2 · docs'); end if;

  update public.os_process_steps
     set docs = '["PO","Price list principal","Konfirmasi trading term","MD02 kontrak & trading term per principal"]'::jsonb
   where entity_code = 'SAMB' and label = '3'
     and docs = '["PO","Price list principal","Konfirmasi trading term"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 3 · docs'); end if;

  update public.os_process_steps
     set docs = '["Instruksi penitipan barang","SJ klien","Berita acara terima titipan","LP05 register barang titipan & berita acara"]'::jsonb
   where entity_code = 'SAMB' and label = '5'
     and docs = '["Instruksi penitipan barang","SJ klien","Berita acara terima titipan"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 5 · docs'); end if;

  update public.os_process_steps
     set docs = '["Task put-away WMS","Peta lokasi rak","LP01 — occupancy","WH01 kapasitas gudang, zona & pallet position","WH03 kelas tumpuk & stacking factor"]'::jsonb
   where entity_code = 'SAMB' and label = '8'
     and docs = '["Task put-away WMS","Peta lokasi rak","LP01 — occupancy"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 8 · docs'); end if;

  update public.os_process_steps
     set docs = '["Stock report WMS","Berita acara opname","LP01 — occupancy pallet-day","Aging / slow-moving report","WH01 kapasitas gudang, zona & pallet position","WH03 kelas tumpuk & stacking factor","FAT04 rekonsiliasi opname & basis inventory days"]'::jsonb
   where entity_code = 'SAMB' and label = '9'
     and docs = '["Stock report WMS","Berita acara opname","LP01 — occupancy pallet-day","Aging / slow-moving report"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 9 · docs'); end if;

  update public.os_process_steps
     set docs = '["SO","Credit check","ATP / stock availability check","SLS01 rekap order count & AOV"]'::jsonb
   where entity_code = 'SAMB' and label = '10'
     and docs = '["SO","Credit check","ATP / stock availability check"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 10 · docs'); end if;

  update public.os_process_steps
     set docs = '["Delivery order klien","Daftar tujuan kirim","LP06 DO klien, register SJ barang klien & peran SAMB"]'::jsonb
   where entity_code = 'SAMB' and label = '11'
     and docs = '["Delivery order klien","Daftar tujuan kirim"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 11 · docs'); end if;

  update public.os_process_steps
     set docs = '["DO","Picking list","SLS02 master rute, zona & aturan FEFO"]'::jsonb
   where entity_code = 'SAMB' and label = '12'
     and docs = '["DO","Picking list"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 12 · docs'); end if;

  update public.os_process_steps
     set docs = '["Picking list","Konfirmasi pick di WMS","WH04 rekap outbound, pick line & CBM per surat jalan","WH02 time study manpower gudang & activity pool"]'::jsonb
   where entity_code = 'SAMB' and label = '13'
     and docs = '["Picking list","Konfirmasi pick di WMS"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 13 · docs'); end if;

  update public.os_process_steps
     set docs = '["Label pengiriman","Packing list","WH04 rekap outbound, pick line & CBM per surat jalan"]'::jsonb
   where entity_code = 'SAMB' and label = '14'
     and docs = '["Label pengiriman","Packing list"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 14 · docs'); end if;

  update public.os_process_steps
     set docs = '["LP02 Trip Log — Trip Key, Armada, Kepemilikan Barang, utilization","LP02 Master Truck","Rencana rute & zona","FLT01 jumlah armada, kapasitas normal & koreksi rate card"]'::jsonb
   where entity_code = 'SAMB' and label = '16'
     and docs = '["LP02 Trip Log — Trip Key, Armada, Kepemilikan Barang, utilization","LP02 Master Truck","Rencana rute & zona"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 16 · docs'); end if;

  update public.os_process_steps
     set docs = '["SJ + tanda terima","Log BBM per trip","Data GPS / tracking","FLT02 rekonsiliasi biaya armada GL lawan laporan operasional","SLS02 master rute, zona & aturan FEFO"]'::jsonb
   where entity_code = 'SAMB' and label = '17'
     and docs = '["SJ + tanda terima","Log BBM per trip","Data GPS / tracking"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 17 · docs'); end if;

  update public.os_process_steps
     set docs = '["Invoice (dicetak fisik)","Faktur pajak / e-Faktur","FAT05 rekap invoice, driver commercial support & perbaikan formula budget"]'::jsonb
   where entity_code = 'SAMB' and label = '19'
     and docs = '["Invoice (dicetak fisik)","Faktur pajak / e-Faktur"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 19 · docs'); end if;

  update public.os_process_steps
     set docs = '["Rekap pallet-day per klien","Rekap CBM terkirim per klien","LP01 + LP02 sebagai sumber","LP07 pengukuran konsumsi layanan per klien LP","LP09 rekonsiliasi billing LP, driver per klien & carve-out"]'::jsonb
   where entity_code = 'SAMB' and label = '20'
     and docs = '["Rekap pallet-day per klien","Rekap CBM terkirim per klien","LP01 + LP02 sebagai sumber"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 20 · docs'); end if;

  update public.os_process_steps
     set docs = '["Invoice jasa LP","Faktur pajak","Lampiran rekap konsumsi","LP08 invoice jasa LP & carve-out COS–LP"]'::jsonb
   where entity_code = 'SAMB' and label = '21'
     and docs = '["Invoice jasa LP","Faktur pajak","Lampiran rekap konsumsi"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 21 · docs'); end if;

  update public.os_process_steps
     set docs = '["Transfer pricing documentation","Analisis kesebandingan","Bukti manfaat bagi penerima jasa","TAX01 dokumentasi transfer pricing klien afiliasi"]'::jsonb
   where entity_code = 'SAMB' and label = '22'
     and docs = '["Transfer pricing documentation","Analisis kesebandingan","Bukti manfaat bagi penerima jasa"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 22 · docs'); end if;

  update public.os_process_steps
     set docs = '["Tanda terima tukar faktur","Log pengiriman tagihan","FAT06 tukar faktur, DSO aktual & AR aging"]'::jsonb
   where entity_code = 'SAMB' and label = '23'
     and docs = '["Tanda terima tukar faktur","Log pengiriman tagihan"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 23 · docs'); end if;

  update public.os_process_steps
     set docs = '["AR aging","Statement of account","Log dunning","FAT06 tukar faktur, DSO aktual & AR aging"]'::jsonb
   where entity_code = 'SAMB' and label = '24'
     and docs = '["AR aging","Statement of account","Log dunning"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 24 · docs'); end if;

  update public.os_process_steps
     set docs = '["Matrix intercompany 9 entitas — BS & IS","Kertas kerja eliminasi","TB konsolidasi","FAT07 pre-recon TB & pasangan intercompany per nomor dokumen"]'::jsonb
   where entity_code = 'SAMB' and label = '26'
     and docs = '["Matrix intercompany 9 entitas — BS & IS","Kertas kerja eliminasi","TB konsolidasi"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 26 · docs'); end if;

  update public.os_process_steps
     set docs = '["SJ principal","Tally sheet bongkar","Referensi PO","WH02 time study manpower gudang & activity pool"]'::jsonb
   where entity_code = 'SAMB' and label = '6a'
     and docs = '["SJ principal","Tally sheet bongkar","Referensi PO"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 6a · docs'); end if;

  update public.os_process_steps
     set docs = '["Berita acara terima titipan","Entry WMS dengan kode pemilik","Foto kondisi barang","LP05 register barang titipan & berita acara"]'::jsonb
   where entity_code = 'SAMB' and label = '7b'
     and docs = '["Berita acara terima titipan","Entry WMS dengan kode pemilik","Foto kondisi barang"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 7b · docs'); end if;

  update public.os_process_steps
     set docs = '["SJ SAMB — grain per-SJ","Checklist loading","Feed ke LP02 Trip Log","WH04 rekap outbound, pick line & CBM per surat jalan"]'::jsonb
   where entity_code = 'SAMB' and label = '15a'
     and docs = '["SJ SAMB — grain per-SJ","Checklist loading","Feed ke LP02 Trip Log"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 15a · docs'); end if;

  update public.os_process_steps
     set docs = '["SJ pengiriman barang klien — SAMB sebagai pengangkut, bukan penjual","Referensi DO klien","Salinan SJ untuk klien","Feed ke LP02 Trip Log","LP06 DO klien, register SJ barang klien & peran SAMB"]'::jsonb
   where entity_code = 'SAMB' and label = '15b'
     and docs = '["SJ pengiriman barang klien — SAMB sebagai pengangkut, bukan penjual","Referensi DO klien","Salinan SJ untuk klien","Feed ke LP02 Trip Log"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 15b · docs'); end if;

  update public.os_process_steps
     set docs = '["POD bertanda tangan customer","Nota retur / reject","WH05 register POD, retur & reject"]'::jsonb
   where entity_code = 'SAMB' and label = '18a'
     and docs = '["POD bertanda tangan customer","Nota retur / reject"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 18a · docs'); end if;

  update public.os_process_steps
     set docs = '["POD bertanda tangan penerima","Salinan POD untuk klien","Nota retur titipan","WH05 register POD, retur & reject"]'::jsonb
   where entity_code = 'SAMB' and label = '18b'
     and docs = '["POD bertanda tangan penerima","Salinan POD untuk klien","Nota retur titipan"]'::jsonb;   -- only while still the v0.3 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 18b · docs'); end if;

  -- Needs: status / src (11 rows) --
  update public.os_process_needs nd
     set status = 'SEBAGIAN', src = 'LP04 + arsip billing — tarif efektif per klien sudah bisa diturunkan'
    from public.os_process_steps s
   where s.id = nd.step_id and s.entity_code = 'SAMB' and s.label = '1'
     and nd.item = 'Master klien LP — badan usaha, term, tarif'
     and nd.status = 'BELUM' and nd.src = 'Sistem / Sales';   -- the v0.3 row, untouched
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_needs 1 · Master klien LP — badan usaha, term, tarif'); end if;

  update public.os_process_needs nd
     set status = 'SEBAGIAN', src = 'LP09 sheet Driver per Klien-Komponen — kelas driver yang benar-benar dipakai'
    from public.os_process_steps s
   where s.id = nd.step_id and s.entity_code = 'SAMB' and s.label = '1'
     and nd.item = 'Basis penetapan tarif layanan'
     and nd.status = 'SEBAGIAN' and nd.src = 'LP02 Rate Card Model';   -- the v0.3 row, untouched
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_needs 1 · Basis penetapan tarif layanan'); end if;

  update public.os_process_needs nd
     set status = 'BELUM', src = 'WH01 sheet Zona & Tinggi Rak'
    from public.os_process_steps s
   where s.id = nd.step_id and s.entity_code = 'SAMB' and s.label = '2'
     and nd.item = 'Kapasitas normal gudang dalam pallet position'
     and nd.status = 'BELUM' and nd.src = 'Survey gudang';   -- the v0.3 row, untouched
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_needs 2 · Kapasitas normal gudang dalam pallet position'); end if;

  update public.os_process_needs nd
     set status = 'BELUM', src = 'WH02 Time Study — payroll per departemen sudah ada, yang hilang time study-nya'
    from public.os_process_steps s
   where s.id = nd.step_id and s.entity_code = 'SAMB' and s.label = '9'
     and nd.item = 'Headcount & pembagian waktu per 4 activity pool'
     and nd.status = 'BELUM' and nd.src = 'HR + time study';   -- the v0.3 row, untouched
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_needs 9 · Headcount & pembagian waktu per 4 activity pool'); end if;

  update public.os_process_needs nd
     set status = 'BELUM', src = 'Kartu stok → WH04 sheet Material Packing'
    from public.os_process_steps s
   where s.id = nd.step_id and s.entity_code = 'SAMB' and s.label = '14'
     and nd.item = 'Pemakaian material packing per periode'
     and nd.status = 'BELUM' and nd.src = 'GL / stok material';   -- the v0.3 row, untouched
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_needs 14 · Pemakaian material packing per periode'); end if;

  update public.os_process_needs nd
     set status = 'BELUM', src = 'Kolom di SJ → Trip Log → WH04'
    from public.os_process_steps s
   where s.id = nd.step_id and s.entity_code = 'SAMB' and s.label = '15a'
     and nd.item = 'CBM per SJ'
     and nd.status = 'BELUM' and nd.src = 'Kolom di SJ → LP02 Trip Log';   -- the v0.3 row, untouched
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_needs 15a · CBM per SJ'); end if;

  update public.os_process_needs nd
     set status = 'SEBAGIAN', src = 'Salary Details → FAT05 sheet Headcount AR — departemennya ada, pembagiannya G11'
    from public.os_process_steps s
   where s.id = nd.step_id and s.entity_code = 'SAMB' and s.label = '19'
     and nd.item = 'Headcount & biaya staff invoicing vs collection'
     and nd.status = 'BELUM' and nd.src = 'HR';   -- the v0.3 row, untouched
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_needs 19 · Headcount & biaya staff invoicing vs collection'); end if;

  update public.os_process_needs nd
     set status = 'SEBAGIAN', src = 'Arsip billing untuk klien bertarif pallet, WMS untuk sisanya'
    from public.os_process_steps s
   where s.id = nd.step_id and s.entity_code = 'SAMB' and s.label = '20'
     and nd.item = 'Pallet-day per klien LP per periode'
     and nd.status = 'BELUM' and nd.src = 'Turunan WMS + LP01';   -- the v0.3 row, untouched
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_needs 20 · Pallet-day per klien LP per periode'); end if;

  update public.os_process_needs nd
     set status = 'SEBAGIAN', src = 'Arsip billing untuk klien afiliasi, imputasi master produk untuk klien bundel, sisanya belum'
    from public.os_process_steps s
   where s.id = nd.step_id and s.entity_code = 'SAMB' and s.label = '20'
     and nd.item = 'CBM terkirim per klien per zona'
     and nd.status = 'BELUM' and nd.src = 'Turunan LP02 Trip Log';   -- the v0.3 row, untouched
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_needs 20 · CBM terkirim per klien per zona'); end if;

  update public.os_process_needs nd
     set status = 'ADA', src = 'Arsip billing per klien per komponen'
    from public.os_process_steps s
   where s.id = nd.step_id and s.entity_code = 'SAMB' and s.label = '21'
     and nd.item = 'Nomor & nilai invoice jasa LP per klien'
     and nd.status = 'SEBAGIAN' and nd.src = 'SAP';   -- the v0.3 row, untouched
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_needs 21 · Nomor & nilai invoice jasa LP per klien'); end if;

  update public.os_process_needs nd
     set status = 'SEBAGIAN', src = 'TAX01 sheet Pembanding Internal + rate card terkoreksi FLT01'
    from public.os_process_steps s
   where s.id = nd.step_id and s.entity_code = 'SAMB' and s.label = '22'
     and nd.item = 'Tarif ke klien pihak ketiga sebagai pembanding internal'
     and nd.status = 'BELUM' and nd.src = 'Rate card & invoice aktual';   -- the v0.3 row, untouched
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_needs 22 · Tarif ke klien pihak ketiga sebagai pembanding internal'); end if;

  if coalesce(array_length(skipped, 1), 0) > 0 then
    raise notice E'samb_process_v04: % of 61 text updates SKIPPED — the live value no longer matches the v0.3 seed, so it was edited from the app and is left as it is. Reconcile by hand:\n  %',
      array_length(skipped, 1), array_to_string(skipped, E'\n  ');
  else
    raise notice 'samb_process_v04: all 61 text updates applied — no row had been edited from the app.';
  end if;
end
$$;
