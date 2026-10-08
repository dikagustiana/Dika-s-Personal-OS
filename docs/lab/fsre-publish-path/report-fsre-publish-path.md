# Laporan: FSRE publish path, repo Personal OS (M3, M5, dan ringkasan ketiga repo)

Pelaksana: Claude Code, 8 Okt 2026. PRD di folder ini (`PRD.md`), cara kerja di `PROMPT.md`.
Branch: `claude/fsre-publish-path-q3tqng`, draft PR https://github.com/dikagustiana/Dika-s-Personal-OS/pull/110. Dika yang merge.

Laporan per repo yang lain: fsre-skills `docs/report-fsre-publish-path.md` (PR https://github.com/dikagustiana/fsre-skills/pull/1), situs `docs/company-models/report-fsre-publish-path.md` (PR https://github.com/dikagustiana/dikagustiana.com/pull/44).

## 0. Ringkasan buat Dika

1. Database: migrasi `0005_preview` (fungsi `fsre.preview_package`) + rollback + tes + runbook bring-up 0000→0005 ada di fsre-skills PR #1. Belum ada yang diterapkan ke project; DDL production itu langkahmu, perintahnya baris per baris di `docs/deployment-runbook-0005.md`, backup dan gladi scratch dulu (O4).
2. 4F: tombol approve sekarang tiga langkah: `check` → "Read package" (sheet, sumber, tie-out, gate, provenance, content hash, dengan hasil pemeriksaan kontrak situs di atas grid) → approve, aktif hanya kalau ketiganya beres. Paket yang bukan `filings` tetap bisa di-approve kalau database mengizinkan, tapi panelnya bilang situs production akan menolaknya.
3. Building: feed live pipeline (`fsre_status.events`) sudah ditawarkan sebagai run di mode Replay; belum tersambung sampai kedua fungsi di-deploy dan diberi secret. Mode "Live office" (transport v2) tetap disabled dan dinamai supaya tidak tertukar.
4. Situs: `VITE_FIA_LIVE=true` memuat viewer atas paket published saja, tanpa fixture di bundle (dibuktikan dua lapis), menolak provenance selain `filings`, dan bilang jujur kalau database belum ada. Satu celah ketemu dan ditutup: paket yang sub-industrinya tidak ada di `sub-industries.json` dulu hilang diam-diam, sekarang ditolak dengan alasan.
5. Ujung ke ujung di scratch (Postgres 16, 0000→0005, paket golden SYNP): stage → preview → approve lewat edge function **asli** di bawah Deno → `model_packages` terisi → situs live menolak paket sintetis dengan alasan, situs preview menampilkannya. Rekaman lengkap di §5.
6. Belum di-deploy: `fsre-events` dan `fsre-approve` (menunggu M2 lulus, sesuai prompt). Bentuk connection string ada di §6.
7. Tidak ada secret yang dibaca atau ditulis; tidak ada DDL ke production; tidak ada `approve` di production; data SAMB tidak disentuh.

## 1. SHA dan commit

| | SHA |
|---|---|
| Awal (acuan PRD, HEAD `main`) | `8050540` |
| Akhir (kode) | `b09ca3b`; laporan ini di commit berikutnya |

| Commit | PRD | Isi |
|---|---|---|
| `f7d34ef` | 6.2 A | `fsre-approve` aksi `preview` → `fsre.preview_package(company, version)`; `fsreInput.ts` `APPROVAL_ACTIONS`; `fsreFunctions.test.ts` memaku daftar fungsi DB = `can_approve`, `preview_package`, `approve_package` |
| `0681611` | 6.2 B | `fsreApproval.preview` mengembalikan result (`ok` / `not-connected` / `refused`+reasons / `failed`); `createFsreApproval(send)` + `fsreApproval.test.ts` |
| `48cab02` | 6.2 C | `src/logic/lab/fsre/modelPackage/`: 15 berkas salinan situs @`bed215d8…` dengan header pin; `pin.test.ts` |
| `f43fcfe` | 6.2 C | `packagePreview.ts` + `FsrePackagePreview.tsx` + tes + fixture `synp.SYNTHETIC.package.json` |
| `6b2e338` | 6.2 D | `PublishControl`: check → read → approve; content hash; peringatan provenance |
| `69bb522` | 6.2 F | `actorRoster.ts` (kosong, frozen, O5) + `liveMap.ts` + tes |
| `b09ca3b` | 6.2 E | `REPLAY_SOURCES` = replay + `connectedLiveSource(fsreLiveFeed, fsreApproval)`; MODES "Live office" |

## 2. Output verifikasi (asli)

Sebelum setiap commit: `pnpm typecheck` (bersih, `tsc -b --force`), `pnpm test:run`, `pnpm build` (`✓ built`). Angka tes per commit:

| Commit | Test files | Tests | Build |
|---|---|---|---|
| (a) `f7d34ef` | 156 | 2603 passed | ✓ built in 16.33s |
| (b) `0681611` | 156 | 2608 passed | ✓ built in 15.59s |
| (c) `48cab02` | 157 | 2632 passed | ✓ built in 15.90s |
| (d) `f43fcfe` | 159 | 2656 passed | ✓ built in 16.71s |
| (e) `6b2e338` | 159 | 2659 passed | ✓ built in 15.04s |
| (f) `69bb522` | 160 | 2665 passed | ✓ built in 14.11s |
| (g) `b09ca3b` | 160 | 2665 passed | ✓ built in 14.27s |

Contoh baris asli (gate (a)):

```
=== typecheck
> personal-os@0.1.0 typecheck /home/user/Dika-s-Personal-OS
> tsc -b --force
=== test:run
 Test Files  156 passed (156)
      Tests  2603 passed (2603)
=== build
✓ built in 16.33s
```

Tidak ada SQL yang berubah di repo ini, jadi `scripts/*-tests.sh` tidak relevan. `src/views/lab/fsre/fsreRules.test.ts` (aturan sumber: tanpa literal angka di komponen, tanpa kata status sendiri, tanpa nilai warna, British English, satu formatter) hijau pada setiap commit; `FsrePackagePreview.tsx` memenuhi semuanya (konstanta dan aritmetika di `packagePreview.ts`).

## 3. Perbedaan repo vs PRD, dan keputusan sendiri

| # | Hal | Keputusan / alasan |
|---|---|---|
| 1 | Nama branch: prompt `feat/fsre-publish-path` | Sesi ini dipaku harness ke `claude/fsre-publish-path-q3tqng`; push ke branch lain bukan wewenang. PR dibuka dari branch itu. |
| 2 | 6.2 C hanya menyebut `contract/*`, `engine/*`, `format.ts` | `validate.ts` mengimpor `@/data/industryChain` dan `@/data/capitalConditions` (daftar situs; tanpa angka perusahaan), `checkFormulas` butuh `model/checks.ts` + `model/workbook.ts`, `types.ts` butuh `constants.ts`. Semuanya disalin verbatim dengan header pin yang sama. Satu-satunya edit: dua import alias `@/data/...` di `validate.ts` menjadi relatif, ditulis di baris kedua berkas itu (repo ini tidak punya alias). `model-package.schema.json` tidak disalin (JSON tidak bisa memuat header; TypeScript tidak membacanya). |
| 3 | Salinan di bawah `src/logic/lab/fsre/` | `fsreRules.test.ts` memindai satu level saja, jadi aturan building tidak mengenai salinan; aturan situs berlaku di situs. Dicatat di pesan commit (c). |
| 4 | Teks UI | Building berbahasa Inggris; tombol "Read package {version}" dan peringatan "This package is not from filings (its provenance is …), so it will not appear on the production site even once approved." menggantikan kalimat Indonesia di PRD §6.2 D. |
| 5 | Angka paket di 4F | Diformat oleh formatter **situs** (`modelPackage/format.ts`: kurung untuk negatif, dua desimal di bawah sepuluh) supaya 4F menampilkan persis yang akan tampil di situs; hitungan building tetap lewat `format.ts` building. Dicatat di header `packagePreview.ts`. |
| 6 | `FsreApproval.preview` wajib, bukan opsional | Approve mensyaratkan preview; antarmuka opsional akan memaksa `PublishControl` menangani "tidak ada preview" sebagai jalur approve. Fake di tes diperbarui. |
| 7 | `fsreFunctions.test.ts` baris `.approver` | Berkas memuat byte backspace mentah (0x08) di tempat `\b`, sehingga assertion itu tidak pernah cocok dengan apa pun. Diperbaiki menjadi `\b` dalam commit (a); dicatat di pesan commit. |
| 8 | 6.2 E, mode `live` | Dibiarkan disabled sebagai "Live office" dengan catatan "Waits for the v2 transport; the live feed is a run under Replay". Feed M5 adalah **run** di Replay, bukan mode. `VERSION_TO_APPROVE` tidak disentuh. |
| 9 | 6.2 F, transisi | Runner tetap `stage.skills[0]`; actor yang ter-roster ke skill yang ada di stage yang sama menang (agent spesifik). Roster kosong, `Object.freeze`, tes memaksa setiap nilai roster adalah skill yang ada di data. |
| 10 | 6.2 G, deploy | **Ditunda** sesuai prompt ("Setelah M2 lulus: deploy kedua fungsi"); M2 menunggu Dika. Fungsi sudah dijalankan utuh di bawah Deno terhadap scratch (§5). |
| 11 | `PRD.md` dan `PROMPT.md` | Di-commit di folder ini (prompt menyebut lokasinya di repo ini; belum ada saat sesi mulai). |
| 12 | `deno.lock` | Deno menulisnya ke root repo saat M5; dihapus, tidak di-commit. |

## 4. Keadaan repo saat mulai

`git status --short` kosong, HEAD `8050540` = acuan PRD. Untuk fsre-skills (`be7defc`) dan situs (`bed215d`) juga sama dengan acuan; tidak ada pergeseran yang mengubah desain.

## 5. M5: ujung ke ujung di scratch (rekaman)

Lingkungan: Postgres **16.15** scratch (container tidak punya Postgres 17 maupun daemon Docker), database `fsre_scratch`, 0000→0005 + seed SYNP dari `fsre-skills/tests/test_db_live.py::_seed` (manifest di `partner_reviewed/in_progress` dengan persetujuan manifest, satu review note escalated, paket golden-0018 di-stage router). Edge function **asli** dari repo ini dijalankan dengan Deno 2.9.6 (`npx -y deno@2.9.6 run --node-modules-dir=none --allow-net --allow-env --allow-read supabase/functions/<fn>/index.ts`; `supabase functions serve` tidak tersedia). Stand-in HTTP satu port (`stub_server.py`, Python) menggantikan: gate passphrase Personal OS (`os_auth_state` → 0 failures, `os_verify_key` → true hanya untuk satu kunci uji, `os_auth_record` → null) dan PostgREST untuk situs (`GET /rest/v1/model_packages` dengan `Accept-Profile: fsre_published` → SELECT sebagai `anon`; profile lain → 406 `PGRST106`). **Bukan** gate asli dan **bukan** PostgREST asli; dicatat sebagai tidak terverifikasi di §7.

```
fsre-events  POST {}                     tanpa x-app-key → {"ok":false,"reason":"Unauthorized"} [401]
             POST {} dengan kunci        → {"ok":true,"waves":[{"wave_id":"wave-live","last_at":"…","events":1}]} [200]
             POST {wave, afterSeq:0}     → seq 1 package_staged SYNP packed/passed router ref SYNP-FY25-r1
fsre-approve action publish              → {"ok":false,"reason":"bad-request"} [400]
             check   r1                  → ok:false ["1 escalated review note(s) wait for your decision"]
             preview r1                  → ok:true status staged, content_hash b1974718…, package: meta.provenance "filings",
                                           subIndustry "SYNPROC", sheets reported 15 / model 20 / assumptions 0
             preview r9                  → ok:false ["no package SYNP-FY25-r9 staged for SYNP"]
             approve r1 (terkunci)       → ok:false, tidak ada yang berubah
             (partner clears RN-SYNP-G3-1 lewat SQL)
             check   r1                  → ok:true
             approve r1                  → ok:true approved_by "Dika (owner, Personal OS partner room)"
             check   r1                  → ok:false ["SYNP-FY25-r1 is published, not waiting", …]
             preview r1                  → ok:true status published, hash sama
SQL anon     fsre_published.model_packages → 1 baris (r1, meta.status published, workpaper.approvedBy Dika)
SQL anon     fsre.package_release         → ERROR: permission denied for schema fsre
status view  seq 1 package_staged r1; seq 2 approved r1
--- release kedua, dilabeli synthetic (provenance synthetic, nama/versi SYNTHETIC, subIndustry SYN-CEM = fixture situs)
             check r2 → ok:true; approve r2 → ok:true
             preview r1 → ok:false ["SYNP-FY25-r1 is withdrawn, not readable"] status withdrawn
             package_release: r1 withdrawn, r2 published; model_packages: hanya r2; status view seq 3 approved r2
```

Situs (build dari working tree branch `feat/fia-live`, `VITE_SUPABASE_URL` ke stand-in, `vite preview --host 127.0.0.1`, dibaca Chromium/Playwright):

| Putaran | DB | `VITE_FIA_LIVE=true` | `VITE_FIA_PREVIEW=true` |
|---|---|---|---|
| 1 sebelum fix situs | r1 filings/SYNPROC published | assert-no-synthetic lulus; **SYNP tidak tampil dan tidak dijelaskan**; slate tampil; tanpa SYNTHETIC | sama + banner preview |
| 1 setelah fix `registry.ts` | sama | alert "Not shown: … SYNP: meta.subIndustry SYNPROC is not a sub-industry the section lists…" | alert sama |
| 2 | r2 synthetic/SYN-CEM published | alert "Not shown: … meta.provenance synthetic is not filings; production shows models built from filings only"; tanpa kata SYNTHETIC | SYNP tampil; `/finance/finance-in-action/synp` = model page "Synthetic Process Co (SYNTHETIC) SYNP", 51 sel grid |

Dua temuan dari putaran ini:
- PRD §8 mengharapkan situs menolak SYNP "karena provenance synthetic". Paket golden yang dibuat `build_package.py` justru `provenance: "filings"` (sesuai `case.json` golden-0018). Gerbang provenance situs bergantung pada kejujuran pipeline; kontrol sesungguhnya adalah preview 4F (menampilkan provenance) sebelum approve, dan approval di database.
- Sub-industri paket (`SYNPROC`) tidak ada di daftar situs → sebelumnya hilang diam-diam. Diperbaiki di situs (`46825d8`). Untuk paket asli pertama, `sub-industries.json` harus memuat sub-industri pilot lebih dulu.

Tidak ada `approve_package` dengan paket sintetis di production: semua di scratch.

## 6. Deploy (6.2 G), disiapkan, menunggu M2

Setelah M2 lulus, Claude Code men-deploy `fsre-events` dan `fsre-approve` ke `ascbthsgborseynmmthm` (`verify_jwt` on, seperti fungsi lain yang memakai `checkAppKey`). Secret yang Dika set di project `personal-os` → Edge Functions → Secrets, tanpa password ditulis di mana pun selain dashboard:

| Secret | Role | Bentuk (password diganti `<PASSWORD>`) |
|---|---|---|
| `FSRE_STATUS_DB_URL` | `fsre_status_reader` | `postgresql://fsre_status_reader.asypkbkiebjvvpimewfp:<PASSWORD>@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres` |
| `FSRE_APPROVER_DB_URL` | `fsre_approver` | `postgresql://fsre_approver.asypkbkiebjvvpimewfp:<PASSWORD>@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres` |

Pilihan pooler: **transaction mode (port 6543)**. Alasan: edge function berumur pendek dan banyak instance, pooler punya IPv4 (host direct `db.<ref>.supabase.co` IPv6-only tanpa add-on), dan kode sudah `prepare: false, max: 1` sehingga aman di transaction mode; kedua fungsi hanya memanggil `select fsre.fn(...)` tanpa transaksi lintas statement. Session mode (port 5432) juga jalan kalau transaction mode ditolak; komentar di `fsre-events/index.ts` menyebut session mode, keduanya cocok dengan `prepare:false`. Host persis (`aws-0-…` atau `aws-1-…`) dibaca dari Dashboard → Connect → Transaction pooler; region project `ap-southeast-1` (diverifikasi read-only). Uji setelah secret terpasang: `check` dengan `{company:"NONE", version:"v0"}` harus menjawab `reasons: ["no package v0 staged for NONE"]`, bukan `not-configured`/`call-failed`.

## 7. Belum selesai / tidak terverifikasi, dan langkah yang menunggu Dika

| Hal | Status | Perintah / tempat |
|---|---|---|
| M2 bring-up database production | menunggu Dika | fsre-skills `docs/deployment-runbook-0005.md` bagian 1–7 |
| Verifikasi read-only §7 PRD | **tidak terverifikasi** (belum ada DDL) | runbook bagian 8, dijalankan Claude Code setelah laporan Dika |
| Deploy dua fungsi + uji `check` production | ditunda sampai M2 | §6 |
| Preview deploy Vercel `VITE_FIA_LIVE=true` | menunggu Dika | laporan situs §6 |
| `dispatch.json` (O5) | belum ada | isi `ACTOR_ROSTER` di `src/logic/lab/fsre/actorRoster.ts`, satu baris per agent, plus tes |
| PostgREST asli dan runtime Supabase Edge | tidak terverifikasi di sesi ini (stand-in) | terverifikasi setelah M2 + deploy |
| Postgres 17 | tidak terverifikasi (16.15 di container) | gladi O4 oleh Dika di `supabase start` |
| Merge ketiga PR | Dika | #1 (fsre-skills), #110 (Personal OS), #44 (situs) |
