# Prompt Claude Code: FSRE publish path

Lokasi: `docs/lab/fsre-publish-path/PROMPT.md` di repo Personal OS, di samping `PRD.md`. Cara pakai: buka Claude Code di checkout Personal OS, lalu kirim pesan:

> Baca `docs/lab/fsre-publish-path/PROMPT.md` dan jalankan.

---

Anda menjalankan PRD `docs/lab/fsre-publish-path/PRD.md`: menyambungkan pipeline FSRE ke situs, sehingga paket model yang di-stage agent dapat dilihat Dika di partner room 4F, di-approve di sana, lalu tampil di dikagustiana.com production. PRD mengatur apa yang dibangun; prompt ini mengatur cara kerja. Kalau keduanya bertentangan, PRD yang menang, dan Anda mencatat pertentangannya di laporan.

## Lingkungan

Anda mulai di checkout `Dika-s-Personal-OS`. Dua repo lain dibutuhkan sebagai sibling:

```
../fsre-skills          github.com/dikagustiana/fsre-skills
../dikagustiana.com     github.com/dikagustiana/dikagustiana.com
```

Kalau belum ada, clone keduanya. Kalau sudah ada, `git fetch` dan pastikan working tree bersih sebelum menyentuhnya.

| Repo | Commit acuan PRD | Branch kerja | Aturan repo yang wajib dibaca dulu |
|---|---|---|---|
| Personal OS | `8050540` | `feat/fsre-publish-path` | `CLAUDE.md` seluruhnya |
| fsre-skills | `be7defc` | `feat/preview-package` | `README.md`, `db/README.md` |
| dikagustiana.com | `bed215d` | `feat/fia-live` | `README.md:108-117`, `docs/company-models/implementation-brief-v3.1.md:35-86` |

Supabase: `personal-os` = `ascbthsgborseynmmthm` (edge function), `dikagustiana-com` = `asypkbkiebjvvpimewfp` (database FSRE dan situs).

Mulai setiap repo dengan `git status --short` dan `git rev-parse HEAD`, dan catat SHA-nya. Kalau HEAD sudah bergeser dari commit acuan, baca perubahannya dulu dan catat dampaknya terhadap PRD sebelum mengedit.

## Keputusan

O1–O5 di PRD §4 sudah diputuskan: rekomendasinya berlaku. Anda boleh menyimpang hanya dengan alasan tertulis di laporan, kecuali O4 (backup dan uji rollback di scratch sebelum DDL) yang wajib. Keputusan lebih kecil yang muncul saat bekerja: ambil sendiri, catat di laporan dengan alasannya, jangan berhenti untuk bertanya kecuali masuk daftar "Berhenti dan laporkan".

Yang tetap menunggu tindakan Dika adalah langkah production di bawah, bukan keputusan. Siapkan perintahnya, lanjutkan pekerjaan lain, dan laporkan apa yang menunggu.

## Wewenang Anda

- Membaca ketiga repo sepenuhnya.
- Membuat branch kerja di atas, commit kecil (satu perubahan logis per commit), push branch ke GitHub, dan membuka **draft PR** di setiap repo. Dika yang merge.
- Menjalankan tes lokal, termasuk Postgres 17 scratch untuk pytest fsre-skills (`FSRE_TEST_PG_URL`).
- Supabase MCP **read-only** ke kedua project untuk verifikasi katalog: `execute_sql` hanya `SELECT`, `has_*_privilege`, `to_regclass`, dibungkus `begin transaction read only`.
- Deploy edge function `fsre-events` dan `fsre-approve` ke `ascbthsgborseynmmthm`, setelah M2 lulus.

## Bukan wewenang Anda (siapkan perintah persisnya, Dika yang menjalankan)

- DDL apa pun ke database production, termasuk 0000–0005 FSRE.
- Mengatur password role, secret edge function (`FSRE_STATUS_DB_URL`, `FSRE_APPROVER_DB_URL`), env Vercel, atau exposed schemas Data API.
- Memanggil `approve` di production.
- Merge ke `main` di repo mana pun.

## Larangan keras

- Tidak membaca, mencetak, atau meng-commit nilai secret. Nama env var boleh, nilainya tidak.
- Tidak `apply_migration`, `supabase db push`, `db reset`, atau `migration up` untuk DDL FSRE. DDL FSRE tercatat di `fsre.schema_migrations`, bukan di ledger migrasi situs.
- Tidak membuat skema paket baru, tabel publikasi baru, atau fungsi `fsre-publish`. Kontrak tunggalnya `model_package` 3.1.0.
- Tidak mengubah `tools/publish.py`, `fsre.publication`, `model_snapshots`, atau `workbooks`.
- Tidak menambah dependency dan tidak bump major.
- Tidak melonggarkan guard, RLS, grant, atau gate.
- Tidak memakai angka perusahaan asli di repo mana pun.
- Tidak menjadikan sumber S6 (media/broker) sebagai nilai, dan tidak memakai screenshot StockMap atau prototipe PTBA sebagai data.
- Tidak mengubah `VERSION_TO_APPROVE = 'v1'` di mode Synthetic (`src/views/lab/fsre/FsreLivePanel.tsx:35`).
- Tidak `push --force`, `reset --hard`, rewrite history, atau hapus branch.

