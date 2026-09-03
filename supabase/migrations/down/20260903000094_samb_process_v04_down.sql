-- Down-migration for 20260903000094_samb_process_v04.
--
-- Returns the SAMB chain to v0.3 + 56. In order: the three v0.4 steps go
-- (their 12 needs and 5 bridge pairs cascade), then the one v0.4 need on
-- 15a, then the five gates G16..G20 — gates AFTER steps, because 27
-- references G20 — then the 61 text updates are reversed under the SAME
-- conditional rule as the up-migration: a column is restored only while it
-- still holds the v0.4 text, and anything edited from the app since the
-- apply is left alone and listed in the closing notice.
--
-- That rule is also this file's limit. It CANNOT restore edits made from the
-- app between apply and rollback, and it DESTROYS any requested_on date
-- entered on the 13 needs it deletes — export os_process_needs first if the
-- register has been worked since the apply.
--
-- Guarded: refuses unless v0.4 is actually present (33 SAMB steps and G16
-- exists). Every statement is scoped to entity_code = 'SAMB', so ARBI and
-- KGR cannot be reached from here. Touches no os_finish_line_* row: deleting
-- bridge edges cannot alter a cell state.

-- 0. Guard ------------------------------------------------------------------
do $$
declare
  n_steps integer;
begin
  select count(*) into n_steps from public.os_process_steps where entity_code = 'SAMB';
  if n_steps <> 33 or not exists (select 1 from public.os_process_gates where id = 'G16') then
    raise exception
      'samb_process_v04_down menolak jalan: v0.4 tidak terpasang (SAMB % step, G16 %) — tidak ada yang bisa dibalikkan.',
      n_steps, case when exists (select 1 from public.os_process_gates where id = 'G16') then 'ada' else 'tidak ada' end;
  end if;
end
$$;

-- 1. The three v0.4 steps; needs and bridge pairs cascade -------------------
delete from public.os_process_steps
 where entity_code = 'SAMB' and label in ('18c', '27', '28');

-- 2. The one v0.4 need on an existing step ---------------------------------
-- Matched on item text, which is editable: a renamed row stays and is
-- reported below rather than guessed at.
do $$
declare
  hit integer;
begin
  delete from public.os_process_needs nd
   using public.os_process_steps s
   where s.id = nd.step_id and s.entity_code = 'SAMB' and s.label = '15a'
     and nd.item = 'Karton & berat per SJ';
  get diagnostics hit = row_count;
  if hit = 0 then
    raise notice 'samb_process_v04_down: the 15a need ''Karton & berat per SJ'' was not found under that item text — renamed from the app? Left in place; remove by hand if it is the v0.4 row.';
  end if;
end
$$;

-- 3. The five v0.4 gates ----------------------------------------------------
delete from public.os_process_gates
 where entity_code = 'SAMB' and id in ('G16', 'G17', 'G18', 'G19', 'G20');

-- 4. Post-conditions on the structure ---------------------------------------
do $$
declare
  n_gates  integer;
  n_steps  integer;
  n_bridge integer;
begin
  select count(*) into n_gates  from public.os_process_gates where entity_code = 'SAMB';
  select count(*) into n_steps  from public.os_process_steps where entity_code = 'SAMB';
  select count(*) into n_bridge from public.os_process_step_items i
                                join public.os_process_steps s on s.id = i.step_id
                                where s.entity_code = 'SAMB';
  if n_gates <> 15 or n_steps <> 30 or n_bridge <> 46 then
    raise exception
      'samb_process_v04_down gagal post-condition: gate % (harus 15), step % (harus 30), bridge % (harus 46).',
      n_gates, n_steps, n_bridge;
  end if;
end
$$;

-- 5. Text back to v0.3, each conditional on the v0.4 value -------------------
do $$
declare
  hit     integer;
  skipped text[] := '{}';
