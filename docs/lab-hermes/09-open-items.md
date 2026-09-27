# Probe live dan pekerjaan di luar scope

Temuan utama: source cukup untuk menetapkan desain, tetapi tidak membuktikan schema/deploy/akun/VPS live. Daftar ini bukan pertanyaan untuk director. Setiap ketidakpastian mempunyai probe, interpretasi dan cabang tindakan.

## O-01 Schema live dan insiden transisi hijau

Pemilik Fable. Jalankan `sql/000-live-probes.sql` read-only setelah memeriksa keberadaan object:

```sql
select to_regclass('public.os_inst_briefs') briefs,
 to_regclass('public.os_inst_corpus') corpus,to_regclass('public.os_lab_runs') runs;
```

Semua nonnull: jalankan blok query schema/count/status/errors. Null: jangan menjalankan query tabel itu; source belum terpasang di project tersebut atau project salah. Cocokkan project ref ascbthsgborseynmmthm, lalu P1 memasang prerequisite Lab yang benar per transaksi. Asumsi kerja: schema 099–107 ada, data brief nol sesuai laporan. Bila counts nol tetap, tidak ada bukti INSERT brief berhasil. Bila brief intake ada dan run nol, telusuri invocation/key/owner RLS. Bila run error ada, cocokkan error/time dengan Edge log. Data live, bukan asumsi “timeout”, menentukan diagnosis akhir.

## O-02 Deploy, logs dan plan

