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
