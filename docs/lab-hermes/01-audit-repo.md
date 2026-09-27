# Audit repo Personal OS

Temuan utama: institusi sudah memiliki skema, runner yang diuji, director’s room, dan floor. Sambungan submit institusi ke runner produksi belum ada. Memindahkan runtime saja tidak menutup sambungan ini.

Snapshot audit: `P = 2a2e336ff8784c74aa75313532f152b08f6e94c4`, default branch `main`, diambil 26 September 2026. Semua path source audit menunjuk commit P, termasuk lampiran. Rujukan sql/000-live-probes.sql dan ADR adalah artefak desain baru dalam docs/lab-hermes, bukan file pada P. Repo terverifikasi `public` melalui metadata GitHub. Angka jumlah di sini dihitung dari checkout P. Komentar “applied live” dan laporan build lama bukan bukti keadaan live hari ini.

## R-01. Framework dan deploy

Vite, React, TypeScript, Tailwind, Zustand. Bukan Next.js. `package.json` memakai `vite`, `tsc`, `vitest` dan pnpm. `vercel.json` me-rewrite seluruh path ke `/index.html`. `deploy/README.md` mendokumentasikan Git integration main serta build stamp. Build/deploy Vercel aktual perlu probe O-02, bukan disimpulkan dari dokumentasi. Repo tidak mempunyai router dependency. Navigasi utama berupa state `ShellArea` dan `LabView`.

Bukti P: [`package.json`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/package.json) [`vite.config.ts`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/vite.config.ts) [`vercel.json`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/vercel.json) [`deploy/README.md`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/deploy/README.md) [`src/App.tsx`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/src/App.tsx) [`src/store/appStore.ts`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/src/store/appStore.ts)

## R-02. Peta kode Lab

| Lapisan | Path pada P | Fungsi aktual |
|---|---|---|
| Mount dan navigasi | `src/App.tsx`, `src/layout/AppShell.tsx`, `src/store/appStore.ts` | Registry, Run, Run log, Chains, Flow, Evidence, Director’s room, The floor |
| Registry dan executor UI | `src/views/lab/LabRegistry.tsx`, `LabRun.tsx`, `LabRuns.tsx`, `LabChains.tsx` di direktori yang sama | Pemilihan agent/provider, SSE run biasa, daftar run |
| State live | `src/store/labLiveStore.ts` | Echo browser untuk status run, bukan antrean tahan reboot |
| API Lab | `src/data/labModel.ts`, `labRepository.ts`, `labTypes.ts` | Edge executor dan mapping run |
| Institusi | `src/data/institutionRepository.ts`, `institutionTypes.ts`, `institutionTools.ts` | CRUD/RPC, mapping camelCase, tool boundary |
| Runner | `src/logic/institution/runner.ts`, `institutionPorts.ts` | State→action, model calls dan persistensi melalui ports |
| Aturan bersama | `supabase/functions/_shared/institution/` | Pipeline, protocol, weight, department, provenance, egress, sandbox |
| Director | `src/views/lab/institution/InstitutionDirector.tsx` | Membaca brief, corpus, review/debate, keputusan, proposal/diff, eval |
| Floor | `src/views/lab/floor/`, `src/logic/floor/` | Scene, projection state dan Realtime transport |

Bukti P: path dalam tabel. Dependency `Repository` tetap menjadi satu seam akses data. Worker baru tidak memindahkan Work/Growth ke API baru.

## R-03. Migrasi dan skema

Ada 104 file forward migration, nomor akhir 107, karena nomor 022–024 tidak ada. Lampiran A mencantumkan seluruh file. Ada 43 tabel Lab/institusi yang dibuat oleh migrasi, termasuk rubric private. Lampiran B mencantumkan nama dan seluruh kolom deklarasi awal beserta tambahan kemudian. Schema live harus dicocokkan dengan `sql/000-live-probes.sql`.

RLS dasar registry/provider/chains memakai `os_key_valid()` untuk write. SELECT sebagian menerima `os_read_key_valid()`. Run/artifact tidak memiliki write policy client. Institusi awalnya SELECT-only, lalu migration 104 memberi write terbatas kepada director pada brief, assignment, review, submission, debate, proposal, eval dan event. Tidak ada grant kolaborator ke Lab. `service_role` melewati RLS, tetapi trigger tetap berjalan.

