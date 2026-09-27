# ADR-003: At-least-once dengan commit hasil idempoten dan budget sebelum panggilan

Status: dipilih dalam desain, 26 September 2026. Dasar source: audit P/H pada 01/02.

## Konteks

Network dan reboot membuat exactly-once eksekusi eksternal mustahil tanpa dukungan transaksi provider. Callback/usage Hermes bukan hard spending gate.

## Opsi

At-most-once kehilangan pekerjaan setelah crash. Exactly-once label tanpa transaksi provider menyesatkan. At-least-once + fencing menjaga hasil tunggal, tetapi panggilan provider dapat berulang.

## Keputusan

Pilih at-least-once, satu hasil kanonik per job, lease token baru setiap attempt. DB time otoritatif. Lease 60 detik, heartbeat 10 detik, poll idle 2 detik, cancel/control poll 5 detik, fail-closed setelah 20 detik tanpa DB, soft kill grace 10 detik. Maksimal 3 attempt, backoff 10 lalu 30 detik ditambah jitter 0–3 detik. Target S-03/S-14 tidak berubah. Concurrency 1. Durasi brief 900 detik, standard 2.700 detik, full 7.200 detik; turn 20/50/90, output per call 4.096/8.192/8.192 token; cap biaya $2,00/$6,00/$12,00 per job. Semua angka ini target desain awal, bukan limit provider; alasan: ruang riset panjang, batas kerugian eksplisit dan VPS 4 GB.

## Konsekuensi dan verifikasi

Cost ledger mencakup semua attempt. Reserve upper bound sebelum tiap request dan sebelum retry; unknown tetap ditahan. Network partition menghentikan proxy dan child sebelum lease habis. Callback completion lama tidak boleh menulis. S-12 memakai limit buatan $0,001: request ditolak sebelum keluar. Daily kill switch penuh Phase 5; pause manual sudah Phase 1.
