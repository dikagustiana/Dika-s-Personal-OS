# Rencana eksekusi bertahap

Keputusan utama: Phase 1 membangun satu jalur berguna, termasuk submit UI yang hilang pada source P. Committee, eval, floor dan proposal tidak menjadi prerequisite. Semua effort berikut estimasi desain, basis satu sesi Fable sekitar 60–90 menit kerja terfokus; waktu tunggu download/model tidak dihitung sebagai menit aktif director. Angka bukan komitmen throughput vendor.

## Phase 0: probe dan persiapan

Tujuan: memastikan schema/deploy/account nyata tanpa menganggap catatan lama sebagai bukti.

Perubahan: Fable hanya menyimpan hasil read-only yang teredaksi di `docs/lab-hermes/probe-results.md` pada branch build. Director tidak mengubah konfigurasi personal selain permission isolasi pada P1. Rotasi hanya jika secret privat benar-benar ditemukan, tidak karena anon key client.

| Urut | Eksekutor | Input dan langkah | Verifikasi pasti |
|---|---|---|---|
| 0A | Fable | Checkout current main, rekam SHA; jalankan setiap blok `sql/000-live-probes.sql` dengan read-only connection project ascbthsgborseynmmthm | Daftar schema/policies/triggers/ledger dan counts. Jika objek hilang, probe catalog dulu lalu pilih migration prerequisite yang benar, bukan terus menjalankan query yang gagal |
| 0B | Fable | Baca Vercel deployment stamp/commit dan Edge logs periode insiden; cek subscription plan read-only | Pinned deployed SHA, invocation/INSERT/auth/key failure diketahui atau ditandai tidak tersedia. Jika plan tak dapat dibaca, semua tes tetap memakai >400 detik sehingga kedua plan tertangani |
| 0C | Fable | Secret scanner tracked/history dan hosting alerts; nama env saja | Tidak ada private key terverifikasi, atau rotasi cloud selesai sebelum deploy P1. Tidak menulis nilai secret |
| 0D | Director, hermesagent | V-01–V-11; O-07 endpoint/saldo | Versi/SHA, mode home, RAM/disk/swap, clock, baseline ufw; global/China/Coding Plan terbedakan |

Rollback: read-only tidak perlu; key yang telah dirotasi tidak diaktifkan kembali. Effort: satu sampai dua sesi Fable, 15–25 menit director. Selesai bila setiap unknown mempunyai outcome/cabang default yang aman, bukan daftar pertanyaan.

## Phase 1: jalur tipis

Tujuan: submit transisi hijau dari Lab, Hermes melakukan search/fetch/Python, output unreviewed masuk director room, tanpa terminal pada run normal.

Perubahan file: `workers/lab-worker/**`, `workers/hermes-backend/**`, `ops/lab-vps/**`, `supabase/functions/lab-worker-enrol/**`, migration baru hasil `001/002` yang telah diuji; `src/data/labRepository.ts`, `labModel.ts`, `labTypes.ts`, `institutionRepository.ts`, `src/store/labLiveStore.ts`, `src/views/lab/LabRegistry.tsx`, `LabRun.tsx`, `LabRuns.tsx`, `institution/InstitutionDirector.tsx` dan komponen/test Lab baru. Update package scripts/CI bila perlu untuk worker/schema/SQL tests. Edge `run-lab-agent` hanya menolak provider Nous untuk executor edge; perilaku provider lama tetap. Tidak mengubah Work/Growth.

| Urut | Eksekutor | Langkah konkret | Verifikasi/output |
|---|---|---|---|
| 1A | Fable | Konversi SQL draft menjadi migration forward baru, schema validator, owner configure/submit/status/files, pairing Edge. Cocokkan nama kolom live termasuk cost_estimate_usd/cost_actual_usd. Tambah provider nous ke check dan UI union tanpa melemahkan boundary | SQL suite memakai guards nyata; anon/collaborator/worker tanpa lease ditolak; owner submit replay satu job; provider_id nyata |
| 1B | Fable | Implement worker Auth/RPC, lease/controller, proxy reservation+usage, MCP search/fetch, local events. SDK retry implicit dimatikan. Tulis config/price seed Kimi dari sumber resmi, no key | Fixture HTTP: cap sangat kecil →zero upstream calls; missing usage tetap reserved; stale token ditolak |
| 1C | Fable | Backend AIAgent pin H, fresh process/home, tool manifest, learning off, bwrap + egress. Implement CLI fallback dan whole-service namespace fallback; paket helper/unit sesuai runbook | Contract test tanpa paid key; U-01–U-04; cancel termasuk grandchildren; fallback tidak membuka all-tools |
| 1D | Fable | Submit form dan executor config native; job polling, live tool/cost, cancel, online, director result. Agent baru public dibuat via owner RPC. Phase 1 direct satu assignment | UI smoke owner berhasil, collaborator tak berhak denied; no approval dialog baru; offline queue jelas |
| 1E | Fable | Jalankan typecheck/test/build, SQL role/guard suites, worker tests, unit verify dalam VM 22.04. Terapkan migration baru satu per transaksi, deploy enrol dan UI melalui akses cloud yang sudah diberikan | Deployment SHA dan migration receipt, rollback commit siap. Jangan db push/reset ke live. Tidak SSH VPS |
| 1F | Director, hermesagent menjalankan proses lab/hermes-lab via sudo | V-12–V-39, lalu UI acceptance. Fable memberi BUILD_SHA konkret dan pairing UI sudah dapat dipakai | Dua units healthy, key hanya lab, no port publik, worker online |
| 1G | Director UI + Fable cloud read-only | S-01, S-02, S-03, S-09, S-10, S-12 per run, S-14. Director V-40–V-42 untuk reboot; Fable query result uniqueness | Bukti masing-masing criterion, usage actual known/reserved dibedakan; tidak mengganti hasil tes dengan estimasi |

