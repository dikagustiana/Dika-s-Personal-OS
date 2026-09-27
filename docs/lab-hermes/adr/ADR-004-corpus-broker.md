# ADR-004: MCP broker memblokir sampai archive berhasil

Status: dipilih dalam desain, 26 September 2026. Dasar source: audit P/H pada 01/02.

## Konteks

Log/transkrip tidak menjamin bytes/timestamp dan callback Hermes dapat menelan error. Lab menghendaki archive saat retrieval.

## Opsi

Ekstraksi log saja terlambat dan kehilangan data. Hook post-tool mudah bypass dan tidak fail-closed. MCP broker dengan network enforcement mengikat retrieval ke transaksi corpus; log menjadi bukti pendamping.

## Keputusan

Pilih MCP milik lab: search/fetch/archive/read/assume. Archive sebelum response, hash UTF-8 content sesuai trigger lama; simpan hash bytes mentah tambahan. Seluruh network runtime hanya ke broker, raw web/browser-fetch tak terbungkus tidak diekspos. Phase 1 mencatat sumber; Phase 2 mewajibkan graph klaim lengkap dan commit archive sebelum setiap retrieval kembali.

## Konsekuensi dan verifikasi

Jika Supabase down, content tidak boleh sampai model. Research dapat berhenti bersih; tidak diam-diam meneruskan sumber tak tercatat. Browser Phase 2 hanya jika proxy capture mencakup semua respons yang terlihat model; jika belum, tetap search/fetch, bukan fitur browser palsu. Reference permanen skill juga berhash dan eksplisit.
