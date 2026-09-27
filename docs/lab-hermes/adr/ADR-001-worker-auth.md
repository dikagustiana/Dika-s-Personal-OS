# ADR-001: Worker memakai Auth machine user dan RPC sempit

Status: dipilih dalam desain, 26 September 2026. Dasar source: audit P/H pada 01/02.

## Konteks

Lab memakai passphrase owner, bukan owner UUID. Memberikan passphrase atau service-role kepada VPS membuat worker dapat mengubah Work/Growth dan mengesahkan output.

## Opsi

Role PostgreSQL langsung + password: connection pooling/network dan DDL role lebih rumit, tidak cocok Realtime. JWT custom bertanda tangan: signing secret berdaya terlalu luas atau issuer baru. Edge token broker: layak dan mudah revoke, tetapi menambah hop per heartbeat/tool dan log token harus dijaga. Auth machine user + definer RPC: refresh terkelola dan cocok Realtime, perlu registry allowlist.

## Keputusan

Pilih Auth machine user khusus tanpa membership/grant. Registry private memetakan auth.uid() ke worker aktif. Tidak pernah menyimpan x-app-key atau service-role di VPS. Pairing satu kali melalui Edge yang hanya menerima kode sekali pakai hasil tindakan owner; setelah itu worker hanya Auth + RPC. Semua RPC memeriksa registry, lease dan resource scope, bukan current_user definer.

## Konsekuensi dan verifikasi

Rotasi revoke registry dahulu sehingga JWT lama langsung tidak berkuasa walau belum expired, kemudian enroll identitas baru. Kredensial bocor dapat membaca konteks job yang diklaim dan memalsukan hasil job itu, tetapi tidak approve/promote/eval/Work/Growth. Tes behavioral sebagai anon, collaborator, worker revoked dan worker tanpa lease wajib.