Rollback: owner pause queue, director stop backend/worker atau rollback release, Fable rollback UI/Edge commit. Pertahankan tabel/hasil dan executor default edge untuk agent lama; set agent Hermes ke edge hanya tindakan config owner yang eksplisit, bukan fallback otomatis. Tidak DROP corpus/queue berisi data. Effort: enam sampai sepuluh sesi Fable, 45–75 menit aktif director plus satu probe durasi sekitar tujuh menit. Ini biaya build adapter/budget/isolation nyata; bukan memasang satu endpoint Hermes lalu selesai.

## Phase 2: institusi

Tujuan: program office, specialist, peer, lead, committee, debate sebagai run terpisah; provenance lengkap dan biaya aktual versus estimasi.

Perubahan: migration `003-institution-provenance`, `lab-institution-step` Edge, shared pure institution state machine/protocol adapters, new `lab_step_commit`, action outbox/revision, archive/claim validator di worker+finish SQL, director provenance/cost view. Source runner browser tetap referensi test; tidak menjalankan browser loop untuk job Hermes. Roster successor public dibuat satu kali dan seat/lead dipetakan tanpa mengganti prompt committee. Whole-process broker sudah tersedia; browser hanya opt-in bila capture lengkap.

Langkah: Fable (1) tes current pipeline fixtures dan public successor mapping, (2) pindahkan setiap model action menjadi enqueue, CAS/action_key atomik, (3) archive-before-return untuk semua retrieval dan explicit corpus inputs per assignment, (4) insert claims/refs dalam transaksi finish, (5) review/debate projections melalui guard existing, (6) scheduler wake + fallback worker poll, (7) actual all attempts versus estimate version di director. Director hanya menjalankan V-51 untuk release worker baru, kemudian memilih mode institution di UI.

Verifikasi: S-07 query claim tanpa ref kosong dan uji ref di luar input ditolak; S-08 setiap run mempunyai ledger/cost status dan actual versus estimate; S-15 emitted_at→UI ≤5 detik pada jaringan normal, poll fallback tetap memenuhi. Race stepper dua invocation menghasilkan satu action/job; tutup tab di tengah pipeline tetap berlanjut; peer berbeda agent, committee re-review sekali, loop ketiga ditolak guard. Jika job `brief`, maksimum dua run; standard/full full pathway tidak dipalsukan menjadi direct.

Rollback: hentikan enqueue institution baru dengan feature config, tetap izinkan direct P1. Outbox pending disimpan, tidak dibuang. Restore release worker sebelumnya dan UI projection lama kompatibel data baru. Effort: empat sampai tujuh sesi Fable, 10–20 menit aktif director.

## Phase 3: learning menjadi proposal

Tujuan: hasil riset dapat mengusulkan skill tanpa mengubah prompt aktif dan tanpa membuka eval rubric.

Perubahan: `004-proposal-link`, `lab_worker_propose`, diff/reference versioning, deterministic eval scorer projection; worker validator dan director diff/eval view existing. Tidak menyalakan memory/curator/session_search.

Langkah: Fable implement proposal output→diff terhadap base version→transaction proposed/linkage; target hanya agent assignment, committee runtime proposal ditolak walaupun guard lama membolehkan self-proposal. Reuse scorer cloud, task-only payload untuk before/after, expected_answer/rubric tidak dikirim. Director update release via V-51 dan meninjau proposal di UI bila ingin mengubah skill, bukan untuk membuka output riset.

Verifikasi: prompt hash aktif sama sebelum/sesudah run; proposed row berisi rationale/diff/base/job; replay tidak ganda; worker direct UPDATE/promote/read-rubric ditolak. Rubric canary tidak muncul dalam payload/logs. Existing director promote/reject tetap bekerja, reject reason tersimpan. Proposal target committee selalu denied. Rollback: disable proposal ingestion, tetap simpan proposed existing, research tidak berhenti. Effort: dua sampai empat sesi Fable, 10–15 menit director.

## Phase 4: Bot Crossing live

Tujuan: feed durable menggerakkan floor existing. Tidak membangun kantor baru.

