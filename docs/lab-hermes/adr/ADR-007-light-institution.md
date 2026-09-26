# ADR-007: Jalur direct Phase 1 dan institusi durable Phase 2

Status: dipilih dalam desain, 26 September 2026. Dasar source: audit P/H pada 01/02.

## Konteks

R-05 tidak mempunyai submit produksi; runner browser tidak bertahan saat tab ditutup. Full pipeline sebagai syarat pertanyaan kecil bertentangan D-12.

## Opsi

Menjalankan runner browser lama tetap rapuh. Langsung seluruh committee membuat Phase 1 berat. Direct job lalu stepper deterministik durable memisahkan kesiapan runtime dari institusi.

## Keputusan

Phase 1 mode direct: satu specialist assignment, satu Hermes job, hasil unreviewed ke director. Weight menentukan budget/durasi, bukan memanggil committee. Phase 2 mode institution: stepper Edge memilih satu action atomik dan enqueue; setiap model action menjadi job terpisah. brief memakai satu researcher dan opsional satu independent review, maksimum dua run; standard/full memakai route institusi. Cap dua rework/debate tetap. Dept/committee tidak dijalankan sebagai kanban/subagent.

## Konsekuensi dan verifikasi

Estimasi direct dan institusi disajikan berbeda dengan estimator_version. Baseline terlapor 89 calls/$4,81 tidak disulap menjadi angka source. Tidak mengubah human approval akhir, tidak menambah approval di tengah.
