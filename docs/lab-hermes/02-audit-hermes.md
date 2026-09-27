# Audit source Hermes

Temuan utama: Hermes mempunyai antarmuka yang dibutuhkan, tetapi `hermes serve` bukan API OpenAI pada port yang disebut catatan lama. Runtime lokal juga bukan sandbox. Integrasi memakai adapter tipis terhadap `AIAgent`, proses baru per attempt, serta pembatasan filesystem dan jaringan di luar Hermes.

Snapshot `H = 8afaab3703e336d72a72c812dd2dd249f04f166a`, branch `main`, diambil 26 September 2026. Semua path berikut relatif terhadap [NousResearch/hermes-agent pada H](https://github.com/NousResearch/hermes-agent/tree/8afaab3703e336d72a72c812dd2dd249f04f166a); setiap bukti path berarti file pada SHA H, bukan main yang bergerak. Versi VPS **tidak ditemukan di source**; O-06 memastikannya. Source menang atas dokumentasi/issue yang lebih lama.

## H-01. Versi dan update

Pin commit H; `pyproject.toml` masih menyebut versi paket `0.0.0`, sehingga bukan identitas build yang memadai. `hermes_cli/subcommands/update.py`, `hermes_cli/update_cmd.py`, `hermes_cli/update_cmd_git.py` mengatur fetch/update checkout dan dependency serta pemulihan proses. Jangan menjalankan `hermes update` pada release Lab. Checkout detached SHA, dependency lock, manifest wheel dan hash dipasang read-only; upgrade mengubah symlink release sesudah contract test. Instalasi personal tidak disentuh. Probe O-06 membandingkan SHA personal dengan H tanpa menyamakan keduanya.

## H-02. Home, profiles, koeksistensi

`hermes_constants.py:get_hermes_home` memakai context override lalu `HERMES_HOME`, lalu default platform `~/.hermes`. `HERMES_RUNTIME_DIR` memisahkan runtime tool. `hermes_cli/profiles.py` mendukung profiles di server, bukan hanya desktop. `hermes_cli/subcommands/dashboard.py` menyatakan named profile dapat bergabung ke server machine-level; `--isolated` memilih server tersendiri. Profile saja tidak menjadi batas Unix.

Dua instalasi user berbeda dapat hidup bersama bila home, runtime directory, cache dan port dibedakan. Tidak ada port yang wajib dibuka keluar. Pilihan desain: root-owned release Lab terpisah; `HERMES_HOME=/run-state/home`, `HOME=/run-state/home`, workspace `/workspace` dan proses baru setiap attempt di mount/PID namespace. Tidak memasang gateway, cron, desktop, atau profile personal. Cek bentrok port dan permission di O-06. Perilaku di host aktual **tidak ditemukan di source**.

## H-03. Antarmuka programatik

| Antarmuka | Request, response, sesi, auth | Penilaian |
|---|---|---|
| `hermes serve` | FastAPI headless yang sama dengan dashboard; JSON-RPC/WebSocket chat. Default loopback port `9119`, `--port 0` tersedia. `session.create` → session identifier; `prompt.submit` dengan `session_id,text` mengembalikan penerimaan streaming, event berikutnya melalui WS. `session.interrupt`, `session.close`, `session.delete`, replay `session.events.since` berada di dispatcher TUI. Auth token dashboard di loopback juga berlaku | Surface desktop besar; bukan kontrak `/v1` di issue lama |
| Gateway API server | Adapter messaging terpisah, default `8642`. GET `/health`, `/v1/models`; POST `/v1/chat/completions` (messages/model/stream), `/v1/responses`, `/v1/runs`; GET `/v1/runs/{run_id}`, `/events`; POST `/stop`, `/steer`, `/approval`. JSON OpenAI dan SSE, native run envelope/events. `API_SERVER_KEY` diwajibkan saat production connect | Lebih dekat API, tetapi membawa lifecycle gateway, session continuity dan konfigurasi server |
| CLI | `hermes chat --query-file PATH --oneshot --format stream-json`, `--model`, `--provider`, `--toolsets`, `--skills`, `--max-turns`, `--run-budget`. Non-TTY one-shot tersedia. Output JSONL event; jangan mengarang flag `--json` | Fallback adapter bila import berubah, setelah fixture JSONL diuji |
| Python | `run_agent.py:AIAgent`, `run_conversation(user_message, system_message=..., conversation_history=[], task_id=...)`; result dict berisi final response/messages dan boundary turn. Constructor menerima session UUID, prompt, toolsets, callback tool/event, model/provider/api_mode/base_url, batas | Dipilih: paling eksplisit untuk prompt/tool/isolation; version pin wajib karena API internal |

Bukti: `hermes_cli/subcommands/dashboard.py`, `hermes_cli/web_server.py`, `hermes_cli/web_server_chat.py`, `tui_gateway/methods_session.py`, `tui_gateway/methods_prompt.py`, `tui_gateway/contracts/sessions.py`, `gateway/platforms/api_server.py`, `gateway/platforms/api_server_openai_routes.py`, `gateway/platforms/api_server_runs.py`, `hermes_cli/_parser.py`, `run_agent.py`, `agent/conversation_loop.py`.

Pada gateway chat, system messages menjadi ephemeral system prompt di atas core. Tanpa session header, continuity dapat diturunkan dari isi request; prompt sama tidak menjamin sesi baru. Selalu UUID baru bila memakai alternatif gateway. Native run mendukung model/provider overrides; chat `model` dapat resolve alias `model_routes`, dengan aturan `direct_model_requests`. Tidak menganggap slash command `/model` sebagai parameter API universal. Toolset gateway umumnya dipilih dari konfigurasi platform, bukan janji allowlist arbitrer per request.

Pada adapter pilihan, system prompt diberikan ke `run_conversation(system_message=...)`; SKILL.md/reference dimaterialisasi dan dibatasi di workspace. `tool_start_callback(id,name,args)` dan `tool_complete_callback(id,name,args,result)` mengamati tool; `event_callback` dan `stream_delta_callback` mengamati stream. `_safe_callback` di `agent/tool_executor.py` menelan exception callback. Oleh sebab itu callback tidak digunakan untuk menjamin archive/cost/otorisasi. Usage diperiksa pada H-07. Endpoint `/lab/v1/*` di kontrak adalah **kode baru Fable**, bukan kapabilitas native Hermes.

### Detail wire serve yang diverifikasi

Endpoint WS serve adalah `/api/ws`, bukan `/v1/chat/completions`. Bukti H: `hermes_cli/web_routers/chat_ws.py`, `tui_gateway/contracts/sessions.py`, `tui_gateway/contracts/prompt_voice.py`. Contoh request JSON-RPC valid pada schema source:

```json
{"jsonrpc":"2.0","id":1,"method":"session.create","params":{"source":"lab-probe","cwd":"/workspace","model":"kimi-k2.6","provider":"kimi-coding","close_on_disconnect":false}}
```

Respons result mempunyai `session_id`, `stored_session_id`, `message_count`, `messages`, `info`. Minting sesi tidak selalu membuat DB row sampai prompt pertama. Gunakan session_id respons, lalu:

```json
{"jsonrpc":"2.0","id":2,"method":"prompt.submit","params":{"session_id":"<SESSION_ID>","text":"<PROMPT>"}}
```

Result mempunyai status `streaming|queued|steered|redirected`, optional user_row_id; output berikutnya event WS, bukan final synchronous response. `session.interrupt`, `session.close`, `session.delete` memakai session_id; close melepas sesi live, delete menghapus stored session, bukan operasi yang sama. `session.events.since` menyediakan replay. `hermes_cli/web_server_chat.py` memeriksa Host/Origin dan token/ticket pada upgrade; modern flow mempunyai subprotocol `hermes-gateway-v1` serta ticket. Jangan menaruh token pada URL/log untuk client Lab. Adapter pilihan menghindari seluruh surface desktop ini.

Gateway API terpisah mengirim JSON status run awal, status/event stream dan token usage fields (`input_tokens`, `output_tokens`, `total_tokens`, `cache_read_tokens`) menurut `gateway/platforms/api_server_runs.py`; completion chat memakai choices/usage OpenAI. Request native mengambil instructions, input/history dan model/provider overrides. Field/usage native tidak dijadikan kontrak final Lab karena auxiliary/retry coverage tetap perlu proxy. Ini alternatif yang diaudit, bukan endpoint yang harus dibangun Fable.

## H-04. Isolasi dan learning

Sesi baru tersedia melalui UUID constructor, tetapi tidak otomatis mengisolasi disk, memory, skill atau process globals. Gunakan proses/home/workspace baru sekaligus. `skip_memory=True`, `skip_background_review=True`, `skip_context_files=True`, `load_soul_identity=False`, `save_trajectories=False`; session DB bila terbentuk tetap di home attempt dan dibuang. Jangan memberikan history lama.

Config yang terbukti di `hermes_cli/config_defaults.py`: `memory.memory_enabled=false`, `memory.user_profile_enabled=false`, `memory.nudge_interval=0`, `auxiliary.background_review.enabled=false`, `curator.enabled=false`, `skills.auto_load=[]`, `skills.external_dirs=[]`, `skills.project_discovery=false`, `skills.inline_shell=false`. Provider memory kosong dan tool memory/session_search/skill mutation tidak diekspos. `run_agent.py:_get_session_db_for_recall` dapat membuka DB bila session_search tersedia; flag memory saja tidak cukup. Config berlaku pada home/profile; constructor memberi kontrol per proses/request. Tidak ada klaim satu flag “disable learning” menutup seluruh jalur. Tes U-04 menguji daftar tool, file canary dan memory lintas run.

## H-05. Tool dan makna execution

Allowlist eksplisit dapat dibangun dengan `toolsets.py:create_custom_toolset` dan `model_tools.py:_select_tool_names`; `None` berarti semua tool, sehingga dilarang. Disabled toolsets dikurangkan setelah pemilihan. Adapter memverifikasi nama tool yang diekspos dan guard dispatch, termasuk tool yang dipanggil lewat execute_code. Daftar MCP yang ditemukan dibandingkan manifest; nama prefix tidak ditebak.

“parallel” adalah [Parallel.ai](https://parallel.ai), bukan mode concurrency. `plugins/web/parallel/provider.py` memakai SDK paid dengan `PARALLEL_API_KEY`, atau keyless search melalui `plugins/web/keyless_mcp.py` pada `https://search.parallel.ai/mcp`. Keyless bergantung rate limit/availability, bukan saldo Kimi. `tools/web_tools.py` memilih backend search/extract terpisah. Paid search/extract ditagih layanan tool, bukan otomatis provider model; harga di 03. Phase 1 broker menyediakan search keyless dan fallback pencarian publik melalui parser yang sudah ada, serta HTTP fetch; raw web tool Hermes tidak diekspos agar tidak melewati budget/archive.

Browser lokal/headless tersedia (`tools/browser_tool.py`, `tools/browser_tool_session.py`); Browserbase/CDP/cloud alternatif membutuhkan config tersendiri. Tidak perlu browser untuk Phase 1 search+fetch+Python; browser opt-in kemudian harus memakai proxy capture dan context sementara, tidak profile personal.

`tools/environments/local.py` menjalankan shell sebagai Unix user proses. `tools/environments/local_env_policy.py` menyaring env provider/tool; `tools/code_execution_env.py` menyaring nama secret, tetapi explicit passthrough dapat memasukkan kembali sejumlah variabel. `tools/code_execution_tool.py` menjalankan Python lokal dan RPC tool; bukan mini interpreter aman milik Lab. File/proc yang dapat dibaca user tetap dapat dibaca tool. Source `SECURITY.md` secara eksplisit menyatakan env scrubbing bukan containment. Karena itu key provider berada pada worker `lab`, bukan pada runtime `hermes-lab`.

## H-06. Batas dan cancel

Constructor menerima `max_iterations`, `max_tokens`, `iteration_budget`, `run_budget_seconds`; default max_iterations sangat besar, jangan digunakan. `agent/conversation_loop.py` melakukan pemeriksaan budget/wrap-up. `agent/interrupt_control.py` menyediakan interrupt dan hard_interrupt; API native mempunyai stop. Tidak ada janji hard wall-clock untuk subprocess yang hang. Supervisor memberi deadline monotonic, soft interrupt lalu membunuh seluruh PID namespace. Batas durasi/output/call/budget dipaksakan worker/proxy; semua angka desain di ADR-003. API request HTTP mempunyai timeout sendiri, berbeda dari deadline job.

## H-07. Usage dan biaya

`agent/turn_usage.py` mengumpulkan input/output/cache/reasoning dan session API calls/cost; respons provider yang tidak punya usage dapat menghasilkan penggunaan tidak diketahui. `hermes_cli/config_defaults.py` memperingatkan token analytics merupakan lower bound dan dapat melewatkan auxiliary/retry. Tidak memakai ringkasan Hermes sebagai ledger tagihan. Broker menghitung dari response usage setiap upstream request, termasuk retry/auxiliary, menggunakan price snapshot. Missing usage tetap reserved/unknown, bukan nol. Biaya yang disajikan ialah calculated from usage; invoice provider hanya diklaim jika tersedia rekonsiliasi. Cache tokens tidak dihitung ganda.

## H-08. Provider

`hermes_cli/auth.py` mendaftarkan `kimi-coding` dengan endpoint Moonshot global `https://api.moonshot.ai/v1`, `kimi-coding-cn` dengan `https://api.moonshot.cn/v1`, DeepSeek `https://api.deepseek.com/v1`, Anthropic dan Nous. `hermes_cli/auth_zai_kimi.py` membedakan Kimi Code `https://api.kimi.com/coding`; saldo API dan Coding Plan tidak disamakan. `hermes_cli/runtime_provider.py` memilih `chat_completions` atau `anthropic_messages`, termasuk custom provider/endpoint. Constructor dapat override model/provider/base_url/api_mode per proses. Config auxiliary meliputi compression, vision, web summarization, background review dan delegation; panggilan ini berpotensi biaya tambahan.

Lab memakai route alias konfigurasi di DB yang di-resolve proxy, main Kimi API global atau China sesuai O-07; model awal global `kimi-k2.6` (harga resmi 03). Auxiliary dinonaktifkan jika tidak diperlukan; yang wajib dipakai runtime diarahkan ke proxy yang sama dengan batas yang sama. Anthropic memakai native Messages, custom proxy URL berakhiran `/anthropic` agar deteksi transport cocok; tetap kirim api_mode eksplisit dan contract test. Nous hanya aktif setelah token Lab tersendiri dan price snapshot tersedia; tidak menyalin OAuth personal. O-07 memiliki kedua cabang saldo serta fallback DeepSeek yang sudah diotorisasi D-08.

## H-09. Nous tool gateway

Provider model dan tool bukan satu pilihan. `tools/web_tools.py` mempunyai jalur managed Nous (search Perplexity, extract Firecrawl) dan backend lain dengan kredensial sendiri. Auth gateway dapat tetap menyediakan tool walaupun model utama bukan Nous, bergantung credential/config; tidak menyimpulkan seluruh tool gratis atau bundled. Jalur Lab menutup auto-selection ini dengan tool manifest dan broker; tidak mewariskan auth Nous personal. Status entitlement Lab **tidak ditemukan di source**; O-07 mengecek akun khusus bila opsi Nous dipakai.

## H-10. Delegation dan kanban

`tools/delegate_tool.py`, `tools/delegate_tool_config.py` menjalankan child agent dengan thread/process/tool resources serta depth/concurrency budget. Default concurrent child pada config tool mencapai 10 child, terlalu besar untuk VPS ini; itu nilai source, bukan rekomendasi. Callback child tidak otomatis menjadi assignment/review independen Lab. Kanban dispatcher men-spawn worker dan mengelola queue sendiri; lihat `tools/kanban_tools.py` dan `hermes_cli/kanban.py`. Integrasi tidak memakai kanban. Phase 1–4 delegation off; Phase 5 opsional satu child di dalam assignment, sequential, budget bersama, fresh subdirectory, seluruh event diberi parent assignment dan child ID. Peer review/committee tetap run Lab lain. Tidak memetakan dispatcher menjadi departemen.

## H-11. Log dan provenance

`hermes_state.py` memakai SQLite `state.db` di Hermes home; message record mencakup tool call/result. `gateway/session_transcript.py` menyediakan transkrip JSONL pada jalur gateway; `hermes_logging.py` mengatur agent/error/gateway log. Mode, tool dan provider menentukan apakah URL/http metadata tersimpan lengkap. Source tidak menjamin setiap fetch tersimpan dengan bytes, timestamp dan hash yang diperlukan Lab. Log mendukung audit/diagnosis; bukan bukti archive-at-retrieval. Per-run home/log sementara hanya dikirim sebagai event yang telah disaring. Raw prompt/secret/header tidak masuk journald.

## H-12. Ekstensi dan MCP

MCP stdio, SSE dan streamable HTTP tersedia (`tools/mcp_tool_transport.py`, `tools/mcp_tool_config.py`, `tools/mcp_tool_registration.py`). Header auth dan include/exclude tool filter dapat diatur. Worker dapat menyediakan MCP lokal dengan capability per-run; Hermes tidak membutuhkan Supabase SDK/key. Desain `lab.search`, `lab.fetch`, `corpus.archive`, `corpus.read`, `corpus.assume` dijalankan worker dan memanggil RPC terbatas. Hanya response setelah commit boleh sampai ke model. Hooks pre-tool dapat menolak dispatch; post hooks/callback bukan transaksi archive. Exact tool manifest dan fixture MCP dipin pada H; CLI fallback memakai MCP yang sama.

## H-13. systemd

Source installer gateway (`hermes_cli/gateway.py` dan modul service terkait) mendukung lifecycle messaging; itu tidak membuktikan user D-Bus hidup pada VPS. Flag serve H-03 dapat dijalankan system unit `User=hermes-lab`, `ExecStart=<release>/bin/hermes serve --host 127.0.0.1 --port 17861 --isolated`, `EnvironmentFile` token, `Restart=on-failure`; angka port contoh milik desain, bukan default Hermes. Unit tersebut **bukan** yang dipasang Lab: dua unit produksi di 06 ialah worker dan backend adapter. Backend mengimpor AIAgent dan mengisolasi per run; tidak membutuhkan desktop, messaging, cron, atau user service. Panduan spesifik system unit untuk kombinasi adapter Lab **tidak ditemukan di source** karena komponen ini baru. Unit/rancangan lengkap ada pada kontrak build dan diuji `systemd-analyze verify` oleh Fable/director.

## H-14. Keamanan

`SECURITY.md` membedakan local trusted operator dari ingestion web yang memerlukan whole-process wrapping. Local terminal mempunyai hak user runtime. Skills/plugins berada dalam trust envelope proses. `hermes_cli/web_server.py:_resolve_session_token/_require_token` melindungi API loopback dengan token session; `--insecure` tidak membypass auth non-loopback pada H. `gateway/platforms/api_server.py` mewajibkan API_SERVER_KEY di production; cabang no-key manual/test bukan default aman untuk deployment. Jangan menjalankan backend tanpa auth hanya karena bind loopback; Unix user personal adalah principal berbeda. Threat model 05 menguji filesystem, /proc, network, capability, budget, serta prompt injection. Tidak mengklaim prompt saja sebagai sandbox.
