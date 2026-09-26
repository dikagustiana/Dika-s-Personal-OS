# ADR-005: Gunakan agent public baru untuk menjaga trigger lama

Status: dipilih dalam desain, 26 September 2026. Dasar source: audit P/H pada 01/02.

## Konteks

R-10: class agent frozen dan corpus public dari agent/brief internal ditolak. D-07 melarang penghapusan mesin itu dan melarang routing berdasarkan class.

## Opsi

Menghapus guard bertentangan scope. Mengubah internal→public menabrak frozen guard/history. Menulis corpus tanpa identitas agent memutus provenance. Public successor dengan prompt yang sama memenuhi intent dan constraint.

## Keputusan

Phase 1 membuat public lab-researcher. UI konfigurasi Hermes pada legacy internal memanggil owner RPC yang membuat successor public, menyalin prompt aktif dan reference, dan memilih ID baru. Tidak menyalin corpus/history. Phase 2 remap seat/lead ke successor dalam transaksi setup yang idempoten. Initial active version boleh di-bootstrap hanya untuk agent baru dalam RPC owner; revisi tetap proposed. Committee successor hanya copy prompt aktif manusia, tidak belajar atau menerima proposal runtime.

## Konsekuensi dan verifikasi

Tidak ada router egress berbasis data_class baru. Semua rows Hermes yang mempunyai kolom tersebut public. Guard lama tetap aktif. Names provider check diperluas dengan nous, bukan dibuat null: run guard lama mengharuskan provider row nyata. Provider/model per-agent snapshot tetap dibekukan saat submit. Ini adaptasi kompatibilitas, bukan relaning history.