Perubahan: `src/views/lab/floor/transport/institutionStream.ts`, `src/logic/floor/institution/project.ts`, related tests; lazy-load tetap. Fable sambungkan event/attempt/cursor ke enam OFFICE states, poll fallback dan reconnect dedup. Jika literal /lab/floor dibutuhkan sebagai alias, hanya resolve initial Lab floor selection di shell existing, jangan memasang router baru.

Verifikasi: replay event fixture menghasilkan state table 03; stale worker/error/cancel/reset tidak membuat agent menggantung; collaborator tak dapat subscribe/read payload; low-motion dan lazy-load tetap. Director membuka The floor sambil S-01 berjalan, tidak ada VPS step bila protocol sama. Rollback: feature flag feed baru off, projector/snapshot lama tetap. Effort: dua sampai tiga sesi Fable, 5–10 menit director.

## Phase 5: hardening

Tujuan: membatasi kerusakan pada beban/ops jangka panjang dan melatih pemulihan.

Perubahan: `005-daily-budget`, per-tool child namespace/capability lebih sempit, daily budget UI/kill switch, pinned update tooling (pin awal tetap P1), backup restore, journald retention, optional Telegram notify-only. Ubuntu tetap 22.04; hanya tulis rencana upgrade 24.04 dengan snapshot/rehearsal/rollback, tidak mengeksekusinya.

Langkah: Fable race-test daily reserve termasuk midnight dan unknown usage; kill switch menolak claim/reserve serta membatalkan active child. Per-tool process tidak membaca parent environment/proc, provider key tetap lab. Build staging update fixture, manifest signed/hash, rollback dan backup exclude-secret. Director V-50–V-55 sesuai kebutuhan; bot opsional tidak jadi prerequisite. Rencana Ubuntu: jadwalkan rehearsal sebelum April 2027 sebagai target konservatif brief, cek kalender Canonical saat pelaksanaan karena halaman resmi berbeda antara April/Mei/Juni 2027, backup restore di VM 24.04, cek Python/bwrap/systemd/nft, baru usulan perubahan host terpisah. Tidak memakai ESM sebagai alasan menunda tanpa keputusan baru.

Verifikasi: S-12 daily, U-06 race reservations, update buruk tetap pin lama, restore backup tidak berisi key dan membutuhkan reenroll, Telegram tidak bisa memicu run, full resource smoke satu run tanpa OOM host. Rollback: daily enforcement tetap on jika aman; untuk bug pause queue dan release rollback, bukan mematikan cap diam-diam. Backup/Telegram dapat dinonaktifkan terpisah. Effort: tiga sampai lima sesi Fable, 30–45 menit director.

## Matriks acceptance sistem

Angka target berasal brief Dika, 26 September 2026. Belum dianggap lulus live dalam PR desain.

| ID | Phase | Bukti dan hasil yang diwajibkan |
|---|---|---|
| S-01 | 1 | Brief transisi hijau persis, job succeeded, search/fetch/Python event, output corpus/director pointer dan UI |
| S-02 | 1 | Durasi DB >400 detik, succeeded; actual research atau probe durasi terpisah berlabel |
| S-03 | 1 | claimed_at-created_at ≤10 detik saat worker online/idle; queued saat busy bukan SLA claim yang sama |
| S-04 | 1 | V-34 scan lengkap home/env/runtime Hermes, nol credential Supabase |
| S-05 | 1 | V-35 semua home,/etc,env, nol service-role |
| S-06 | 1 | Reboot terkontrol V-40; retry/failed bersih; satu final canonical corpus per job; stale lease denied |
| S-07 | 2 | Seluruh claim blocks mempunyai corpus/assumption ref; zero orphan query dan klik UI; entailment dinilai review |
| S-08 | 2 | Semua model/tool request ledger, known/reserved status; actual di samping estimate dan estimator version |
| S-09 | 1 | Agent baru UI→run tanpa migration/deploy, stopwatch ≤10 menit |
| S-10 | 1 | Config provider/model diganti sekali, run baru memakai ID itu tanpa deploy |
| S-11 | 1 | Raw Unix dan tool run personal-home probe menghasilkan permission denied dan canary utuh |
| S-12 | 1,5 | Cap buatan rendah menghentikan request sebelum egress; P5 daily race/midnight/active cancel |
| S-13 | 1 | Ufw V-09 dan V-38 sama, ss loopback untuk dua listener baru |
| S-14 | 1 | UI cancel→child/proses/tool berhenti ≤30 detik, DB cancelled; stopwatch/event timestamps |
| S-15 | 2 | Tool event→UI ≤5 detik, reconnect replay/no duplicate, poll fallback diuji |

S-03 tidak dapat dijanjikan untuk semua job yang datang saat satu slot sedang sibuk. ADR-010 mencatat hambatan matematis dan mempertahankan target untuk worker online dengan kapasitas tersedia. UI menampilkan antre saat sibuk, bukan menyamarkan keterlambatan. Hal yang sama berlaku S-15 ketika jaringan/cloud benar-benar down: UI offline, bukan janji realtime selama outage.