| Penegakan | Bukti P | Akibat untuk integrasi |
|---|---|---|
| Prompt proposal-only | `20260910000100_institution_guards.sql`, fungsi `os_lab_agents_prompt_lock`, `os_inst_agent_versions_guard`, `os_inst_version_promote` | UPDATE prompt ditolak tanpa promotion GUC. INSERT versi normal harus proposed, termasuk owner. Bootstrap versi pertama perlu RPC terbatas, bukan promosi otomatis revisi |
| Committee | migration 100 dan `20260910000106_institution_committee.sql` | Reviewer harus agent committee yang ditentukan department. Hanya committee sendiri/director boleh mengusulkan prompt committee |
| Passphrase dan RLS | `20260724000002_security.sql`, `20260728000034_read_only_key.sql`, `supabase/functions/_shared/appKeyAuth.ts` | Tidak mempunyai owner UUID untuk diisikan worker |
| Epistemik | `20260817000077_lab_epistemic_gates.sql`, 079, 080, 082 | G-EXTRACT/VERIFY/CLAIM/LAYER/OUTPUT/FALSIFY/NUMBER tetap berlaku pada evidence lane |
| Data class | `20260817000074_lab_data_boundary.sql`, 092, 100 | Kelas agent frozen. Corpus public ditolak bila agent, brief, atau ancestor internal |
| Egress | `supabase/functions/_shared/institution/egress.ts`, `supabase/functions/institution-tools/index.ts` | Scan query/URL terhadap internal context berada di tool layer, bukan trigger PostgreSQL |
| Grant fungsi | `20260910000102_institution_function_grants.sql`, 104, 107 | REVOKE dari PUBLIC saja tidak cukup. Cabut anon/authenticated/service_role secara eksplisit sebelum GRANT terbatas |
| Staleness evidence | `20260827000091_lab_stale_sweep_gate_fix_definer_context.sql` | Sweeper menurunkan status datapoint terverifikasi yang kedaluwarsa, bukan membatalkan run panjang. Jangan mengubahnya untuk Hermes |

Seluruh basename di tabel berada di `supabase/migrations/`, kecuali path functions yang disebut lengkap. Semua pada commit P. Jangan `supabase db push`, `migration up`, `db reset`, atau `db remote commit` ke live. Ledger live dan nama file historis berbeda menurut repo. Fable menerapkan satu migration baru per transaksi melalui akses yang sudah diotorisasi brief ini.

## R-04. Edge Functions

Ada 10 direktori function berisi `index.ts`, dihitung dari P. Adapter Lab memakai Anthropic Messages dan OpenAI-compatible. Tidak ada Edge Function stepper institusi, walaupun komentar migration 099 menyebut rencana itu.

| Function | Model | Streaming dan persistensi |
|---|---|---|
| `run-lab-agent` | Ya, `anthropicAdapter` / `openaiAdapter` | SSE `run`, `delta`, `done`, `error`. Row `os_lab_runs` ditulis sebelum provider. Finalize token/cost sekali, `EdgeRuntime.waitUntil` mencoba mempertahankan PATCH saat disconnect. Bukan jaminan melampaui wall clock |
| `run-evidence-agent` | Ya, `complete()` | Respons model nonstreaming, aksi per evidence agent, menulis run serta output terstruktur yang tunduk trigger |
| `run-research-prompt` | Ya, OpenAI-compatible | Request sinkron, JSON kembali ke client. Bukan durable queue Lab |
| `run-research-council` | Ya, OpenAI-compatible | Council calls sinkron dengan batas concurrency, kembali ke client. Bukan institusi `os_inst_*` |
| `institution-tools` | Tidak untuk inti tool | Search/fetch/archive, mini interpreter deterministik, synthesize/provenance. Corpus ditulis dengan service role |
| `verify-passphrase` | Tidak | Verifikasi owner dan rate limit |
| `request-passphrase-recovery` | Tidak | Recovery email melalui Resend |
| `consume-passphrase-recovery` | Tidak | Konsumsi recovery token |
| `provision-collaborator` | Tidak | Auth/grant provisioning |
| `share-view` | Tidak | Baca share yang diotorisasi |

