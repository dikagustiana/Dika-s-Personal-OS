# Pemeriksaan offline draft

Keputusan utama: pemeriksaan ini menguji SQL dan schema tanpa koneksi Supabase, kredensial atau provider. Script memakai PGlite dan Ajv dengan versi dipin pada package.json. Dependency test terisolasi dari package aplikasi.

Dari root repo, pasang dependency pemeriksaan:

```bash
npm install --prefix docs/lab-hermes/checks --ignore-scripts
```

Lalu jalankan:

```bash
npm test --prefix docs/lab-hermes/checks
```

Expected: `SCHEMAS_COMPILED_OK`, `SCHEMA_AND_FUNCTIONS_OK`, `BEHAVIOR_OK`, satu succeeded job/satu output/director, dan `SCHEMA_NEGATIVES_AND_RECOVERY_OK`. Error/exit nonzero berarti draft atau kontrak perlu diperbaiki. Fixture tidak menyimpan data atau mengubah repo aplikasi.

Basis schema: CREATE TABLE migration 073, penambahan model/refusals run, migration boundary 074, institution 099 dan guards 100. Auth users/uid, passphrase serta updated_at memakai shim fixture. Seluruh draft 001 sampai 005 diterapkan berurutan pada database memori kosong. Uji ini bukan pengganti suite SQL Supabase penuh, RLS/refresh JWT nyata, tes race multikoneksi, provider transport atau commissioning VPS. Nilai hash/model/biaya fixture bukan bukti retrieval atau billing nyata. PGlite 0.5.8, Ajv 8.20.0 dan ajv-formats 3.0.1 adalah dependency pemeriksaan yang benar-benar dipakai saat audit.
