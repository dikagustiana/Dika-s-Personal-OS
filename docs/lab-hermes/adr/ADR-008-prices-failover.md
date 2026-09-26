# ADR-008: Harga dan route adalah snapshot config

Status: dipilih dalam desain, 26 September 2026. Dasar source: audit P/H pada 01/02.

## Konteks

Saldo global/China berbeda. Model ID/harga catatan lama bukan bukti catalog sekarang. Auxiliary dan tool mempunyai biaya sendiri.

## Opsi

Hardcode model memerlukan deploy. Auto fallback tanpa batas dapat merubah kualitas/biaya dan memakai akun tak dimaksud. Route config + price snapshot + failover eksplisit dapat diaudit.

## Keputusan

Kimi global kimi-k2.6 default setelah probe kredensial; China memakai route tersendiri dengan mata uang CNY dan FX pembukuan eksplisit. DeepSeek flash opsi murah; Anthropic/Nous dapat dipilih tanpa deploy setelah credential/price config siap. Failover off default; daftar alternatif per agent dengan cap sama, hanya pada 429/insufficient_balance sebelum output berguna, bukan fallback edge. Auxiliary off atau lewat proxy yang sama. Tidak ada harga 0 untuk usage unknown.

## Konsekuensi dan verifikasi

Budget memakai peak list price yang dibekukan dan konteks maksimum sebagai reservasi konservatif; perubahan price refresh berlaku job baru. Bila tak ada price/credential, submit ditolak dengan pesan konfigurasi, bukan job menghilang. Seluruh angka biaya di 03 berasal halaman resmi atau ditandai asumsi.
