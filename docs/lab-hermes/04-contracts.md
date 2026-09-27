# Kontrak eksekusi

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
