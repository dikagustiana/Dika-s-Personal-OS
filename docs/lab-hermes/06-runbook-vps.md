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

## Pemeriksaan UI sesudah V-39

Director membuka Lab tanpa terminal. Pilih lab-researcher, executor Hermes, Kimi route yang lulus probe. Submit kalimat acceptance transisi hijau persis dari brief. Job dibuat, claim ≤10 detik, tool search/fetch/python tampil, hasil masuk director room dengan sumber/model/token/biaya. Klik cancel pada job tes lain, proses berhenti ≤30 detik. Tambah public agent dari Registry, pilih template config dan prompt, run pertama ≤10 menit. Ubah model/provider config lalu run baru, model ID harus mengikuti config tanpa deploy.

Jika S-01 selesai kurang dari 400 detik, uji S-02 terpisah melalui Run biasa dengan prompt: “Jalankan terminal Python yang menunggu 420 detik lalu mencetak LONG_RUN_OK. Sesudah itu jelaskan bahwa ini probe runtime, bukan hasil riset.” Agent tes memakai terminal timeout 450 detik, job timeout 900 detik, cap $2,00 (target desain untuk tes saja); Fable membolehkan argumen timeout ini pada fixture manifest. Hasil sukses dan durasi DB >400 detik, bukan edit timestamp. Tes ini tidak dipakai sebagai bukti kualitas brief transisi hijau.

V-SQL, oleh Fable dengan akses read-only setelah acceptance:

```sql
select j.id,j.status,j.attempt,
 extract(epoch from(j.claimed_at-j.created_at)) as claim_seconds,
 extract(epoch from(j.finished_at-j.attempt_started_at)) as duration_seconds,
 count(c.id) filter(where c.kind='output') as canonical_outputs
from public.os_lab_hermes_jobs j
left join public.os_inst_corpus c on c.id=j.final_corpus_id
 group by j.id order by j.created_at desc;
select provenance->>'job_id' as job_id,count(*)
from public.os_inst_corpus where kind='output' and provenance ? 'job_id'
group by provenance->>'job_id' having count(*)>1;
```

Query kedua harus kosong; Fable juga menghitung output corpus berdasarkan provenance.job_id agar output duplikat di luar pointer tidak tersembunyi. Tes reboot boleh mengulang model call karena at-least-once, tetapi hasil kanonik tidak boleh ganda.

## Rollback

RB-0: langkah read-only atau idempoten, tidak perlu rollback. Keluar dari tmux dengan detach menjaga proses install hidup; bukan membunuhnya. Untuk langkah lain, jalankan rollback terkait sebagai langkah terpisah.

### RB-1 Stop backend

Lokasi SSH admin, prompt hermesagent@<host>:~$.

```bash
sudo systemctl stop hermes-lab-backend.service
```

Hasil: backend dan seluruh child berhenti, worker menjaga antrean. Error unit missing sebelum install berarti tidak ada yang dihentikan. Tidak menghentikan Hermes personal.

### RB-2 Stop worker

Lokasi SSH admin, prompt hermesagent@<host>:~$.

```bash
sudo systemctl stop lab-worker.service
```

Hasil: claims berhenti, lease yang tersisa dipulihkan setelah startup. Revoke credential dari UI bila rollback disebabkan kebocoran. Stop worker tidak menghapus job/database.

### RB-3 Hapus key route

Lokasi SSH admin, prompt hermesagent@<host>:~$.

```bash
sudo -u lab /opt/lab/current/bin/labctl provider remove <ROUTE_NAME>
```

Hasil: route not-ready, key lokal dihapus tanpa dicetak; provider revoke tetap dilakukan pada akun provider. Error unknown route berarti sudah tidak ada.

### RB-4 Hapus aturan integrasi sesudah backend stop

Lokasi SSH admin, prompt hermesagent@<host>:~$.

```bash
sudo /opt/lab/current/bin/lab-admin egress-remove
```

Hasil: hanya table inet lab_egress dihapus; ufw/SSH tetap. Helper menolak bila backend masih aktif. Jangan menjalankan Hermes Lab tanpa aturan ini.

### RB-5 Kembalikan userns jika sebelumnya nol

Lokasi SSH admin, prompt hermesagent@<host>:~$.

```bash
sudo sysctl -w kernel.unprivileged_userns_clone=0
```

Hasil: nilai nol, backend bwrap harus tetap stop atau memakai fallback namespace systemd yang lulus tes. Tidak dilakukan bila baseline sudah satu.

### RB-6 Rollback release

Lokasi SSH admin, prompt hermesagent@<host>:~$.

```bash
sudo /opt/lab/current/bin/lab-admin rollback --previous
```

Hasil: current symlink ke manifest sebelumnya, units restart, runtime SHA sesuai manifest lama. Tidak mengembalikan schema dengan DROP data; queue pause saat compatibility belum pulih. Jika release sebelumnya tidak ada, helper menjaga backend stop dan worker paused.

## Spesifikasi unit yang dibuat paket Fable

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