## Urutan kerja

1. **M1, fsre-skills (PRD §6.1).**
   - Tulis `db/postgres/0005_preview.sql` dan `rollback/0005_preview_down.sql` dengan gaya 0004.
   - Tulis tesnya di atas seed SYNP golden-0018 (`tests/test_db_live.py` atau `tests/test_db_preview.py`), dengan kontrol negatif: approver tetap tidak bisa SELECT tabel; status_reader dan anon tidak bisa execute; withdrawn ditolak; rollback bersih.
   - Update `db/README.md`, `docs/deployment-notes.md`, `CHANGELOG.md`.
   - Jalankan `python -m pytest -q tests` dan `tools/check_all.py` di Postgres scratch. Tempel output asli. Push dan buka draft PR.
2. **M2, runbook database (PRD §7).**
   - Tulis `docs/deployment-runbook-0005.md` di fsre-skills: backup dan uji restore/rollback di scratch (O4), lalu 0000 → set password → 0001–0003 → 0004a → set password → 0004 → 0005, expose `fsre_published` saja, bucket.
   - Setiap langkah punya kolom "dijalankan oleh", "perintah", "hasil yang diharapkan".
   - Setelah Dika melapor selesai, jalankan verifikasi read-only PRD §7 dan tempel hasilnya.
3. **M3, Personal OS (PRD §6.2 A–G).** Urutan commit:
   - (a) aksi `preview` di `supabase/functions/_shared/fsreInput.ts` dan `fsre-approve`, plus update `src/data/fsreFunctions.test.ts` (daftar fungsi DB menjadi `can_approve`, `approve_package`, `preview_package`)
   - (b) `previewPackage` di `src/data/fsreApproval.ts`
   - (c) salin modul viewer situs ke `src/logic/lab/fsre/modelPackage/` dengan header pin, plus tes header
   - (d) `src/views/lab/fsre/FsrePackagePreview.tsx`
   - (e) `PublishControl` di `FsrePanel.tsx`: check → lihat paket → approve
   - (f) `src/logic/lab/fsre/actorRoster.ts` dan `liveMap.ts`, plus tes
   - (g) live source ditawarkan di `FsreReplay.tsx`, label mode diselaraskan

   Verifikasi sebelum setiap commit: `pnpm typecheck`, `pnpm test:run`, `pnpm build`. Tempel output asli. Push dan buka draft PR.

   Setelah M2 lulus: deploy kedua fungsi, lalu tulis untuk Dika bentuk connection string tanpa password beserta pilihan pooler-nya. Setelah Dika mengatur secret, panggil `check` dengan company dan versi fiktif. Hasil yang benar: reasons "no package … staged", bukan error koneksi.
4. **M4, situs (PRD §6.3 A–C).**
   - Flag `__FIA_LIVE__`, registry published-only tanpa fixture di bundle, penolakan provenance selain `filings`, error `not-available` / `refused` / `failed`, perluasan `scripts/assert-no-synthetic.mjs`, koreksi `docs/company-models/schema-proposal-v3.md`.
   - CI harus hijau: eslint `--max-warnings=35`, typecheck, vitest, `MIN_TESTS` tidak turun.
   - Push, buka draft PR, lalu minta Dika membuat preview deploy Vercel dengan `VITE_FIA_LIVE=true`.
5. **M5, ujung ke ujung di scratch (PRD §8).** Rekam setiap langkah dan outputnya.

## Cara melapor

- Tulis laporan per repo sesuai PRD §11 (`docs/.../report-fsre-publish-path.md`), dan commit laporan itu di branch kerja repo yang bersangkutan.
- Di setiap gate, kirim ringkasan ke Dika: apa yang selesai (dengan bukti), apa yang menunggu Dika (dengan perintah persis), apa yang Anda putuskan sendiri (dengan alasan).
- Jangan mengarang hasil. Kalau sesuatu tidak bisa diverifikasi, tulis "tidak terverifikasi" beserta sebabnya.

## Berhenti dan laporkan bila

- butuh perubahan kontrak `model_package` atau grant tabel baru
- tes gagal dua kali dengan sebab yang sama
- perubahan lebih besar dari perkiraan
- repo berbeda dari PRD dengan cara yang mengubah desain
- sebuah langkah membutuhkan secret atau tindakan production yang bukan wewenang Anda

Bahasa: dokumen dan laporan dalam Bahasa Indonesia; kode, komentar, identifier, dan pesan commit dalam bahasa Inggris (konvensi Personal OS dan fsre-skills). Teks UI situs memakai British English.
