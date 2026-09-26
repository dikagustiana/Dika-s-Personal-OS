# ADR-006: Pindahkan key provider ke worker dan isolasi seluruh run sejak Phase 1

Status: dipilih dalam desain, 26 September 2026. Dasar source: audit P/H pada 01/02.

## Konteks

Terminal dan execute_code dapat membaca semua file user runtime. D-10 dan S-11 harus berlaku Phase 1; menunggu seluruh containment sampai Phase 5 meninggalkan kebocoran nyata.

## Opsi

Env scrub saja tidak cukup. Docker group setara root ditolak. Key di home Hermes dengan spending cap membatasi nominal tetapi tetap bocor. Worker model proxy + whole-process bubblewrap memisahkan key dan filesystem tanpa user sudo.

## Keputusan

Key provider milik lab mode 0600; runtime hanya per-attempt capability proxy. Backend spawn bwrap dengan private PID/proc/tmp, read-only runtime libs, bind home/workspace attempt saja, no host /home,/etc secrets,/run control. nftables output untuk UID hermes-lab hanya NEW connection ke worker broker loopback; established reply tetap diizinkan. No capability, no sudo, no Docker. Ubuntu 22.04 user namespaces diprobe; bila dinonaktifkan, admin mengaktifkan kernel.unprivileged_userns_clone untuk bwrap sesuai langkah eksplisit, kemudian tes ulang. Bila host tetap menolak, backend memakai systemd namespace fallback yang dijelaskan 06 dan tetap fail-closed sampai tes lulus; tidak menjalankan raw local tools.

## Konsekuensi dan verifikasi

Phase 1 menerima baseline containment tambahan karena mencegah pembacaan sesi lain dan key; Phase 5 memperketat pemisahan proses tool di dalam namespace. Ini mengubah urutan mitigasi, bukan menambah approval. Kerugian residual: exploit kernel/proxy dan pengeluaran capability dalam cap. Disk namespace bukan disk quota; watchdog tetap diperlukan.