Pemilik Fable, read-only Vercel/Supabase. Di Vercel project Personal OS, baca deployment production gitSource SHA dan build stamp website; bandingkan P. Di Supabase Functions logs, filter run-lab-agent dan institution-tools pada 26 September 2026, lihat invocation/status/duration tanpa body/key. Di organization Billing/Subscription, baca plan active. Tidak ditemukan di source: deploy aktual, plan hari ini dan log insiden. Free berarti wall-clock 150 detik; paid 400 detik menurut [Supabase limits](https://supabase.com/docs/guides/functions/limits), diperiksa 26 September 2026. Jika log/plan inaccessible, tandai unconfirmed dan tetap uji Hermes >400 detik. Desain tidak membutuhkan jawaban billing untuk lanjut.

## O-03 Realtime owner dan worker

Pemilik Fable. Catalog read-only:

```sql
select pubname,tablename from pg_publication_tables where pubname='supabase_realtime';
select schemaname,tablename,policyname,roles,qual from pg_policies
where tablename in ('os_inst_events','os_inst_assignments','os_lab_worker_wake');
```

Di UI owner, buka websocket inspector lalu jalankan job tes biasa. Event ada ≤5 detik: Realtime owner dapat dipakai. Tidak ada event tetapi repository fetch sukses: passphrase header kemungkinan tidak tersedia untuk Postgres Changes, gunakan polling dua detik. Collaborator subscribe/fetch harus denied/kosong. Worker AuthJWT hanya menerima wake row sendiri. Jangan melonggarkan RLS untuk membuat animasi hidup.

## O-04 Roster/versi/public

Pemilik Fable. Query di 000 menunjukkan class, active version count, lead/seat. Satu active prompt cocok agents.system_prompt: snapshot langsung. Tidak ada active version: owner configure bootstrap hanya current prompt, bukan proposed. Lebih dari satu active atau mismatch: Fable memperbaiki baseline dalam migration terbatas dengan bukti versi/current prompt; jangan memilih proposal otomatis. Legacy internal mendapat public successor dengan mapping; data/corpus internal lama tidak disalin. Referensi committee ialah prompt manusia yang sedang aktif, bukan output agent. Asumsi source roster internal ditangani tanpa menghapus guard.

## O-05 Secrets/history/alerts

Pemilik Fable. Scan tracked/history dengan secret scanner mode redacted dan baca GitHub secret scanning alerts jika akun mendukungnya; jangan mencetak token. Source audit menemukan hanya anon JWT pada scripts/probe-password-grant.sh. Tidak ada private secret terverifikasi: lanjut tanpa rotasi sia-sia. Ada private secret: catat path/jenis saja, revoke/rotate di provider/Supabase sebelum P1, lalu secret baru hanya cloud/worker seperti inventory. Access alerts tidak tersedia: tetap lakukan scan lokal dan tandai keterbatasan coverage. History rewrite di luar PR desain.

## O-06 VPS/kernel/resource/pin

Pemilik director, user admin, satu command tiap langkah V-03–V-10; lokasi/prompt/expected sudah lengkap pada runbook. SHA/versi personal tidak sama pin Lab adalah normal. Mode home 700/750 aman terhadap user di luar grup, desain mengunci 700; 755 diperbaiki. RAM usable/disk menentukan cap, bukan angka motd asumsi. USERNS=1 lalu bwrap berhasil →mode utama; USERNS=0 →admin enable lalu test; kernel tetap menolak →whole-service namespace fallback. Jika fallback tidak lolos tes, readiness false dan job queued sampai paket unit diperbaiki, bukan runtime tanpa isolasi. `timedatectl status` synced yes →normal; no →NTP enable dan DB-time fencing tetap berfungsi. Tidak menjalankan upgrade OS.

## O-07 Endpoint saldo dan route provider

Pemilik director. Jalankan probe satu command di SSH prompt hermesagent@<host>:~$ sebelum ada helper, key diminta tersembunyi dan tidak disimpan:

```bash
python3 -c 'import getpass,json,urllib.request,urllib.error; key=getpass.getpass("Kimi API key (hidden): "); hosts=("https://api.moonshot.ai/v1/models","https://api.moonshot.cn/v1/models"); exec("for url in hosts:\n try:\n  response=urllib.request.urlopen(urllib.request.Request(url,headers={\"Authorization\":\"Bearer \"+key}),timeout=15)\n  data=json.load(response)\n  print(url, response.status, \"models=\"+str(len(data.get(\"data\",[]))))\n except urllib.error.HTTPError as error:\n  print(url,error.code)\n except Exception as error:\n  print(url,type(error).__name__)" )'
```

Hasil: global 200/CN 401 →key global; CN 200/global 401 →key China. Keduanya 200 →pilih akun yang billing-nya mempunyai saldo, bukan menebak dari models. Keduanya 401/403 →key salah atau Kimi Coding Plan berbeda; setup route direct DeepSeek sementara lewat V-26b, lalu key API Kimi yang sesuai. GET models tidak memastikan saldo, jadi billing saldo dibaca pada akun [global](https://platform.kimi.ai) atau [China](https://platform.kimi.com); saldo positif pada akun global →route global USD, pada China →route China CNY dengan FX snapshot. Tidak ada API balance yang diasumsikan tersedia tanpa source resmi. Jika dashboard tidak dapat diakses, key dinyatakan auth-ready/balance-unverified; pertama kali insufficient_balance membuat error jelas, bukan saldo fiktif. Helper V-27 mengemas probe yang sama.

Anthropic/Nous opsional: dedicated key/token Lab dan model list/tarif akun diverifikasi sebelum route enabled. Jangan menyalin OAuth /home/hermes. Bila Nous hanya menyediakan OAuth, labctl auth nous menyimpan akun Lab di home worker, tidak menjalankan Hermes personal. Fable menggunakan flow resmi dari source H dalam auth helper; bila entitlement/pricing tak tersedia, route disabled dengan alasan, Kimi/DeepSeek tetap jalan. Tidak ada deploy diperlukan untuk route yang credential/price-nya sudah ready.

## O-08 Scheduler/Auth/extension

Pemilik Fable. Query extensions/policies/roles di 000 dan Auth project settings read-only. Machine user dibuat lewat admin Edge, sehingga public signup boleh off. Refresh token rotation harus ditangani atomic di satu worker process. pg_cron+pg_net tersedia →cloud outbox recovery; tidak tersedia →worker poll pending jobs dan invoke thin step Edge outbound. Kedua pilihan menggunakan action_key/CAS yang sama. Tidak ada call Supabase→VPS. Realtime optional, bukan prasyarat.

## O-09 Tool availability dan resource live

Pemilik director V-24/V-30/V-37; Fable build fixture H. Search keyless bisa bekerja atau rate-limited: fallback public parser diperiksa dengan query publik dan minimal satu URL fetch; jika kedua backend gagal, tool error dan acceptance S-01 belum lulus, bukan mengarang sumber. Python terminal dapat berjalan atau native dependency gagal: installer pin/verify memperbaiki dependency Lab saja. Browser tetap off sampai headless context+capture proxy lulus test dan peak memory mendukung. Default satu run, tidak perlu memutuskan concurrency baru.

## Di luar scope

- Menghapus engine data_class, trigger frozen/egress lama dan teks SAMB. Integrasi hanya public successor; penghapusan tersendiri setelah regression test.
- Menghapus secret historis dengan rewrite git bila kelak ditemukan; rotasi masuk P0, rewrite koordinasi terpisah.
- Mengubah Work/Growth, owner auth menjadi full Supabase Auth, atau model grant kolaborator.
- Menjalankan upgrade Ubuntu; rencana 24.04 ada P5. Kalender support Canonical tidak seragam: [release notes 22.04](https://documentation.ubuntu.com/release-notes/22.04/) menyebut April 2027, [release cycle](https://ubuntu.com/about/release-cycle) Mei 2027, [release-team list](https://ubuntu.com/project/docs/release-team/list-of-releases/) Juni 2027 saat diperiksa. Target perencanaan tetap sebelum April 2027 agar tidak bergantung selisih itu.
- Hermes personal/Telegram personal/laptop desktop, kecuali permission isolasi. Remote desktop tidak dibuka ke internet.
- Local LLM, Docker group, port/API VPS publik, atau rebuild UI/floor.
