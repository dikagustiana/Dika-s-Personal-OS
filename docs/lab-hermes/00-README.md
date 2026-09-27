# Integrasi Hermes ke Lab

Lab akan tetap menyimpan agent, brief, assignment, corpus, review dan keputusan director di Supabase, sementara worker di VPS menjalankan pekerjaan panjang melalui Hermes. Audit menemukan sambungan submit brief dari UI ke runner institusi belum ada pada source yang diperiksa; karena itu gejala transisi hijau belum membuktikan timeout Edge Functions. Phase 1 menambahkan sambungan tersebut, antrean tahan reboot, satu agent riset dengan search/fetch/Python, progress, cancel dan hasil di director’s room tanpa approval perantara. Worker memegang kredensial terbatas, sedangkan Hermes memakai proses, home dan workspace baru setiap run serta hanya mendapat capability lokal. Committee, proposal, eval dan animasi kantor menyusul setelah jalur ini dapat dipakai.

## Batas bukti

Tanggal konteks dan snapshot audit: 26 September 2026. Source Personal OS **P** adalah [`2a2e336ff8784c74aa75313532f152b08f6e94c4`](https://github.com/dikagustiana/Dika-s-Personal-OS/tree/2a2e336ff8784c74aa75313532f152b08f6e94c4). Source Hermes **H** adalah [`8afaab3703e336d72a72c812dd2dd249f04f166a`](https://github.com/NousResearch/hermes-agent/tree/8afaab3703e336d72a72c812dd2dd249f04f166a). Path audit selalu mengacu snapshot tersebut. Harga memakai halaman resmi bertanggal pemeriksaan pada arsitektur; nilai VPS dan saldo yang dilaporkan berasal brief Dika. Batas resource, waktu, biaya dan effort berlabel desain adalah asumsi operasional, bukan hasil benchmark.

PR ini hanya desain dan pemeriksaan lokal di `docs/lab-hermes/`. Tidak ada perubahan aplikasi, migration live, deploy, instalasi VPS atau klaim acceptance sistem sudah lulus. SQL di folder ini tidak berada di jalur auto-apply. Fable mengonversinya menjadi migration baru setelah mencocokkan schema live; director menjalankan operasi VPS. Semua unknown live mempunyai probe dan cabang tindakan pada [09-open-items.md](09-open-items.md).

## Urutan baca dan eksekusi

1. [01-audit-repo.md](01-audit-repo.md) dan [02-audit-hermes.md](02-audit-hermes.md): bukti R/H, perbedaan dengan catatan lama, dan kemampuan source yang benar-benar dipakai.
2. [03-architecture.md](03-architecture.md): keputusan komponen, lifecycle, institusi, operasi dan biaya. [ADR](adr/) menjelaskan pilihan serta alternatifnya.
3. [04-contracts.md](04-contracts.md), [schemas](schemas/) dan [draft SQL](sql/): kontrak implementasi dan authority. [05-security.md](05-security.md): inventaris secret, T-1 sampai T-9 dan tes isolasi.
4. [07-plan.md](07-plan.md): urutan Phase 0 sampai Phase 5 dan pemetaan seluruh acceptance sistem.
5. Fable menyalin **satu bagian BEGIN/END yang sesuai phase** dari [08-fable-prompts.md](08-fable-prompts.md). Phase 1 menyertakan kontrak, schema, SQL, unit dan operasi agar dapat dieksekusi tanpa dokumen desain lain. Helper yang disebut runbook wajib dibangun Fable terlebih dahulu.
6. Director mengikuti [06-runbook-vps.md](06-runbook-vps.md), satu command per langkah, setelah Fable memberikan build SHA konkret. Lokasi, prompt, hasil, tanda salah dan rollback tercantum di setiap langkah.

## Temuan yang mengubah implementasi

| Temuan | Implikasi |
|---|---|
| Framework aktual Vite; navigasi Lab berupa state | Ikuti komponen/store existing, tanpa Next.js atau router baru |
| Owner Lab memakai passphrase dan `os_key_valid()`, bukan owner `auth.uid()` | Worker memakai machine Auth dan RPC terbatas; tidak diberi passphrase atau membership kolaborator |
| Public corpus tidak boleh berasal dari agent/brief/ancestor internal | Buat public successor dari prompt aktif; jangan menghapus guard atau menyalin corpus internal |
| `hermes serve` pada H adalah desktop JSON-RPC/WebSocket, berbeda dari gateway API | Pakai adapter `AIAgent` yang dipin; endpoint `/lab/v1` adalah komponen baru Fable |
| Callback tool menelan exception; token analytics tidak menjamin semua biaya | Archive sebelum konten dikembalikan dan reserve biaya sebelum request keluar melalui broker |
| Satu slot tidak bisa mengklaim seluruh backlog dalam batas waktu yang sama | ADR-010 mempertahankan target S-03 saat worker online dan slot tersedia, serta menampilkan total waktu antre |

## Ketaatan terhadap keputusan director

| Keputusan | Realisasi |
|---|---|
| D-01, D-02 | Supabase tetap system of record; executor per agent; deterministik pendek tetap Edge |
| D-03, D-04, D-05 | Pull outbound, machine Auth terbatas, service-role hanya cloud, Hermes tanpa kredensial Supabase; ADR-001/006 |
| D-06, D-10, D-11 | Tiga Unix user terpisah tanpa sudo; proses/home/workspace baru; system units dengan `User=`; ADR-006/009 |
| D-07 | Semua row baru dengan `data_class` bernilai public; public successor menjaga guard lama; ADR-005 |
| D-08 | Route/model/auxiliary per agent dan price snapshot berupa config; ADR-008 |
| D-09 | Memory, curator, session search dan mutasi skill otomatis mati sejak instalasi; proposal mulai Phase 3 |
| D-12 | Phase 1 direct menuju director; tidak menunggu committee, eval, floor atau approval tambahan; ADR-007 |
| D-13 | Fable menangani repo/cloud; director menjalankan command VPS manual satu per langkah |
| D-14 | Ubuntu 22.04 tetap; Phase 5 hanya merencanakan 24.04 |

## Validasi desain

Hasil berikut berasal pemeriksaan checkout P dan draft dalam PR ini, bukan lingkungan live:

| Pemeriksaan | Hasil dan batas |
|---|---|
| Baseline `pnpm typecheck` | Pass |
| Baseline `pnpm test:run` | Pass: 127 file test, 2.084 kasus, menurut output Vitest |
| Baseline `pnpm build` | Pass; peringatan ukuran chunk existing tetap ada |
| Draft SQL berurutan | Pass pada PGlite 0.5.8, dengan schema Lab dari migration 073/074/099/100 dan shim Auth/passphrase; bukan seluruh migration Supabase |
| Behavior SQL | Pass: submit/finish replay, claim satu slot, heartbeat, reserve/settle, corpus/event, owner projection, cap biaya, unknown usage, cancel dan reaper expired lease |
| Penolakan authority | Pass: owner RPC dari worker, private SELECT, stale lease dan conflicting final ditolak |
| JSON Schema | Pass: kompilasi draft 2020-12, payload SQL dan hasil fixture valid; extra field, timeout nol, path traversal dan runtime tanpa commit pin ditolak |
| Audit kredensial source | Tidak ada private secret terkonfirmasi dalam pola yang dipindai; anon JWT yang ter-commit dicatat menurut path/jenis pada R-12. Bukan jaminan seluruh bentuk secret dapat dideteksi |

[checks/README.md](checks/README.md) menjelaskan cara mengulang pemeriksaan offline. Auth JWT nyata, RLS/grants seluruh aplikasi, race antar koneksi, transport Hermes, namespace/systemd, provider billing, reboot dan latency UI masih diuji saat build/commissioning, sesuai phase. S-01 sampai S-15 belum berstatus pass live.

## Status acceptance deliverable

Pass di bawah berarti artefak desain memenuhi pemeriksaan kelengkapan dan konsistensi yang tertulis; tidak berarti Fable atau director sudah menjalankan build.

| ID | Status | Bukti |
|---|---|---|
| S-D01 | Pass | Prompt Phase 1 mandiri pada 08, input source/pin, schema/SQL, langkah, helper, test, expected result dan definisi selesai tertanam |
| S-D02 | Pass | 06: satu command per langkah, lokasi/prompt, hasil, error, cabang fallback dan rollback; placeholder build harus diisi Fable sebelum diserahkan |
| S-D03 | Pass | R-01–R-13 dan H-01–H-14 mencantumkan path serta SHA; unknown diarahkan ke probe O-01–O-09 |
| S-D04 | Pass | Matriks D di atas; pilihan antarmuka, public successor dan batas kapasitas dijelaskan ADR |
| S-D05 | Pass | 05: lokasi/pemilik/permission/pembaca/rotasi; service-role hanya cloud, Hermes hanya capability lokal |
| S-D06 | Pass | T-1–T-9 disertai mitigasi dan tes U/V |
| S-D07 | Pass | 03 bagian 6.15 mencakup seluruh failure mode dari brief |
| S-D08 | Pass | Diff dibatasi `docs/lab-hermes/`; pemeriksaan secret tidak menemukan credential privat pada deliverable |
| S-D09 | Pass | Paragraf pembuka menjelaskan perubahan dan penyebabnya tanpa bergantung dokumen lain |
| S-D10 | Pass | Matriks S-01–S-15 pada 07 mencantumkan phase dan bukti; perubahan lingkup latensi dibuka melalui ADR-010 |
