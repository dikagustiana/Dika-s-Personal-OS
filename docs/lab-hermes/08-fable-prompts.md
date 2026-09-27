# Prompt eksekusi Fable

Keputusan utama: setiap bagian berikut dapat disalin sebagai satu prompt utuh. Source code repo boleh dibaca; dokumen desain lain tidak menjadi prasyarat. Phase 1 sengaja menyertakan kontrak, schema, SQL dan unit agar tidak ada sambungan yang harus ditebak.
## Prompt Phase 0

BEGIN FABLE PHASE 0

Anda Fable, eksekutor build Dika untuk repo github.com/dikagustiana/Dika-s-Personal-OS, Supabase project ascbthsgborseynmmthm dan deploy Vercel Personal OS. Anda tidak punya SSH VPS. Director menjalankan perintah VPS sebagai hermesagent dengan sudo; user runtime lab/hermes-lab/hermes tidak punya sudo. Jangan bertanya atau meminta approval tambahan untuk langkah yang sudah diotorisasi prompt ini. Patuhi proteksi repo yang benar-benar berlaku; jika akses live gagal, lanjutkan pekerjaan build yang tersedia dan tulis probe/kode error yang konkret, bukan mengarang hasil.

Audit dasar: Personal OS P=2a2e336ff8784c74aa75313532f152b08f6e94c4, Vite/React/TS/Tailwind/Zustand, Vercel SPA. Navigasi Lab berupa state, bukan Next.js/router. RLS owner memakai x-app-key/passphrase dan os_key_valid(), bukan owner auth.uid. Collaborator Auth mempunyai grant Work, tidak Lab. Lab rows tidak mempunyai user_id owner. Runner institusi src/logic/institution/runner.ts sudah ada, tetapi tidak dipanggil submit UI produksi pada P. Director room dan floor sudah ada. os_lab_stale_sweep menurunkan datapoint expired, bukan timeout run. Nama biaya briefs ialah cost_estimate_usd/cost_actual_usd. Provider row wajib nyata, check lama hanya anthropic/deepseek/kimi. data_class engine tetap utuh; agent internal frozen dan corpus public dari agent/brief/ancestor internal ditolak.

Hermes pin H=8afaab3703e336d72a72c812dd2dd249f04f166a, NousResearch/hermes-agent. AIAgent constructor/run_conversation + callbacks tersedia. hermes serve ialah desktop JSON-RPC/WS default port 9.119, gateway API /v1 default port 8.642 terpisah. Jangan memakai endpoint yang dikarang. Local terminal/code_execution punya hak Unix user, env scrub bukan sandbox. Memory/curator/session_search/skill mutation harus off. Setiap run proses/home/workspace/session baru. Key model/Supabase hanya worker lab; Hermes hanya capability per-attempt ke broker loopback. Tidak ada service-role VPS, tidak ada port inbound, tidak ada Docker group, tidak mengubah personal Hermes atau Ubuntu 22.04. Semua rows baru yang punya data_class public. Semua artefak public repo tanpa secret/IP VPS/.env.

Baca current checkout dan instruksi repo sebelum edit, catat deviasi dari P. Buat branch build tersendiri untuk phase ini. Jangan ubah file Work/Growth atau semantik auth global. Main tidak di-reset atau force-push. Draft desain tidak boleh diterapkan dengan db push/reset/migration up ke live. Migration baru satu per transaksi lewat akses Supabase yang sudah diotorisasi, setelah test. Bahasa dokumen Indonesia, identifier/code tetap native. Angka prose format Indonesia dan sumber/basis disebut. Anda boleh membaca source code/migration/test repo; prompt ini menyediakan desain tanpa mengharuskan dokumen desain lain.
Tujuan Phase 0: audit live read-only dan menyiapkan input build. Izin tulis hanya docs/lab-hermes/probe-results.md; rotasi secret privat yang terbukti bocor boleh dilakukan pada cloud/provider sesuai brief, tidak mengubah app atau schema. Repo source paling baru menang atas asumsi lama.

Urutan: (1) `git status --short` lalu `git rev-parse HEAD`; output harus checkout bersih dan SHA tercatat, jangan menghapus kerja lain. (2) Catalog to_regclass dahulu; jika tabel ada, jalankan SQL read-only di bawah. Jika tidak ada, tandai prerequisite yang harus dipasang P1, jangan mengeksekusi migration di phase ini. (3) Baca production deployment Vercel git SHA/build stamp dan Functions log run-lab-agent/institution-tools pada 26 September 2026 tanpa body/key. Cari apakah INSERT brief pernah sukses, apakah model invocation terjadi, auth/key/config/provider failure. Route/estimate saja tidak membuktikan timeout. (4) Baca Supabase subscription plan read-only. Jika tidak tersedia, tetap desain acceptance >400 detik sehingga free/paid sama-sama tertangani. (5) Jalankan secret scanner redacted tracked/history, lihat GitHub alerts jika ada. Anon JWT scripts/probe-password-grant.sh bukan private secret. Private secret nyata: revoke/rotate sebelum P1, laporkan path/jenis saja, jangan rewrite history dalam phase ini. (6) Hasil VPS dari director boleh menyusul; asumsi RAM 4 GB, concurrency satu dan home mode 0700, namespace bwrap + fallback systemd telah didesain, bukan menunggu jawaban.

Perintah director Phase 0, masing-masing terpisah pada SSH prompt hermesagent@<host>:~$: `sudo -iu hermes hermes --version`; `sudo -u hermes git -C /home/hermes/.hermes/hermes-agent rev-parse HEAD`; `stat -c "%a %U %G %n" /home/hermes`; `free -h`; `df -h /`; `sudo ufw status numbered`; `sysctl kernel.unprivileged_userns_clone`; `timedatectl status`. Expected versi/SHA, mode700/750, RAM sekitar 4 GB, disk ≥8 GiB bebas, OpenSSH saja, userns=1, clock synchronized. userns=0 di-enable oleh admin P1 atau fallback; jangan upgrade Ubuntu.

Kimi endpoint: gunakan key khusus Lab pada helper getpass P1 untuk GET /v1/models global dan China. Global 200/CN 401 →global; CN 200/global 401 →China; keduanya 200 →billing account dengan saldo; keduanya 401/403 →key/Coding Plan salah, route DeepSeek sementara secara eksplisit. Models 200 bukan bukti saldo. Billing portal global platform.kimi.ai dan China platform.kimi.com menentukan akun saldo. Tidak menyalin OAuth/key personal.

SQL input lengkap:

```sql
-- READ ONLY. Fable menjalankan setiap blok dan menyimpan output teredaksi.
begin transaction read only;
select current_database(), version(), now() as db_time;
select table_schema,table_name,column_name,data_type,is_nullable,column_default
from information_schema.columns where table_schema in ('public','private')
 and (table_name like 'os_lab_%' or table_name like 'os_inst_%')
order by table_schema,table_name,ordinal_position;
select schemaname,tablename,policyname,roles,cmd,qual,with_check
from pg_policies where tablename like 'os_lab_%' or tablename like 'os_inst_%'
order by tablename,policyname;
select n.nspname,c.relname,t.tgname,pg_get_triggerdef(t.oid)
from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
where not t.tgisinternal and (c.relname like 'os_lab_%' or c.relname like 'os_inst_%');
select n.nspname,p.proname,p.prosecdef,p.proconfig,p.proacl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private') and (p.proname like 'os_inst_%' or p.proname like 'os_lab_%');
select 'briefs' as kind,count(*) from public.os_inst_briefs
union all select 'corpus',count(*) from public.os_inst_corpus
union all select 'runs',count(*) from public.os_lab_runs;
select id,question,status,weight_class,created_at,started_at,finished_at,cost_estimate_usd,cost_actual_usd
from public.os_inst_briefs order by created_at desc limit 20;
select id,agent_id,provider_id,status,left(error,200) as error_summary,model,tokens_in,tokens_out,cost_usd,created_at
from public.os_lab_runs order by created_at desc limit 30;
select a.id,a.slug,a.data_class,a.version,a.is_active,
 count(v.id) filter(where v.status='active') as active_versions
from public.os_lab_agents a left join public.os_inst_agent_versions v on v.agent_id=a.id
 group by a.id order by a.slug;
select slug,kind,lead_agent_slug,pipeline_order from public.os_inst_departments order by pipeline_order;
select extname,extversion from pg_extension where extname in ('pg_cron','pg_net','pgcrypto');
select pubname,tablename from pg_publication_tables where pubname='supabase_realtime';
select version,name from supabase_migrations.schema_migrations order by version;
rollback;
-- Plan Supabase, deployment SHA, logs, Auth settings dan secret alerts bukan SQL catalog:
-- O-02/O-05/O-08 memberi probe MCP/dashboard read-only. Jangan SELECT nilai secret.
```

Sebelum selesai: git diff --check, pnpm typecheck, pnpm test:run, pnpm build, SQL/worker tests yang relevan. Jangan mencetak secret. Push branch, buka PR dengan masalah/perubahan/hasil test/risiko, merge/deploy hanya sesuai izin phase dan proteksi repo. Keluaran wajib: commit/PR/deploy/migration receipts, daftar tes benar-benar dijalankan, command director dengan BUILD_SHA konkret bila ada, status acceptance yang belum bisa diamati. Jangan mengklaim acceptance VPS lulus tanpa bukti. Tidak ada pertanyaan keputusan ke director.

END FABLE PHASE 0

## Prompt Phase 1

BEGIN FABLE PHASE 1

Anda Fable, eksekutor build Dika untuk repo github.com/dikagustiana/Dika-s-Personal-OS, Supabase project ascbthsgborseynmmthm dan deploy Vercel Personal OS. Anda tidak punya SSH VPS. Director menjalankan perintah VPS sebagai hermesagent dengan sudo; user runtime lab/hermes-lab/hermes tidak punya sudo. Jangan bertanya atau meminta approval tambahan untuk langkah yang sudah diotorisasi prompt ini. Patuhi proteksi repo yang benar-benar berlaku; jika akses live gagal, lanjutkan pekerjaan build yang tersedia dan tulis probe/kode error yang konkret, bukan mengarang hasil.

Audit dasar: Personal OS P=2a2e336ff8784c74aa75313532f152b08f6e94c4, Vite/React/TS/Tailwind/Zustand, Vercel SPA. Navigasi Lab berupa state, bukan Next.js/router. RLS owner memakai x-app-key/passphrase dan os_key_valid(), bukan owner auth.uid. Collaborator Auth mempunyai grant Work, tidak Lab. Lab rows tidak mempunyai user_id owner. Runner institusi src/logic/institution/runner.ts sudah ada, tetapi tidak dipanggil submit UI produksi pada P. Director room dan floor sudah ada. os_lab_stale_sweep menurunkan datapoint expired, bukan timeout run. Nama biaya briefs ialah cost_estimate_usd/cost_actual_usd. Provider row wajib nyata, check lama hanya anthropic/deepseek/kimi. data_class engine tetap utuh; agent internal frozen dan corpus public dari agent/brief/ancestor internal ditolak.

Hermes pin H=8afaab3703e336d72a72c812dd2dd249f04f166a, NousResearch/hermes-agent. AIAgent constructor/run_conversation + callbacks tersedia. hermes serve ialah desktop JSON-RPC/WS default port 9.119, gateway API /v1 default port 8.642 terpisah. Jangan memakai endpoint yang dikarang. Local terminal/code_execution punya hak Unix user, env scrub bukan sandbox. Memory/curator/session_search/skill mutation harus off. Setiap run proses/home/workspace/session baru. Key model/Supabase hanya worker lab; Hermes hanya capability per-attempt ke broker loopback. Tidak ada service-role VPS, tidak ada port inbound, tidak ada Docker group, tidak mengubah personal Hermes atau Ubuntu 22.04. Semua rows baru yang punya data_class public. Semua artefak public repo tanpa secret/IP VPS/.env.

Baca current checkout dan instruksi repo sebelum edit, catat deviasi dari P. Buat branch build tersendiri untuk phase ini. Jangan ubah file Work/Growth atau semantik auth global. Main tidak di-reset atau force-push. Draft desain tidak boleh diterapkan dengan db push/reset/migration up ke live. Migration baru satu per transaksi lewat akses Supabase yang sudah diotorisasi, setelah test. Bahasa dokumen Indonesia, identifier/code tetap native. Angka prose format Indonesia dan sumber/basis disebut. Anda boleh membaca source code/migration/test repo; prompt ini menyediakan desain tanpa mengharuskan dokumen desain lain.
Tujuan Phase 1: satu public agent lab-researcher, satu assignment specialist_work dan satu job direct. Submit dari UI Lab, Kimi melakukan search/fetch/Python, result unreviewed ke director room existing. Tidak memerlukan committee/eval/floor/proposal atau approval perantara. Semua design berikut wajib menjadi kode yang dapat dijalankan, bukan hanya TODO.

