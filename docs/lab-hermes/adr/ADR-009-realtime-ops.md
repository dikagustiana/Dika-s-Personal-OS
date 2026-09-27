# ADR-009: Polling menjamin kemajuan, Realtime hanya mempercepat

Status: dipilih dalam desain, 26 September 2026. Dasar source: audit P/H pada 01/02.

## Konteks

Owner memakai x-app-key; penerusan header ke Realtime belum terbukti. VPS dapat offline dan SSH sering putus.

## Opsi

Mengandalkan Realtime saja kehilangan wakeup. Membuka policy anon demi animasi membocorkan Lab. Polling terotorisasi dengan Realtime sebagai hint tetap bekerja.

## Keputusan

Worker poll 2 detik dan optional AuthJWT subscription wake row miliknya. UI repository polling 2 detik memakai passphrase; durable events berurutan, batch flush ≤1 detik. Target tool terlihat ≤5 detik pada jaringan normal (S-15). Online bila DB heartbeat ≤30 detik; offline >30 detik. Service system units, restart, root-owned release. Tidak ada fallback edge saat worker offline.

## Konsekuensi dan verifikasi

Phase 4 menghubungkan event ke floor yang sudah ada; literal /lab/floor hanya ditambah sebagai alias navigasi jika diinginkan dalam scope Lab, tidak mengganti router app. Realtime probe gagal tidak memblokir Phase 1. Event payload tidak mengandung prompt/secret.