Bukti P: `supabase/functions/<nama>/index.ts`, `supabase/functions/_shared/appKeyAuth.ts`, `supabase/functions/_shared/provision.ts`, dan `src/data/labModel.ts`. Nama environment, tanpa nilai:

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LAB_ANTHROPIC_API_KEY`, `LAB_DEEPSEEK_API_KEY`, `LAB_KIMI_API_KEY`, `LAB_MODEL_MAX_TOKENS`, `RESEARCH_MODEL_API_KEY`, `RESEARCH_MODEL_BASE_URL`, `RESEARCH_MODEL_DEFAULT`, `RESEARCH_MODEL_BROWSING`, `RESEARCH_MODEL_MAX_TOKENS`, `RESEARCH_MODEL_MAX_CONCURRENCY`, `INSTITUTION_SEARCH_URL`, `INSTITUTION_SEARCH_API_KEY`, `INSTITUTION_SEARCH_AUTH_HEADER`, `INSTITUTION_SEARCH_AUTH_PREFIX`, `RESEND_API_KEY`, `RECOVERY_EMAIL_TO`, `RECOVERY_EMAIL_FROM`, `RECOVERY_APP_ORIGIN`, `COLLAB_LINK_TTL_SECONDS`. Frontend: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Kimi Lab dapat memakai fallback `RESEARCH_MODEL_API_KEY` pada jalur Edge lama. Jalur Hermes tidak membaca secret Edge ini.

## R-05. Titik berhenti brief transisi hijau

Cacat integrasi source terletak sebelum model call pertama. Pencarian semua pemanggil produksi `createInstitutionPorts`, `stepBrief`, `runBrief`, `institution.createBrief`, dengan file test/mock/fixture dikecualikan, tidak menemukan pemanggil UI yang menjalankan brief institusi. `InstitutionDirector.tsx` membaca dan memutus brief, tetapi tidak mempunyai submit intake. `LabRun.tsx` menjalankan agent biasa lewat `runLabAgent`, bukan membuat `os_inst_briefs`.

Jalur yang tersedia bila dipanggil oleh kode:

1. `institutionRepository.createBrief()` INSERT `os_inst_briefs`, status default intake.
2. `runBrief()` memanggil `stepBrief()` berulang di browser. Menutup tab menghentikan loop.
3. `stepBrief()` membaca rows, `pipeline.nextAction()` memilih `program_intake`.
4. Cabang `program_intake` memanggil model `evidence-coordinator` melalui `ports.runAgent()` SEBELUM parsing route/estimate dan update brief.
5. `createInstitutionPorts.runAgent()`→`labModel.runLabAgent()`→POST `run-lab-agent`→`checkAppKey()`→agent/provider lookup→boundary→key check→INSERT run→adapter provider.

Karena route/estimate di runner asli muncul setelah model intake, laporan “routing/estimator berjalan, brief kosong, tanpa model call” tidak berasal dari eksekusi lengkap runner ini. Inferensi terbaik: sesi sebelumnya hanya menguji fungsi deterministik atau kode di luar jalur produksi. Ini konsisten dengan tidak adanya submit UI. Tidak dapat memastikan penyebab insiden live tanpa log. Tidak ada bukti timeout Edge sebagai penyebab insiden tersebut.

Kemungkinan tambahan yang ditangani desain: deploy lebih tua, migration tidak applied, request ditolak passphrase, provider key kosong, coordinator internal tidak dapat memakai Kimi, atau provider call gagal. O-01 memeriksa row count/time/error dan O-02 log deploy/function. Bila `briefs=0`, cek request INSERT belum terjadi/ditolak. Bila brief intake ada tetapi run nol, cek invocation/key. Bila run running/error ada, baru cocokkan wall clock/provider failure. Jangan membuat diagnosis pasti dari jumlah nol saja.

Estimator pada P: `full` dengan tujuh department menghitung `2 + 7 + 21 + 21 + 14 + 1 + 4 + 2 + 4 = 76` model calls. Asumsi contoh 9.000 token/call dan $6,00 per 1 juta token menghasilkan 684.000 token dan $4,104. Sumber rumus: `weight.ts:estimate`. Fallback produksi di `institutionPorts.ts` justru 4.000 token/call dan $3,00 per 1 juta token, yaitu $0,912 untuk route yang sama. Angka 89 calls / $4,81 dari brief director tidak dapat direproduksi dari P. Jangan mengganti angka historis itu dengan angka source seolah keduanya pengukuran yang sama. Perbandingan disimpan sebagai baseline terlapor, estimator versi P, dan aktual Hermes secara terpisah.

Bukti P: [`src/logic/institution/runner.ts`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/src/logic/institution/runner.ts) [`src/logic/institution/institutionPorts.ts`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/src/logic/institution/institutionPorts.ts) [`supabase/functions/_shared/institution/pipeline.ts`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/functions/_shared/institution/pipeline.ts) [`supabase/functions/_shared/institution/weight.ts`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/functions/_shared/institution/weight.ts) [`src/data/institutionRepository.ts`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/src/data/institutionRepository.ts) [`src/views/lab/LabRun.tsx`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/src/views/lab/LabRun.tsx) [`src/views/lab/institution/InstitutionDirector.tsx`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/src/views/lab/institution/InstitutionDirector.tsx) [`supabase/functions/run-lab-agent/index.ts`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/functions/run-lab-agent/index.ts)

## R-06. Corpus

Sudah dibangun: `os_inst_corpus` menyimpan text, SHA-256, URL, fetched_at, query, provenance, derived_from, brief/assignment/agent/run IDs. `supabase/functions/institution-tools/index.ts` mempunyai archive pada retrieval dan hasil execution/synthesis. `institutionRepository.listCorpus/getCorpus` serta director room membacanya. Belum ada jaminan semua retrieval Hermes terarsip, karena Hermes belum tersambung. Phase 2 memakai MCP yang menunggu commit archive sebelum mengembalikan content. Log akhir saja tidak cukup.

Bukti P: migration 099/100, [`supabase/functions/institution-tools/index.ts`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/functions/institution-tools/index.ts) [`src/data/institutionRepository.ts`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/src/data/institutionRepository.ts) [`supabase/functions/_shared/institution/provenance.ts`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/functions/_shared/institution/provenance.ts)

## R-07. Committee, debate, eval, director’s room

| Fitur | Keadaan source P | Yang belum terbukti |
|---|---|---|
| Committee | Prompt migration 106, cabang review/reweigh di runner, guard reviewer | Eksekusi live dan staffing |
| Debate | Tabel, parser rebuttal/weighing, runner, batas round | Orkestrasi tahan tab tertutup/reboot |
| Eval | Tabel tugas/expected answer, rubric private, scorer deterministik, runner before/after, UI | Expected answer tidak boleh ikut payload agent. Endpoint worker baru hanya memberi task, tidak keseluruhan row |
| Director’s room | Halaman sudah ada, cost estimate/actual, provenance, reviews/debates, proposal diff, keputusan | Submit institusi dan live run Hermes |

Bukti P: migration 099–107, `runner.ts` cabang `committee_review`, `committee_reweigh`, `runEvaluations`, `promoteWithEvaluations`, dan `InstitutionDirector.tsx`. “Sudah dibangun” di sini berarti source ada, bukan acceptance live sudah lulus.

## R-08. Bot Crossing

The floor sudah lazy-loaded lewat `React.lazy` dalam `src/App.tsx`. Tidak ada route URL literal `/lab/floor` yang diimplementasikan. Navigasi ialah Lab→The floor, state `labView='floor'`. `InstitutionStream` menyimak delapan tabel institusi lewat `postgres_changes`, kemudian mengambil ulang snapshot dan memproyeksikan state. Fastify standalone tidak diperlukan. Phase 4 memperluas projector, bukan membangun kantor baru.

Realtime owner perlu probe: `x-app-key` HTTP bukan JWT claim. Source subscription tidak membuktikan RLS header tersebut tersedia pada Postgres Changes. Data dibaca ulang melalui repository passphrase. Desain memakai polling yang bekerja sejak Phase 1, dan tidak membuka RLS supaya animasi tampak live. O-03 memverifikasi delivery sebagai owner dan collaborator.

Bukti P: [`src/App.tsx`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/src/App.tsx) [`src/views/lab/floor/transport/institutionStream.ts`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/src/views/lab/floor/transport/institutionStream.ts) [`src/views/lab/floor/hud/useInstitutionFloor.ts`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/src/views/lab/floor/hud/useInstitutionFloor.ts) [`src/logic/floor/institution/project.ts`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/src/logic/floor/institution/project.ts)

## R-09. Identitas dan kepemilikan

Lab ini single-owner, berdasarkan passphrase, tanpa `user_id` pada tabel Lab/institusi. Director memakai anon API role plus `x-app-key`, lalu `os_key_valid()` di DB. Kolaborator memakai Supabase Auth JWT dan tabel membership/grant Work. Mengisi owner UUID yang dikarang tidak menyelesaikan akses.

Worker memakai Auth machine user baru yang tidak mempunyai membership, grant Finish Line, passphrase, maupun read-only key. `auth.uid()` dipetakan ke registry private worker, dan hanya RPC sempit yang diberi EXECUTE. SELECT biasa ke Lab/Work/Growth tetap nol baris. Penulisan melalui RPC SECURITY DEFINER menghasilkan rows yang dibaca director melalui RLS lama. RPC tidak meneruskan `x-app-key` sehingga worker tidak bisa approve, publish, promote, atau membaca rubric. UI polling memakai client director yang sudah ada.

Bukti P: [`src/components/PassphraseGate.tsx`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/src/components/PassphraseGate.tsx) [`src/data/supabaseRepository.ts`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/src/data/supabaseRepository.ts) [`supabase/migrations/20260804000037_collab_membership.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260804000037_collab_membership.sql) [`supabase/migrations/20260904000095_finish_line_grants.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260904000095_finish_line_grants.sql) dan schema 073/099. ADR-001 menjelaskan pilihan kredensial.

## R-10. `public` bukan bypass universal

`public` lolos boundary provider untuk agent public. Namun corpus public yang `created_by_agent_id`-nya internal tetap ditolak, begitu juga turunan corpus internal dan brief internal. Kelas agent frozen oleh 092. Klaim brief bahwa semua rows public otomatis lolos seluruh trigger terlalu luas: hash, provenance, proposal, reviewer, status dan FK tetap wajib valid.

Jalur Hermes selalu membuat brief/corpus public dan memakai roster public. Pada Phase 1 buat `lab-researcher` public. Saat director memilih Hermes pada legacy internal agent, RPC owner membuat successor public berprompt sama dengan slug `<slug>-hermes`, mengembalikan ID baru, lalu UI memilih successor tersebut. Tidak mengubah kelas/prompt/history row lama, tidak membawa corpus lama, tidak membuat routing bisnis berdasarkan kelas. Ini adaptasi constraint saat konfigurasi, bukan pilihan provider berdasarkan `data_class`. Phase 2 memetakan seat/lead/committee ke successor public dalam transaksi yang terotorisasi instalasi. Committee prompt disalin byte-for-byte dari versi aktif manusia. ADR-005 menjelaskan batas dan tesnya.

Bukti P: migration 074/092/100, `institution-tools/index.ts:egress`, `supabase/functions/_shared/institution/egress.ts`. Query O-04 menentukan successor yang diperlukan. Trigger lama tidak dihapus.

## R-11. Run log

Satu `os_lab_runs` memuat `id, agent_id, provider_id, parent_run_id, chain_id, step_index, input, output, status, error, tokens_in, tokens_out, cost_usd, duration_ms, created_at, model, refusals`. Status lama `queued|running|ok|error`. Tidak ada lease, heartbeat, attempt, Hermes SHA, tool event, per-run model configuration snapshot, atau cancel durable. Model tersimpan sebagai string hasil resolve pada dispatch. Harga dihitung memakai rate provider pada saat run.

`LabRuns.tsx` menampilkan riwayat/filter/detail, `LabRun.tsx` menampilkan hasil SSE, `labLiveStore` bersifat sementara. Desain menambah job/attempt/event/usage tanpa mengubah arti row lama. Satu attempt memiliki satu run, satu job memiliki maksimal satu hasil sukses yang dipublikasikan. Kegagalan/cancel tetap terlihat sebagai `error` pada UI kompatibilitas lama, dengan kode rinci di job.

Bukti P: migration 073/079/083, [`src/data/labTypes.ts`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/src/data/labTypes.ts) [`src/views/lab/LabRuns.tsx`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/src/views/lab/LabRuns.tsx) [`src/data/labModel.ts`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/src/data/labModel.ts)

## R-12. Secret ter-commit

Pemindaian terarah dilakukan terhadap 732 tracked files pada P dan blobs dalam 328 commit lokal (`git rev-list --all`). Pola: private key, token GitHub, API key provider, secret Supabase baru, JWT yang payload role-nya diperiksa tanpa mencetak token. Temuan: `scripts/probe-password-grant.sh`, jenis JWT `anon` Supabase. Itu kredensial publik client, bukan `service_role`. Tidak ditemukan secret privat terverifikasi melalui pola ini. Tidak ada rotasi wajib hanya karena anon key dipublikasikan.

Cakupan ini bukan bukti matematis tidak ada secret berformat lain, secret eksternal, atau commit yang tidak reachable dari refs yang di-clone. O-05 meminta Fable meninjau secret scanning alert jika tersedia dan memindai artefak build tanpa mencetak nilai. Bila menemukan secret privat, revoke/rotate sebelum deploy, purge salinan runtime lama, kemudian rencana pembersihan history terpisah. Tidak memasukkan nilainya ke PR. Repo publik diperlakukan publik sepanjang desain.

## R-13. Test dan CI

`.github/workflows/ci.yml`: checkout, pnpm/action-setup, Node, frozen install, test, build. `package.json` punya typecheck/test:run/build, tidak ada lint. Suite SQL terpisah: `scripts/institution-tests.sh`, `lab-boundary-tests.sh`, `lab-epistemic-tests.sh`, `role-read-tests.sh`, `grant-scope-tests.sh`. Harness memakai cluster sementara dan stand-in seed, bukan mirror live.

Baseline desain diverifikasi sebagaimana tercatat di `00-README.md`. PR ini hanya docs, JSON Schema, draft SQL. Tidak mengklaim worker telah dibangun, migration telah applied, atau S-01–S-15 telah lulus.

## Lampiran A. Daftar forward migration

Sumber seluruh daftar: tree commit P, direktori `supabase/migrations/`. Down scripts berada di subdirektori `down/`, tidak dijalankan audit.

- `20260724000001_schema.sql`
- `20260724000002_security.sql`
- `20260724000003_seed.sql`
- `20260724000004_hardening.sql`
- `20260724000005_milestone_enrichment.sql`
- `20260724000006_domains.sql`
- `20260724000007_v3_ielts_and_projects.sql`
- `20260724000008_project_working_title_category.sql`
- `20260724000009_scholarship_pathway.sql`
- `20260724000010_date_confidence.sql`
- `20260724000011_auth_attempts.sql`
- `20260724000012_verify_key_lockdown.sql`
- `20260724000013_project_hierarchy.sql`
- `20260724000014_dashboard_pinned.sql`
- `20260724000015_passphrase_recovery.sql`
- `20260724000016_research_pipeline.sql`
- `20260724000017_finance_writing_backlog.sql`
- `20260726000018_research_council.sql`
- `20260726000019_ielts_errors.sql`
- `20260726000020_finish_line_target.sql`
- `20260726000021_finish_line_pack.sql`
- `20260726000025_finish_line_matrix.sql`
- `20260726000026_finish_line_views_v2.sql`
- `20260727000027_ielts_sessions.sql`
- `20260727000028_ielts_errors_drop_revision_of.sql`
- `20260728000029_finish_line_accounts.sql`
- `20260728000030_rls_policy_initplan.sql`
- `20260728000031_record_live_indexes.sql`
- `20260728000032_split_rls_read_write.sql`
- `20260728000033_account_entity_code.sql`
- `20260728000034_read_only_key.sql`
- `20260730000035_model_routing.sql`
- `20260731000036_share_links.sql`
- `20260804000037_collab_membership.sql`
- `20260804000038_project_engagement.sql`
- `20260804000039_cell_attribution.sql`
- `20260804000040_member_policies.sql`
- `20260804000041_write_guard_grants.sql`
- `20260804000042_provision_log.sql`
- `20260804000043_history_note_contents.sql`
- `20260804000044_project_membership.sql`
- `20260804000045_project_policy_replace.sql`
- `20260804000046_tasks_with_history.sql`
- `20260804000047_growth_domain_guard.sql`
- `20260804000048_provision_log_projects.sql`
- `20260804000049_birth_password_guard.sql`
- `20260806000050_samb_process_schema.sql`
- `20260806000051_samb_process_seed.sql`
- `20260806000052_process_entity_aware.sql`
- `20260806000053_arbi_process_seed.sql`
- `20260806000054_process_references.sql`
- `20260806000055_process_text_history.sql`
- `20260806000056_samb_bridge_18b.sql`
- `20260806000057_grant_member_entities_to_anon.sql`
- `20260806000058_process_member_read_policies.sql`
- `20260807000059_mam_kgr_entities.sql`
- `20260807000060_kgr_process_seed.sql`
- `20260807000061_kgr_process_seed_v2.sql`
- `20260807000062_poultry_rows.sql`
- `20260807000063_widen_account_key_and_load_poultry.sql`
- `20260808000064_ielts_prep_surface_schema.sql`
- `20260808000065_ielts_prep_surface_seed.sql`
- `20260808000066_ielts_log_practice_rpc.sql`
- `20260808000067_ielts_topic_criterion_sort_order.sql`
- `20260808000068_ielts_task_achievement_label.sql`
- `20260809000069_text_history_actor.sql`
- `20260809000070_sign_in_log.sql`
- `20260809000071_collab_link_store.sql`
- `20260809000072_collab_link_minted_at.sql`
- `20260817000073_lab_schema.sql`
- `20260817000074_lab_data_boundary.sql`
- `20260817000075_lab_seed.sql`
- `20260817000076_lab_epistemic_schema.sql`
- `20260817000077_lab_epistemic_gates.sql`
- `20260817000078_lab_evidence_agents.sql`
- `20260817000079_lab_hardening.sql`
- `20260817000080_lab_framer_intake.sql`
- `20260817000081_lab_scout_curation.sql`
- `20260817000082_lab_modeler.sql`
- `20260817000083_lab_run_refusals.sql`
- `20260818000084_lab_provider_pins.sql`
- `20260819000085_lab_workflows.sql`
- `20260820000086_process_forms_and_phase_tracks.sql`
- `20260820000087_kgr_retrack_sourcing.sql`
- `20260820000088_kgr_trading_seed.sql`
- `20260827000089_lab_stale_sweep_owner_gate.sql`
- `20260827000090_verify_key_anon_revoke_reapply.sql`
- `20260827000091_lab_stale_sweep_gate_fix_definer_context.sql`
- `20260827000092_lab_public_lane_guards.sql`
- `20260827000093_lab_public_lane_delete.sql`
- `20260903000094_samb_process_v04.sql`
- `20260904000095_finish_line_grants.sql`
- `20260904000096_provision_scope_audit.sql`
- `20260904000097_finish_line_edges_follow_grants.sql`
- `20260904000098_collab_link_status.sql`
- `20260910000099_institution_schema.sql`
- `20260910000100_institution_guards.sql`
- `20260910000101_institution_seed.sql`
- `20260910000102_institution_function_grants.sql`
- `20260910000103_institution_eval_cagr_fix.sql`
- `20260910000104_institution_director_writes.sql`
- `20260910000105_institution_program_office_proposal.sql`
- `20260910000106_institution_committee.sql`
- `20260910000107_institution_director_evals.sql`

## Lampiran B. Inventaris tabel dan kolom dari migrasi

Setiap sumber di bawah pada commit P. Ini deklarasi source, bukan live introspection. Tipe/constraint lengkap ada pada tautan migration. Tambahan kolom setelah CREATE dicantumkan setelah tabel.

| Tabel | Kolom saat CREATE | Sumber P |
|---|---|---|
| `public.os_lab_providers` | `id`, `name`, `adapter`, `base_url`, `model`, `cost_in_per_mtok`, `cost_out_per_mtok`, `is_active`, `created_at`, `updated_at` | [`supabase/migrations/20260817000073_lab_schema.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260817000073_lab_schema.sql) |
| `public.os_lab_agents` | `id`, `slug`, `name`, `description`, `system_prompt`, `data_class`, `default_provider_id`, `version`, `is_active`, `created_at`, `updated_at` | [`supabase/migrations/20260817000073_lab_schema.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260817000073_lab_schema.sql) |
| `public.os_lab_chains` | `id`, `name`, `description`, `steps`, `is_active`, `created_at`, `updated_at` | [`supabase/migrations/20260817000073_lab_schema.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260817000073_lab_schema.sql) |
| `public.os_lab_runs` | `id`, `agent_id`, `provider_id`, `parent_run_id`, `chain_id`, `step_index`, `input`, `output`, `status`, `error`, `tokens_in`, `tokens_out`, `cost_usd`, `duration_ms`, `created_at` | [`supabase/migrations/20260817000073_lab_schema.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260817000073_lab_schema.sql) |
| `public.os_lab_artifacts` | `id`, `run_id`, `filename`, `mime`, `storage_path`, `size_bytes`, `created_at` | [`supabase/migrations/20260817000073_lab_schema.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260817000073_lab_schema.sql) |
| `public.os_lab_projects` | `id`, `name`, `research_question`, `status`, `wip_slot`, `created_at`, `updated_at` | [`supabase/migrations/20260817000076_lab_epistemic_schema.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260817000076_lab_epistemic_schema.sql) |
| `public.os_lab_source_documents` | `id`, `title`, `publisher`, `publication_date`, `doc_type`, `url`, `local_snapshot_path`, `snapshot_hash`, `retrieved_at` | [`supabase/migrations/20260817000076_lab_epistemic_schema.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260817000076_lab_epistemic_schema.sql) |
| `public.os_lab_datapoints` | `id`, `value`, `unit`, `year`, `geography`, `definition_scope`, `source_document_id`, `locator`, `retrieved_at`, `status`, `verification_note`, `verified_at`, `volatility_class`, `extraction_method`, `internal_check_passed`, `created_at` | [`supabase/migrations/20260817000076_lab_epistemic_schema.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260817000076_lab_epistemic_schema.sql) |
| `public.os_lab_datapoint_conflicts` | `id`, `datapoint_a_id`, `datapoint_b_id`, `conflict_type`, `resolution_status`, `resolution_note`, `created_at` | [`supabase/migrations/20260817000076_lab_epistemic_schema.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260817000076_lab_epistemic_schema.sql) |
| `public.os_lab_references` | `id`, `title`, `authors`, `container`, `publication_year`, `doi`, `url`, `verification_level`, `full_text_path`, `created_at` | [`supabase/migrations/20260817000076_lab_epistemic_schema.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260817000076_lab_epistemic_schema.sql) |
| `public.os_lab_commitment_sources` | `id`, `project_id`, `title`, `type`, `committed_at`, `document_path`, `created_at` | [`supabase/migrations/20260817000076_lab_epistemic_schema.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260817000076_lab_epistemic_schema.sql) |
| `public.os_lab_claims` | `id`, `project_id`, `statement`, `layer`, `commitment_source_id`, `evidence_direction`, `status`, `approved_by_human_at`, `created_by_run_id`, `created_at`, `updated_at` | [`supabase/migrations/20260817000076_lab_epistemic_schema.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260817000076_lab_epistemic_schema.sql) |
| `public.os_lab_claim_datapoints` | `claim_id`, `datapoint_id` | [`supabase/migrations/20260817000076_lab_epistemic_schema.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260817000076_lab_epistemic_schema.sql) |
| `public.os_lab_claim_references` | `claim_id`, `reference_id` | [`supabase/migrations/20260817000076_lab_epistemic_schema.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260817000076_lab_epistemic_schema.sql) |
| `public.os_lab_claim_contradictions` | `id`, `claim_a_id`, `claim_b_id`, `severity`, `status`, `resolution_note`, `created_at` | [`supabase/migrations/20260817000076_lab_epistemic_schema.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260817000076_lab_epistemic_schema.sql) |
| `public.os_lab_outputs` | `id`, `project_id`, `output_type`, `content`, `status`, `stale`, `generated_by_run_id`, `created_at`, `updated_at` | [`supabase/migrations/20260817000076_lab_epistemic_schema.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260817000076_lab_epistemic_schema.sql) |
| `public.os_lab_output_claims` | `output_id`, `claim_id` | [`supabase/migrations/20260817000076_lab_epistemic_schema.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260817000076_lab_epistemic_schema.sql) |
| `public.os_lab_tasks` | `id`, `project_id`, `title`, `agent_slug`, `input`, `status`, `detail`, `run_id`, `created_at`, `updated_at` | [`supabase/migrations/20260817000078_lab_evidence_agents.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260817000078_lab_evidence_agents.sql) |
| `public.os_lab_sweep_log` | `id`, `ran_at`, `rows_demoted` | [`supabase/migrations/20260817000079_lab_hardening.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260817000079_lab_hardening.sql) |
| `public.os_lab_questions` | `id`, `project_id`, `raw_statement`, `framed_question`, `framing_source`, `created_at`, `updated_at` | [`supabase/migrations/20260817000080_lab_framer_intake.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260817000080_lab_framer_intake.sql) |
| `public.os_lab_sub_questions` | `id`, `question_id`, `statement`, `falsifier`, `position`, `created_at` | [`supabase/migrations/20260817000080_lab_framer_intake.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260817000080_lab_framer_intake.sql) |
| `public.os_lab_evidence_requirements` | `id`, `sub_question_id`, `description`, `kind`, `satisfied_by_datapoint_id`, `satisfied_by_reference_id`, `satisfied_at`, `created_at` | [`supabase/migrations/20260817000080_lab_framer_intake.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260817000080_lab_framer_intake.sql) |
| `public.os_lab_output_sub_questions` | `output_id`, `sub_question_id` | [`supabase/migrations/20260817000080_lab_framer_intake.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260817000080_lab_framer_intake.sql) |
| `public.os_lab_publisher_tiers` | `id`, `publisher`, `tier`, `created_at` | [`supabase/migrations/20260817000081_lab_scout_curation.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260817000081_lab_scout_curation.sql) |
| `public.os_lab_candidate_sources` | `id`, `project_id`, `title`, `publisher`, `url`, `claimed_date`, `tier`, `status`, `promoted_source_document_id`, `created_by_run_id`, `created_at` | [`supabase/migrations/20260817000081_lab_scout_curation.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260817000081_lab_scout_curation.sql) |
| `public.os_lab_model_specs` | `id`, `project_id`, `name`, `kind`, `spec`, `spec_hash`, `rationale`, `status`, `approved_by_human_at`, `created_by_run_id`, `created_at`, `updated_at` | [`supabase/migrations/20260817000082_lab_modeler.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260817000082_lab_modeler.sql) |
| `public.os_lab_model_spec_params` | `id`, `spec_id`, `name`, `kind`, `datapoint_id`, `value`, `unit`, `justification_reference_id`, `distribution`, `created_at` | [`supabase/migrations/20260817000082_lab_modeler.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260817000082_lab_modeler.sql) |
| `public.os_lab_model_results` | `id`, `spec_id`, `evaluator_version`, `seed`, `result_value`, `result_unit`, `result_summary`, `checks`, `checks_passed`, `sensitivity_passed`, `input_datapoint_ids`, `stale_input`, `external`, `external_note`, `created_at` | [`supabase/migrations/20260817000082_lab_modeler.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260817000082_lab_modeler.sql) |
| `public.os_lab_workflows` | `id`, `name`, `stage_codes`, `is_canonical`, `created_at`, `updated_at` | [`supabase/migrations/20260819000085_lab_workflows.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260819000085_lab_workflows.sql) |
| `public.os_inst_departments` | `id`, `slug`, `name`, `kind`, `purpose`, `accountable_for`, `lead_agent_slug`, `pipeline_order`, `created_at`, `updated_at` | [`supabase/migrations/20260910000099_institution_schema.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260910000099_institution_schema.sql) |
| `public.os_inst_department_members` | `department_id`, `agent_slug`, `role`, `seat_purpose`, `position` | [`supabase/migrations/20260910000099_institution_schema.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260910000099_institution_schema.sql) |
| `public.os_inst_agent_versions` | `id`, `agent_id`, `version`, `system_prompt`, `status`, `proposed_by`, `proposed_by_agent_id`, `rationale`, `diff`, `triggered_by_review_id`, `eval_score_before`, `eval_score_after`, `approved_by`, `approved_at`, `rejected_reason`, `created_at` | [`supabase/migrations/20260910000099_institution_schema.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260910000099_institution_schema.sql) |
| `public.os_inst_briefs` | `id`, `question`, `brief`, `weight_class`, `class_overridden_by_director`, `data_class`, `routing`, `status`, `current_department_slug`, `cost_estimate_usd`, `tokens_estimate`, `cost_actual_usd`, `tokens_actual`, `steps_taken`, `final_output_corpus_id`, `director_decision`, `director_reason`, `decided_at`, `started_at`, `finished_at`, `created_at`, `updated_at` | [`supabase/migrations/20260910000099_institution_schema.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260910000099_institution_schema.sql) |
| `public.os_inst_corpus` | `id`, `kind`, `title`, `data_class`, `content`, `content_hash`, `url`, `http_status`, `fetched_at`, `query`, `provenance`, `derived_from`, `brief_id`, `assignment_id`, `created_by_agent_id`, `created_by_run_id`, `review_status`, `created_at` | [`supabase/migrations/20260910000099_institution_schema.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260910000099_institution_schema.sql) |
| `public.os_inst_assignments` | `id`, `brief_id`, `department_id`, `agent_id`, `agent_slug`, `kind`, `status`, `parent_assignment_id`, `input`, `output`, `output_corpus_id`, `run_id`, `rework_count`, `round`, `refusal_reason`, `detail`, `started_at`, `finished_at`, `created_at`, `updated_at` | [`supabase/migrations/20260910000099_institution_schema.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260910000099_institution_schema.sql) |
| `public.os_inst_reviews` | `id`, `brief_id`, `kind`, `reviewer_agent_id`, `subject_assignment_id`, `subject_submission_id`, `subject_agent_id`, `findings`, `verdict`, `summary`, `round`, `run_id`, `created_at` | [`supabase/migrations/20260910000099_institution_schema.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260910000099_institution_schema.sql) |
| `public.os_inst_submissions` | `id`, `brief_id`, `from_department_id`, `to_department_id`, `to_committee`, `produced`, `rests_on`, `uncertainties`, `exclusions`, `status`, `return_count`, `return_reason`, `lead_assignment_id`, `corpus_id`, `decided_at`, `created_at` | [`supabase/migrations/20260910000099_institution_schema.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260910000099_institution_schema.sql) |
| `public.os_inst_debates` | `id`, `brief_id`, `review_id`, `rebutting_agent_id`, `rebuttal`, `weighing`, `outcome`, `round`, `run_id`, `created_at`, `weighed_at` | [`supabase/migrations/20260910000099_institution_schema.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260910000099_institution_schema.sql) |
| `public.os_inst_evaluations` | `id`, `slug`, `department_slug`, `task`, `expected_answer`, `weight`, `is_active`, `created_at` | [`supabase/migrations/20260910000099_institution_schema.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260910000099_institution_schema.sql) |
| `private.os_inst_evaluation_rubrics` | `evaluation_id`, `rubric`, `created_at` | [`supabase/migrations/20260910000099_institution_schema.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260910000099_institution_schema.sql) |
| `public.os_inst_evaluation_runs` | `id`, `evaluation_id`, `agent_id`, `agent_version_id`, `phase`, `answer`, `score`, `run_id`, `created_at` | [`supabase/migrations/20260910000099_institution_schema.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260910000099_institution_schema.sql) |
| `public.os_inst_egress_blocks` | `id`, `brief_id`, `assignment_id`, `agent_id`, `run_id`, `tool`, `matched_excerpt`, `query_hash`, `created_at` | [`supabase/migrations/20260910000099_institution_schema.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260910000099_institution_schema.sql) |
| `public.os_inst_events` | `id`, `brief_id`, `kind`, `agent_slug`, `department_slug`, `payload`, `created_at` | [`supabase/migrations/20260910000099_institution_schema.sql`](https://github.com/dikagustiana/Dika-s-Personal-OS/blob/2a2e336ff8784c74aa75313532f152b08f6e94c4/supabase/migrations/20260910000099_institution_schema.sql) |

Tambahan kolom: `os_lab_runs.model` (079), `os_lab_runs.refusals` (083), `os_lab_claims.inference_step` (080), `os_lab_source_documents.last_rechecked_at/content_changed_at` (081), `os_lab_evidence_requirements.satisfied_by_model_result_id` (082), `os_lab_projects.workflow_id` (085), `os_lab_agents.authored_by_agent_id/authoring_purpose` (099). Sumber P: forward migration bernomor tersebut dalam Lampiran A. Semua kolom baru rancangan Hermes berada di draft SQL terpisah.