Izin edit: workers/lab-worker/**, workers/hermes-backend/**, ops/lab-vps/**, supabase/functions/lab-worker-enrol/**, supabase/functions/_shared/** untuk helper khusus Lab, migration forward baru, supabase/tests/** dan scripts test Lab. Frontend: src/data/labRepository.ts, labModel.ts, labTypes.ts, institutionRepository.ts, repository interface/adapters terkait Lab; src/store/labLiveStore.ts; src/views/lab/LabRegistry.tsx, LabRun.tsx, LabRuns.tsx, institution/InstitutionDirector.tsx dan komponen/test Lab baru. Package scripts/CI/dependency lock boleh berubah untuk tests. App.tsx/appStore hanya wiring Lab. run-lab-agent hanya dispatch executor/penolakan Nous edge, provider lama tetap. Jangan menyentuh Work/Growth atau menghapus data_class/epistemic guards.

Input: source P/current, Hermes H, schema/RPC/schema JSON dan operasi lengkap yang tertanam di bawah. Harga Kimi global K2.6 input noncache $0,95 per juta token, hit $0,16, output $4,00, context 262.144 token dari https://platform.kimi.ai/docs/pricing/chat.md pada 26 September 2026. China ¥6,50/¥1,10/¥27,00 per juta token, context 262.144 token dari https://platform.kimi.com/docs/pricing/chat.md. Default accounting FX $0,16/CNY adalah asumsi buffer, bukan kurs pasar. Tarik harga resmi ulang saat build; simpan URL/timestamp/snapshot. Bukan harga Nous pada catatan. Seed provider Nous row hanya dengan model/rate config yang benar dan is_active sesuai readiness, tidak memberi provider_id null. Agent route tanpa credential/price jelas not-ready; offline job menunggu.

Urutan implementasi:

1. Probe catalog live read-only dan compare prerequisite 099–107. Buat migration forward baru dari draft SQL tertanam. Perbaiki deviasi berdasar schema aktual, pertahankan existing gates. Public successor untuk legacy internal, initial version snapshot current prompt saja; committee prompt tidak diedit. Tidak ada migration saat menambah agent berikutnya.
2. Pairing Edge: owner meminta one-time code, CLI getpass redeem, Auth admin user tanpa membership, private enabled registry, Auth refresh hanya lab. Revoke registry memutus access JWT lama langsung. Service-role hanya cloud. Expose status/files owner RPC yang tercantum, no generic DB proxy.
3. Worker Python async satu process, concurrency global satu di DB. Lease 60 detik, heartbeat 10 detik, control lima detik, polling dua detik, stop bila DB tak terkonfirmasi selama 20 detik, retry total tiga attempt, backoff 10/30 detik ditambah jitter 0–3 detik. Deadline sejak klaim pertama mencakup retry. Main caps brief 900 detik/20 turn/$2,00, standard 2.700 detik/50 turn/$6,00, full 7.200 detik/90 turn/$12,00; output 4.096/8.192/8.192 token (batas desain). UI boleh override lebih kecil. Proxy semua model/tool paid: reserve upper bound maxcontext×peakinput+maxoutput×peakoutput+cachewrite maksimum SEBELUM setiap actual send. Automatic SDK retry off. Missing usage menahan reservation; cost bukan nol; failover off default, optional per-agent allowed routes dengan cap sama, no edge fallback.
4. Backend loopback port 17.861, broker port 17.862. Import pinned AIAgent proses baru dan capability lokal, tanpa DB creds. Fresh home/workspace tmpfs 512 MiB dan tmp 128 MiB, read-only install/skill/input, private PID/proc, bwrap no host root bind. No writable host path untuk tool. nft UID hermes-lab hanya broker new connection; existing replies boleh. Native web dihapus dari manifest sehingga search/fetch masuk MCP. Keyless Parallel search + public search fallback dari institution-tools dengan fixture nyata; Python/terminal penuh di namespace. Tidak mengaktifkan browser/kanban/delegation/memory/session_search/curator/skill_manage. Exposed exact tool list dan execute_code dispatch guard wajib diuji.
5. Payload context active version+refs+brief/assignment+explicit corpus IDs, tidak expected_answer/rubric atau history reviewer. Tool callbacks untuk events saja, archive dan cost bukan callback observer. Final parse+schema sekali format repair dalam cap, worker mengisi usage/runtime/provenance dari ledger. Finish atomik dan idempoten, one output canonical; stale lease tak bisa finish/spend/archive.
6. UI native shadcn/zinc: executor/provider/model/config per agent, submit brief, queue/running/tool/known+reservedcost/cancel/worker status; polling dua detik via existing passphrase client. Realtime hanya hint, tidak melonggarkan RLS. Menutup tab tidak menghentikan run. Hasil direct masuk director tanpa approve/publish otomatis.
7. Build ops helper dan unit persis kontrak embedded. Installer di systemd transient/tmux, dependency build nonroot, pin root-owned release. Semua command director yang ditunjukkan harus benar-benar tersedia, idempoten, safe redaction, exit codes jelas; jangan menyerahkan placeholder helper. Unit system User=lab/hermes-lab, no user D-Bus. Test fallback namespace jika userns tak tersedia, bukan plain local. Tidak perlu SSH Fable.
8. Verifikasi lokal: pnpm typecheck/test:run/build, existing institution/boundary/epistemic SQL suites plus behavior tests. Python worker/backends tests termasuk token revoke, cross-job corpus denial, simultaneous claim/reservation, duplicate finish/body conflict, forced lease expiry, cancel grandchild, unknown usage, provider429/saldo, fake prompt injection, filesystem/proc/net canary, env scanner negative control. Fixture test pada H tanpa paid calls; VM Ubuntu 22.04 systemd-analyze verify dan sandbox U-tests. Source existing tests: 2.084 kasus lulus di audit, bukan pengganti tes baru.
9. Apply migration baru satu per transaksi melalui cloud, deploy enrol dan UI, buka PR/merge sesuai CI yang berlaku. Publish BUILD_SHA dan release manifest tanpa secrets serta satu perintah per langkah VPS untuk director. Langkah cloud dapat selesai tanpa menunggu VPS; jangan menyatakan system acceptance lulus sebelum director commissioning.
10. Acceptance setelah director memasang: S01 transisi hijau question exact “Uji apakah urutan kebijakan publik → infrastruktur → pembiayaan → pajak karbon berlaku: apakah setiap mata rantai mengikuti mata rantai sebelumnya?” S02 lebih dari 400 detik actual elapsed; jika riset singkat, ordinary test run Python sleep 420 detik dengan terminal timeout 450 detik, job 900 detik, cap $2,00 berlabel probe. S03 claim ≤10 detik saat idle; total queue wait saat busy ditampilkan. S04/S05 scanner zero dan complete, S06 reboot retry bersih/maksimal satu output, S09 agent baru ≤10 menit tanpa migration, S10 config provider tanpa deploy, S11 home personal Permission denied, S12 cap rendah, nol egress, S13 ufw tidak berubah, S14 cancel ≤30 detik. S15 target formal P2 walau live tool sudah ada P1.

Rollback: pause di owner UI, stop backend/worker lewat director, rollback release/UI/Edge commit. Pertahankan DB rows. Tidak fallback ke edge diam-diam dan tidak DROP corpus/queue. Definition selesai build: semua file/helper/tests/SQL/Edge/UI terpasang dengan receipts, director mendapat SHA konkret dan langkah siap pakai, acceptance yang menunggu VPS dilabeli belum diamati. Definition selesai sistem hanya bila acceptance di atas benar-benar lulus.

Kontrak normatif lengkap:
### Kontrak eksekusi tertanam

Keputusan utama: worker memiliki kuasa DB yang sempit; Hermes hanya menerima capability lokal. Lease token dan AuthJWT tidak boleh dimasukkan ke request Hermes, environment child, prompt, MCP result atau transkrip. Semua endpoint `/lab/v1` berikut adalah komponen baru yang harus dibuat Fable, bukan native Hermes.

## Bentuk wire dan authority

Semua JSON UTF-8, UTC RFC3339, UUID random. Batas payload input satu MiB dan hasil dua MiB (desain untuk RAM/database); pagination corpus mencegah input membengkak. Schema normatif: `schemas/job-payload.schema.json`, `agent-config.schema.json`, `result.schema.json`, draft 2020-12, validation format aktif. Schema version tak dikenal ditolak sebelum memanggil model. SQL menegakkan identitas/fencing/constraint; worker juga memvalidasi schema. SQL draft tidak memasang Python, Edge atau UI.

PostgREST: `POST https://<SUPABASE_PROJECT_HOST>/rest/v1/rpc/<name>`, `apikey: <PUBLIC_ANON_KEY>`, `Authorization: Bearer <MACHINE_ACCESS_TOKEN>`, JSON parameter bernama. Nama placeholder bukan nilai secret. Public anon key bukan service-role. Refresh melalui Supabase Auth, simpan refresh token atomic 0600. Tidak memasang `x-app-key` pada worker. UI memakai client passphrase existing. Worker login tidak masuk membership/Finish Line grants.

| RPC | Principal; hasil | Efek dan validasi |
|---|---|---|
| `lab_owner_pair_begin(p_name text)` | owner; `{code,expires_at}` | Kode acak sekali pakai, hash saja di private, sepuluh menit; jangan log result |
| `lab_enrol_consume(p_code text,p_auth_user uuid)` | service_role cloud; worker UUID | Lock pairing row, TTL/unused, bind Auth user, create wake row; tidak bisa dipanggil worker |
| `lab_owner_worker_revoke(p_worker uuid)` | owner; void | Disable registry segera, cancel active lease; tidak cukup hanya revoke refresh token |
| `lab_owner_settings(p_paused boolean,p_daily_limit_usd numeric=null)` | owner; void | Pause claims/reservations dan cancel run; daily enforcement aktif P5 |
| `lab_owner_price(p_route text,p_provider text,p_model text,p_region text,p_price jsonb,p_source text,p_checked timestamptz,p_enabled boolean)` | owner; void | Price snapshot konfigurasi, tak berisi secret; model/context/rate wajib tervalidasi |
| `lab_owner_configure(p_agent_id uuid,p_new_agent jsonb,p_config jsonb)` | owner; agent UUID | Buat public agent/successor, bootstrap current prompt version jika perlu, simpan config. Tidak mengadopsi proposal. Return ID baru harus dipilih UI |
| `lab_owner_files(p_version uuid,p_files jsonb)` | owner; count | Validasi paths/hashes, hanya initial files sebelum versi dipakai job, insert sekali. Existing reference set tak bisa overwrite; perubahan berikutnya via proposal P3 |
| `lab_owner_submit(p_submit_key uuid,p_agent uuid,p_question text,p_weight text='standard')` | owner; `{job_id,brief_id,replay}` | Atomic brief+assignment+job, freeze config/version/price/files. Key sama body sama replay, body beda conflict |
| `lab_owner_run_status(p_job uuid,p_after bigint=0)` | owner; JSON projection | Job, worker online, events cursor paginated, cost known/reserved semua attempt, per-attempt usage; tanpa secret/private auth |
| `lab_owner_cancel(p_job uuid)` | owner; status string | Queued/retry jadi cancelled; running/validating jadi cancel_requested; terminal no-op |
| `lab_worker_claim()` | worker enabled; job row atau null | Lock global, reap lease expired, one active job, SKIP LOCKED, priority ageing. Create attempt/run atomik |
| `lab_worker_heartbeat(p_job uuid=null,p_attempt int=null,p_lease uuid=null,p_runtime_sha text=null)` | worker enabled; `{command,db_now}` | Idle heartbeat atau renew lease; command continue/cancel/timeout. Poll kontrol setiap lima detik, renew maksimum interval sepuluh detik |
| `lab_worker_events(p_job uuid,p_attempt int,p_lease uuid,p_events jsonb)` | lease owner; accepted count | Batch maksimum seratus event, masing-masing empat KiB; unique sequence; scrub payload sebelum kirim |
| `lab_worker_reserve(p_job uuid,p_attempt int,p_lease uuid,p_call uuid,p_route text,p_upper_usd numeric)` | running lease; receipt | Atomic budget check all attempts/daily; call_id unik setiap actual upstream send |
| `lab_worker_settle(p_job uuid,p_attempt int,p_lease uuid,p_call uuid,p_actual_usd numeric,p_usage jsonb)` | worker asal attempt; void | Usage hasil proxy, bukan model. Late settle boleh, final stale tidak. Unknown tidak disettle nol; overrun pause semua |
| `lab_worker_archive(p_job uuid,p_attempt int,p_lease uuid,p_operation uuid,p_record jsonb)` | running lease; corpus UUID | Hash dihitung DB, row public dan atribusi immutable dari job; operation replay aman |
| `lab_worker_read_corpus(p_job uuid,p_attempt int,p_lease uuid,p_corpus uuid)` | lease owner; corpus object | Hanya corpus input snapshot yang sengaja dipilih atau archive attempt sendiri |
| `lab_worker_validating(p_job uuid,p_attempt int,p_lease uuid)` | running lease; void | Runtime sudah berhenti, pindah validating; cancel menang jika lebih dulu |
| `lab_worker_finish(p_job uuid,p_attempt int,p_lease uuid,p_result jsonb)` | validating lease; `{job_id,corpus_id,replay}` | Satu output/assignment/director pointer dalam transaksi, ledger authoritative. P2 insert claims/refs pada transaksi yang sama |
| `lab_worker_fail(p_job uuid,p_attempt int,p_lease uuid,p_code text,p_retryable bool,p_detail text='')` | lease owner; status | Hanya transient allowlist retry, maksimal tiga attempt; failure/cancel reflected di brief/assignment |
| `lab_step_commit(p_brief uuid,p_expected_revision bigint,p_action_key text,p_action jsonb)` | service_role cloud; outbox receipt | Build P2: row lock brief, compare revision, compute/validate nextAction di Edge, action_key unique, create assignment/job atomik. Tidak menerima arbitrary SQL/table/column |
| `lab_worker_propose(p_job uuid,p_attempt int,p_lease uuid,p_proposals jsonb)` | lease owner; proposal UUIDs | Build P3: target self, bukan committee, base version snapshot, diff recompute dan duplicate hash; INSERT proposed saja |

Semua worker RPC memeriksa auth.uid() registry enabled. Definer `search_path=''`, schema-qualified names, revoke PUBLIC/anon/authenticated/service_role dahulu, grant hanya principal yang diperlukan. Tidak menggunakan current_user untuk memeriksa caller. Service-only RPC memeriksa request role GUC selain grant. Projection/files/step/propose ditambahkan Fable sesuai algoritma ini; tidak ada generic “execute SQL” atau “write table” API.

Error DB yang dipetakan worker: `42501` unauthorized/worker_disabled/lease_lost berarti hentikan child dan egress; `idempotency_conflict` permanen; `budget_exceeded`/`daily_budget_exceeded` terminal; `provider_row_missing`/`route_invalid` konfigurasi; transient network retry dengan key sama. Tidak retry semua exception. HTTP enrol 401 kode invalid, 409 already consumed, 429 rate limit, 5xx transient. Teks error tidak berisi request auth/header/provider raw body.

## Pairing Edge

Function `lab-worker-enrol` mempunyai dua aksi terpisah. UI meminta pairing lewat RPC owner. CLI meminta POST `{pairing_code, password, installation_id}`; password acak dibuat lokal, tidak diketik director dan tidak disimpan setelah sign-in. Edge memvalidasi bentuk/size, rate limit, Auth admin createUser email `worker-<random-id>@lab.invalid`, email_confirm=true. Panggil consume RPC. Bila consume gagal, delete Auth user yang baru dibuat sebagai kompensasi. Balas `{worker_id,auth_user_id,email,supabase_url,public_anon_key}`. CLI signInWithPassword ke Auth; simpan refresh token 0600 dan hapus password RAM. Dua redeem bersamaan: satu registry saja, loser user dibersihkan. Edge log hanya installation_id/status. Fable test orphan cleanup dan code reuse. Pairing UI tidak memberi approval per run.

## Payload job dan hasil

`claim()` mengembalikan row job yang berisi payload sesuai schema serta lease metadata. Worker mengambil `payload` untuk perakitan konteks; lease metadata hanya di worker. Agent config default P1:

```json
{"executor":"hermes","route_id":"kimi-global-k2.6","provider":"kimi","model":"kimi-k2.6","endpoint_region":"global","api_mode":"chat_completions","auxiliary":{},"tool_allowlist":["lab.search","lab.fetch","corpus.archive","corpus.read","corpus.assume","terminal","execute_code","read_file","write_file"],"fallback_routes":[],"max_turns":50,"max_output_tokens":8192,"timeout_seconds":2700,"max_cost_usd":6,"provenance_required":false}
```

Tool logical names dipetakan ke exact registered names pada H dan diuji; gagal menemukan satu tool wajib adalah config error, tidak menggunakan `None` atau fallback all-tools. Jangan mengasumsikan tool `file` composite aman tanpa memeriksa isinya. Batas efektif job adalah minimum ceiling config agent dan default weight. UI memperlihatkan batas efektif sebelum submit tanpa dialog approval. Override rendah selalu dihormati; ceiling agent yang lebih tinggi tidak menaikkan default brief/standard. P1 transisi hijau pilih full direct, timeout 7.200 detik, budget $12,00, max turns 90. S-02 harus benar-benar mengerjakan run lebih dari 400 detik, bukan memalsukan duration field.

Output agent minimal `{title,markdown,claims,limitations,skill_proposals}`. Worker membungkusnya menjadi result schema, mengisi provenance, tool_calls, usage, runtime dan error dari pengamatan sendiri. P1 claims boleh kosong; P2 provenance_required mewajibkan minimal satu block, semua factual prose dirender dari blocks, title/headings tidak menambah klaim. Assumption juga corpus kind assumption dengan rationale. `usage.cost_status=partial` bila response usage hilang; unresolved reserve tidak disajikan sebagai actual. Per-call usage disimpan meski job failed/cancelled. Run log biaya per attempt; brief/director agregat semua attempt. Jangan memasukkan seluruh biaya job ulang pada setiap attempt.

## Backend lokal

Bind `127.0.0.1:17861`, header `Authorization: Bearer <BACKEND_CONTROL_TOKEN>` diperiksa constant-time. Token per epoch berada di /run/lab-bridge/control.token, mode 0640 hermes-lab:lab-bridge; worker membacanya, child bwrap tidak melihat file tersebut. Model/MCP broker bind `127.0.0.1:17862` dan memakai capability random per attempt. Capability mempunyai scope job/attempt/expiry/route/budget, bukan Supabase JWT. Token tidak dicetak.

| Endpoint backend | Request | Respons |
|---|---|---|
| GET `/lab/v1/health` | control auth | `{adapter_version,hermes_commit,ready,active_attempt}`; tanpa filesystem/secret |
| POST `/lab/v1/runs` | `{request_id,job_id,attempt,session_id,prompt,input,files,config,proxy_capability,deadline_seconds}` | 202 `{request_id,state:"running"}`; request_id sama body sama replay, conflict 409; active lain 409 busy |
| GET `/lab/v1/runs/{request_id}/events?after=<seq>` | control auth | NDJSON `{seq,kind,at,payload}`; reconnect replay, terminal final envelope; ring buffer + spool worker |
| POST `/lab/v1/runs/{request_id}/keepalive` | control auth; `{db_lease_confirmed:true}` dari worker sesudah RPC heartbeat berhasil | 200; reset watchdog 20 detik. Worker tidak boleh memperbarui pulse bila DB lease belum terkonfirmasi |
| DELETE `/lab/v1/runs/{request_id}` | control auth | 202 stopping atau 200 terminal; revoke capability dahulu; interrupt, grace, kill namespace |

Backend tidak menerima executable path/cwd/argv dari request. Supervisor memilih path dari UUID yang divalidasi, tidak shell-interpolate prompt. Batas ring buffer delapan MiB per attempt (desain); worker drain terus. Overflow stop dengan observability_lost, tidak lanjut research buta. Child stdout JSONL terstruktur; stderr terseleksi; prompt/secret tak ikut journal.

Bentuk invokasi source H, dengan helper adapter baru ditandai jelas:

```python
from run_agent import AIAgent
from toolsets import create_custom_toolset
from model_tools import get_tool_definitions

# resolve_mcp_names, validate_exact_tools, emit, callbacks ialah kode adapter Lab.
exact_names = resolve_mcp_names(job_config["tool_allowlist"])
create_custom_toolset("lab_run", "Tool eksplisit untuk assignment Lab", tools=exact_names)
validate_exact_tools(get_tool_definitions(enabled_toolsets=["lab_run"]), exact_names)
agent = AIAgent(
    provider="custom", api_mode=job_config["api_mode"],
    base_url=proxy_url, api_key=run_capability, model=job_config["model"],
    session_id=session_uuid, enabled_toolsets=["lab_run"],
    skip_memory=True, skip_background_review=True, skip_context_files=True,
    load_soul_identity=False, save_trajectories=False, quiet_mode=True,
    max_iterations=job_config["max_turns"], max_tokens=job_config["max_output_tokens"],
    run_budget_seconds=remaining_seconds, cwd="/workspace",
    tool_start_callback=callbacks.tool_start, tool_complete_callback=callbacks.tool_complete,
    event_callback=callbacks.event, stream_delta_callback=callbacks.delta,
)
raw = agent.run_conversation(user_message=input_json, system_message=assembled_prompt,
                             conversation_history=[], task_id=session_uuid)
# Validate completed/error/interrupt status and final_response. Teks ada != sukses.
emit(normalize_result(raw))
```

Config home attempt: memory off, user profile off, provider memory kosong; auxiliary.background_review.enabled=false, curator.enabled=false; skills project_discovery/inline_shell=false, auto_load/external_dirs empty; no gateway/cron/delegation/session_search. Adapter melakukan preflight mengecek effective config setelah load, bukan hanya menulis YAML. Jika versi pinned tidak menerima custom Anthropic transport, fallback CLI dengan config custom provider dan native api_mode, test fixture sebelum enable route; tidak mengubah ke OpenAI protocol secara diam-diam.

## Model proxy dan MCP

Proxy endpoint `/model/v1/chat/completions` dan `/model/anthropic/v1/messages`. Header capability dipetakan ke frozen route, semua upstream auth dihapus lalu diganti key lab. Tolak request model berbeda, host/URL custom, output cap lebih besar, stream tanpa usage accounting, extra headers/tool forwarding tak dikenal. Disable automatic SDK retries; worker memberi call_id baru pada setiap actual send. Nonstream upstream P1 boleh, UI live melalui events; streaming provider tetap diparse dan usage terminal dicatat. Cost reserve memakai peak max-context upper bound; setelah response trustworthy, settle actual. Error 429 yang secara eksplisit tidak ditagih dapat settle nol dengan error receipt, timeout/connection drop tidak boleh diasumsikan gratis. Unknown reserve mengurangi budget sampai rekonsiliasi.

MCP streamable HTTP `/mcp`, header bearer capability. Implement dengan SDK MCP standar, tanpa endpoint Supabase proxy generik. Catalog:

| Tool | Input | Output dan efek |
|---|---|---|
| `lab.search` | query, max_results ≤10 | sumber/search corpus ID, snippets berlabel; archive response sebelum return |
| `lab.fetch` | URL, purpose | corpus ID, content, hash, URL final, fetched_at; commit sebelum return |
| `corpus.archive` | kind execution/dataset/methodology, content, input IDs, execution metadata | corpus ID/hash; tidak boleh mengaku HTTP retrieval tanpa broker receipt |
| `corpus.read` | corpus ID | content/hash dari allowlist input atau archive attempt |
| `corpus.assume` | statement, rationale | assumption corpus ID; tidak dipresentasikan sebagai temuan web |

Paid search/extract juga reserve/settle ledger dengan route_id tool dan harga per request. Phase 1 default keyless Parallel; bila 429/unavailable, broker memakai implementasi public search yang sudah ada pada institution-tools, endpoint/parse fixture verified sebelum rilis. Bila keduanya gagal, tool error jelas dan run tidak mengaku telah browsing. Full research acceptance membutuhkan minimal search berhasil, fetch berhasil dan Python berhasil.

## Pengemasan yang wajib dibangun Fable

`workers/lab-worker/`: Python service, DB client, provider proxy, MCP, schema validator, CLI `labctl`, budget ledger client dan bounded spool. `workers/hermes-backend/`: supervisor, bwrap launcher, AIAgent/CLI adapters, event normalization, fixtures pada H. `ops/lab-vps/`: root installer/admin helper, system units, nft rule generator, pinned release manifest, rollback, tests. Semua nama command `labctl`/`lab-admin` di 06 adalah deliverable Fable, belum ada pada repo P.

`labctl` subcommands normatif: pair, provider set/probe (getpass, hanya status/redacted codes), status, diagnose, isolation-check, acceptance-probe, pause-local. `lab-admin` subcommands: install-release, verify-install, namespace-check, enable-namespace-fallback, secret-scan, egress-install, egress-remove, rotate-control-token, clean, rollback, backup, restore-check. Jangan menambah prompt approval; helper input secret memakai getpass. Setiap command idempoten, dry-run tersedia untuk root mutations, exit 0=berhasil, nonzero+kode singkat=perlu cabang pemulihan tertulis. Tidak menjalankan shell string dari input model. Root helper tidak setuid; director menjalankan `sudo` manual. Satu pengecualian terbatas ada pada fallback namespace systemd: `ExecStartPre=+... prepare-backend-epoch` membuat direktori/token startup dari argumen tetap tanpa input model. Helper itu root-owned, tidak memberi sudo atau hak memilih command kepada runtime; spesifikasinya ada pada unit fallback di 06.

Deadline job dibekukan saat klaim pertama (`deadline_at`), mencakup retry/backoff. Retry tidak mengulang jatah waktu dari awal. Batas pending antre tidak memakan jatah eksekusi. Proxy menghentikan request baru setelah deadline; backend memakai selisih deadline dengan waktu DB dan monotonic clock. Latensi klaim ketika slot tersedia mengikuti ADR-010.

Worker mengirim keepalive backend setiap lima detik sesudah heartbeat DB berhasil. Supervisor backend membunuh child jika pulse hilang selama 20 detik, termasuk ketika worker crash, sehingga attempt lama tidak hidup sampai retry baru. Watchdog independen dari event callbacks Hermes. Unit backend tidak bergantung pada tab UI atau sesi SSH.

### Keamanan tertanam
# Keamanan dan bukti isolasi

Keputusan utama: jangan menaruh key DB maupun key provider pada runtime yang dapat menjalankan terminal. Worker adalah trusted broker; Hermes beserta konten web diperlakukan sebagai proses yang bisa salah atau dimanipulasi. Kontrol awal mencegah kehilangan data/key dan pengeluaran lepas kendali, tanpa approval per tool/run.

## Principal dan batas kuasa

Director browser punya passphrase owner. Supabase Auth machine user hanya mengenali worker, bukan director. Worker `lab` boleh mengklaim job, membaca konteks terpilih, mengarsip retrieval dan mengirim hasil/proposal untuk job itu. Tidak boleh promote, approve, publish, menulis eval/rubric, membaca Work/Growth, atau memilih resource arbitrary. `hermes-lab` hanya capability lokal per run; `hermes` personal terpisah. Admin `hermesagent` memakai sudo untuk instalasi manual dan tetap dapat membaca file host sebagai root. Tidak berpura-pura melindungi secret dari admin host.

## T-1 sampai T-9

| Ancaman | Kerugian konkret | Mitigasi dan phase | Tes verifikasi |
|---|---|---|---|
| T-1 Prompt injection web → terminal | Menghapus file, membuka koneksi, mencuri konteks | P1 whole-process bwrap, mount hanya workspace/home attempt, runtime read-only, UID egress ke broker saja; tool manifest dan source text sebagai data. P2 semua retrieval broker; no approval per shell | U-01 sumber fixture berisi perintah baca personal/key, curl attacker, tulis /opt. Tool/OS menolak, canary utuh, zero arbitrary egress; output tidak mengaku berhasil |
| T-2 Provider key dicuri agent | Saldo disalahgunakan di luar batas run | P1 key milik lab 0600, runtime tidak mewarisinya; proxy capability scoped dan reservation. H-05 env scrub tidak cukup melawan filesystem/proc. Dedicated provider key + spending cap bila provider mendukung; jika tidak, proxy tetap membatasi Lab, key compromise worker menjadi residual | U-02 enumerasi env/path/proc di namespace tidak menemukan key atau worker Auth token. Capability dipakai ke model/route lain →403; expiry/revocation →401/403. P5 pemisahan proses tool tambahan diuji dengan canary |
| T-3 Lab membaca Hermes personal | Hilangnya independensi dan secret personal | P1 home 0700, Unix user berbeda, parent homes tidak dimount, private /proc; personal tidak masuk grup bridge. Empty deny marker /home/hermes berpermission 000 di namespace memberi EACCES tanpa memasang data personal | U-03 raw Unix access sebagai hermes-lab →Permission denied; run attack sama →denied, tidak mengandung canary. Run B tidak bisa membaca file/session canary run A |
| T-4 Credential worker bocor | Konteks job aktif dan hasil palsu, bukan kuasa director | P1 machine Auth tanpa membership, registry enabled setiap RPC, no app-key, lease fence, per-resource projection. TLS/redacted log/0600. Revoke registry terlebih dahulu, re-enroll, invalidate refresh | U-05 worker JWT direct SELECT Lab/Work/Growth kosong/denied, owner RPC denied, job lain denied; token lama ditolak segera setelah revoke. Worker compromise tetap dapat memalsukan hasil job yang diklaim; review manusia menjaga keputusan akhir |
| T-5 Loop/biaya | Tagihan tak terbatas | P1 max turns/deadline/output + reservation sebelum actual request termasuk retry/auxiliary; manual pause. P5 daily kill switch atomic | U-06 cap $0,001 menolak request sebelum network; synthetic missing usage menahan reserve; race dua reserve tidak melampaui cap; S-12 |
| T-6 Supply chain main/dependency | Update menyisipkan kode dengan akses konteks | Pin H sejak P1, root-owned read-only release; dependencies lock+hash; install deps sebagai nonroot build user hermes-lab; jangan curl installer main saat operasi. P5 staging/rollback | U-07 commit mismatch membuat health not-ready; incompatible fixture release tidak dipromosikan; symlink rollback mengembalikan SHA sebelumnya |
| T-7 Bot Telegram | Token memberi remote command atau spam/exfil | P5 opsional bot khusus notify-only, key worker; no polling/webhook/inbound, fixed chat allowlist, payload status/link tanpa brief content. Tidak memakai bot Hermes personal | U-08 kirim pesan masuk tidak menciptakan job; API command endpoint tidak ada; token revoked tidak mengganggu worker queue |
| T-8 Disk penuh | Host/SSH/DB spool gagal | P1 cap workspace/spool, disk watermark, no symlink cleanup; journals terbatas. P5 backup/retensi; jangan download dataset tak terbatas | U-09 disk fixture low →no claim; active run berhenti sebelum ENOSPC; cleanup hanya receipted paths. Tidak mengisi disk produksi sampai penuh untuk tes |
| T-9 OOM 4 GB | Worker/personals SSH ikut mati | P1 MemoryHigh/Max per unit, TasksMax, concurrency satu, browser off default; swap bersyarat hanya bantalan. Budget source 03, bukan klaim semua tool muat | U-10 memory cgroup fixture kill hanya unit backend, worker hidup, lease terpulihkan, satu output; beban S-02 catat peak RSS/cgroup |

## Inventaris credential

Path ialah target desain, bukan bukti file sudah ada. Semua directory secret mode 0700 kecuali bridge directory 0750. Tidak ada nilai secret dalam repo atau command argument. Secret provider diperlukan di P1 hanya Kimi/alternatif terpilih; opsi lain dibuat bila dipakai.

| Nama secret | Fungsi | Lokasi file | Pemilik Unix | Permission | Bisa membaca | Rotasi |
|---|---|---|---|---|---|---|
| Director app passphrase | Owner DB/UI existing | Browser state existing; hash di Supabase private | Tidak ada di VPS | Sesuai existing | Director; cloud memverifikasi hash | Alur recovery/passphrase existing, tak disalin ke worker |
| SUPABASE_SERVICE_ROLE_KEY | Edge enrol/stepper/scorer existing | Supabase Edge secret store | Tidak ada di VPS | Cloud IAM | Fable melalui akses cloud yang diotorisasi; Edge | Rotate Supabase, deploy secret baru, revoke lama |
| MACHINE_REFRESH_TOKEN | Auth worker | `/var/lib/lab-worker/auth.json` | lab | 0600 | lab, root/hermesagent via sudo | Registry revoke →enroll identitas baru →delete token lama |
| MACHINE_ACCESS_TOKEN | RPC sementara | RAM worker; tak disimpan di journal | lab | Proc beda UID ditolak | lab, root | Refresh Auth; revoke registry memutus segera |
| PAIRING_CODE | Enroll sekali | RAM UI/CLI; hash di DB private | lab hanya selama pair | Tidak persist raw | Director, CLI, Edge selama request | Kedaluwarsa sepuluh menit atau consumed; bikin baru |
| KIMI_API_KEY/KIMI_CN_API_KEY | Model upstream | `/etc/lab-worker/providers.json` | lab | 0600 | lab, root | Buat key khusus baru, atomic replace, probe, revoke lama |
| DEEPSEEK_API_KEY | Model murah | file providers yang sama | lab | 0600 | lab, root | Prosedur sama |
| ANTHROPIC_API_KEY | Route Anthropic opsional | file providers yang sama | lab | 0600 | lab, root | Prosedur sama; tidak mengandalkan Claude subscription |
| NOUS_LAB_AUTH | OAuth/key akun Lab opsional | `/var/lib/lab-worker/nous-auth.json` | lab | 0600 | lab, root | Login akun Lab, revoke token lama; tidak copy personal |
| PARALLEL_API_KEY | Search/extract paid opsional | file providers yang sama | lab | 0600 | lab, root | Rekey; keyless route tidak memerlukan secret ini |
| BACKEND_CONTROL_TOKEN | Worker→backend loopback | `/run/lab-bridge/control.token` | hermes-lab:lab-bridge (root:lab-bridge pada fallback) | 0640 | lab dan hermes-lab supervisor, root; child bwrap tidak melihatnya; fallback hanya epoch aktif | Backend membuat random token baru setiap startup; worker membaca ulang |
| RUN_CAPABILITY | Model/MCP scope attempt | RAM worker/child; config home attempt jika MCP perlu | hermes-lab | 0600, ephemeral | Child/tool dalam run yang sama, worker, root | Revoke saat cancel/finish/lease lost; expiry deadline; tak bisa dipakai Supabase |
| TELEGRAM_NOTIFY_TOKEN | Notify-only P5 | `/etc/lab-worker/telegram.json` | lab | 0600 | lab, root | Revoke via BotFather, fixed new token/chat, no inbound |
| Personal Hermes secrets/OAuth | Runtime personal existing | `/home/hermes/.hermes/` | hermes | home 0700; secrets 0600 | hermes, root | Di luar integrasi; tidak disentuh selain permission isolasi |
| SSH private key admin | Login manual director | Laptop director, bukan repo/VPS runtime | Director Windows | ACL user | Director | Key management SSH existing |

SUPABASE_URL dan public anon key merupakan identifier/public credential client, hanya worker memerlukannya. Keduanya pun tidak dimasukkan ke Hermes supaya tes D-05 sederhana. Secret provider telah dipindahkan keluar home hermes-lab, lebih ketat daripada asumsi awal T-2. File SKILL.md, corpus dan prompt tidak diberi secret.

## Detektor S-04 dan S-05

`lab-admin secret-scan` harus membaca file dan environment sebagai root tanpa mencetak content/value. Mode supabase-in-hermes memeriksa home/state/workspace hermes-lab, env seluruh PID unit backend dan descendants, staged config, serta `/proc/<pid>/environ`. Deteksi assignment key Supabase, access/refresh token yang dicocokkan fingerprint RAM/file worker, JWT decoded `role=service_role`, dan format `sb_secret_`. Mode service-role-all mencakup seluruh `/home`, `/etc`, `/var/lib/lab-worker`, `/var/lib/hermes-lab`, `/opt/lab` dan env process yang dapat dibaca. Output hanya count, jenis, path atau PID/name. Permission/read errors menjadi `scan_incomplete` nonzero, bukan “zero findings”. Test scanner dengan canary sintetis lalu hapus canary. Nol temuan adalah hasil pencarian terdefinisi, bukan bukti formal melawan format secret tak dikenal.

Kredensial worker yang sah di lab tidak dihitung pelanggaran S-04; service-role di mana pun tetap pelanggaran S-05. Jangan menjalankan grep yang mencetak isi `.env`. Fable tidak pernah menyalin service-role untuk memudahkan commissioning.

## Invariant namespace dan egress

Bwrap child melihat read-only `/usr`, `/bin`, `/lib`, `/lib64` yang diperlukan, release Hermes/venv pinned read-only, certificate bundle minimum read-only, `/dev` minimal, private `/proc`, tmpfs `/tmp`, current home/workspace saja. Jangan `--ro-bind / /`: itu membuka seluruh host walau read-only. Tidak bind `/etc` utuh, host `/run`, sibling attempt, worker state, personal home atau SSH. Clear env lalu allowlist PATH/HOME/HERMES_HOME/cache/proxy capability. Private PID namespace dan `--die-with-parent`; kill namespace PID 1 mengakhiri tool grandchildren. Deny marker root-owned mode 000 dibind read-only pada `/home/hermes` untuk uji EACCES.

nftables table `inet lab_egress`: hanya UID hermes-lab, accept established/related, accept NEW IPv4 127.0.0.1 TCP destination 17862, drop NEW lainnya termasuk IPv6/DNS. Tidak mengubah chain inbound ufw atau user lab/hermes/hermesagent. Saat install, backend berhenti agar tidak ada koneksi established lama yang lolos. Proxy menolak SSRF/private redirects dan custom CONNECT. Raw Python/terminal tidak dapat melewati archive atau mengirim key ke internet. Network target per-tool di broker sesuai manifest; modelproxy tidak menyediakan generic HTTP tunnel.

Jika bwrap/user namespaces tidak tersedia, 06 menjelaskan fallback whole-service namespace systemd. Backend fallback hanya satu run per restart dan seluruh writable state RuntimeDirectory ephemeral. KillMode=control-group menghapus semua proses sebelum run berikut. Egress rule dan key-outside-runtime tetap wajib. Tidak kembali ke plain local mode. Fallback control token dapat terlihat oleh proses satu unit; token hanya mengontrol epoch saat itu, egress melarang koneksi child ke backend/control listener, dan worker tidak menerima token itu sebagai Auth/MCP capability. Fable harus menguji replay token lama ditolak saat epoch berubah. Fallback yang gagal U-01–U-04 tidak mengklaim job.

## Data/institusi

Semua class Hermes public, tetapi class bukan policy egress baru. Public successor menutup konflik trigger lama tanpa menghapusnya. Worker tidak mempunyai passphrase, private rubric, expected_answer, atau generic service-role. Prompt committee tidak berubah dari output runtime, termasuk self-proposal. Evaluation task diproyeksikan tanpa jawaban/rubric. Review/submission constraints source tetap menolak self-review. Hasil director room P1 unreviewed, bukan approved/published otomatis.

## Batas write yang keras

Workspace dan home child utama berada di satu tmpfs `/run-state` berukuran 512 MiB, dengan `/workspace` menunjuk `/run-state/workspace`; `/tmp` tmpfs 128 MiB. Angka desain ini bagian MemoryMax backend, bukan RAM tambahan. Bwrap memakai `--size 536870912 --tmpfs /run-state` dan `--size 134217728 --tmpfs /tmp`; skill/input/config yang sudah disaring dibind read-only ke direktori itu. Tidak ada writable host bind pada child. Fallback systemd memakai TemporaryFileSystem dengan size yang sama untuk state/tmp dan `PrivateIPC=yes`; tidak ada persistent writable path pada unit backend fallback; spool hanya di worker lab. Ini mencegah terminal mengisi root disk lebih cepat daripada watchdog lima detik. Tes write besar harus menghasilkan ENOSPC tmpfs atau OOM cgroup yang terkendali, dengan host disk tetap utuh.

Workspace hilang saat namespace mati; hasil yang diperlukan diarsip melalui MCP selama run. Bundel diagnostic gagal hanya metadata/log teredaksi yang sudah diterima worker, bukan jaminan seluruh filesystem gagal dapat diselamatkan. Retensi 24 jam/total empat GiB pada 03 berlaku pada bundel dan spool supervisor, tidak membenarkan writable host mount kepada tool. Parent/supervisor tidak boleh menerima arbitrary file path dari model untuk disalin ke host.

### Schema agent-config

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://personal-os.dikagustiana.com/schemas/lab-hermes/agent-config-v1.json",
  "type": "object",
  "properties": {
    "executor": {
      "const": "hermes"
    },
    "route_id": {
      "type": "string",
      "minLength": 1
    },
    "provider": {
      "enum": [
        "kimi",
        "deepseek",
        "anthropic",
        "nous"
      ]
    },
    "model": {
      "type": "string",
      "minLength": 1
    },
    "endpoint_region": {
      "enum": [
        "global",
        "china",
        "direct",
        "nous"
      ]
    },
    "api_mode": {
      "enum": [
        "chat_completions",
        "anthropic_messages"
      ]
    },
    "auxiliary": {
      "type": "object",
      "additionalProperties": {
        "type": [
          "string",
          "null"
        ]
      }
    },
    "tool_allowlist": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "uniqueItems": true,
      "minItems": 1
    },
    "fallback_routes": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "max_turns": {
      "type": "integer",
      "minimum": 1,
      "maximum": 90
    },
    "max_output_tokens": {
      "type": "integer",
      "minimum": 1,
      "maximum": 8192
    },
    "timeout_seconds": {
      "type": "integer",
      "minimum": 1,
      "maximum": 7200
    },
    "max_cost_usd": {
      "type": "number",
      "exclusiveMinimum": 0
    },
    "provenance_required": {
      "type": "boolean"
    }
  },
  "required": [
    "executor",
    "route_id",
    "provider",
    "model",
    "endpoint_region",
    "api_mode",
    "auxiliary",
    "tool_allowlist",
    "fallback_routes",
    "max_turns",
    "max_output_tokens",
    "timeout_seconds",
    "max_cost_usd",
    "provenance_required"
  ],
  "additionalProperties": false
}
```

### Schema job-payload

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://personal-os.dikagustiana.com/schemas/lab-hermes/job-payload-v1.json",
  "type": "object",
  "properties": {
    "schema_version": {
      "const": "1"
    },
    "agent": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid"
        },
        "slug": {
          "type": "string"
        },
        "version_id": {
          "type": "string",
          "format": "uuid"
        },
        "system_prompt": {
          "type": "string",
          "minLength": 1
        },
        "files": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "path": {
                "type": "string",
                "pattern": "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))(?!.*\\\\).+$"
              },
              "content": {
                "type": "string"
              },
              "sha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              }
            },
            "required": [
              "path",
              "content",
              "sha256"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "id",
        "slug",
        "version_id",
        "system_prompt",
        "files"
      ],
      "additionalProperties": false
    },
    "config": {
      "type": "object",
      "properties": {
        "executor": {
          "const": "hermes"
        },
        "route_id": {
          "type": "string",
          "minLength": 1
        },
        "provider": {
          "enum": [
            "kimi",
            "deepseek",
            "anthropic",
            "nous"
          ]
        },
        "model": {
          "type": "string",
          "minLength": 1
        },
        "endpoint_region": {
          "enum": [
            "global",
            "china",
            "direct",
            "nous"
          ]
        },
        "api_mode": {
          "enum": [
            "chat_completions",
            "anthropic_messages"
          ]
        },
        "auxiliary": {
          "type": "object",
          "additionalProperties": {
            "type": [
              "string",
              "null"
            ]
          }
        },
        "tool_allowlist": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "uniqueItems": true,
          "minItems": 1
        },
        "fallback_routes": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "max_turns": {
          "type": "integer",
          "minimum": 1,
          "maximum": 90
        },
        "max_output_tokens": {
          "type": "integer",
          "minimum": 1,
          "maximum": 8192
        },
        "timeout_seconds": {
          "type": "integer",
          "minimum": 1,
          "maximum": 7200
        },
        "max_cost_usd": {
          "type": "number",
          "exclusiveMinimum": 0
        },
        "provenance_required": {
          "type": "boolean"
        }
      },
      "required": [
        "executor",
        "route_id",
        "provider",
        "model",
        "endpoint_region",
        "api_mode",
        "auxiliary",
        "tool_allowlist",
        "fallback_routes",
        "max_turns",
        "max_output_tokens",
        "timeout_seconds",
        "max_cost_usd",
        "provenance_required"
      ],
      "additionalProperties": false
    },
    "price": {
      "type": "object",
      "properties": {
        "route_id": {
          "type": "string"
        },
        "provider": {
          "type": "string"
        },
        "model": {
          "type": "string"
        },
        "region": {
          "type": "string"
        },
        "price": {
          "type": "object",
          "properties": {
            "currency": {
              "enum": [
                "USD",
                "CNY"
              ]
            },
            "max_context_tokens": {
              "type": "integer",
              "minimum": 1
            },
            "input_usd_per_million": {
              "type": "number",
              "minimum": 0
            },
            "output_usd_per_million": {
              "type": "number",
              "minimum": 0
            },
            "cache_hit_usd_per_million": {
              "type": "number",
              "minimum": 0
            },
            "cache_write_usd_per_million": {
              "type": "number",
              "minimum": 0
            },
            "fx_usd_per_native": {
              "type": "number",
              "exclusiveMinimum": 0
            }
          },
          "required": [
            "currency",
            "max_context_tokens",
            "input_usd_per_million",
            "output_usd_per_million",
            "cache_hit_usd_per_million",
            "cache_write_usd_per_million",
            "fx_usd_per_native"
          ],
          "additionalProperties": true
        },
        "source_url": {
          "type": "string",
          "format": "uri"
        },
        "checked_at": {
          "type": "string",
          "format": "date-time"
        },
        "enabled": {
          "const": true
        }
      },
      "required": [
        "route_id",
        "provider",
        "model",
        "region",
        "price",
        "source_url",
        "checked_at",
        "enabled"
      ],
      "additionalProperties": false
    },
    "input": {
      "type": "object",
      "properties": {
        "question": {
          "type": "string",
          "minLength": 8,
          "maxLength": 32000
        },
        "brief_id": {
          "type": "string",
          "format": "uuid"
        },
        "assignment_id": {
          "type": "string",
          "format": "uuid"
        },
        "corpus_ids": {
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid"
          }
        }
      },
      "required": [
        "question",
        "brief_id",
        "assignment_id",
        "corpus_ids"
      ],
      "additionalProperties": false
    }
  },
  "required": [
    "schema_version",
    "agent",
    "config",
    "price",
    "input"
  ],
  "additionalProperties": false
}
```

### Schema result

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://personal-os.dikagustiana.com/schemas/lab-hermes/result-v1.json",
  "type": "object",
  "properties": {
    "schema_version": {
      "const": "1"
    },
    "job_id": {
      "type": "string",
      "format": "uuid"
    },
    "attempt": {
      "type": "integer",
      "minimum": 1,
      "maximum": 3
    },
    "status": {
      "enum": [
        "succeeded",
        "failed",
        "cancelled",
        "timed_out",
        "budget_exceeded"
      ]
    },
    "output": {
      "type": "object",
      "properties": {
        "title": {
          "type": "string"
        },
        "markdown": {
          "type": "string"
        },
        "claims": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string",
                "pattern": "^[a-zA-Z0-9_-]+$"
              },
              "text": {
                "type": "string",
                "minLength": 1
              },
              "kind": {
                "enum": [
                  "fact",
                  "inference",
                  "assumption"
                ]
              },
              "corpus_refs": {
                "type": "array",
                "items": {
                  "type": "string",
                  "format": "uuid"
                },
                "minItems": 1,
                "uniqueItems": true
              }
            },
            "required": [
              "id",
              "text",
              "kind",
              "corpus_refs"
            ],
            "additionalProperties": false
          }
        },
        "limitations": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "title",
        "markdown",
        "claims",
        "limitations"
      ],
      "additionalProperties": false
    },
    "provenance": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "corpus_id": {
            "type": "string",
            "format": "uuid"
          },
          "kind": {
            "enum": [
              "retrieval",
              "dataset",
              "methodology",
              "execution",
              "assumption",
              "output",
              "submission"
            ]
          },
          "source": {
            "type": "string"
          },
          "url": {
            "type": [
              "string",
              "null"
            ],
            "format": "uri"
          },
          "fetched_at": {
            "anyOf": [
              {
                "type": "string",
                "format": "date-time"
              },
              {
                "type": "null"
              }
            ]
          },
          "content_hash": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          },
          "raw_content_hash": {
            "anyOf": [
              {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              {
                "type": "null"
              }
            ]
          },
          "locator": {
            "type": "string"
          }
        },
        "required": [
          "corpus_id",
          "kind",
          "source",
          "url",
          "fetched_at",
          "content_hash",
          "raw_content_hash",
          "locator"
        ],
        "additionalProperties": false
      }
    },
    "tool_calls": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "event_id": {
            "type": "integer"
          },
          "call_id": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "started_at": {
            "type": "string",
            "format": "date-time"
          },
          "finished_at": {
            "anyOf": [
              {
                "type": "string",
                "format": "date-time"
              },
              {
                "type": "null"
              }
            ]
          },
          "status": {
            "enum": [
              "ok",
              "error",
              "cancelled"
            ]
          },
          "corpus_ids": {
            "type": "array",
            "items": {
              "type": "string",
              "format": "uuid"
            }
          }
        },
        "required": [
          "event_id",
          "call_id",
          "name",
          "started_at",
          "finished_at",
          "status",
          "corpus_ids"
        ],
        "additionalProperties": false
      }
    },
    "usage": {
      "type": "object",
      "properties": {
        "input_tokens": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 0
        },
        "output_tokens": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 0
        },
        "cache_read_tokens": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 0
        },
        "cache_write_tokens": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 0
        },
        "known_cost_usd": {
          "type": "number",
          "minimum": 0
        },
        "unresolved_reserved_usd": {
          "type": "number",
          "minimum": 0
        },
        "cost_status": {
          "enum": [
            "calculated",
            "partial",
            "reconciled"
          ]
        },
        "price_route_id": {
          "type": "string"
        },
        "native_currency": {
          "enum": [
            "USD",
            "CNY"
          ]
        },
        "native_cost": {
          "type": [
            "number",
            "null"
          ],
          "minimum": 0
        },
        "fx_usd_per_native": {
          "type": "number",
          "exclusiveMinimum": 0
        }
      },
      "required": [
        "input_tokens",
        "output_tokens",
        "cache_read_tokens",
        "cache_write_tokens",
        "known_cost_usd",
        "unresolved_reserved_usd",
        "cost_status",
        "price_route_id",
        "native_currency",
        "native_cost",
        "fx_usd_per_native"
      ],
      "additionalProperties": false
    },
    "runtime": {
      "type": "object",
      "properties": {
        "hermes_commit": {
          "type": "string",
          "pattern": "^[a-f0-9]{40}$"
        },
        "adapter_version": {
          "type": "string"
        },
        "session_id": {
          "type": "string",
          "format": "uuid"
        },
        "provider": {
          "type": "string"
        },
        "model": {
          "type": "string"
        },
        "started_at": {
          "type": "string",
          "format": "date-time"
        },
        "finished_at": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "hermes_commit",
        "adapter_version",
        "session_id",
        "provider",
        "model",
        "started_at",
        "finished_at"
      ],
      "additionalProperties": false
    },
    "error": {
      "anyOf": [
        {
          "type": "null"
        },
        {
          "type": "object",
          "properties": {
            "code": {
              "type": "string"
            },
            "message": {
              "type": "string"
            },
            "retryable": {
              "type": "boolean"
            }
          },
          "required": [
            "code",
            "message",
            "retryable"
          ],
          "additionalProperties": false
        }
      ]
    },
    "skill_proposals": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "target_agent_id": {
            "type": "string",
            "format": "uuid"
          },
          "base_version_id": {
            "type": "string",
            "format": "uuid"
          },
          "rationale": {
            "type": "string",
            "minLength": 10
          },
          "proposed_prompt": {
            "type": "string",
            "minLength": 1
          },
          "reference_files": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "path": {
                  "type": "string",
                  "pattern": "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))(?!.*\\\\).+$"
                },
                "content": {
                  "type": "string"
                },
                "sha256": {
                  "type": "string",
                  "pattern": "^[a-f0-9]{64}$"
                }
              },
              "required": [
                "path",
                "content",
                "sha256"
              ],
              "additionalProperties": false
            }
          }
        },
        "required": [
          "target_agent_id",
          "base_version_id",
          "rationale",
          "proposed_prompt",
          "reference_files"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "schema_version",
    "job_id",
    "attempt",
    "status",
    "output",
    "provenance",
    "tool_calls",
    "usage",
    "runtime",
    "error",
    "skill_proposals"
  ],
  "additionalProperties": false
}
```

### Draft input 001-queue-schema.sql

```sql
-- DRAFT PHASE 1. Bukan migration auto-apply. Prasyarat schema P 099-107 terverifikasi.
begin;
create schema if not exists lab_private;
revoke all on schema lab_private from public,anon,authenticated;

alter table public.os_lab_agents add column if not exists executor text not null default 'edge'
 check (executor in ('edge','hermes'));
-- Menambah nama provider, bukan menghapus boundary data_class. Provider ID tetap wajib nyata.
alter table public.os_lab_providers drop constraint if exists os_lab_providers_name_check;
alter table public.os_lab_providers add constraint os_lab_providers_name_check
 check(name in ('anthropic','deepseek','kimi','nous'));

create table public.os_lab_agent_execution (
 agent_id uuid primary key references public.os_lab_agents(id),
 config jsonb not null check(jsonb_typeof(config)='object'),
 updated_at timestamptz not null default now()
);
create table public.os_lab_agent_files (
 version_id uuid not null references public.os_inst_agent_versions(id),
 path text not null check(path !~ '(^/|(^|/)\.\.(/|$))' and path !~ '[\\]'),
 content text not null,
 content_hash text not null default '' check(content_hash ~ '^[a-f0-9]{64}$'),
 primary key(version_id,path)
);
create function lab_private.file_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op<>'INSERT' then raise exception 'reference_immutable'; end if;
 new.content_hash:=encode(sha256(convert_to(new.content,'UTF8')),'hex');
 return new;
end $$;
create trigger lab_file_guard before insert or update or delete on public.os_lab_agent_files
for each row execute function lab_private.file_guard();
create table public.os_lab_model_prices (
 route_id text primary key,
 provider text not null check(provider in ('kimi','deepseek','anthropic','nous')),
 model text not null, region text not null,
 price jsonb not null, source_url text not null check(source_url like 'https://%'),
 checked_at timestamptz not null, enabled boolean not null default false
);
create table lab_private.workers (
 id uuid primary key default gen_random_uuid(),
 auth_user_id uuid not null unique references auth.users(id),
 name text not null, enabled boolean not null default true,
 last_seen_at timestamptz, runtime_sha text, capabilities jsonb not null default '{}'
);
create table lab_private.agent_successors (
 legacy_id uuid primary key references public.os_lab_agents(id),
 successor_id uuid not null unique references public.os_lab_agents(id)
);
create table lab_private.pairings (
 code_hash text primary key, name text not null, expires_at timestamptz not null,
 consumed_at timestamptz, worker_id uuid
);
create table lab_private.settings (
 singleton boolean primary key default true check(singleton),
 paused boolean not null default false,
 concurrency integer not null default 1 check(concurrency=1),
 enforce_daily boolean not null default false,
 daily_limit_usd numeric(16,8) not null default 20 check(daily_limit_usd>0)
);
insert into lab_private.settings(singleton) values(true);
create table public.os_lab_worker_status (
 worker_id uuid primary key references lab_private.workers(id),
 name text not null,last_seen_at timestamptz not null,runtime_sha text,
 active_job_id uuid, health text not null default 'online'
);
-- Hint tanpa payload Lab; SELECT own-row JWT hanya di tabel ini.
create table public.os_lab_worker_wake (
 auth_user_id uuid primary key references auth.users(id),
 revision bigint not null default 0,changed_at timestamptz not null default now()
);
create table public.os_lab_hermes_jobs (
 id uuid primary key default gen_random_uuid(),
 submit_key uuid not null unique, submit_hash text not null,
 brief_id uuid not null references public.os_inst_briefs(id),
 assignment_id uuid not null references public.os_inst_assignments(id),
 agent_id uuid not null references public.os_lab_agents(id),
 payload jsonb not null,
 weight_class text not null check(weight_class in ('brief','standard','full')),
 mode text not null default 'direct' check(mode in ('direct','institution')),
 status text not null default 'queued' check(status in
 ('queued','running','validating','retry_wait','cancel_requested','succeeded','failed','cancelled','timed_out','budget_exceeded')),
 attempt integer not null default 0 check(attempt between 0 and 3),
 worker_id uuid references lab_private.workers(id),lease_token uuid,lease_until timestamptz,
 run_id uuid references public.os_lab_runs(id),
 created_at timestamptz not null default now(),claimed_at timestamptz,attempt_started_at timestamptz,deadline_at timestamptz,
 available_at timestamptz not null default now(),finished_at timestamptz,
 result_hash text,result jsonb,final_corpus_id uuid references public.os_inst_corpus(id),error jsonb,
 max_cost_usd numeric(16,8) not null check(max_cost_usd>0),
 timeout_seconds integer not null check(timeout_seconds between 1 and 7200)
);
create index os_lab_hermes_jobs_claim_idx on public.os_lab_hermes_jobs(status,available_at,created_at);
create table public.os_lab_hermes_attempts (
 job_id uuid not null references public.os_lab_hermes_jobs(id),attempt integer not null,
 worker_id uuid not null references lab_private.workers(id),lease_token uuid not null unique,
 run_id uuid not null unique references public.os_lab_runs(id),
 started_at timestamptz not null default now(),finished_at timestamptz,status text not null,
 primary key(job_id,attempt)
);
create table public.os_lab_hermes_events (
 id bigint generated always as identity primary key,
 job_id uuid not null references public.os_lab_hermes_jobs(id),attempt integer not null,
 sequence bigint not null,kind text not null,
 emitted_at timestamptz not null,received_at timestamptz not null default now(),
 payload jsonb not null default '{}',unique(job_id,attempt,sequence)
);
create table lab_private.usage_ledger (
 job_id uuid not null references public.os_lab_hermes_jobs(id),attempt integer not null,
 call_id uuid not null,route_id text not null,
 reserved_usd numeric(16,8) not null check(reserved_usd>0),
 actual_usd numeric(16,8) check(actual_usd>=0),
 usage jsonb,created_at timestamptz not null default now(),settled_at timestamptz,
 primary key(job_id,attempt,call_id)
);
create table lab_private.archives (
 job_id uuid not null references public.os_lab_hermes_jobs(id),attempt integer not null,
 operation_id uuid not null,body_hash text not null,corpus_id uuid not null references public.os_inst_corpus(id),
 primary key(job_id,attempt,operation_id)
);
-- Semua data operasional baru hanya director; worker membaca melalui RPC.
do $block$
declare n text;
begin
 foreach n in array array['os_lab_agent_execution','os_lab_agent_files','os_lab_model_prices','os_lab_worker_status',
  'os_lab_hermes_jobs','os_lab_hermes_attempts','os_lab_hermes_events'] loop
  execute format('alter table public.%I enable row level security',n);
  execute format('revoke all on public.%I from public,anon,authenticated',n);
  execute format('grant select on public.%I to anon,authenticated',n);
  execute format('create policy director_select on public.%I for select to anon,authenticated using(public.os_key_valid())',n);
 end loop;
end $block$;
alter table public.os_lab_worker_wake enable row level security;
revoke all on public.os_lab_worker_wake from public,anon,authenticated;
grant select on public.os_lab_worker_wake to authenticated;
create policy worker_wake_select on public.os_lab_worker_wake for select to authenticated
 using(auth_user_id=auth.uid());
-- Jangan tambah tabel berpayload ke publikasi tanpa RLS. Wake opsional dan aman tanpa publikasi.
do $block$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.os_lab_worker_wake;
 end if;
end $block$;
commit;
```

### Draft input 002-queue-rpc.sql

```sql
-- DRAFT PHASE 1: queue + owner RPC. Adapter, Edge enrol, schema validators dan UI masih build Fable.
-- Menjalankan SQL saja tidak membangun sistem. Uji terhadap live schema probe dahulu.
begin;
create function lab_private.worker_id() returns uuid language plpgsql security definer set search_path='' as $$
declare w uuid;
begin
 select id into w from lab_private.workers where auth_user_id=auth.uid() and enabled;
 if w is null then raise exception 'worker_disabled' using errcode='42501'; end if;
 return w;
end $$;
create function lab_private.lock_job(p_job uuid,p_attempt integer,p_lease uuid)
returns public.os_lab_hermes_jobs language plpgsql security definer set search_path='' as $$
declare j public.os_lab_hermes_jobs; w uuid:=lab_private.worker_id();
begin
 select * into j from public.os_lab_hermes_jobs where id=p_job for update;
 if not found or j.worker_id is distinct from w or j.attempt is distinct from p_attempt
 or j.lease_token is distinct from p_lease or j.lease_until<=clock_timestamp()
 or j.status not in ('running','validating','cancel_requested') then
  raise exception 'lease_lost' using errcode='42501'; end if;
 return j;
end $$;
create function lab_private.refresh_usage(p_job uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.os_lab_runs r set cost_usd=u.cost,tokens_in=u.tin,tokens_out=u.tout
 from (select a.run_id,sum(l.actual_usd) cost,sum((l.usage->>'input_tokens')::int) tin,sum((l.usage->>'output_tokens')::int) tout
 from public.os_lab_hermes_attempts a left join lab_private.usage_ledger l on l.job_id=a.job_id and l.attempt=a.attempt
 where a.job_id=p_job group by a.run_id) u where r.id=u.run_id;
 update public.os_inst_briefs b set cost_actual_usd=u.cost,tokens_actual=u.tokens
 from (select j.brief_id,coalesce(sum(l.actual_usd),0) cost,
 coalesce(sum(coalesce((l.usage->>'input_tokens')::bigint,0)+coalesce((l.usage->>'output_tokens')::bigint,0)),0) tokens
 from public.os_lab_hermes_jobs j left join lab_private.usage_ledger l on l.job_id=j.id
 where j.brief_id=(select brief_id from public.os_lab_hermes_jobs where id=p_job) group by j.brief_id) u
 where b.id=u.brief_id;
end $$;
create function public.lab_worker_claim() returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid:=lab_private.worker_id(); j public.os_lab_hermes_jobs; r uuid; p uuid; expired record;
begin
 perform pg_advisory_xact_lock(7192601);
 -- Reap, termasuk cancel; DB clock, bukan timestamp yang dikirim worker.
 for expired in select * from public.os_lab_hermes_jobs where status in ('running','validating','cancel_requested')
 and lease_until<=clock_timestamp() for update loop
  update public.os_lab_runs set status='error',error='lease_expired' where id=expired.run_id;
  update public.os_lab_hermes_attempts set status='lease_expired',finished_at=now()
   where job_id=expired.id and attempt=expired.attempt;
  update public.os_lab_hermes_jobs set status=case when expired.status='cancel_requested' then 'cancelled'
   when expired.attempt>=3 then 'failed' else 'retry_wait' end,
   available_at=now()+case when expired.attempt=1 then interval '10 seconds' else interval '30 seconds' end,
   finished_at=case when expired.status='cancel_requested' or expired.attempt>=3 then now() else null end,
   lease_until=null,error=jsonb_build_object('code','lease_expired') where id=expired.id;
  if expired.status='cancel_requested' or expired.attempt>=3 then
   update public.os_inst_assignments set status='failed',finished_at=now() where id=expired.assignment_id;
   if expired.mode='direct' then
    update public.os_inst_briefs set status=case when expired.status='cancel_requested' then 'paused' else 'failed' end,
    finished_at=now() where id=expired.brief_id;
   end if;
  end if;
 end loop;
 if (select paused from lab_private.settings) then return null; end if;
 if exists(select 1 from public.os_lab_hermes_jobs where status in ('running','validating','cancel_requested')) then return null; end if;
 if (select enforce_daily from lab_private.settings) and
  (select coalesce(sum(coalesce(actual_usd,reserved_usd)),0) from lab_private.usage_ledger
   where created_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC' or actual_usd is null)
  >= (select daily_limit_usd from lab_private.settings) then return null; end if;
 select * into j from public.os_lab_hermes_jobs where status in ('queued','retry_wait') and available_at<=now()
 order by greatest(0,(case weight_class when 'brief' then 0 when 'standard' then 1 else 2 end)
 - floor(extract(epoch from (now()-created_at))/300)::integer),created_at,id
 for update skip locked limit 1;
 if not found then return null; end if;
 if j.deadline_at is not null and j.deadline_at<=clock_timestamp() then
  update public.os_lab_hermes_jobs set status='timed_out',finished_at=now() where id=j.id;
  update public.os_inst_assignments set status='failed',finished_at=now() where id=j.assignment_id;
  if j.mode='direct' then update public.os_inst_briefs set status='failed',finished_at=now() where id=j.brief_id; end if;
  return null;
 end if;
 select id into p from public.os_lab_providers where name=j.payload#>>'{config,provider}';
 if p is null then raise exception 'provider_row_missing'; end if;
 insert into public.os_lab_runs(agent_id,provider_id,input,status,model)
 values(j.agent_id,p,j.payload#>>'{input,question}','running',j.payload#>>'{config,model}') returning id into r;
 update public.os_lab_hermes_jobs set status='running',attempt=attempt+1,worker_id=w,
 lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds',
 claimed_at=coalesce(claimed_at,now()),attempt_started_at=now(),deadline_at=coalesce(deadline_at,now()+make_interval(secs=>timeout_seconds)),run_id=r
 where id=j.id returning * into j;
 insert into public.os_lab_hermes_attempts(job_id,attempt,worker_id,lease_token,run_id,status)
 values(j.id,j.attempt,w,j.lease_token,r,'running');
 update public.os_inst_assignments set status='working',run_id=r,started_at=coalesce(started_at,now()) where id=j.assignment_id;
 return to_jsonb(j);
end $$;
create function public.lab_worker_heartbeat(p_job uuid default null,p_attempt integer default null,p_lease uuid default null,
 p_runtime_sha text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid:=lab_private.worker_id(); j public.os_lab_hermes_jobs;
begin
 update lab_private.workers set last_seen_at=now(),runtime_sha=p_runtime_sha where id=w;
 insert into public.os_lab_worker_status(worker_id,name,last_seen_at,runtime_sha,active_job_id)
 select w,name,now(),p_runtime_sha,p_job from lab_private.workers where id=w
 on conflict(worker_id) do update set last_seen_at=excluded.last_seen_at,runtime_sha=excluded.runtime_sha,active_job_id=excluded.active_job_id;
 if p_job is not null then
  j:=lab_private.lock_job(p_job,p_attempt,p_lease);
  if clock_timestamp()>=j.deadline_at then
   return jsonb_build_object('command','timeout','db_now',clock_timestamp()); end if;
  update public.os_lab_hermes_jobs set lease_until=clock_timestamp()+interval '60 seconds' where id=p_job;
  if j.status='cancel_requested' or (select paused from lab_private.settings) then
   return jsonb_build_object('command','cancel','db_now',clock_timestamp()); end if;
 end if;
 return jsonb_build_object('command','continue','db_now',clock_timestamp());
end $$;
create function public.lab_owner_cancel(p_job uuid) returns text language plpgsql security definer set search_path='' as $$
declare s text;
begin
 if not public.os_key_valid() then raise exception 'owner_required' using errcode='42501'; end if;
 select status into s from public.os_lab_hermes_jobs where id=p_job for update;
 if s in ('queued','retry_wait') then
  update public.os_lab_hermes_jobs set status='cancelled',finished_at=now() where id=p_job;
  update public.os_inst_assignments set status='failed',finished_at=now() where id=(select assignment_id from public.os_lab_hermes_jobs where id=p_job);
  update public.os_inst_briefs set status='paused',finished_at=now() where id=(select brief_id from public.os_lab_hermes_jobs where id=p_job and mode='direct');
  return 'cancelled';
 elsif s in ('running','validating','cancel_requested') then
  update public.os_lab_hermes_jobs set status='cancel_requested' where id=p_job;
  return 'cancel_requested';
 end if;
 return coalesce(s,'not_found');
end $$;
create function public.lab_worker_events(p_job uuid,p_attempt integer,p_lease uuid,p_events jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare j public.os_lab_hermes_jobs; e jsonb; n integer:=0;
begin
 j:=lab_private.lock_job(p_job,p_attempt,p_lease);
 if jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events)>100 then raise exception 'events_invalid'; end if;
 for e in select * from jsonb_array_elements(p_events) loop
  if octet_length(e::text)>4096 or e->>'kind' not in
   ('job.started','tool.started','tool.finished','model.started','model.finished','usage.updated','job.warning','job.stopped','delivery.started')
  then raise exception 'event_invalid'; end if;
  insert into public.os_lab_hermes_events(job_id,attempt,sequence,kind,emitted_at,payload)
  values(p_job,p_attempt,(e->>'sequence')::bigint,e->>'kind',(e->>'emitted_at')::timestamptz,
  coalesce(e->'payload','{}')) on conflict(job_id,attempt,sequence) do nothing;
  n:=n+1;
 end loop;
 return n;
end $$;
create function public.lab_worker_reserve(p_job uuid,p_attempt integer,p_lease uuid,p_call uuid,p_route text,p_upper_usd numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.os_lab_hermes_jobs; total numeric; prior lab_private.usage_ledger;
begin
 perform pg_advisory_xact_lock(7192601); j:=lab_private.lock_job(p_job,p_attempt,p_lease);
 if j.status<>'running' or (select paused from lab_private.settings) then raise exception 'spending_disabled'; end if;
 select * into prior from lab_private.usage_ledger where job_id=p_job and attempt=p_attempt and call_id=p_call;
 if found then
  if prior.route_id<>p_route or prior.reserved_usd<>p_upper_usd then raise exception 'idempotency_conflict'; end if;
  return jsonb_build_object('reserved',true,'replay',true); end if;
 if p_upper_usd is null or p_upper_usd<=0 then raise exception 'reservation_invalid'; end if;
 select coalesce(sum(coalesce(actual_usd,reserved_usd)),0) into total from lab_private.usage_ledger where job_id=p_job;
 if total+p_upper_usd>j.max_cost_usd then raise exception 'budget_exceeded'; end if;
 if (select enforce_daily from lab_private.settings) and
  (select coalesce(sum(coalesce(actual_usd,reserved_usd)),0) from lab_private.usage_ledger
   where created_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC' or actual_usd is null)+p_upper_usd
  > (select daily_limit_usd from lab_private.settings) then raise exception 'daily_budget_exceeded'; end if;
 insert into lab_private.usage_ledger(job_id,attempt,call_id,route_id,reserved_usd) values(p_job,p_attempt,p_call,p_route,p_upper_usd);
 return jsonb_build_object('reserved',true,'replay',false);
end $$;
create function public.lab_worker_settle(p_job uuid,p_attempt integer,p_lease uuid,p_call uuid,p_actual_usd numeric,p_usage jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare w uuid:=lab_private.worker_id(); l lab_private.usage_ledger;
begin
 -- Late settlement diizinkan untuk attempt milik worker ini; bukan hak mengirim final lama.
 if not exists(select 1 from public.os_lab_hermes_attempts where job_id=p_job and attempt=p_attempt
  and worker_id=w and lease_token=p_lease) then raise exception 'attempt_forbidden' using errcode='42501'; end if;
 select * into l from lab_private.usage_ledger where job_id=p_job and attempt=p_attempt and call_id=p_call for update;
 if not found then raise exception 'reservation_missing'; end if;
 if p_actual_usd is null or p_actual_usd<0 then raise exception 'usage_unknown_keep_reservation'; end if;
 if l.actual_usd is not null then
  if l.actual_usd<>p_actual_usd or l.usage is distinct from p_usage then raise exception 'idempotency_conflict'; end if;
  return; end if;
 -- Jangan truncate actual ke cap. Overrun menunjukkan bug harga, harus terlihat dan menghentikan klaim.
 update lab_private.usage_ledger set actual_usd=p_actual_usd,usage=p_usage,settled_at=now()
 where job_id=p_job and attempt=p_attempt and call_id=p_call;
 if p_actual_usd>l.reserved_usd then update lab_private.settings set paused=true; end if;
 perform lab_private.refresh_usage(p_job);
end $$;
create function public.lab_worker_archive(p_job uuid,p_attempt integer,p_lease uuid,p_operation uuid,p_record jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare j public.os_lab_hermes_jobs; c uuid; h text; old lab_private.archives; parents uuid[];
begin
 j:=lab_private.lock_job(p_job,p_attempt,p_lease);
 if j.status<>'running' then raise exception 'archive_not_running'; end if;
 if length(coalesce(p_record->>'content',''))=0 or octet_length(p_record->>'content')>2097152 then raise exception 'content_invalid'; end if;
 h:=encode(sha256(convert_to(p_record::text,'UTF8')),'hex');
 select * into old from lab_private.archives where job_id=p_job and attempt=p_attempt and operation_id=p_operation;
 if found then if old.body_hash<>h then raise exception 'idempotency_conflict'; end if; return old.corpus_id; end if;
 if p_record->>'kind' not in ('retrieval','dataset','methodology','execution','assumption') then raise exception 'corpus_kind_forbidden'; end if;
 select coalesce(array_agg(value::uuid),'{}') into parents from jsonb_array_elements_text(coalesce(p_record->'derived_from','[]'));
 if exists(select 1 from unnest(parents) x where not exists(select 1 from public.os_inst_corpus c where c.id=x and c.brief_id=j.brief_id and c.data_class='public'
 and (coalesce(j.payload#>'{input,corpus_ids}','[]') ? x::text or exists(select 1 from lab_private.archives ar where ar.job_id=p_job and ar.attempt=p_attempt and ar.corpus_id=x)))) then raise exception 'corpus_scope'; end if;
 insert into public.os_inst_corpus(kind,title,data_class,content,content_hash,url,http_status,fetched_at,query,provenance,derived_from,
 brief_id,assignment_id,created_by_agent_id,created_by_run_id)
 values(p_record->>'kind',coalesce(p_record->>'title','Retrieval'),'public',p_record->>'content',
 encode(sha256(convert_to(p_record->>'content','UTF8')),'hex'),p_record->>'url',(p_record->>'http_status')::integer,
 (p_record->>'fetched_at')::timestamptz,p_record->>'query',coalesce(p_record->'provenance','{}'),parents,
 j.brief_id,j.assignment_id,j.agent_id,j.run_id) returning id into c;
 insert into lab_private.archives values(p_job,p_attempt,p_operation,h,c);
 return c;
end $$;
create function public.lab_worker_read_corpus(p_job uuid,p_attempt integer,p_lease uuid,p_corpus uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.os_lab_hermes_jobs; c jsonb;
begin
 j:=lab_private.lock_job(p_job,p_attempt,p_lease);
 -- Hanya input snapshot yang disengaja atau retrieval milik attempt ini; bukan semua brief.
 if not (coalesce(j.payload#>'{input,corpus_ids}','[]') ? p_corpus::text)
 and not exists(select 1 from lab_private.archives where job_id=p_job and attempt=p_attempt and corpus_id=p_corpus)
 then raise exception 'corpus_scope' using errcode='42501'; end if;
 select to_jsonb(t) into c from public.os_inst_corpus t where id=p_corpus and data_class='public';
 return c;
end $$;
create function public.lab_worker_validating(p_job uuid,p_attempt integer,p_lease uuid)
returns void language plpgsql security definer set search_path='' as $$
declare j public.os_lab_hermes_jobs;
begin j:=lab_private.lock_job(p_job,p_attempt,p_lease);
 if j.status='cancel_requested' then raise exception 'cancel_requested'; end if;
 update public.os_lab_hermes_jobs set status='validating' where id=p_job;
end $$;
create function public.lab_worker_finish(p_job uuid,p_attempt integer,p_lease uuid,p_result jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.os_lab_hermes_jobs; w uuid:=lab_private.worker_id(); h text; c uuid; cost numeric; tin bigint; tout bigint; parents uuid[];
begin
 h:=encode(sha256(convert_to(p_result::text,'UTF8')),'hex');
 select * into j from public.os_lab_hermes_jobs where id=p_job for update;
 if j.status='succeeded' and j.worker_id=w and j.attempt=p_attempt and j.lease_token=p_lease then
  if j.result_hash<>h then raise exception 'idempotency_conflict'; end if;
  return jsonb_build_object('job_id',j.id,'corpus_id',j.final_corpus_id,'replay',true); end if;
 j:=lab_private.lock_job(p_job,p_attempt,p_lease);
 if j.status<>'validating' then raise exception 'not_validating'; end if;
 if coalesce(length(p_result#>>'{output,markdown}'),0)=0 then raise exception 'output_invalid'; end if;
 -- Worker schema validator mandatory; SQL enforces authority, reference scope and singular commit.
 select coalesce(array_agg((value->>'corpus_id')::uuid),'{}') into parents
 from jsonb_array_elements(coalesce(p_result->'provenance','[]'));
 if exists(select 1 from unnest(parents) x where not exists(select 1 from public.os_inst_corpus c0
  where c0.id=x and c0.brief_id=j.brief_id and c0.data_class='public'
 and (coalesce(j.payload#>'{input,corpus_ids}','[]') ? x::text or exists(select 1 from lab_private.archives ar where ar.job_id=p_job and ar.attempt=p_attempt and ar.corpus_id=x)))) then raise exception 'corpus_scope'; end if;
 select coalesce(sum(actual_usd),0),coalesce(sum((usage->>'input_tokens')::bigint),0),coalesce(sum((usage->>'output_tokens')::bigint),0)
 into cost,tin,tout from lab_private.usage_ledger where job_id=p_job;
 insert into public.os_inst_corpus(kind,title,data_class,content,content_hash,provenance,derived_from,brief_id,assignment_id,created_by_agent_id,created_by_run_id)
 values('output','Hasil Hermes','public',p_result#>>'{output,markdown}',encode(sha256(convert_to(p_result#>>'{output,markdown}','UTF8')),'hex'),
 jsonb_build_object('job_id',p_job,'attempt',p_attempt,'runtime',p_result->'runtime'),parents,j.brief_id,j.assignment_id,j.agent_id,j.run_id) returning id into c;
 update public.os_lab_runs set status='ok',output=p_result#>>'{output,markdown}',tokens_in=tin,tokens_out=tout,cost_usd=cost,
 duration_ms=floor(extract(epoch from (clock_timestamp()-j.attempt_started_at))*1000)::integer where id=j.run_id;
 update public.os_inst_assignments set status='done',output=p_result#>>'{output,markdown}',output_corpus_id=c,finished_at=now() where id=j.assignment_id;
 if j.mode='direct' then
  update public.os_inst_briefs set status='director',final_output_corpus_id=c,finished_at=now(),cost_actual_usd=cost,tokens_actual=tin+tout where id=j.brief_id;
 end if;
 update public.os_lab_hermes_jobs set status='succeeded',result=p_result,result_hash=h,final_corpus_id=c,finished_at=now(),lease_until=null where id=p_job;
 update public.os_lab_hermes_attempts set status='succeeded',finished_at=now() where job_id=p_job and attempt=p_attempt;
 perform lab_private.refresh_usage(p_job);
 return jsonb_build_object('job_id',p_job,'corpus_id',c,'replay',false);
end $$;
create function public.lab_worker_fail(p_job uuid,p_attempt integer,p_lease uuid,p_code text,p_retryable boolean,p_detail text default '')
returns text language plpgsql security definer set search_path='' as $$
declare j public.os_lab_hermes_jobs; s text;
begin
 j:=lab_private.lock_job(p_job,p_attempt,p_lease);
 s:=case when j.status='cancel_requested' then 'cancelled' when p_code='timeout' then 'timed_out'
  when p_code in ('budget_exceeded','daily_budget_exceeded') then 'budget_exceeded'
  when p_retryable and p_code in ('provider_429','provider_transient','runtime_crash','oom') and j.attempt<3 then 'retry_wait' else 'failed' end;
 update public.os_lab_runs set status='error',error=left(p_code||': '||p_detail,1000) where id=j.run_id;
 update public.os_lab_hermes_attempts set status=s,finished_at=now() where job_id=p_job and attempt=p_attempt;
 update public.os_lab_hermes_jobs set status=s,lease_until=null,error=jsonb_build_object('code',p_code,'detail',left(p_detail,1000)),
 available_at=now()+make_interval(secs=>(case when j.attempt=1 then 10 else 30 end)+(floor(random()*4))::integer),
 finished_at=case when s='retry_wait' then null else now() end where id=p_job;
 if s<>'retry_wait' then
  update public.os_inst_assignments set status='failed',finished_at=now() where id=j.assignment_id;
  if j.mode='direct' then update public.os_inst_briefs set status=case when s='cancelled' then 'paused' else 'failed' end,finished_at=now() where id=j.brief_id; end if;
 end if;
 perform lab_private.refresh_usage(p_job);
 return s;
end $$;

create function public.lab_owner_pair_begin(p_name text) returns jsonb language plpgsql security definer set search_path='' as $$
declare code text:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
begin
 if not public.os_key_valid() then raise exception 'owner_required' using errcode='42501'; end if;
 if length(p_name) not between 1 and 60 then raise exception 'name_invalid'; end if;
 insert into lab_private.pairings(code_hash,name,expires_at)
 values(encode(sha256(convert_to(code,'UTF8')),'hex'),p_name,now()+interval '10 minutes');
 return jsonb_build_object('code',code,'expires_at',now()+interval '10 minutes');
end $$;
create function public.lab_enrol_consume(p_code text,p_auth_user uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare t lab_private.pairings; w uuid;
begin
 if coalesce(current_setting('role',true),'none')<>'service_role' then raise exception 'service_required' using errcode='42501'; end if;
 select * into t from lab_private.pairings where code_hash=encode(sha256(convert_to(p_code,'UTF8')),'hex') for update;
 if not found or t.consumed_at is not null or t.expires_at<=now() then raise exception 'pairing_invalid'; end if;
 insert into lab_private.workers(auth_user_id,name) values(p_auth_user,t.name) returning id into w;
 insert into public.os_lab_worker_wake(auth_user_id) values(p_auth_user);
 update lab_private.pairings set consumed_at=now(),worker_id=w where code_hash=t.code_hash;
 return w;
end $$;
create function public.lab_owner_worker_revoke(p_worker uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.os_key_valid() then raise exception 'owner_required' using errcode='42501'; end if;
 update lab_private.workers set enabled=false where id=p_worker;
 update public.os_lab_hermes_jobs set status='cancel_requested' where worker_id=p_worker and status in ('running','validating');
end $$;
create function public.lab_owner_settings(p_paused boolean,p_daily_limit_usd numeric default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.os_key_valid() then raise exception 'owner_required' using errcode='42501'; end if;
 if p_daily_limit_usd is not null and p_daily_limit_usd<=0 then raise exception 'limit_invalid'; end if;
 update lab_private.settings set paused=p_paused,daily_limit_usd=coalesce(p_daily_limit_usd,daily_limit_usd);
 if p_paused then update public.os_lab_hermes_jobs set status='cancel_requested' where status in ('running','validating'); end if;
end $$;
create function public.lab_owner_price(p_route text,p_provider text,p_model text,p_region text,p_price jsonb,p_source text,p_checked timestamptz,p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.os_key_valid() then raise exception 'owner_required' using errcode='42501'; end if;
 if coalesce((p_price->>'max_context_tokens')::integer,0)<=0 or coalesce((p_price->>'input_usd_per_million')::numeric,-1)<0
 or coalesce((p_price->>'output_usd_per_million')::numeric,-1)<0 then raise exception 'price_invalid'; end if;
 insert into public.os_lab_model_prices values(p_route,p_provider,p_model,p_region,p_price,p_source,p_checked,p_enabled)
 on conflict(route_id) do update set provider=excluded.provider,model=excluded.model,region=excluded.region,
 price=excluded.price,source_url=excluded.source_url,checked_at=excluded.checked_at,enabled=excluded.enabled;
end $$;
create function public.lab_owner_configure(p_agent_id uuid,p_new_agent jsonb,p_config jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare a public.os_lab_agents; orig uuid; v uuid; slug text; route public.os_lab_model_prices; provider_id uuid;
begin
 if not public.os_key_valid() then raise exception 'owner_required' using errcode='42501'; end if;
 if (p_config->>'executor') not in ('edge','hermes') then raise exception 'executor_invalid'; end if;
 if p_config->>'executor'='edge' then
  update public.os_lab_agents set executor='edge' where id=p_agent_id; return p_agent_id;
 end if;
 select * into route from public.os_lab_model_prices where route_id=p_config->>'route_id' and enabled;
 if not found or route.provider is distinct from p_config->>'provider' or route.model is distinct from p_config->>'model'
 then raise exception 'route_invalid'; end if;
 if coalesce((p_config->>'max_cost_usd')::numeric,0)<=0 or coalesce((p_config->>'timeout_seconds')::int,0) not between 1 and 7200
 or coalesce((p_config->>'max_turns')::int,0) not between 1 and 90 or coalesce((p_config->>'max_output_tokens')::int,0) not between 1 and 8192
 then raise exception 'limits_invalid'; end if;
 select id into provider_id from public.os_lab_providers where name=route.provider;
 if provider_id is null then raise exception 'provider_row_missing'; end if;
 if p_agent_id is null then
  insert into public.os_lab_agents(slug,name,description,system_prompt,data_class,default_provider_id,executor)
  values(p_new_agent->>'slug',p_new_agent->>'name',coalesce(p_new_agent->>'description',''),p_new_agent->>'system_prompt','public',provider_id,'hermes') returning * into a;
 else
  select * into a from public.os_lab_agents where id=p_agent_id for update;
  if not found then raise exception 'agent_missing'; end if;
  if a.data_class='internal' then
   orig:=a.id;
   select successor_id into p_agent_id from lab_private.agent_successors where legacy_id=orig;
   if p_agent_id is null then
    slug:=a.slug||'-hermes';
    if exists(select 1 from public.os_lab_agents x where x.slug=slug) then slug:=slug||'-'||left(orig::text,8); end if;
    insert into public.os_lab_agents(slug,name,description,system_prompt,data_class,default_provider_id,executor)
    values(slug,a.name||' (Hermes)',a.description,a.system_prompt,'public',provider_id,'hermes') returning id into p_agent_id;
    insert into lab_private.agent_successors values(orig,p_agent_id);
   end if;
   select * into a from public.os_lab_agents where id=p_agent_id for update;
  end if;
 end if;
 select id into v from public.os_inst_agent_versions where agent_id=a.id and status='active' and system_prompt=a.system_prompt;
 if v is null then
  if exists(select 1 from public.os_inst_agent_versions where agent_id=a.id and status='active') then raise exception 'active_prompt_mismatch'; end if;
  -- Owner materializes CURRENT prompt only, never adopts a proposed revision.
  perform set_config('app.inst_seed','on',true);
  insert into public.os_inst_agent_versions(agent_id,version,system_prompt,status,proposed_by,rationale,diff,approved_by,approved_at)
  values(a.id,a.version,a.system_prompt,'active','director','Baseline prompt yang dipilih owner untuk eksekusi Hermes.','Initial baseline','director',now()) returning id into v;
  perform set_config('app.inst_seed','off',true);
 end if;
 if orig is not null then
  insert into public.os_lab_agent_files(version_id,path,content)
  select v,f.path,f.content from public.os_lab_agent_files f join public.os_inst_agent_versions av on av.id=f.version_id
  where av.agent_id=orig and av.status='active' on conflict do nothing;
 end if;
 update public.os_lab_agents set executor='hermes' where id=a.id;
 insert into public.os_lab_agent_execution(agent_id,config) values(a.id,p_config)
 on conflict(agent_id) do update set config=excluded.config,updated_at=now();
 return a.id;
end $$;
create function public.lab_owner_submit(p_submit_key uuid,p_agent uuid,p_question text,p_weight text default 'standard')
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.os_lab_agents; v public.os_inst_agent_versions; config jsonb; price public.os_lab_model_prices;
 h text; old public.os_lab_hermes_jobs; b uuid; assignment uuid; j uuid; payload jsonb;
begin
 if not public.os_key_valid() then raise exception 'owner_required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_submit_key::text,0));
 h:=encode(sha256(convert_to(jsonb_build_array(p_agent,p_question,p_weight)::text,'UTF8')),'hex');
 select * into old from public.os_lab_hermes_jobs where submit_key=p_submit_key;
 if found then
  if old.submit_hash<>h then raise exception 'idempotency_conflict'; end if;
  return jsonb_build_object('job_id',old.id,'brief_id',old.brief_id,'replay',true); end if;
 if length(p_question) not between 8 and 32000 or p_weight not in ('brief','standard','full') then raise exception 'input_invalid'; end if;
 select * into a from public.os_lab_agents where id=p_agent and executor='hermes' and is_active;
 if not found or a.data_class<>'public' then raise exception 'configure_public_successor'; end if;
 select * into v from public.os_inst_agent_versions where agent_id=p_agent and status='active' order by version desc limit 1 for share;
 if not found or v.system_prompt<>a.system_prompt then raise exception 'active_version_invalid'; end if;
 select e.config into config from public.os_lab_agent_execution e where agent_id=p_agent;
 -- Batas efektif ialah minimum ceiling agent dan default weight; retry tidak meresetnya.
 config:=config||jsonb_build_object(
 'max_cost_usd',least((config->>'max_cost_usd')::numeric,case p_weight when 'brief' then 2 when 'standard' then 6 else 12 end),
 'timeout_seconds',least((config->>'timeout_seconds')::int,case p_weight when 'brief' then 900 when 'standard' then 2700 else 7200 end),
 'max_turns',least((config->>'max_turns')::int,case p_weight when 'brief' then 20 when 'standard' then 50 else 90 end),
 'max_output_tokens',least((config->>'max_output_tokens')::int,case p_weight when 'brief' then 4096 else 8192 end));
 select * into price from public.os_lab_model_prices where route_id=config->>'route_id' and enabled;
 if not found then raise exception 'route_invalid'; end if;
 insert into public.os_inst_briefs(question,weight_class,data_class,status,started_at,brief)
 values(p_question,p_weight,'public','running',now(),jsonb_build_object('execution_mode','direct','estimator_version','hermes-direct-v1')) returning id into b;
 insert into public.os_inst_assignments(brief_id,agent_id,agent_slug,kind,input)
 values(b,p_agent,a.slug,'specialist_work',p_question) returning id into assignment;
 payload:=jsonb_build_object('schema_version','1','agent',jsonb_build_object('id',a.id,'slug',a.slug,'version_id',v.id,
 'system_prompt',v.system_prompt,'files',coalesce((select jsonb_agg(jsonb_build_object('path',path,'content',content,'sha256',content_hash)) from public.os_lab_agent_files where version_id=v.id),'[]'::jsonb)),
 'config',config,'price',to_jsonb(price),'input',jsonb_build_object('question',p_question,'brief_id',b,'assignment_id',assignment,'corpus_ids','[]'::jsonb));
 insert into public.os_lab_hermes_jobs(submit_key,submit_hash,brief_id,assignment_id,agent_id,payload,weight_class,max_cost_usd,timeout_seconds)
 values(p_submit_key,h,b,assignment,p_agent,payload,p_weight,(config->>'max_cost_usd')::numeric,(config->>'timeout_seconds')::integer) returning id into j;
 update public.os_lab_worker_wake set revision=revision+1,changed_at=now();
 return jsonb_build_object('job_id',j,'brief_id',b,'replay',false);
end $$;


create function public.lab_owner_files(p_version uuid,p_files jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare f jsonb; n integer:=0;
begin
 if not public.os_key_valid() then raise exception 'owner_required' using errcode='42501'; end if;
 perform 1 from public.os_inst_agent_versions where id=p_version and status='active' for update;
 if not found then raise exception 'version_invalid'; end if;
 if exists(select 1 from public.os_lab_agent_files where version_id=p_version)
 or exists(select 1 from public.os_lab_hermes_jobs where payload#>>'{agent,version_id}'=p_version::text) then raise exception 'reference_frozen'; end if;
 if jsonb_typeof(p_files)<>'array' or octet_length(p_files::text)>1048576 then raise exception 'files_invalid'; end if;
 for f in select * from jsonb_array_elements(p_files) loop
  if f->>'path' in ('SKILL.md','config.yaml','.env') then raise exception 'reserved_path'; end if;
  insert into public.os_lab_agent_files(version_id,path,content) values(p_version,f->>'path',f->>'content');n:=n+1;
 end loop;
 return n;
end $$;
create function public.lab_owner_run_status(p_job uuid,p_after bigint default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.os_lab_hermes_jobs; events jsonb; usage jsonb;
begin
 if not public.os_key_valid() then raise exception 'owner_required' using errcode='42501'; end if;
 select * into j from public.os_lab_hermes_jobs where id=p_job;
 if not found then return null; end if;
 select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]') into events
 from (select * from public.os_lab_hermes_events where job_id=p_job and id>p_after order by id limit 100) e;
 select jsonb_build_object('known_cost_usd',coalesce(sum(actual_usd),0),'unresolved_reserved_usd',
 coalesce(sum(reserved_usd) filter(where actual_usd is null),0),'input_tokens',sum((l.usage->>'input_tokens')::bigint),
 'output_tokens',sum((l.usage->>'output_tokens')::bigint)) into usage from lab_private.usage_ledger l where job_id=p_job;
 return jsonb_build_object('job',to_jsonb(j)-'lease_token','events',events,'usage',usage,'attempts',
 coalesce((select jsonb_agg(jsonb_build_object('attempt',a.attempt,'status',a.status,'run_id',a.run_id,
 'started_at',a.started_at,'finished_at',a.finished_at,'tokens_in',r.tokens_in,'tokens_out',r.tokens_out,'cost_usd',r.cost_usd)
 order by a.attempt) from public.os_lab_hermes_attempts a join public.os_lab_runs r on r.id=a.run_id where a.job_id=p_job),'[]'),
 'workers',
 coalesce((select jsonb_agg(to_jsonb(w)||jsonb_build_object('online',w.last_seen_at>now()-interval '30 seconds')) from public.os_lab_worker_status w),'[]'));
end $$;

-- Tolak secara default, termasuk grant eksplisit bawaan Supabase.
do $block$ declare r record; begin
 for r in select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace where n.nspname='lab_private' or (n.nspname='public' and p.proname like 'lab_%') loop
  execute format('revoke all on function %I.%I(%s) from public,anon,authenticated,service_role',r.nspname,r.proname,r.args);
  if r.nspname='public' and r.proname like 'lab_worker_%' then
   execute format('grant execute on function %I.%I(%s) to authenticated',r.nspname,r.proname,r.args);
  elsif r.nspname='public' and r.proname like 'lab_enrol_%' then
   execute format('grant execute on function %I.%I(%s) to service_role',r.nspname,r.proname,r.args);
  elsif r.nspname='public' and r.proname like 'lab_owner_%' then
   execute format('grant execute on function %I.%I(%s) to anon,authenticated',r.nspname,r.proname,r.args);
  end if;
 end loop;
end $block$;
commit;
```

### Unit dan installer tertanam


Ini isi file, bukan command tambahan untuk director. Path interpreter dan scripts diisi dari release manifest, bukan PATH home personal. Worker dan backend adalah system service, dua unit persistent; unit installer hanya transient untuk download/build.

```ini
# /etc/systemd/system/lab-worker.service
[Unit]
Description=Lab queue worker and local broker
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=lab
Group=lab
SupplementaryGroups=lab-bridge
ExecStart=/opt/lab/current/worker-venv/bin/python -m lab_worker
WorkingDirectory=/var/lib/lab-worker
Environment=PYTHONDONTWRITEBYTECODE=1
UMask=0077
Restart=on-failure
RestartSec=5
KillMode=control-group
TimeoutStopSec=15
MemoryHigh=320M
MemoryMax=384M
CPUQuota=25%
TasksMax=128
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
ReadWritePaths=/var/lib/lab-worker
ReadOnlyPaths=/etc/lab-worker -/run/lab-bridge
[Install]
WantedBy=multi-user.target
```

```ini
# /etc/systemd/system/hermes-lab-backend.service
[Unit]
Description=Lab Hermes isolated execution backend
After=network-online.target lab-worker.service
Wants=lab-worker.service
[Service]
Type=simple
User=hermes-lab
Group=lab-bridge
ExecStart=/opt/lab/current/backend-venv/bin/python -m hermes_backend
WorkingDirectory=/var/lib/hermes-lab
RuntimeDirectory=hermes-lab lab-bridge
RuntimeDirectoryMode=0750
RuntimeDirectoryPreserve=no
Environment=PYTHONDONTWRITEBYTECODE=1
UMask=0077
Restart=on-failure
RestartSec=5
KillMode=control-group
TimeoutStopSec=15
MemoryHigh=1536M
MemoryMax=2048M
CPUQuota=125%
TasksMax=256
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
ReadWritePaths=/var/lib/hermes-lab /run/hermes-lab /run/lab-bridge
[Install]
WantedBy=multi-user.target
```

Control token dibuat backend setiap startup di `/run/lab-bridge/control.token`, owner hermes-lab:lab-bridge mode 0640. Worker membaca ulang saat epoch berubah, tidak memakai token yang dipin permanen. Parent token tidak dimount ke bwrap child. Prefix minus pada ReadOnlyPaths mengizinkan direktori epoch belum ada ketika worker pertama start. Health readiness baru true setelah broker, namespace, egress dan schema version lulus. Jangan memakai RestrictNamespaces yang melarang user/PID namespace bwrap. UID egress nft tetap UID hermes-lab walau grup unit lab-bridge.

Fallback V-30c ialah whole-service namespace, bukan plain local. Drop-in backend: `TemporaryFileSystem=/var/lib/hermes-lab /tmp /home`; read-only bind runtime/lib/CA saja, `ProtectProc=invisible`, `ProcSubset=pid`, `PrivateDevices=yes`, writable state hanya RuntimeDirectory; `Restart=always`; backend `--one-run-per-epoch`. Setelah final/cancel, backend exit dan systemd KillMode membersihkan descendants, RuntimeDirectoryPreserve=no menghapus home/workspace/control epoch sebelum start berikut. `HOME/HERMES_HOME/XDG_*` di RuntimeDirectory. Worker spool terpisah sebagai lab. `/home/hermes` deny marker root-owned mode 000 dibuat unit setup agar S-11 menghasilkan permission denied. Backend baru tidak ready sampai manifest canary run lama tidak ada dan nonce baru dibuat. Worker membaca control token baru dari RuntimeDirectory, token epoch lama ditolak. Tidak ada tempat writable persisten lain yang bisa membawa state antar-run. Direktori data backend lama tidak dibind ke fallback. Fable menguji mode ini dalam VM Ubuntu 22.04 sebelum menyediakan helper V-30c.

Installer tidak menjalankan package install dengan privilege root. Root membuat directory/users/units/rules, lalu dependency build lewat user hermes-lab dalam staging, dengan Python/uv/Node yang hash-nya dipin dalam manifest. Node hanya jika tool terpilih memerlukannya, browser off P1. Root menyalin release tervalidasi ke /opt/lab/releases/<build-sha>, chmod read-only bagi runtime, dan mengganti symlink atomic. Tidak menjalankan installer Hermes personal atau mengubah ~/.hermes milik hermes.

Swap: bila V-06 belum menunjukkan swap dan disk V-07 memadai, installer dapat menyiapkan satu GiB swapfile root mode 0600 secara idempoten; ia harus menghindari file existing, memverifikasi filesystem mendukung swapfile, dan menyediakan `lab-admin swap-remove` untuk rollback ketika tidak dipakai. Ini bagian installer yang outputnya menyebut SWAP_CREATED atau SWAP_EXISTING, bukan kapasitas untuk menaikkan concurrency.

Batas filesystem child: state/home/workspace pada tmpfs 512 MiB dan tmp 128 MiB, seperti 05. Fable tidak boleh mengganti ini dengan writable bind seluruh /var/lib/hermes-lab. Fallback memakai temporary filesystems bersize, tidak hanya watchdog. Journald/log supervisor dan worker spool mempunyai batas sendiri; command clean hanya membuang bundel yang aman, tidak menjalankan path dari model.

Fallback namespace memakai `ExecStartPre=+/opt/lab/current/bin/lab-admin prepare-backend-epoch`, helper root milik admin dengan argumen tetap, standard library saja, menolak symlink dan tidak membaca input model. Ia membuat control token baru root:lab-bridge 0640 pada RuntimeDirectory. Backend fallback membaca token itu, tidak menulisnya. Drop-in me-reset ReadWritePaths, memasang /run/lab-bridge read-only, dan memberi state/tool hanya tmpfs bersize. Tidak ada writable host spool pada backend fallback; semua event dikirim ke worker lab. Helper tidak setuid dan tidak dapat dipanggil root oleh user runtime, tidak ada sudo/polkit grant. Ini pekerjaan setup tetap milik systemd yang dikonfigurasi admin, bukan kuasa root untuk agent. Epoch baru, state tmpfs baru dan cgroup lama bersih wajib sebelum readiness.

### Langkah director yang harus didukung helper
# Runbook VPS director

Keputusan utama: semua kerja panjang berada dalam tmux atau systemd system unit. Setelah setup, penggunaan normal berlangsung dari UI Lab. Fable tidak membutuhkan SSH. Satu blok command di setiap langkah berarti satu command yang diketik. Jangan mengetik label prompt, placeholder atau langkah Linux di PowerShell.

Input sebelum Phase 1: Fable sudah menghasilkan build, migration/Edge/UI dan paket `ops/lab-vps`, serta memberikan `<BUILD_SHA>` konkret. Command `labctl` dan `lab-admin` adalah output build yang dispesifikasikan di 04/08, belum ada pada source awal. Tidak meminta director merancang helper. `<VPS_HOST>` berasal panel VPS, `<BUILD_SHA>` dari pesan rilis Fable. Secret dimasukkan hanya pada getpass lokal. Tidak ada perintah di sini yang meminta service-role.

Phase 0: V-01–V-11 dan billing O-07. Phase 1: V-12–V-42. V-03b/V-08b/V-19b/V-26b/V-28b/V-30b/V-30c hanya cabang kondisi yang tertulis. Phase 5: V-50–V-55. Rollback mempunyai langkah command tersendiri di bawah. Estimasi kerja director aktif 45–75 menit Phase 1, di luar download dan tes durasi, asumsi desain pada 07.

### V-01 Masuk VPS

Lokasi: laptop Windows PowerShell; prompt `PS C:\Users\<director>>`.

```bash
ssh hermesagent@<VPS_HOST>
```

Hasil: Prompt berubah menjadi hermesagent@<host>; pakai host dari pengelola VPS, jangan salin IP ke repo.

Jika salah: Permission denied berarti key SSH salah. Jangan ketik langkah Linux berikutnya di PowerShell.

Rollback: RB-0.

### V-02 Identitas

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
whoami
```

Hasil: hermesagent.

Jika salah: Nama lain: kembali ke V-01; jangan menjalankan sudo dari user runtime.

Rollback: RB-0.

### V-03 Versi personal

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo -iu hermes hermes --version
```

Hasil: Versi CLI dicatat untuk O-06, tanpa config/secret.

Jika salah: command not found: V-03b. Bukan bukti Hermes tidak terpasang.

Rollback: RB-0.

### V-03b Hanya jika PATH gagal

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo -iu hermes /home/hermes/.local/bin/hermes --version
```

Hasil: Versi. Bila binary berbeda, Fable memakai output instalasi/log path read-only, tidak memindahkan personal.

Jika salah: Path tidak ada: pakai SHA V-04 sebagai versi source; Lab tetap instalasi terpisah.

Rollback: RB-0.

### V-04 SHA personal

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo -u hermes git -C /home/hermes/.hermes/hermes-agent rev-parse HEAD
```

Hasil: SHA personal. Boleh berbeda dari pin Lab, bukan alasan update personal.

Jika salah: Repo tidak ada: catat instalasi personal berbeda, lanjut Lab dengan pin sendiri.

Rollback: RB-0.

### V-05 Home personal

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
stat -c "%a %U %G %n" /home/hermes
```

Hasil: 700 atau 750, owner hermes.

Jika salah: 755/world-readable perlu V-16. Jika owner berbeda, admin memperbaiki hanya permission yang relevan, tidak copy data.

Rollback: RB-0.

### V-06 RAM

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
free -h
```

Hasil: RAM sekitar 4 GB menurut brief; swap diketahui. Simpan hasil untuk alokasi 03.

Jika salah: RAM usable jauh di bawah 4 GB atau available <1 GiB: browser tetap off, identifikasi penggunaan personal dahulu. Jangan menaikkan concurrency.

Rollback: RB-0.

### V-07 Disk

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
df -h /
```

Hasil: Bebas minimal 8 GiB, desain watermark.

Jika salah: Di bawah batas: V-55 cleanup release/workspace receipted. Jangan hapus home personal.

Rollback: RB-0.

### V-08 Clock

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
timedatectl status
```

Hasil: System clock synchronized: yes; timezone Asia/Jakarta boleh, DB tetap UTC.

Jika salah: NTP belum sinkron: V-08b.

Rollback: RB-0.

### V-08b Jika belum sinkron

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo timedatectl set-ntp true
```

Hasil: Tanpa output error; ulang V-08.

Jika salah: NTP unreachable: job memakai DB time/monotonic dan flag clock_skew; Fable cek jaringan NTP, tidak backdate DB.

Rollback: RB-0.

### V-09 Firewall awal

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo ufw status numbered
```

Hasil: Hanya OpenSSH. Simpan output privat untuk S-13.

Jika salah: Ada rule lain: catat baseline; integrasi tidak menambah inbound.

Rollback: RB-0.

### V-10 User namespaces

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sysctl kernel.unprivileged_userns_clone
```

Hasil: Nilai 1: lanjut bwrap test sesudah install. Nilai 0: V-30b.

Jika salah: Key tidak ada: kernel probe via V-30 dan fallback V-30c.

Rollback: RB-0.

### V-11 Sesi tahan disconnect

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
tmux new-session -A -s lab-setup
```

Hasil: Shell admin berjalan di tmux. Jika SSH putus, V-01 lalu command ini melanjutkan.

Jika salah: tmux tidak tersedia walau brief menyebut ada: admin memasang tmux sebelum download panjang.

Rollback: RB-0.

### V-12 Paket index

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo apt-get update
```

Hasil: Index berhasil di dalam tmux.

Jika salah: Network gagal: ulang langkah ini; jangan lanjut install dari index yang gagal total.

Rollback: RB-0.

### V-13 Dependency host

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo apt-get install -y git curl xz-utils libatomic1 bubblewrap nftables python3 python3-venv
```

Hasil: Paket tersedia; tidak ada Docker, tidak upgrade Ubuntu.

Jika salah: apt lock: tunggu proses apt yang sah selesai dalam tmux; jangan hapus lock.

Rollback: RB-0; paket tidak perlu dihapus.

### V-14 User worker

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo adduser --disabled-password --gecos "Lab worker" lab
```

Hasil: User lab dibuat tanpa password/sudo.

Jika salah: Already exists: verifikasi V-18, jangan menghapus user existing.

Rollback: RB-0.

### V-15 User runtime

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo adduser --disabled-password --gecos "Lab Hermes runtime" hermes-lab
```

Hasil: User hermes-lab dibuat tanpa password/sudo.

Jika salah: Already exists: verifikasi V-18.

Rollback: RB-0.

### V-16 Home terpisah

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo chmod 700 /home/hermes /home/hermes-lab /home/lab
```

Hasil: Tidak ada output error.

Jika salah: Path tidak ada: selesaikan create user; tidak memakai chmod recursive pada personal.

Rollback: RB-0; jangan membuka kembali home.

### V-17 Grup lokal

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo addgroup lab-bridge
```

Hasil: Grup lab-bridge untuk control token runtime, bukan sudo.

Jika salah: Already exists aman; tidak memakai grup docker.

Rollback: RB-0.

### V-17a Membership worker

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo adduser lab lab-bridge
```

Hasil: lab masuk lab-bridge.

Jika salah: Kegagalan group: periksa V-17.

Rollback: RB-0.

### V-17b Membership backend

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo adduser hermes-lab lab-bridge
```

Hasil: hermes-lab masuk lab-bridge; hermes personal tidak.

Jika salah: Jangan menambahkan hermes personal.

Rollback: RB-0.

### V-18 Audit hak

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo -l -U lab
```

Hasil: User lab is not allowed to run sudo.

Jika salah: Ada sudo command: hapus grant tak diotorisasi melalui admin sebelum start service.

Rollback: RB-0.

### V-18a Audit runtime

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo -l -U hermes-lab
```

Hasil: Not allowed to run sudo.

Jika salah: Sudo grant membuat D-06 gagal; perbaiki sebelum start.

Rollback: RB-0.

### V-18b Audit personal

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo -l -U hermes
```

Hasil: Not allowed to run sudo, sesuai brief.

Jika salah: Jangan menjalankan agent selama personal masih punya sudo.

Rollback: RB-0.

### V-19 Ambil build Fable

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
git clone https://github.com/dikagustiana/Dika-s-Personal-OS.git /home/hermesagent/lab-build
```

Hasil: Checkout lengkap. Repo yang diaudit public.

Jika salah: Directory sudah ada: jangan overwrite; V-19b untuk fetch. Jika visibility berubah, Fable sediakan bundle publik tanpa secrets dengan SHA yang sama.

Rollback: RB-0.

### V-19b Jika checkout sudah ada

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
git -C /home/hermesagent/lab-build fetch origin
```

Hasil: Refs diperbarui, working tree tidak dihapus.

Jika salah: Perubahan lokal: installer hanya menerima release commit bersih dan tidak menimpa file personal.

Rollback: RB-0.

### V-20 Pin build

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
git -C /home/hermesagent/lab-build checkout --detach <BUILD_SHA>
```

Hasil: HEAD detached pada SHA yang Fable keluarkan setelah build Phase 1.

Jika salah: SHA tak ditemukan: Fable belum push release; fetch V-19b. Jangan mengganti placeholder dengan main.

Rollback: RB-0.

### V-21 Cek SHA

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
git -C /home/hermesagent/lab-build rev-parse HEAD
```

Hasil: Persis BUILD_SHA dari paket build Fable.

Jika salah: Mismatch: kembali V-20.

Rollback: RB-0.

### V-22 Install tahan SSH putus

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo systemd-run --unit=lab-hermes-install --property=User=root --property=Type=exec --collect /usr/bin/python3 /home/hermesagent/lab-build/ops/lab-vps/install_release.py --build-sha <BUILD_SHA> --hermes-sha 8afaab3703e336d72a72c812dd2dd249f04f166a
```

Hasil: Unit transient berjalan; install tetap hidup jika SSH putus. Tidak menyalakan worker sebelum pairing/egress siap.

Jika salah: Unit failed: V-23 memberi kode tahap; perbaiki penyebab lalu ulang V-22. Installer idempoten dan tidak mengubah current sebelum verifikasi.

Rollback: RB-1.

### V-23 Log install

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo journalctl -u lab-hermes-install --no-pager -n 60
```

Hasil: RELEASE_READY dan SHA/H yang benar. Ini progress read, boleh diulang.

Jika salah: DOWNLOAD_FAILED/HASH_MISMATCH/BUILD_FAILED: tidak ada promote; jangan bypass hash.

Rollback: RB-1.

### V-24 Verifikasi paket

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo /opt/lab/current/bin/lab-admin verify-install
```

Hasil: PIN_OK, PERMISSIONS_OK, UNITS_OK, NO_PERSONAL_MUTATION.

Jika salah: Nonzero: service tetap tidak ready; Fable memperbaiki paket, director memasang release baru.

Rollback: RB-1.

### V-25 Pair worker

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo -u lab /opt/lab/current/bin/labctl pair
```

Hasil: CLI meminta pairing code melalui getpass. Ambil sekali dari Lab→worker→Pair. PAIRED worker_id; tidak mencetak token.

Jika salah: EXPIRED/CONSUMED: buat kode baru di UI dan ulang. Ini setup credential, bukan gate run.

Rollback: RB-2.

### V-26 Key Kimi

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo -u lab /opt/lab/current/bin/labctl provider set kimi --region auto
```

Hasil: Getpass meminta key khusus Lab, menguji global/China tanpa mencetak key, menyimpan endpoint yang lolos.

Jika salah: Keduanya 401/403: key salah atau Coding Plan; V-26b memakai DeepSeek sementara config Kimi diperbaiki. Tidak menyalin key personal.

Rollback: RB-3.

### V-26b Jika Kimi belum bisa dipakai

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo -u lab /opt/lab/current/bin/labctl provider set deepseek --region direct
```

Hasil: Key DeepSeek lewat getpass tersimpan; Fable/UI memilih DeepSeek secara eksplisit sementara.

Jika salah: Auth gagal: jangan mengaku S-01 lulus; job queued/config error sampai key benar. Tidak perlu SSH Fable.

Rollback: RB-3.

### V-27 Probe endpoint/saldo

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo -u lab /opt/lab/current/bin/labctl provider probe kimi
```

Hasil: HTTP status global/China, selected region/model availability; hanya status saldo available/unavailable jika endpoint billing resmi mendukung. Jika billing tidak tersedia, cetak BILLING_DASHBOARD_REQUIRED dengan URL akun global/China.

Jika salah: GET models 200 tidak membuktikan saldo positif. Director melihat billing pada akun yang bersangkutan. Pilihan config mengikuti saldo yang terlihat; tidak ada transfer saldo antar region.

Rollback: RB-0.

### V-28 Firewall egress

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo /opt/lab/current/bin/lab-admin egress-install
```

Hasil: INET_UID_POLICY_OK; tidak ada inbound rule baru; backend masih stop.

Jika salah: Rule compile gagal: fail-closed readiness, V-28b diagnosis. Jangan start plain local.

Rollback: RB-4.

### V-28b Diagnosis aturan

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo nft list table inet lab_egress
```

Hasil: Hanya UID hermes-lab dibatasi, allow broker loopback, established reply, drop lainnya.

Jika salah: UID/port salah: regenerate helper dari UID nyata; tidak menyentuh ufw SSH.

Rollback: RB-0.

### V-29 Unit syntax

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo systemd-analyze verify /etc/systemd/system/lab-worker.service /etc/systemd/system/hermes-lab-backend.service
```

Hasil: Tidak ada error unit/ExecStart yang hilang.

Jika salah: Unknown option: paket harus kompatibel systemd Ubuntu 22.04; jangan abaikan error sandbox.

Rollback: RB-0.

### V-30 Namespace test

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo /opt/lab/current/bin/lab-admin namespace-check
```

Hasil: BWRAP_OK, PERSONAL_DENIED, WORKER_DENIED, PREVIOUS_RUN_DENIED.

Jika salah: USERNS_DISABLED: V-30b. USERNS_UNAVAILABLE meski enabled: V-30c.

Rollback: RB-1.

### V-30b Hanya jika userns=0

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo sysctl -w kernel.unprivileged_userns_clone=1
```

Hasil: Nilai 1; ulang V-30. Installer menyimpan sysctl scoped kebutuhan ini jika test lulus.

Jika salah: EPERM/key missing: V-30c. Jangan memberi sudo ke user runtime.

Rollback: RB-5.

### V-30c Fallback namespace systemd

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo /opt/lab/current/bin/lab-admin enable-namespace-fallback
```

Hasil: WHOLE_SERVICE_NAMESPACE_OK setelah canary tests; backend one-run-per-restart.

Jika salah: Fallback gagal: readiness tetap false dan job menunggu; Fable memperbaiki unit pada kernel aktual. Tidak menjalankan raw local.

Rollback: RB-1.

### V-31 Start broker/worker

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo systemctl enable --now lab-worker.service
```

Hasil: active; boleh ready waiting_backend sampai langkah berikut.

Jika salah: Auth refresh/config gagal: labctl diagnose memberi status tanpa token.

Rollback: RB-2.

### V-32 Start backend

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo systemctl enable --now hermes-lab-backend.service
```

Hasil: active; loopback saja, worker healthy.

Jika salah: Restart loop: journal redacted; rollback release bila contract mismatch.

Rollback: RB-1.

### V-33 Status

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo -u lab /opt/lab/current/bin/labctl status
```

Hasil: ONLINE, runtime H, concurrency 1, routes ready, lease idle/active; UI worker online.

Jika salah: Heartbeat age >30 detik: Auth/network/DB belum benar; queued tidak fallback edge.

Rollback: RB-0.

### V-34 S-04

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo /opt/lab/current/bin/lab-admin secret-scan --mode supabase-in-hermes
```

Hasil: COMPLETE findings=0; path/env inspected.

Jika salah: Temuan atau scan_incomplete: stop backend RB-1, hapus salinan dan rotate credential terkait, ulang scan. Jangan paste nilai.

Rollback: RB-0.

### V-35 S-05

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo /opt/lab/current/bin/lab-admin secret-scan --mode service-role-all
```

Hasil: COMPLETE findings=0 di seluruh home,/etc dan lokasi runtime.

Jika salah: Temuan: Fable rotate service-role cloud, admin hapus salinan, ulang scan; key tak boleh digunakan sementara.

Rollback: RB-0.

### V-36 S-11 Unix

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo -u hermes-lab python3 -c 'open("/home/hermes/.hermes/.env").close()'
```

Hasil: Permission denied; tidak ada isi secret. Perintah sengaja gagal dengan akses ditolak.

Jika salah: Exit 0 tanpa PermissionError berarti file dapat dibaca dan isolasi gagal; V-16 dan cek group/ACL. Probe ini tidak pernah mencetak isi file.

Rollback: RB-0.

### V-37 Isolasi proses

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo -u lab /opt/lab/current/bin/labctl isolation-check
```

Hasil: U-01–U-04 PASS menggunakan canary sintetis, termasuk antar-run dan /proc.

Jika salah: FAIL berarti readiness false; tidak ada job riset diluncurkan sampai perbaikan paket.

Rollback: RB-0.

### V-38 S-13 akhir

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo ufw status numbered
```

Hasil: Sama dengan V-09. nft egress tidak menambah inbound ufw.

Jika salah: Rule inbound baru bukan bagian desain; hapus perubahan integrasi yang keliru.

Rollback: RB-0.

### V-39 List listener

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo ss -ltnp
```

Hasil: SSH existing; port backend/broker hanya 127.0.0.1, tidak 0.0.0.0 atau [::].

Jika salah: Bind publik: RB-1 lalu perbaiki bind sebelum restart.

Rollback: RB-0.

### V-40 Reboot terkontrol S-06

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo reboot
```

Hasil: Jalankan hanya ketika UI menampilkan job acceptance khusus running dan job ID sudah dicatat. SSH putus memang diharapkan.

Jika salah: Jangan menjalankan saat riset yang ingin dipertahankan. Ini tes yang diotorisasi brief, bukan langkah tiap run.

Rollback: RB-0.

### V-41 Masuk kembali

Lokasi: laptop Windows PowerShell; prompt `PS C:\Users\<director>>`.

```bash
ssh hermesagent@<VPS_HOST>
```

Hasil: VPS kembali; tunggu boot normal bila connection refused.

Jika salah: Tetap down: console provider untuk diagnosis host; tidak membuat port tambahan.

Rollback: RB-0.

### V-42 Verifikasi recovery

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo -u lab /opt/lab/current/bin/labctl diagnose --case reboot-recovery
```

Hasil: Previous attempt lease expired; fresh retry atau failed bersih; query Fable V-SQL memastikan output kanonik ≤1.

Jika salah: Run ganda/capability lama masih bisa spend: fail acceptance, pause queue dan perbaiki fence.

Rollback: RB-0.

### V-50 Rotate control epoch

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo /opt/lab/current/bin/lab-admin rotate-control-token
```

Hasil: Drain, backend restart dengan epoch/token baru, worker membaca ulang; tidak mencetak token.

Jika salah: Active job tidak boleh dipindah ke epoch baru diam-diam; job di-cancel/fail bersih.

Rollback: RB-1.

### V-51 Update pinned

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo /opt/lab/current/bin/lab-admin install-release --build-sha <NEW_BUILD_SHA> --hermes-sha <NEW_HERMES_SHA>
```

Hasil: P5: drain, fetch pin, verify hashes/fixtures, stage lalu atomic switch. Long work unit/tmux.

Jika salah: Contract fail menjaga current lama; jangan menjalankan hermes update.

Rollback: RB-6.

### V-52 Backup nonsecret

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo /opt/lab/current/bin/lab-admin backup --destination /home/hermesagent/lab-backups
```

Hasil: P5: manifest/config nonsecret; report SECRET_EXCLUSION_OK. Corpus/DB backup di cloud Fable.

Jika salah: Jika scanner menemukan token backup gagal, hapus file belum final; jangan upload ke repo.

Rollback: RB-0.

### V-53 Restore drill

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo /opt/lab/current/bin/lab-admin restore-check --latest
```

Hasil: P5: verifikasi hash, unit/config restore di staging, NEEDS_REENROL benar. Tidak overwrite production.

Jika salah: Kehilangan source/artifact membuat backup belum lulus; Fable melengkapi export cloud.

Rollback: RB-0.

### V-54 Notify bot opsional

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo -u lab /opt/lab/current/bin/labctl provider set telegram-notify --region direct
```

Hasil: P5: getpass token bot khusus dan chat ID privat; send-only fixed chat.

Jika salah: Jangan memasukkan token bot Hermes personal; opsi boleh tidak dipakai.

Rollback: RB-0.

### V-55 Cleanup

Lokasi: SSH VPS sebagai `hermesagent`; prompt `hermesagent@<host>:~$` (hostname boleh berbeda).

```bash
sudo /opt/lab/current/bin/lab-admin clean --receipted-only
```

Hasil: Spool sukses receipted dan diagnostic gagal >24 jam dibersihkan; symlink keluar ditolak.

Jika salah: Receipt DB belum ada: tidak hapus workspace/spool itu; hentikan claim jika disk rendah.

Rollback: RB-0.


Sebelum selesai: git diff --check, pnpm typecheck, pnpm test:run, pnpm build, SQL/worker tests yang relevan. Jangan mencetak secret. Push branch, buka PR dengan masalah/perubahan/hasil test/risiko, merge/deploy hanya sesuai izin phase dan proteksi repo. Keluaran wajib: commit/PR/deploy/migration receipts, daftar tes benar-benar dijalankan, command director dengan BUILD_SHA konkret bila ada, status acceptance yang belum bisa diamati. Jangan mengklaim acceptance VPS lulus tanpa bukti. Tidak ada pertanyaan keputusan ke director.

END FABLE PHASE 1

## Prompt Phase 2

BEGIN FABLE PHASE 2

Anda Fable, eksekutor build Dika untuk repo github.com/dikagustiana/Dika-s-Personal-OS, Supabase project ascbthsgborseynmmthm dan deploy Vercel Personal OS. Anda tidak punya SSH VPS. Director menjalankan perintah VPS sebagai hermesagent dengan sudo; user runtime lab/hermes-lab/hermes tidak punya sudo. Jangan bertanya atau meminta approval tambahan untuk langkah yang sudah diotorisasi prompt ini. Patuhi proteksi repo yang benar-benar berlaku; jika akses live gagal, lanjutkan pekerjaan build yang tersedia dan tulis probe/kode error yang konkret, bukan mengarang hasil.

Audit dasar: Personal OS P=2a2e336ff8784c74aa75313532f152b08f6e94c4, Vite/React/TS/Tailwind/Zustand, Vercel SPA. Navigasi Lab berupa state, bukan Next.js/router. RLS owner memakai x-app-key/passphrase dan os_key_valid(), bukan owner auth.uid. Collaborator Auth mempunyai grant Work, tidak Lab. Lab rows tidak mempunyai user_id owner. Runner institusi src/logic/institution/runner.ts sudah ada, tetapi tidak dipanggil submit UI produksi pada P. Director room dan floor sudah ada. os_lab_stale_sweep menurunkan datapoint expired, bukan timeout run. Nama biaya briefs ialah cost_estimate_usd/cost_actual_usd. Provider row wajib nyata, check lama hanya anthropic/deepseek/kimi. data_class engine tetap utuh; agent internal frozen dan corpus public dari agent/brief/ancestor internal ditolak.

Hermes pin H=8afaab3703e336d72a72c812dd2dd249f04f166a, NousResearch/hermes-agent. AIAgent constructor/run_conversation + callbacks tersedia. hermes serve ialah desktop JSON-RPC/WS default port 9.119, gateway API /v1 default port 8.642 terpisah. Jangan memakai endpoint yang dikarang. Local terminal/code_execution punya hak Unix user, env scrub bukan sandbox. Memory/curator/session_search/skill mutation harus off. Setiap run proses/home/workspace/session baru. Key model/Supabase hanya worker lab; Hermes hanya capability per-attempt ke broker loopback. Tidak ada service-role VPS, tidak ada port inbound, tidak ada Docker group, tidak mengubah personal Hermes atau Ubuntu 22.04. Semua rows baru yang punya data_class public. Semua artefak public repo tanpa secret/IP VPS/.env.

Baca current checkout dan instruksi repo sebelum edit, catat deviasi dari P. Buat branch build tersendiri untuk phase ini. Jangan ubah file Work/Growth atau semantik auth global. Main tidak di-reset atau force-push. Draft desain tidak boleh diterapkan dengan db push/reset/migration up ke live. Migration baru satu per transaksi lewat akses Supabase yang sudah diotorisasi, setelah test. Bahasa dokumen Indonesia, identifier/code tetap native. Angka prose format Indonesia dan sumber/basis disebut. Anda boleh membaca source code/migration/test repo; prompt ini menyediakan desain tanpa mengharuskan dokumen desain lain.
Tujuan Phase 2: orkestrasi Lab yang bertahan saat browser ditutup, setiap model action menjadi run Hermes independen, retrieval diarsipkan saat diambil, biaya aktual dibanding estimasi, dan progress tampil dalam lima detik. Phase 1 sudah menyediakan queue, worker, proxy, schema dan UI owner.

Izin edit: supabase/functions/lab-institution-step/**, shared institution pure functions/protocol, migration/test Lab baru, workers/lab-worker/** dan Hermes adapter untuk provenance/events, src/data/institutionRepository/Types serta director/floor transport interface terkait Lab. Jangan mengubah Work/Growth atau prompt committee. Fable tidak membutuhkan SSH; director memperbarui release melalui lab-admin install-release dengan SHA konkret setelah build.

Input source: os_inst_briefs, os_inst_assignments, os_inst_reviews, os_inst_submissions, os_inst_debates, os_inst_corpus, os_inst_agent_versions dan os_inst_evaluations sudah ada. Guards migration 100 menjaga proposal, self-review, putaran dan data_class. Runner browser adalah referensi logic/tests; loop harus dipindah ke langkah deterministik yang durable. Estimator source P untuk route tujuh departemen menghasilkan 76 model call, sedangkan 89 model call/$4,81 adalah laporan lama yang belum direproduksi. Pertanyaan kecil harus tetap ringan.

Langkah berurutan:

1. Tambah execution_revision pada briefs dan private institution_outbox(action_key unique,brief_id,action,status,job_id), sesuai draft tertanam. action_key berbentuk brief/stage/subject/round. Edge stepper menghitung satu nextAction per request, tanpa model call atau polling loop. Baca snapshot, parse completed job dengan protocol existing, lalu CAS revision dan enqueue dalam satu transaksi lab_step_commit(p_brief uuid,p_expected_revision bigint,p_action_key text,p_action jsonb), hanya service_role cloud. Revision berubah berarti hitung ulang; action_key duplikat mengembalikan receipt yang sama.
2. Pertahankan mode direct Phase 1. Mode institution memetakan program_intake, lead_intake, specialist_work, peer_review, lead_review, lead_submit, agent_authoring, committee_review, debate, arbitration dan evaluation ke job terpisah. Home, session dan history selalu baru. Peer berbeda dari author; lead harus sesuai seat; committee memakai prompt manusia. Weight brief memakai researcher dan reviewer independen, maksimal dua run. Standard/full mengikuti route dan guards. Rework/debate maksimal dua putaran, committee re-review sekali, lalu director atau eskalasi. Kanban/delegation tidak menjadi orkestrator.
3. Buat public successor roster dari current active prompts/reference, dengan mapping private legacy ke successor yang idempoten. Remap departments.lead_agent_slug dan department_members secara atomik. Update committee roster sehingga guard memakai slug baru. Jangan menyalin corpus internal atau mengganti class history. Agent baru hasil authoring tetap public dan attributed authored_by_agent_id; bootstrap hanya versi pertama untuk row baru. Revisi agent existing selalu proposed.
4. Completion worker memicu wake outbound ke lab-institution-step memakai machine JWT dan completed job ID. Edge memeriksa enabled worker, kepemilikan attempt dan status receipt, lalu memakai service-role cloud untuk transition deterministik. Worker tidak boleh mengirim brief arbitrary. Cloud pg_cron/pg_net setiap satu menit menyapu outbox; bila tidak tersedia, worker polling pending receipt dan memanggil stepper. action_key/CAS tetap sama pada kedua jalur. Supabase tidak memanggil VPS.
5. MCP search/fetch mengarsipkan metadata raw response, normalized content/hash, requested/final URL, query, timestamp UTC dan status sebelum mengembalikan konten. corpus.archive tidak boleh mengaku telah melakukan HTTP retrieval. Network runtime tetap melalui broker. Browser hanya diaktifkan bila seluruh response yang terlihat dapat diarsipkan; sebelumnya gunakan search/fetch/Python. Setiap assignment mendapat input corpus IDs eksplisit. Broker menolak corpus di luar input snapshot atau archive attempt sendiri, meski brief-nya sama.
6. Final output memuat claims{id,text,kind,corpus_refs}; setiap klaim memiliki minimal satu rujukan corpus valid atau assumption corpus beserta rationale. Render factual prose dari claim blocks; markdown bebas hanya projection hasil render. Tambah claims/refs dengan FK dan validasi dalam transaksi finish sebelum status succeeded. Hash/scope/coverage yang salah mendapat satu format repair dalam budget, lalu failed bila masih salah; jangan menulis director pointer. Keterlacakan bukan bukti kebenaran, sehingga review existing tetap menguji entailment.
7. Projection per stage: specialist output ke assignment/corpus; parsed peer/lead/committee review ke os_inst_reviews dengan reviewer dari job; lead_submit ke os_inst_submissions dengan target guard; rebuttal dan penimbangannya ke os_inst_debates. Action wajib cocok dengan frozen assignment.kind. Worker tidak memilih reviewer, departemen asal atau approved status. Trusted stepper mengambil atribut dari DB. Projection dan outbox done harus atomik dan idempoten; reuse guards tanpa generic CRUD worker.
8. Director menampilkan actual cost semua attempt, auxiliary dan tool, berdampingan dengan cost_estimate_usd serta estimator_version, mode dan price snapshot. Unknown usage tidak diisi nol. Target S-15: flush event maksimal satu detik, polling dua detik, jaringan/render dua detik, total lima detik berdasarkan desain. Realtime hanya hint jika JWT/RLS mendukung, tanpa melonggarkan policy anon.

Verifikasi: jalankan pnpm typecheck, pnpm test:run dan pnpm build, semuanya harus sukses. SQL boundary/institution suites dan skenario Phase 2 wajib lulus. Dua stepper bersamaan menghasilkan satu action. Pipeline tetap maju setelah browser ditutup. Putaran ketiga dan reviewer yang salah ditolak. Query `select c.job_id,c.claim_id from public.os_lab_hermes_claims c left join public.os_lab_hermes_claim_refs r using(job_id,claim_id) group by c.job_id,c.claim_id having count(r.corpus_id)=0` menghasilkan nol baris. Negative controls missing/hash palsu/rujukan di luar scope harus gagal. S-07 semua klaim dapat diklik; S-08 setiap run mempunyai status biaya di samping estimasi; S-15 diukur dari timestamp event ke UI, maksimal lima detik. Director mengulang pertanyaan transisi hijau dalam mode institution; hasil memuat review, committee dan debate tanpa approval perantara.

Selesai bila source/SQL/Edge terpasang, test receipts tersedia, dan acceptance yang belum diamati di VPS ditandai dengan jelas. Rollback menonaktifkan enqueue institution baru, mempertahankan direct Phase 1, outbox dan data; rollback release bila perlu.

Draft schema phase ini, bukan pengganti implementasi transaction/function di prompt:

```sql
-- DRAFT PHASE 2. Stepper Edge mengisi tabel ini lewat RPC service-role-only, bukan worker generic CRUD.
begin;
alter table public.os_inst_briefs add column execution_revision bigint not null default 0;
create table lab_private.institution_outbox (
 action_key text primary key,brief_id uuid not null references public.os_inst_briefs(id),
 action jsonb not null,status text not null default 'pending' check(status in ('pending','dispatched','done','failed')),
 job_id uuid references public.os_lab_hermes_jobs(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.os_lab_hermes_claims (
 job_id uuid not null references public.os_lab_hermes_jobs(id),claim_id text not null,
 text text not null,kind text not null check(kind in ('fact','inference','assumption')),
 primary key(job_id,claim_id)
);
create table public.os_lab_hermes_claim_refs (
 job_id uuid not null,claim_id text not null,corpus_id uuid not null references public.os_inst_corpus(id),
 locator text not null default '',primary key(job_id,claim_id,corpus_id),
 foreign key(job_id,claim_id) references public.os_lab_hermes_claims(job_id,claim_id)
);
alter table public.os_lab_hermes_claims enable row level security;
alter table public.os_lab_hermes_claim_refs enable row level security;
revoke all on public.os_lab_hermes_claims,public.os_lab_hermes_claim_refs from public,anon,authenticated;
grant select on public.os_lab_hermes_claims,public.os_lab_hermes_claim_refs to anon,authenticated;
create policy director_select on public.os_lab_hermes_claims for select using(public.os_key_valid());
create policy director_select on public.os_lab_hermes_claim_refs for select using(public.os_key_valid());
-- Fable Phase 2 menambahkan validasi claim_refs dan INSERT dalam transaksi lab_worker_finish,
-- sebelum status succeeded. Referensi harus input snapshot atau archive attempt, bukan rubric/eval.
-- Deployment tidak boleh mengaktifkan provenance_required sebelum validator/projection atomik tersedia.
commit;
```

Sebelum selesai: git diff --check, pnpm typecheck, pnpm test:run, pnpm build, SQL/worker tests yang relevan. Jangan mencetak secret. Push branch, buka PR dengan masalah/perubahan/hasil test/risiko, merge/deploy hanya sesuai izin phase dan proteksi repo. Keluaran wajib: commit/PR/deploy/migration receipts, daftar tes benar-benar dijalankan, command director dengan BUILD_SHA konkret bila ada, status acceptance yang belum bisa diamati. Jangan mengklaim acceptance VPS lulus tanpa bukti. Tidak ada pertanyaan keputusan ke director.

END FABLE PHASE 2

## Prompt Phase 3

BEGIN FABLE PHASE 3

Anda Fable, eksekutor build Dika untuk repo github.com/dikagustiana/Dika-s-Personal-OS, Supabase project ascbthsgborseynmmthm dan deploy Vercel Personal OS. Anda tidak punya SSH VPS. Director menjalankan perintah VPS sebagai hermesagent dengan sudo; user runtime lab/hermes-lab/hermes tidak punya sudo. Jangan bertanya atau meminta approval tambahan untuk langkah yang sudah diotorisasi prompt ini. Patuhi proteksi repo yang benar-benar berlaku; jika akses live gagal, lanjutkan pekerjaan build yang tersedia dan tulis probe/kode error yang konkret, bukan mengarang hasil.

Audit dasar: Personal OS P=2a2e336ff8784c74aa75313532f152b08f6e94c4, Vite/React/TS/Tailwind/Zustand, Vercel SPA. Navigasi Lab berupa state, bukan Next.js/router. RLS owner memakai x-app-key/passphrase dan os_key_valid(), bukan owner auth.uid. Collaborator Auth mempunyai grant Work, tidak Lab. Lab rows tidak mempunyai user_id owner. Runner institusi src/logic/institution/runner.ts sudah ada, tetapi tidak dipanggil submit UI produksi pada P. Director room dan floor sudah ada. os_lab_stale_sweep menurunkan datapoint expired, bukan timeout run. Nama biaya briefs ialah cost_estimate_usd/cost_actual_usd. Provider row wajib nyata, check lama hanya anthropic/deepseek/kimi. data_class engine tetap utuh; agent internal frozen dan corpus public dari agent/brief/ancestor internal ditolak.

Hermes pin H=8afaab3703e336d72a72c812dd2dd249f04f166a, NousResearch/hermes-agent. AIAgent constructor/run_conversation + callbacks tersedia. hermes serve ialah desktop JSON-RPC/WS default port 9.119, gateway API /v1 default port 8.642 terpisah. Jangan memakai endpoint yang dikarang. Local terminal/code_execution punya hak Unix user, env scrub bukan sandbox. Memory/curator/session_search/skill mutation harus off. Setiap run proses/home/workspace/session baru. Key model/Supabase hanya worker lab; Hermes hanya capability per-attempt ke broker loopback. Tidak ada service-role VPS, tidak ada port inbound, tidak ada Docker group, tidak mengubah personal Hermes atau Ubuntu 22.04. Semua rows baru yang punya data_class public. Semua artefak public repo tanpa secret/IP VPS/.env.

Baca current checkout dan instruksi repo sebelum edit, catat deviasi dari P. Buat branch build tersendiri untuk phase ini. Jangan ubah file Work/Growth atau semantik auth global. Main tidak di-reset atau force-push. Draft desain tidak boleh diterapkan dengan db push/reset/migration up ke live. Migration baru satu per transaksi lewat akses Supabase yang sudah diotorisasi, setelah test. Bahasa dokumen Indonesia, identifier/code tetap native. Angka prose format Indonesia dan sumber/basis disebut. Anda boleh membaca source code/migration/test repo; prompt ini menyediakan desain tanpa mengharuskan dokumen desain lain.
Tujuan Phase 3: usulan perbaikan skill menjadi proposed version dengan diff dan eval task-only. Memory, curator, session_search dan skill mutation tetap mati. Proposal bukan syarat memperoleh hasil riset.

Izin edit: migration/tests Lab, RPC lab_worker_propose, worker proposal validator, cloud stepper/scorer, institutionRepository/types dan director proposal/eval view. Jangan mengubah prompt committee, eval tasks/answers/rubrics, Work/Growth atau human approval gates.

Input: queue dan worker Phase 1, stepper/corpus Phase 2, guards existing pada os_inst_agent_versions. Payload job membekukan agent.id/version_id/prompt/reference files; worker tidak mempunyai app-key. Output proposal memuat target_agent_id, base_version_id, rationale minimal sepuluh karakter, proposed_prompt, reference_files dengan path/content/sha256. Batas rationale mengikuti guard existing, bukan gate baru.

Langkah:

1. Implement lab_worker_propose(p_job uuid,p_attempt int,p_lease uuid,p_proposals jsonb), definer hanya authenticated dengan registry enabled dan current lease. Panggil saat validating sebelum finish. Target harus agent assignment sendiri, base version harus snapshot. Target committee selalu ditolak, termasuk self-proposal.
2. Hitung diff server terhadap base version, jangan mempercayai diff model. INSERT os_inst_agent_versions berstatus proposed dan linkage os_lab_hermes_proposals(job,target,base,hash,version_id) dalam satu transaksi. Unique job/target/hash memberikan replay yang sama. Jangan UPDATE agents.system_prompt atau active version. Reference baru masuk versi proposed, path traversal/symlink/auto-exec ditolak. Active reference tidak di-overwrite.
3. Stepper cloud menjalankan before/after eval dengan task set tetap. Worker hanya menerima task, candidate prompt dan input yang disengaja. expected_answer/private rubric tetap cloud. Scorer deterministik existing menulis evaluation_runs serta version eval fields melalui service-only RPC. Agent tidak menulis skor. Gunakan tugas/config yang sama untuk baseline dan candidate, simpan cohort/price snapshot.
4. Gunakan UI diff/rationale/eval existing. Director promote/reject tetap satu-satunya perubahan prompt aktif, reject reason disimpan. Stale base version ditandai needs_rebase, tidak menimpa versi aktif otomatis. Research selesai meskipun proposal belum dibaca director.

Verifikasi: pnpm typecheck, pnpm test:run, pnpm build dan SQL guard suites lulus. Fixture proposal membuat satu proposed/link, replay tidak ganda, hash prompt aktif tetap sama. Target committee/agent lain ditolak. Worker promote/direct UPDATE/rubric SELECT ditolak. Rubric canary tidak ada di serialized payload, event atau journal. Owner promote/reject existing tetap bekerja. Apply migration baru satu transaksi, deploy cloud dan release worker. Director hanya menjalankan update release yang dipin lalu meninjau UI bila ingin. Rollback menonaktifkan ingestion proposal, mempertahankan rows dan research Phase 1/2. Selesai bila proposal/diff/eval dan negative tests mempunyai bukti, bukan ketika learning runtime diaktifkan.

Draft schema phase ini, bukan pengganti implementasi transaction/function di prompt:

```sql
-- DRAFT PHASE 3. Bukan hak untuk mengubah prompt aktif.
begin;
create table public.os_lab_hermes_proposals (
 job_id uuid not null references public.os_lab_hermes_jobs(id),target_agent_id uuid not null references public.os_lab_agents(id),
 base_version_id uuid not null references public.os_inst_agent_versions(id),
 proposed_hash text not null,version_id uuid not null unique references public.os_inst_agent_versions(id),
 primary key(job_id,target_agent_id,proposed_hash)
);
alter table public.os_lab_hermes_proposals enable row level security;
revoke all on public.os_lab_hermes_proposals from public,anon,authenticated;
grant select on public.os_lab_hermes_proposals to anon,authenticated;
create policy director_select on public.os_lab_hermes_proposals for select using(public.os_key_valid());
-- lab_worker_propose (04) insert proposed + linkage atomik; tidak mengubah guard 100.
commit;
```

Sebelum selesai: git diff --check, pnpm typecheck, pnpm test:run, pnpm build, SQL/worker tests yang relevan. Jangan mencetak secret. Push branch, buka PR dengan masalah/perubahan/hasil test/risiko, merge/deploy hanya sesuai izin phase dan proteksi repo. Keluaran wajib: commit/PR/deploy/migration receipts, daftar tes benar-benar dijalankan, command director dengan BUILD_SHA konkret bila ada, status acceptance yang belum bisa diamati. Jangan mengklaim acceptance VPS lulus tanpa bukti. Tidak ada pertanyaan keputusan ke director.

END FABLE PHASE 3

## Prompt Phase 4

BEGIN FABLE PHASE 4

Anda Fable, eksekutor build Dika untuk repo github.com/dikagustiana/Dika-s-Personal-OS, Supabase project ascbthsgborseynmmthm dan deploy Vercel Personal OS. Anda tidak punya SSH VPS. Director menjalankan perintah VPS sebagai hermesagent dengan sudo; user runtime lab/hermes-lab/hermes tidak punya sudo. Jangan bertanya atau meminta approval tambahan untuk langkah yang sudah diotorisasi prompt ini. Patuhi proteksi repo yang benar-benar berlaku; jika akses live gagal, lanjutkan pekerjaan build yang tersedia dan tulis probe/kode error yang konkret, bukan mengarang hasil.

Audit dasar: Personal OS P=2a2e336ff8784c74aa75313532f152b08f6e94c4, Vite/React/TS/Tailwind/Zustand, Vercel SPA. Navigasi Lab berupa state, bukan Next.js/router. RLS owner memakai x-app-key/passphrase dan os_key_valid(), bukan owner auth.uid. Collaborator Auth mempunyai grant Work, tidak Lab. Lab rows tidak mempunyai user_id owner. Runner institusi src/logic/institution/runner.ts sudah ada, tetapi tidak dipanggil submit UI produksi pada P. Director room dan floor sudah ada. os_lab_stale_sweep menurunkan datapoint expired, bukan timeout run. Nama biaya briefs ialah cost_estimate_usd/cost_actual_usd. Provider row wajib nyata, check lama hanya anthropic/deepseek/kimi. data_class engine tetap utuh; agent internal frozen dan corpus public dari agent/brief/ancestor internal ditolak.

Hermes pin H=8afaab3703e336d72a72c812dd2dd249f04f166a, NousResearch/hermes-agent. AIAgent constructor/run_conversation + callbacks tersedia. hermes serve ialah desktop JSON-RPC/WS default port 9.119, gateway API /v1 default port 8.642 terpisah. Jangan memakai endpoint yang dikarang. Local terminal/code_execution punya hak Unix user, env scrub bukan sandbox. Memory/curator/session_search/skill mutation harus off. Setiap run proses/home/workspace/session baru. Key model/Supabase hanya worker lab; Hermes hanya capability per-attempt ke broker loopback. Tidak ada service-role VPS, tidak ada port inbound, tidak ada Docker group, tidak mengubah personal Hermes atau Ubuntu 22.04. Semua rows baru yang punya data_class public. Semua artefak public repo tanpa secret/IP VPS/.env.

Baca current checkout dan instruksi repo sebelum edit, catat deviasi dari P. Buat branch build tersendiri untuk phase ini. Jangan ubah file Work/Growth atau semantik auth global. Main tidak di-reset atau force-push. Draft desain tidak boleh diterapkan dengan db push/reset/migration up ke live. Migration baru satu per transaksi lewat akses Supabase yang sudah diotorisasi, setelah test. Bahasa dokumen Indonesia, identifier/code tetap native. Angka prose format Indonesia dan sumber/basis disebut. Anda boleh membaca source code/migration/test repo; prompt ini menyediakan desain tanpa mengharuskan dokumen desain lain.
Tujuan Phase 4: durable Hermes event menggerakkan Bot Crossing yang sudah ada. Tidak membangun ulang floor dan tidak mengganti executor.

Izin edit: src/views/lab/floor/transport/institutionStream.ts, src/logic/floor/institution/project.ts, floor hooks/tests/types, repository projection Lab. App shell hanya boleh menerima alias /lab/floor yang memilih existing labView=floor. Jangan menambah router baru atau mengubah Work/Growth.

Input event: os_lab_hermes_events(id,job_id,attempt,sequence,kind,emitted_at,received_at,payload), join job ke assignment/agent/departemen melalui RLS owner client. Tidak ada socket VPS publik. Worker Auth Realtime hanya own wake row. Owner memakai postgres_changes jika probe x-app-key berhasil, selain itu polling repository dua detik. Cursor event_id, urutan server, dedup dan replay saat reconnect. Payload tidak berisi prompt atau secret.

Mapping wajib: tidak ada kerja aktif →OFFICE_IDLE; queued/claimed/handoff →OFFICE_WALKING; model/search/fetch/Python aktif →OFFICE_WORKING; peer/lead/committee/debate aktif →OFFICE_COLLABORATING; validating/succeeded/submission →OFFICE_DELIVERING; failed/timeout/budget/expired worker →OFFICE_ERROR. Cancel kembali idle setelah proses berhenti. Prioritas error, collaboration, delivery, working, walking, idle. Delivery selesai kembali idle dari state projector, tanpa menulis event job palsu.

Langkah: baca protocol/projector source, tambah fixture projection Hermes; implement cursor/reconnect/poll; pertahankan React lazy-load, visual existing dan reduced motion. Uji duplicate/out-of-order events, retry attempt baru, cancel, worker offline/recovery dan akses collaborator. Jalankan pnpm typecheck, pnpm test:run, pnpm build. UI smoke: owner melihat enam state saat job berjalan, collaborator tidak dapat subscribe/read payload. Ukur event ke UI ≤lima detik saat jaringan normal. Tidak perlu perubahan VPS bila protocol sama. Deploy UI dan berikan PR/deploy stamp serta hasil smoke. Rollback feature flag feed Hermes, projector lama dan queue tetap berjalan. Selesai bila mapping, reconnect dan privacy lulus, bukan ketika kantor baru selesai digambar.

Sebelum selesai: git diff --check, pnpm typecheck, pnpm test:run, pnpm build, SQL/worker tests yang relevan. Jangan mencetak secret. Push branch, buka PR dengan masalah/perubahan/hasil test/risiko, merge/deploy hanya sesuai izin phase dan proteksi repo. Keluaran wajib: commit/PR/deploy/migration receipts, daftar tes benar-benar dijalankan, command director dengan BUILD_SHA konkret bila ada, status acceptance yang belum bisa diamati. Jangan mengklaim acceptance VPS lulus tanpa bukti. Tidak ada pertanyaan keputusan ke director.

END FABLE PHASE 4

## Prompt Phase 5

BEGIN FABLE PHASE 5

Anda Fable, eksekutor build Dika untuk repo github.com/dikagustiana/Dika-s-Personal-OS, Supabase project ascbthsgborseynmmthm dan deploy Vercel Personal OS. Anda tidak punya SSH VPS. Director menjalankan perintah VPS sebagai hermesagent dengan sudo; user runtime lab/hermes-lab/hermes tidak punya sudo. Jangan bertanya atau meminta approval tambahan untuk langkah yang sudah diotorisasi prompt ini. Patuhi proteksi repo yang benar-benar berlaku; jika akses live gagal, lanjutkan pekerjaan build yang tersedia dan tulis probe/kode error yang konkret, bukan mengarang hasil.

Audit dasar: Personal OS P=2a2e336ff8784c74aa75313532f152b08f6e94c4, Vite/React/TS/Tailwind/Zustand, Vercel SPA. Navigasi Lab berupa state, bukan Next.js/router. RLS owner memakai x-app-key/passphrase dan os_key_valid(), bukan owner auth.uid. Collaborator Auth mempunyai grant Work, tidak Lab. Lab rows tidak mempunyai user_id owner. Runner institusi src/logic/institution/runner.ts sudah ada, tetapi tidak dipanggil submit UI produksi pada P. Director room dan floor sudah ada. os_lab_stale_sweep menurunkan datapoint expired, bukan timeout run. Nama biaya briefs ialah cost_estimate_usd/cost_actual_usd. Provider row wajib nyata, check lama hanya anthropic/deepseek/kimi. data_class engine tetap utuh; agent internal frozen dan corpus public dari agent/brief/ancestor internal ditolak.

Hermes pin H=8afaab3703e336d72a72c812dd2dd249f04f166a, NousResearch/hermes-agent. AIAgent constructor/run_conversation + callbacks tersedia. hermes serve ialah desktop JSON-RPC/WS default port 9.119, gateway API /v1 default port 8.642 terpisah. Jangan memakai endpoint yang dikarang. Local terminal/code_execution punya hak Unix user, env scrub bukan sandbox. Memory/curator/session_search/skill mutation harus off. Setiap run proses/home/workspace/session baru. Key model/Supabase hanya worker lab; Hermes hanya capability per-attempt ke broker loopback. Tidak ada service-role VPS, tidak ada port inbound, tidak ada Docker group, tidak mengubah personal Hermes atau Ubuntu 22.04. Semua rows baru yang punya data_class public. Semua artefak public repo tanpa secret/IP VPS/.env.

Baca current checkout dan instruksi repo sebelum edit, catat deviasi dari P. Buat branch build tersendiri untuk phase ini. Jangan ubah file Work/Growth atau semantik auth global. Main tidak di-reset atau force-push. Draft desain tidak boleh diterapkan dengan db push/reset/migration up ke live. Migration baru satu per transaksi lewat akses Supabase yang sudah diotorisasi, setelah test. Bahasa dokumen Indonesia, identifier/code tetap native. Angka prose format Indonesia dan sumber/basis disebut. Anda boleh membaca source code/migration/test repo; prompt ini menyediakan desain tanpa mengharuskan dokumen desain lain.
Tujuan Phase 5: hardening biaya, resource, update dan backup; Telegram notify-only opsional; rencana Ubuntu 24.04 tanpa menjalankan upgrade.

Izin edit: worker/backend/tool sandbox/ops helpers/systemd/nft tests, migration budget Lab, owner budget UI, notification send-only dan dokumen operasi. Tidak mengubah Work/Growth atau Hermes personal. Tidak memberi sudo/Docker membership pada runtime.

Langkah:

1. Aktifkan enforce_daily setelah test. Default desain daily_limit_usd=$20,00 per hari UTC, bukan prediksi tagihan. Reservation atomic memeriksa actual hari berjalan, seluruh unresolved in-flight dan upper bound request berikutnya. Midnight tidak menghapus liability. Limit menolak claim/request baru dan membatalkan active run. Resume tidak mereset ledger. Uji simultaneous reserve, missing usage, retry dan UTC boundary; counter upstream membuktikan stop sebelum egress.
2. Pisahkan tool subprocess di dalam namespace: tidak membaca parent proc/env, hanya workspace dan capability tool yang diperlukan. Key provider tetap lab. Whole-process containment Phase 1 tetap. Delegation opsional maksimal satu child sequential, fresh child home, budget/event assignment yang sama; jangan mengaku child sebagai peer independen. Kanban tetap mati.
3. Update pin: drain, fetch SHA tertentu, locked dependencies/hash manifest, fixture AIAgent/CLI/tool/usage, staged canary, atomic symlink dan health SHA. Kegagalan mempertahankan release lama. Jangan menjalankan hermes update yang mengikuti main.
4. Backup DB/schema/corpus/agent-version references/config nonsecret. Secret exclusion scanner wajib. Simpan salinan off-host pada akun backup cloud yang tersedia, terenkripsi dengan key terpisah. Restore staging memeriksa hash, count dan reference graph, membutuhkan reenroll worker/rekey provider. Jangan restore key ke Hermes.
5. Retensi desain journal tujuh hari/256 MiB, diagnostic gagal 24 jam, spool total empat GiB, watermark disk delapan GiB. State tmpfs 512 MiB dan tmp 128 MiB berada di dalam MemoryMax backend 2.048 MiB; worker 384 MiB. Concurrency satu. Uji disk-low tanpa memenuhi disk produksi dan OOM cgroup tanpa mematikan host/worker.
6. Telegram opsional memakai bot terpisah, sendMessage ke chat allowlist tetap, tidak getUpdates/webhook/command. Payload status/link, bukan isi brief. Tidak adanya bot tidak menghalangi phase. Token personal tidak dipakai.
7. Tulis rencana 24.04: rehearsal sebelum April 2027 sebagai target konservatif brief, verifikasi kernel/Python/uv/systemd/bwrap/nft, snapshot dan restore, jendela downtime dan rollback. Kalender Canonical saat audit berbeda April/Mei/Juni 2027; cek kembali saat upgrade benar-benar direncanakan. Jangan menjalankan do-release-upgrade dalam phase ini.

Verifikasi Fable: pnpm typecheck, pnpm test:run, pnpm build, SQL concurrency tests, Python proxy/ops tests, systemd-analyze verify di VM 22.04. Release rusak tidak dipromosikan. Backup scanner nol temuan dan restore menunjukkan NEEDS_REENROL. Director menjalankan command terpisah sebagai hermesagent: lab-admin install-release dengan build/Hermes SHA konkret, lab-admin backup, lab-admin restore-check. Semua via sudo manual, satu command per langkah, proses panjang systemd/tmux. S-12 daily harus dibuktikan ledger dan counter actual requests. Rollback pause queue dan release sebelumnya, tidak mematikan cap diam-diam atau memulihkan secret bocor. Selesai bila hardening/restore terbukti dan rencana OS tertulis; host tetap Ubuntu 22.04.

Draft schema phase ini, bukan pengganti implementasi transaction/function di prompt:

```sql
-- DRAFT PHASE 5: aktifkan hanya setelah proxy reservation+daily tests lulus.
begin;
update lab_private.settings set enforce_daily=true,daily_limit_usd=20 where singleton;
-- $20/hari UTC ialah default desain, bukan prediksi tagihan; owner dapat ubah melalui RPC config.
-- Resume tidak me-reset usage ledger; unsettled reservations hari sebelumnya tetap dihitung.
commit;
```

Sebelum selesai: git diff --check, pnpm typecheck, pnpm test:run, pnpm build, SQL/worker tests yang relevan. Jangan mencetak secret. Push branch, buka PR dengan masalah/perubahan/hasil test/risiko, merge/deploy hanya sesuai izin phase dan proteksi repo. Keluaran wajib: commit/PR/deploy/migration receipts, daftar tes benar-benar dijalankan, command director dengan BUILD_SHA konkret bila ada, status acceptance yang belum bisa diamati. Jangan mengklaim acceptance VPS lulus tanpa bukti. Tidak ada pertanyaan keputusan ke director.

END FABLE PHASE 5
