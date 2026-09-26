# ADR-010: Latensi klaim ketika kapasitas tersedia

Status: keputusan desain, 26 September 2026. Target S-03 dari brief ialah klaim ≤10 detik; VPS memakai concurrency satu sesuai D-12 dan sumber kapasitas brief.

## Konteks

Dua job yang tiba hampir bersamaan tidak mungkin keduanya mulai dalam sepuluh detik jika job pertama berlangsung lebih dari sepuluh detik dan concurrency satu. Klaim lalu menahan job kedua tanpa eksekusi memalsukan latensi dan memperbesar recovery lease.

## Opsi

Naikkan concurrency tanpa hitungan RAM, klaim awal palsu, atau definisikan kapan slot tersedia. Pilihan pertama meningkatkan risiko OOM, kedua menyesatkan log.

## Keputusan

Pertahankan nilai target ≤10 detik untuk worker online dan idle, serta ≤10 detik dari slot tersedia bagi job yang memenuhi prioritas. Ukur juga total queue_wait dari created_at, jangan menghapus waktu antre. Ini pengecualian cakupan target S-03, dinyatakan eksplisit karena tidak mungkin dijamin untuk arbitrary backlog. Fable menguji satu job saat idle dan burst queue terpisah. Worker offline/busy ditampilkan di UI. Tidak ada perubahan angka target.

## Konsekuensi

S-03 sesuai teks tanpa kondisi tidak dapat dinyatakan lulus untuk seluruh beban. Laporan acceptance menyebut kondisi test dan distribusi antre. Tidak membuka slot kedua sebelum resource evidence mendukungnya. S-15 diuji ketika jaringan tersedia; outage diberi indikator offline.