begin
  -- Gates (10 column updates, v0.4 → v0.3) --
  update public.os_process_gates
     set sub = 'Standing blocker #1'
   where entity_code = 'SAMB' and id = 'G01'
     and sub = 'Standing blocker #1 — konsekuensinya kini terukur';   -- only while still the v0.4 text
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_gates G01 · sub'); end if;

  update public.os_process_gates
     set unblock = 'Datanya melewati Purchasing tiap kali PO dibuat (step 2). Minta formal, eskalasi kalau menggantung.'
   where entity_code = 'SAMB' and id = 'G01'
     and unblock = 'Datanya melewati Purchasing tiap kali PO dibuat (step 3). Minta formal, eskalasi kalau menggantung. Tanpa isi per karton, basis volume budget terpaksa memakai kapasitas armada alih-alih volume fisik dari dimensi karton — SELURUH metrik per CBM bergeser, dan uji muat gudang (step 9) tidak bisa dijalankan. Jalan tercepat: minta price list lewat MD02 sheet Annex SKU, mulai dari principal dengan SKU terbanyak. Satu blocker ini menutup G16 dan perbandingan cost-to-serve per karton sekaligus.';   -- only while still the v0.4 text
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_gates G01 · unblock'); end if;

  update public.os_process_gates
     set title = 'Driver COGS LP Fulfillment'
   where entity_code = 'SAMB' and id = 'G05'
     and title = 'Driver COGS-LP per pool (bukan satu driver)';   -- only while still the v0.4 text
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_gates G05 · title'); end if;

  update public.os_process_gates
     set sub = 'Standing blocker #5'
   where entity_code = 'SAMB' and id = 'G05'
     and sub = 'Metode ditetapkan — sisa satu keputusan satuan, lihat G16';   -- only while still the v0.4 text
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_gates G05 · sub'); end if;

  update public.os_process_gates
     set unblock = 'Pilih satu: pallet position (step 6) · CBM stored (step 7) · pick line count (step 10). Ketiganya sudah lahir di rantai.'
   where entity_code = 'SAMB' and id = 'G05'
     and unblock = 'Premis lama — pilih satu dari pallet position, CBM stored, atau pick line — ditinggalkan. Tiga pool dibelah masing-masing SEKALI dengan driver konsumsinya sendiri: ruang → pallet position; handling → karton-ekuivalen masuk + keluar; truk → CBM, diuji atas basis tonase. Bukan revenue share, bukan persentase flat. Yang dibelah harus KELUAR dari pool asalnya (step 28), sehingga reklas ini netral terhadap laba operasi. Yang belum diputus: satuan handling — G16.';   -- only while still the v0.4 text
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_gates G05 · unblock'); end if;

  update public.os_process_gates
     set unblock = 'Pilih (a) split internal/LP + benchmark rate, CBM dari estimasi inventory; atau (b) all internal armada, CBM dari Trip Log actual, tanpa Rate Card.'
   where entity_code = 'SAMB' and id = 'G06'
     and unblock = 'Pilih (a) split internal/LP + benchmark rate, CBM dari estimasi inventory; atau (b) all internal armada, CBM dari Trip Log actual, tanpa Rate Card. Dua koreksi, apa pun pilihannya: pembilang biaya delivery WAJIB memuat CBM barang klien karena truk yang sama mengangkut keduanya — carve-out truk membelah pool yang sudah memuatnya, bukan menambah pool baru; dan satuan kapasitas normal per kelas armada belum ditetapkan (G17), karena pada basis CBM utilisasinya terbaca rendah dengan cara yang lebih menunjukkan armada trade dibatasi jumlah drop dan tonase daripada volume.';   -- only while still the v0.4 text
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_gates G06 · unblock'); end if;

  update public.os_process_gates
     set unblock = 'Menentukan apakah masuk pengurang revenue atau biaya komersial. Retur & klaim belum dipetakan sebagai step.'
   where entity_code = 'SAMB' and id = 'G09'
     and unblock = 'Menentukan apakah masuk pengurang revenue atau biaya komersial. Retur & klaim sekarang dipetakan di step 18c.';   -- only while still the v0.4 text
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_gates G09 · unblock'); end if;

  update public.os_process_gates
     set sub = 'Terbuka — risiko double count'
   where entity_code = 'SAMB' and id = 'G13'
     and sub = 'Metode ditetapkan — sisa dua pertanyaan: lokasi fisik dan entitas penagih';   -- only while still the v0.4 text
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_gates G13 · sub'); end if;

  update public.os_process_gates
     set unblock = 'Tetapkan apakah biaya melayani barang klien dikarve-out dari pool yang sama sehingga Storing/Distribution Cost tinggal porsi barang sendiri, atau dihitung terpisah. Tanpa keputusan ini, sewa gudang dan biaya armada berisiko terhitung dua kali.'
   where entity_code = 'SAMB' and id = 'G13'
     and unblock = 'Metodenya: carve-out per pool dengan driver konsumsi fisik, masing-masing sekali, dibukukan SAAT TUTUP BUKU di step 28 — bukan saat invoice di step 21. Jumlah yang masuk COGS-LP dikeluarkan lewat baris ''dikeluarkan ke COGS-LP'' di pool asalnya, jadi laba operasi tidak berubah oleh reklas (gross profit turun, opex turun). Yang masih terbuka: (a) apakah barang klien yang ditagih benar berada di gudang trading — kalau tidak, pool yang dibelah salah; (b) entitas mana yang menagih klien di gudang sewa (G18).';   -- only while still the v0.4 text
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_gates G13 · unblock'); end if;

  update public.os_process_gates
     set unblock = 'Tarif ke pihak ketiga = harga pasar di atas cost-to-serve. Untuk klien afiliasi, tarif pihak ketiga jadi pembanding internal — tetapkan apakah dipakai apa adanya atau disesuaikan, dan dokumentasikan selisihnya.'
   where entity_code = 'SAMB' and id = 'G15'
     and unblock = 'Tarif ke pihak ketiga = harga pasar di atas cost-to-serve. Untuk klien afiliasi, tarif pihak ketiga jadi pembanding internal — tetapkan apakah dipakai apa adanya atau disesuaikan, dan dokumentasikan selisihnya. Tarif LP bukan dua angka: ada beberapa kelas driver yang hidup berdampingan — pallet position × waktu, nilai persediaan, karton keluar, persentase nilai penjualan, pallet/karton masuk-keluar, CBM per zona — dan sebagian besar tagihan berbentuk SATU HARGA BUNDEL yang memuat penyimpanan, pick/pack, pengiriman, dan biaya komersial sekaligus. Karena bundel itu satu harga, pemisahan revenue LP ke channel COA Fulfillment dan Trucking adalah KEPUTUSAN, bukan pembacaan data; skenarionya disiapkan di LP09 sheet Split.';   -- only while still the v0.4 text
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_gates G15 · unblock'); end if;

  -- Steps: drivers, one note, one gate_id (14) --
  update public.os_process_steps
     set drivers = '["Tarif per pallet position per periode","Tarif per CBM per zona"]'::jsonb
   where entity_code = 'SAMB' and label = '1'
     and drivers = '["Tarif per pallet position per periode — hanya berlaku untuk sebagian klien","Tarif per karton keluar di dalam distribution fee bundel","Persentase nilai penjualan principal di dalam bundel yang sama","Persentase nilai persediaan — stok awal dan barang masuk","Tarif handling per pallet atau per karton masuk-keluar","Tarif per CBM per zona","Floor, ratchet dan take-or-pay per klien"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 1 · drivers'); end if;

  update public.os_process_steps
     set drivers = '["CBM inbound per kategori → Pool 1 Receiving & Put-Away"]'::jsonb
   where entity_code = 'SAMB' and label = '6a'
     and drivers = '["CBM inbound per kategori → Pool 1 Receiving & Put-Away","Upah bongkar dibayar per karton — biaya variabel yang mengikuti volume, bukan biaya tetap"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 6a · drivers'); end if;

  update public.os_process_steps
     set drivers = '["CBM × inventory days (space × time) → Pool 2 Storage & Housekeeping","Pallet-day rate — total cost pool ÷ pallet-days","Net CBM movement → cluster sisa account","Pallet-day per pemilik barang → belah pool bersama"]'::jsonb
   where entity_code = 'SAMB' and label = '9'
     and drivers = '["CBM × inventory days (space × time) → Pool 2 Storage & Housekeeping","Pallet-day rate — total cost pool ÷ pallet-days","Net CBM movement → cluster sisa account","Pallet-day per pemilik barang → belah pool bersama","Sewa gudang menjadi depresiasi hak-guna aset + bunga sejak PSAK 73 berlaku — tarif kontrak per PP tidak boleh ditambahkan di atas depresiasi","Uji muat: stok CBM × faktor tumpuk ÷ m³ per pallet position, dibandingkan dengan PP tersedia"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 9 · drivers'); end if;

  update public.os_process_steps
     set drivers = '["CBM outbound per kategori → Pool 3 Picking & Packing","Pick line count → kandidat driver LP Fulfillment","Baris pick per pemilik barang → belah pool bersama"]'::jsonb
   where entity_code = 'SAMB' and label = '13'
     and drivers = '["CBM outbound per kategori → Pool 3 Picking & Packing","Baris pick per pemilik barang → membelah Pool 3","Karton keluar per pemilik barang → driver handling, satuannya belum ditetapkan (G16)"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 13 · drivers'); end if;

  update public.os_process_steps
     set note = 'Pick line count yang tercatat di step ini adalah salah satu dari tiga kandidat driver LP Fulfillment. Kalau driver-nya dipilih, datanya sudah ada di sini. Tidak dipecah: picking list adalah dokumen kerja internal dengan format yang sama untuk kedua jalur, dan tidak ada posting akuntansi. Yang membedakan hanya atribut pemilik.'
   where entity_code = 'SAMB' and label = '13'
     and note = 'Baris pick per pemilik barang yang tercatat di step ini adalah driver yang membelah Pool 3 — bukan lagi salah satu dari tiga kandidat driver tunggal (premis G05 yang lama). Karton keluar per pemilik barang lahir di sini juga, dan satuannya menunggu G16. Tidak dipecah: picking list adalah dokumen kerja internal dengan format yang sama untuk kedua jalur, dan tidak ada posting akuntansi. Yang membedakan hanya atribut pemilik.';   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 13 · note'); end if;

  update public.os_process_steps
     set drivers = '["CBM outbound → Pool 4 Loading & Dispatch","CBM per SJ → basis alokasi trucking"]'::jsonb
   where entity_code = 'SAMB' and label = '15a'
     and drivers = '["CBM outbound → Pool 4 Loading & Dispatch","CBM per SJ → basis alokasi trucking","Karton per SJ → satuan upah borongan DAN penyebut share handling","Berat per SJ → tonase mengikat sebelum CBM untuk produk padat"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 15a · drivers'); end if;

  update public.os_process_steps
     set drivers = '["CBM outbound per klien → Pool 4, porsi COS–LP","CBM per SJ per klien → dasar tagih trucking"]'::jsonb
   where entity_code = 'SAMB' and label = '15b'
     and drivers = '["CBM outbound per klien → Pool 4, porsi COS–LP","CBM per SJ per klien → dasar tagih trucking","Karton dan berat per SJ per klien → penyebut handling dan uji basis tonase"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 15b · drivers'); end if;

  update public.os_process_steps
     set drivers = '["CBM per trip dari Trip Log","Normal / achievable capacity per tipe truk — BUKAN actual","Depresiasi normalized per tipe truk"]'::jsonb
   where entity_code = 'SAMB' and label = '16'
     and drivers = '["CBM per trip dari Trip Log","Kapasitas NORMAL per tipe armada — satuannya belum ditetapkan (G17): drop per hari, tonase, atau CBM","Depresiasi normalized per tipe truk","Varians kapasitas tak terpakai — disurfacing, tidak dikubur ke unit cost"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 16 · drivers'); end if;

  update public.os_process_steps
     set drivers = '["CBM × zona (Zone 1 / 2 / 3)","Backhaul sudah di dalam asumsi tarif round-trip Zone 2 & 3"]'::jsonb
   where entity_code = 'SAMB' and label = '17'
     and drivers = '["CBM × zona (Zone 1 / 2 / 3)","Backhaul sudah di dalam asumsi tarif round-trip Zone 2 & 3","CBM barang sendiri DAN barang klien di satu pembilang — truk yang sama mengangkut keduanya"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 17 · drivers'); end if;

  update public.os_process_steps
     set drivers = '["Jumlah invoice created → Commercial Support (people cost DAN paper cost)"]'::jsonb
   where entity_code = 'SAMB' and label = '19'
     and drivers = '["Jumlah invoice created → Commercial Support (people cost DAN paper cost)","Headcount AR × porsi waktu ke invoicing → biaya orang Commercial Support; mekanismenya di FAT05 sheet Headcount AR"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 19 · drivers'); end if;

  update public.os_process_steps
     set drivers = '["Pallet-day per klien → dasar tagih fulfillment","CBM × zona per klien → dasar tagih trucking","Baris pick per klien → kandidat driver fulfillment"]'::jsonb
   where entity_code = 'SAMB' and label = '20'
     and drivers = '["Pallet-day per klien → dasar tagih fulfillment, berlaku hanya untuk sebagian klien","Nilai persediaan klien → dasar tagih storage untuk sebagian klien lain","Karton keluar atau persentase nilai penjualan → distribution fee bundel","Pallet atau karton masuk + keluar → handling","CBM × zona per klien → trucking eksplisit, porsi terkecil","PERINGATAN: klien di gudang sewa dan klien yang ditagih adalah dua himpunan terpisah (G18)"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 20 · drivers'); end if;

  update public.os_process_steps
     set drivers = '["Tarif × konsumsi terukur per klien"]'::jsonb
   where entity_code = 'SAMB' and label = '21'
     and drivers = '["Tarif × konsumsi terukur per klien","Selisih antara dasar tagih dan akun revenue di buku dibawa sebagai baris tersendiri — bukan disembunyikan di tarif (G20)"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 21 · drivers'); end if;

  update public.os_process_steps
     set gate_id = 'G13'
   where entity_code = 'SAMB' and label = '21'
     and gate_id = 'G15';   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 21 · gate_id'); end if;

  update public.os_process_steps
     set drivers = '[]'::jsonb
   where entity_code = 'SAMB' and label = '26'
     and drivers = '["Pasangan revenue ↔ biaya AT COST per nomor dokumen — laba rugi bukan cermin","Markup di atas cost dieliminasi terpisah sebagai laba belum terealisasi","Kolom pasangan diisi bertanda cermin — tanpa konvensi tanda, semua baris terbaca selisih"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 26 · drivers'); end if;

  -- Steps: docs — the workpaper names (26) --
  update public.os_process_steps
     set docs = '["Perjanjian jasa fulfillment & trucking","LP02 Rate Card Model","Proposal & penawaran tarif"]'::jsonb
   where entity_code = 'SAMB' and label = '1'
     and docs = '["Perjanjian jasa fulfillment & trucking","LP02 Rate Card Model","Proposal & penawaran tarif","LP04 master klien LP, komitmen kapasitas & tarif"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 1 · docs'); end if;

  update public.os_process_steps
     set docs = '["SAMB_Demand_Forecast_WP_v1.0.xlsx","Historis sales SAP (VBRP)","Rencana promo principal"]'::jsonb
   where entity_code = 'SAMB' and label = '2'
     and docs = '["SAMB_Demand_Forecast_WP_v1.0.xlsx","Historis sales SAP (VBRP)","Rencana promo principal","SLS01 rekap order count & AOV"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 2 · docs'); end if;

  update public.os_process_steps
     set docs = '["PO","Price list principal","Konfirmasi trading term"]'::jsonb
   where entity_code = 'SAMB' and label = '3'
     and docs = '["PO","Price list principal","Konfirmasi trading term","MD02 kontrak & trading term per principal"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 3 · docs'); end if;

  update public.os_process_steps
     set docs = '["Instruksi penitipan barang","SJ klien","Berita acara terima titipan"]'::jsonb
   where entity_code = 'SAMB' and label = '5'
     and docs = '["Instruksi penitipan barang","SJ klien","Berita acara terima titipan","LP05 register barang titipan & berita acara"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 5 · docs'); end if;

  update public.os_process_steps
     set docs = '["Task put-away WMS","Peta lokasi rak","LP01 — occupancy"]'::jsonb
   where entity_code = 'SAMB' and label = '8'
     and docs = '["Task put-away WMS","Peta lokasi rak","LP01 — occupancy","WH01 kapasitas gudang, zona & pallet position","WH03 kelas tumpuk & stacking factor"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 8 · docs'); end if;

  update public.os_process_steps
     set docs = '["Stock report WMS","Berita acara opname","LP01 — occupancy pallet-day","Aging / slow-moving report"]'::jsonb
   where entity_code = 'SAMB' and label = '9'
     and docs = '["Stock report WMS","Berita acara opname","LP01 — occupancy pallet-day","Aging / slow-moving report","WH01 kapasitas gudang, zona & pallet position","WH03 kelas tumpuk & stacking factor","FAT04 rekonsiliasi opname & basis inventory days"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 9 · docs'); end if;

  update public.os_process_steps
     set docs = '["SO","Credit check","ATP / stock availability check"]'::jsonb
   where entity_code = 'SAMB' and label = '10'
     and docs = '["SO","Credit check","ATP / stock availability check","SLS01 rekap order count & AOV"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 10 · docs'); end if;

  update public.os_process_steps
     set docs = '["Delivery order klien","Daftar tujuan kirim"]'::jsonb
   where entity_code = 'SAMB' and label = '11'
     and docs = '["Delivery order klien","Daftar tujuan kirim","LP06 DO klien, register SJ barang klien & peran SAMB"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 11 · docs'); end if;

  update public.os_process_steps
     set docs = '["DO","Picking list"]'::jsonb
   where entity_code = 'SAMB' and label = '12'
     and docs = '["DO","Picking list","SLS02 master rute, zona & aturan FEFO"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 12 · docs'); end if;

  update public.os_process_steps
     set docs = '["Picking list","Konfirmasi pick di WMS"]'::jsonb
   where entity_code = 'SAMB' and label = '13'
     and docs = '["Picking list","Konfirmasi pick di WMS","WH04 rekap outbound, pick line & CBM per surat jalan","WH02 time study manpower gudang & activity pool"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 13 · docs'); end if;

  update public.os_process_steps
     set docs = '["Label pengiriman","Packing list"]'::jsonb
   where entity_code = 'SAMB' and label = '14'
     and docs = '["Label pengiriman","Packing list","WH04 rekap outbound, pick line & CBM per surat jalan"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 14 · docs'); end if;

  update public.os_process_steps
     set docs = '["LP02 Trip Log — Trip Key, Armada, Kepemilikan Barang, utilization","LP02 Master Truck","Rencana rute & zona"]'::jsonb
   where entity_code = 'SAMB' and label = '16'
     and docs = '["LP02 Trip Log — Trip Key, Armada, Kepemilikan Barang, utilization","LP02 Master Truck","Rencana rute & zona","FLT01 jumlah armada, kapasitas normal & koreksi rate card"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 16 · docs'); end if;

  update public.os_process_steps
     set docs = '["SJ + tanda terima","Log BBM per trip","Data GPS / tracking"]'::jsonb
   where entity_code = 'SAMB' and label = '17'
     and docs = '["SJ + tanda terima","Log BBM per trip","Data GPS / tracking","FLT02 rekonsiliasi biaya armada GL lawan laporan operasional","SLS02 master rute, zona & aturan FEFO"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 17 · docs'); end if;

  update public.os_process_steps
     set docs = '["Invoice (dicetak fisik)","Faktur pajak / e-Faktur"]'::jsonb
   where entity_code = 'SAMB' and label = '19'
     and docs = '["Invoice (dicetak fisik)","Faktur pajak / e-Faktur","FAT05 rekap invoice, driver commercial support & perbaikan formula budget"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 19 · docs'); end if;

  update public.os_process_steps
     set docs = '["Rekap pallet-day per klien","Rekap CBM terkirim per klien","LP01 + LP02 sebagai sumber"]'::jsonb
   where entity_code = 'SAMB' and label = '20'
     and docs = '["Rekap pallet-day per klien","Rekap CBM terkirim per klien","LP01 + LP02 sebagai sumber","LP07 pengukuran konsumsi layanan per klien LP","LP09 rekonsiliasi billing LP, driver per klien & carve-out"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 20 · docs'); end if;

  update public.os_process_steps
     set docs = '["Invoice jasa LP","Faktur pajak","Lampiran rekap konsumsi"]'::jsonb
   where entity_code = 'SAMB' and label = '21'
     and docs = '["Invoice jasa LP","Faktur pajak","Lampiran rekap konsumsi","LP08 invoice jasa LP & carve-out COS–LP"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 21 · docs'); end if;

  update public.os_process_steps
     set docs = '["Transfer pricing documentation","Analisis kesebandingan","Bukti manfaat bagi penerima jasa"]'::jsonb
   where entity_code = 'SAMB' and label = '22'
     and docs = '["Transfer pricing documentation","Analisis kesebandingan","Bukti manfaat bagi penerima jasa","TAX01 dokumentasi transfer pricing klien afiliasi"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 22 · docs'); end if;

  update public.os_process_steps
     set docs = '["Tanda terima tukar faktur","Log pengiriman tagihan"]'::jsonb
   where entity_code = 'SAMB' and label = '23'
     and docs = '["Tanda terima tukar faktur","Log pengiriman tagihan","FAT06 tukar faktur, DSO aktual & AR aging"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 23 · docs'); end if;

  update public.os_process_steps
     set docs = '["AR aging","Statement of account","Log dunning"]'::jsonb
   where entity_code = 'SAMB' and label = '24'
     and docs = '["AR aging","Statement of account","Log dunning","FAT06 tukar faktur, DSO aktual & AR aging"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 24 · docs'); end if;

  update public.os_process_steps
     set docs = '["Matrix intercompany 9 entitas — BS & IS","Kertas kerja eliminasi","TB konsolidasi"]'::jsonb
   where entity_code = 'SAMB' and label = '26'
     and docs = '["Matrix intercompany 9 entitas — BS & IS","Kertas kerja eliminasi","TB konsolidasi","FAT07 pre-recon TB & pasangan intercompany per nomor dokumen"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 26 · docs'); end if;

  update public.os_process_steps
     set docs = '["SJ principal","Tally sheet bongkar","Referensi PO"]'::jsonb
   where entity_code = 'SAMB' and label = '6a'
     and docs = '["SJ principal","Tally sheet bongkar","Referensi PO","WH02 time study manpower gudang & activity pool"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 6a · docs'); end if;

  update public.os_process_steps
     set docs = '["Berita acara terima titipan","Entry WMS dengan kode pemilik","Foto kondisi barang"]'::jsonb
   where entity_code = 'SAMB' and label = '7b'
     and docs = '["Berita acara terima titipan","Entry WMS dengan kode pemilik","Foto kondisi barang","LP05 register barang titipan & berita acara"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 7b · docs'); end if;

  update public.os_process_steps
     set docs = '["SJ SAMB — grain per-SJ","Checklist loading","Feed ke LP02 Trip Log"]'::jsonb
   where entity_code = 'SAMB' and label = '15a'
     and docs = '["SJ SAMB — grain per-SJ","Checklist loading","Feed ke LP02 Trip Log","WH04 rekap outbound, pick line & CBM per surat jalan"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 15a · docs'); end if;

  update public.os_process_steps
     set docs = '["SJ pengiriman barang klien — SAMB sebagai pengangkut, bukan penjual","Referensi DO klien","Salinan SJ untuk klien","Feed ke LP02 Trip Log"]'::jsonb
   where entity_code = 'SAMB' and label = '15b'
     and docs = '["SJ pengiriman barang klien — SAMB sebagai pengangkut, bukan penjual","Referensi DO klien","Salinan SJ untuk klien","Feed ke LP02 Trip Log","LP06 DO klien, register SJ barang klien & peran SAMB"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 15b · docs'); end if;

  update public.os_process_steps
     set docs = '["POD bertanda tangan customer","Nota retur / reject"]'::jsonb
   where entity_code = 'SAMB' and label = '18a'
     and docs = '["POD bertanda tangan customer","Nota retur / reject","WH05 register POD, retur & reject"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 18a · docs'); end if;

  update public.os_process_steps
     set docs = '["POD bertanda tangan penerima","Salinan POD untuk klien","Nota retur titipan"]'::jsonb
   where entity_code = 'SAMB' and label = '18b'
     and docs = '["POD bertanda tangan penerima","Salinan POD untuk klien","Nota retur titipan","WH05 register POD, retur & reject"]'::jsonb;   -- only while still the v0.4 value
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_steps 18b · docs'); end if;

  -- Needs: status / src (11 rows) --
  update public.os_process_needs nd
     set status = 'BELUM', src = 'Sistem / Sales'
    from public.os_process_steps s
   where s.id = nd.step_id and s.entity_code = 'SAMB' and s.label = '1'
     and nd.item = 'Master klien LP — badan usaha, term, tarif'
     and nd.status = 'SEBAGIAN' and nd.src = 'LP04 + arsip billing — tarif efektif per klien sudah bisa diturunkan';   -- the v0.4 row, untouched
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_needs 1 · Master klien LP — badan usaha, term, tarif'); end if;

  update public.os_process_needs nd
     set status = 'SEBAGIAN', src = 'LP02 Rate Card Model'
    from public.os_process_steps s
   where s.id = nd.step_id and s.entity_code = 'SAMB' and s.label = '1'
     and nd.item = 'Basis penetapan tarif layanan'
     and nd.status = 'SEBAGIAN' and nd.src = 'LP09 sheet Driver per Klien-Komponen — kelas driver yang benar-benar dipakai';   -- the v0.4 row, untouched
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_needs 1 · Basis penetapan tarif layanan'); end if;

  update public.os_process_needs nd
     set status = 'BELUM', src = 'Survey gudang'
    from public.os_process_steps s
   where s.id = nd.step_id and s.entity_code = 'SAMB' and s.label = '2'
     and nd.item = 'Kapasitas normal gudang dalam pallet position'
     and nd.status = 'BELUM' and nd.src = 'WH01 sheet Zona & Tinggi Rak';   -- the v0.4 row, untouched
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_needs 2 · Kapasitas normal gudang dalam pallet position'); end if;

  update public.os_process_needs nd
     set status = 'BELUM', src = 'HR + time study'
    from public.os_process_steps s
   where s.id = nd.step_id and s.entity_code = 'SAMB' and s.label = '9'
     and nd.item = 'Headcount & pembagian waktu per 4 activity pool'
     and nd.status = 'BELUM' and nd.src = 'WH02 Time Study — payroll per departemen sudah ada, yang hilang time study-nya';   -- the v0.4 row, untouched
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_needs 9 · Headcount & pembagian waktu per 4 activity pool'); end if;

  update public.os_process_needs nd
     set status = 'BELUM', src = 'GL / stok material'
    from public.os_process_steps s
   where s.id = nd.step_id and s.entity_code = 'SAMB' and s.label = '14'
     and nd.item = 'Pemakaian material packing per periode'
     and nd.status = 'BELUM' and nd.src = 'Kartu stok → WH04 sheet Material Packing';   -- the v0.4 row, untouched
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_needs 14 · Pemakaian material packing per periode'); end if;

  update public.os_process_needs nd
     set status = 'BELUM', src = 'Kolom di SJ → LP02 Trip Log'
    from public.os_process_steps s
   where s.id = nd.step_id and s.entity_code = 'SAMB' and s.label = '15a'
     and nd.item = 'CBM per SJ'
     and nd.status = 'BELUM' and nd.src = 'Kolom di SJ → Trip Log → WH04';   -- the v0.4 row, untouched
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_needs 15a · CBM per SJ'); end if;

  update public.os_process_needs nd
     set status = 'BELUM', src = 'HR'
    from public.os_process_steps s
   where s.id = nd.step_id and s.entity_code = 'SAMB' and s.label = '19'
     and nd.item = 'Headcount & biaya staff invoicing vs collection'
     and nd.status = 'SEBAGIAN' and nd.src = 'Salary Details → FAT05 sheet Headcount AR — departemennya ada, pembagiannya G11';   -- the v0.4 row, untouched
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_needs 19 · Headcount & biaya staff invoicing vs collection'); end if;

  update public.os_process_needs nd
     set status = 'BELUM', src = 'Turunan WMS + LP01'
    from public.os_process_steps s
   where s.id = nd.step_id and s.entity_code = 'SAMB' and s.label = '20'
     and nd.item = 'Pallet-day per klien LP per periode'
     and nd.status = 'SEBAGIAN' and nd.src = 'Arsip billing untuk klien bertarif pallet, WMS untuk sisanya';   -- the v0.4 row, untouched
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_needs 20 · Pallet-day per klien LP per periode'); end if;

  update public.os_process_needs nd
     set status = 'BELUM', src = 'Turunan LP02 Trip Log'
    from public.os_process_steps s
   where s.id = nd.step_id and s.entity_code = 'SAMB' and s.label = '20'
     and nd.item = 'CBM terkirim per klien per zona'
     and nd.status = 'SEBAGIAN' and nd.src = 'Arsip billing untuk klien afiliasi, imputasi master produk untuk klien bundel, sisanya belum';   -- the v0.4 row, untouched
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_needs 20 · CBM terkirim per klien per zona'); end if;

  update public.os_process_needs nd
     set status = 'SEBAGIAN', src = 'SAP'
    from public.os_process_steps s
   where s.id = nd.step_id and s.entity_code = 'SAMB' and s.label = '21'
     and nd.item = 'Nomor & nilai invoice jasa LP per klien'
     and nd.status = 'ADA' and nd.src = 'Arsip billing per klien per komponen';   -- the v0.4 row, untouched
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_needs 21 · Nomor & nilai invoice jasa LP per klien'); end if;

  update public.os_process_needs nd
     set status = 'BELUM', src = 'Rate card & invoice aktual'
    from public.os_process_steps s
   where s.id = nd.step_id and s.entity_code = 'SAMB' and s.label = '22'
     and nd.item = 'Tarif ke klien pihak ketiga sebagai pembanding internal'
     and nd.status = 'SEBAGIAN' and nd.src = 'TAX01 sheet Pembanding Internal + rate card terkoreksi FLT01';   -- the v0.4 row, untouched
  get diagnostics hit = row_count;
  if hit = 0 then skipped := array_append(skipped, 'os_process_needs 22 · Tarif ke klien pihak ketiga sebagai pembanding internal'); end if;

  if coalesce(array_length(skipped, 1), 0) > 0 then
    raise notice E'samb_process_v04_down: % of 61 text updates SKIPPED — the live value no longer matches the v0.4 seed, so it was edited from the app and is left as it is. Reconcile by hand:\n  %',
      array_length(skipped, 1), array_to_string(skipped, E'\n  ');
  else
    raise notice 'samb_process_v04_down: all 61 text updates applied — no row had been edited from the app.';
  end if;
end
$$;
