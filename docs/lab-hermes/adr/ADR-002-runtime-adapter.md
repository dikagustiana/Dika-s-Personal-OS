# ADR-002: Pilih adapter AIAgent per proses, bukan desktop serve

Status: dipilih dalam desain, 26 September 2026. Dasar source: audit P/H pada 01/02.

## Konteks

H-03 memisahkan serve JSON-RPC dan gateway API. UI desktop/messaging session lifecycle tidak diperlukan untuk antrean Lab.

## Opsi

Serve: remote UI luas dan version churn. Gateway /v1/runs: native events/stop tetapi session/config tersentral. CLI stream-json: proses terpisah, parsing fixture perlu. AIAgent: constructor eksplisit, callback dan cancel tersedia, API internal perlu pin.

## Keputusan

Pilih backend adapter milik Lab, import AIAgent pada H, proses baru setiap attempt. Dua persistent system units; child dibungkus whole-process namespace. Backend loopback port 17861, worker broker 17862 (alokasi desain, bukan port publik). CLI stream-json fallback hanya setelah tes kesetaraan; adapter tidak menganggap endpoint baru sebagai native Hermes.

## Konsekuensi dan verifikasi

Fable menulis adapter dan contract tests terhadap pinned H. Jika H berubah tidak kompatibel, update ditolak otomatis dan symlink release lama dipakai. Tidak mengaktifkan gateway/cron. D-11 tetap terpenuhi.
