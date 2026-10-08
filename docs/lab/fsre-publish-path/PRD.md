# PRD: FSRE publish path, Personal OS → dikagustiana.com

Lokasi dokumen ini: `docs/lab/fsre-publish-path/PRD.md` di repo Personal OS. Pelaksana: Claude Code, dijalankan dari checkout Personal OS, dengan instruksi kerja di `PROMPT.md` di folder yang sama. Semua rujukan `file:line` diverifikasi ulang pada 8 Okt terhadap commit di tabel bawah.

Pemilik: Dika. Ditulis 8 Okt 2026 dari tiga repo yang dibaca langsung pada commit ini:

| Repo | Commit | Peran |
|---|---|---|
| `dikagustiana/Dika-s-Personal-OS` | `8050540` | Kantor: FSRE building, partner room 4F, edge function `fsre-events` dan `fsre-approve` |
| `dikagustiana/fsre-skills` | `be7defc` | Pipeline: kontrak, DDL `db/postgres/0000–0004a`, skill agent |
| `dikagustiana/dikagustiana.com` | `bed215d` | Etalase: Finance in Action, viewer `model_package`, reader `fsre_published.model_packages` |

Supabase: `personal-os` = `ascbthsgborseynmmthm` (app Personal OS dan edge function). `dikagustiana-com` = `asypkbkiebjvvpimewfp` (situs dan database FSRE).

Kalau isi repo berbeda dari PRD ini, repo yang menang. Catat perbedaannya di laporan, jangan diam-diam disesuaikan.

---

## 1. Tujuan

Satu jalur yang utuh dan bisa diaudit: agent FSRE menyiapkan paket model, Dika melihat isinya di 4F Personal OS lalu approve, dan paket itu tampil di dikagustiana.com production. Tidak ada salinan manual, tidak ada skema kedua, dan tidak ada angka tanpa sumber resmi.

Hasil akhir yang bisa dicek:
1. Database FSRE hidup di `dikagustiana-com`. `anon` hanya bisa membaca `fsre_published`.
2. Di 4F, Dika membuka paket yang di-stage (sheet, sumber, tie-out, gate) sebelum menekan Approve.
3. Approve memanggil `fsre.approve_package`. Versi baru menjadi `published` dan versi lama `withdrawn`.
4. Halaman `/finance/finance-in-action` di production menampilkan paket yang sudah published dan tidak pernah menampilkan fixture sintetis.
5. FSRE building di Personal OS punya mode Live yang membaca `fsre_status.events` sungguhan.

## 2. Keadaan sekarang (diverifikasi 8 Okt)

### 2.1 Yang sudah ada dan dipakai ulang, bukan dibangun ulang

| Bagian | Lokasi | Catatan |
|---|---|---|
| Kontrak paket | fsre-skills `contracts/model_package.schema.json` 3.1.0; situs `src/lib/finance-in-action/contract/types.ts` (`CONTRACT_VERSION = 'proposal-v3.1'`) | Sel `sourced` / `formula` / `assumption` / `missing`, `source` (issuer, document, period, page, xbrlConcept, docSha256), `tieOut`, `workpaper.gates`. **Ini satu-satunya skema paket.** |
| Release dan approve | fsre-skills `0004_live.sql`: `fsre.package_release`, `guard_package_release`, `fsre.can_approve`, `fsre.approve_package`, view `fsre_published.model_packages` (anon SELECT) | Approve sama dengan publish. Paket yang di-stage tidak bisa diubah (trigger). |
| Staging | fsre-skills `skills/fs-reverse-engineering/scripts/stage_package.py` (router, menulis `status='staged'` dan event `package_staged`) | |
| Feed status | fsre-skills `fsre_status.events`; Personal OS `supabase/functions/fsre-events` | Fungsi sudah ditulis dan dites, belum di-deploy. |
| Tombol approve | Personal OS `supabase/functions/fsre-approve` (`check` / `approve`); `src/data/fsreApproval.ts`; `PublishControl` di `src/views/lab/fsre/FsrePanel.tsx:301` | Versi diambil dari `payload.ref` event `package_staged` terakhir (`reducer.ts:476-478`). Belum ditawarkan di UI. |
| Live source | Personal OS `connectedLiveSource`, `eventSource.ts` | Tidak pernah diimpor di view; `REPLAY_SOURCES = [replaySource]` (`FsreReplay.tsx:50`). |
| Viewer | Situs: `engine/parser.ts`, `engine.ts`, `contract/validate.ts`, `registry.ts` (`validatePackage` + `checkFormulas`), `export/xlsx.ts` | Engine di-port dari prototipe PTBA. |
| Reader publik | Situs `src/lib/finance-in-action/published.ts` | `fetch` ke `/rest/v1/model_packages`, header `Accept-Profile: fsre_published`, env `VITE_SUPABASE_URL` dan `VITE_SUPABASE_PUBLISHABLE_KEY`. **Hanya jalan di build preview** (`VITE_FIA_PREVIEW=true`), yang diblokir di production oleh `scripts/assert-no-synthetic.mjs`. |

### 2.2 Yang belum ada

| # | Celah | Dampak |
|---|---|---|
| G1 | Tidak ada schema, role, atau bucket `fsre*` di `dikagustiana-com` | Tidak ada yang bisa dibaca atau di-approve |
| G2 | `fsre-events` dan `fsre-approve` belum di-deploy; secret `FSRE_STATUS_DB_URL` dan `FSRE_APPROVER_DB_URL` belum di-set | 4F tidak terhubung |
| G3 | Role `fsre_approver` tidak bisa membaca isi `package_release` | Dika approve tanpa melihat paketnya |
| G4 | Personal OS tidak punya viewer `model_package` | Sama dengan G3 |
| G5 | Mode Live di building berstatus "Not wired yet"; live source tidak ditawarkan | Building hanya bisa replay dan synthetic |
| G6 | `liveMap.ts` memetakan `actor` sebagai nama skill. Id agent dispatcher (`data-staff-a`) jatuh ke `lobby:fallback` | Desk salah saat data live masuk |
| G7 | Production situs tidak pernah membaca paket published | Approve tidak terlihat di situs |
| G8 | `published.ts` tidak membedakan view yang hilang atau schema yang belum di-expose dari kegagalan lain | Pesan error mentah |
| G9 | Dokumen situs menyebut `fsre_published.model_snapshots` (`schema-proposal-v3.md:19,60`), sedangkan kodenya membaca `model_packages` | Dua sumber kebenaran di dokumen |
| G10 | Dispatcher VPS (`infra/hermes`, branch `infra/hermes-pilot`) belum ada di GitHub | Id actor sebenarnya belum bisa dicek |

## 3. Keputusan yang sudah diambil Dika

| # | Keputusan |
|---|---|
| K1 | **S6 tetap lead-only** (opsi a). Berita dan riset broker tidak pernah menjadi nilai. Data operasional diambil dari dokumen resmi perusahaan (S2), laporan keuangan dari S1. Kontrak dan `validate_register.py` tidak diubah. |
| K2 | **Preview 4F disetujui.** Ini mencakup migrasi baru di fsre-skills dan aksi baru di `fsre-approve`. |
| K3 | **Skema paket = `model_package` 3.1.0.** Usulan `fsre-model/1`, tabel `published_models`, dan fungsi `fsre-publish` dibatalkan karena menduplikasi yang sudah ada. |
| K4 | **Approve = publish.** Tidak ada tombol Publish terpisah. |
| K5 | **Prototipe PTBA HTML adalah acuan tampilan, bukan data.** Ia tidak pernah di-publish (fsre-skills `README.md:10-12`). Screenshot StockMap tidak punya tier dan tidak pernah dipakai. |
| K6 | Viewer publik ada di repo dikagustiana.com. Personal OS tidak mendapat halaman publik baru, karena itu akan mengubah model keamanannya. |

## 4. Keputusan terbuka, didelegasikan ke pelaksana

Dika mendelegasikan O1–O5 ke pelaksana. Rekomendasi di setiap baris berlaku sebagai keputusan. Pelaksana boleh menyimpang hanya dengan alasan tertulis di laporan, dan tidak boleh menyimpang dari O4 (backup wajib).

| # | Pertanyaan | Rekomendasi | Gate | Keputusan |
|---|---|---|---|---|
| O1 | Seam Live di building (P1 di `fsre-building-v2-port.md`): pakai feed M5 sekarang, atau tunggu `SupabaseTransport` v2? | **Feed M5 sekarang.** `connectedLiveSource` dan `PublishControl` sudah ditulis dan dites, dan tidak ada perubahan kontrak. `SupabaseTransport` v2 (commands, engagements, roster) ditunda sampai backend punya entitasnya. Mode Synthetic tetap memakai `MockTransport`. | M3 | Setuju, delegasi ke pelaksana |
| O2 | `npm:postgres@3.4.9` di edge function (`docs/lab/fsre-building-mount-report.md` step 6 masih menunggu OK) | **OK.** Sudah dikunci versinya, hanya di Deno, dan tidak masuk bundle klien. | M3 | Setuju, delegasi ke pelaksana |
| O3 | Flag production situs: nama dan siapa yang menyalakan | **`VITE_FIA_LIVE`**, dinyalakan Dika di env Vercel production setelah paket asli pertama di-approve. | M4 | Setuju, delegasi ke pelaksana |
| O4 | Prasyarat backup sebelum DDL FSRE (CHANGELOG fsre-skills: restore ke target scratch dan uji rollback dulu) | **Wajib.** `supabase db dump` dari `dikagustiana-com`, restore ke Postgres scratch, jalankan 0000→0005, lalu semua rollback. | M2 | Setuju, wajib |
| O5 | Id actor dispatcher | Dika push `infra/hermes-pilot` atau kirim `dispatch.json` (tanpa secret). Sebelum itu, Claude Code membuat peta yang bisa dikonfigurasi dengan entri kosong dan tes. | M3 (sebagian) | Belum tersedia; mulai dengan roster kosong, isi setelah Dika mengirim `dispatch.json` |

## 5. Ruang lingkup

### 5.1 Termasuk

- **fsre-skills:** migrasi `0005_preview.sql` dan rollback-nya, tes, serta update README, CHANGELOG, dan deployment notes.
- **Personal OS:** aksi `preview` di `fsre-approve`, viewer paket di 4F, live source ditawarkan, peta actor ke desk, deploy edge function.
- **dikagustiana.com:** jalur production published-only, penanganan error yang rapi, dan koreksi dokumen G9.
- **Runbook bring-up database** dan verifikasi read-only.

### 5.2 Tidak termasuk (jangan dikerjakan)

- Skema paket baru, tabel publikasi baru, atau perubahan `model_package.schema.json`. Kalau sebuah fitur butuh perubahan kontrak: berhenti dan laporkan.
- Perubahan `tools/publish.py`, `fsre.publication`, atau view `model_snapshots` / `workbooks`. Jalur xlsx itu bukan bagian PRD ini dan dibiarkan apa adanya.
- `SupabaseTransport` v2, tabel commands, engagements, atau roster (lihat O1).
- Menjalankan pipeline FSRE atau memproduksi paket asli. Itu kerja VPS dan agent.
- Mempublikasikan apa pun ke database production dari tes. Tidak boleh ada `approve_package` dengan paket sintetis di production.
- Overhaul visual building (lantai ilustrasi). Itu track terpisah (§10) dan butuh aset dari Dika.
- Dependency baru di repo mana pun.

## 6. Spesifikasi per repo

### 6.1 fsre-skills: `db/postgres/0005_preview.sql` (hand-written, seperti 0004)

```sql
-- 0005_preview: the partner room reads a release before approving it.
CREATE OR REPLACE FUNCTION fsre.preview_package(p_company text, p_version text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, fsre AS $$ ... $$;
```

Perilaku:
- Mengembalikan `{ok, company, version, wave_id, status, content_hash, staged_at, package}` untuk release berstatus `staged` atau `published`.
- `withdrawn` atau tidak ada mengembalikan `{ok:false, reasons:[...]}` dengan kalimat yang sama gayanya dengan `can_approve`.
- `package` dikembalikan apa adanya, tanpa `jsonb_set` publikasi.
- Hanya membaca `package_release` dan tidak menulis apa pun.

Grant:
- `REVOKE EXECUTE ... FROM PUBLIC`
- `GRANT EXECUTE ... TO fsre_approver, fsre_partner`
- Tidak ada grant SELECT tabel baru untuk `fsre_approver`.

Penutup:
- Baris `fsre.schema_migrations` `('0005_preview', ...)`.
- Rollback `db/postgres/rollback/0005_preview_down.sql` (DROP FUNCTION).

Tes di `tests/test_db_live.py` (atau file baru `test_db_preview.py`) di atas seed SYNP golden-0018 yang sudah ada:
- `fsre_approver` bisa preview yang staged dan yang published.
- `fsre_approver` tetap tidak bisa `SELECT` dari `fsre.package_release` (kontrol negatif yang sudah ada tetap hijau).
- `fsre_status_reader` dan `anon` tidak bisa execute.
- Release `withdrawn` mengembalikan `ok:false`.
- Isi `package` sama byte-per-byte dengan baris tabel (bandingkan `content_hash`).
- Rollback mengembalikan katalog ke kondisi 0004.

Dokumentasi: tambahkan 0005 ke tabel dan urutan di `db/README.md`, ke `docs/deployment-notes.md`, dan entri `CHANGELOG.md`.

### 6.2 Personal OS

**A. `fsre-approve`: aksi `preview`**
- `parseApprovalRequest` (`_shared/fsreInput.ts`) menerima `action: 'preview'` dengan validasi `company` dan `version` yang sama.
- Fungsi memanggil `fsre.preview_package(company, version)` sebagai bound parameter. Tetap satu `Deno.env.get` (`FSRE_APPROVER_DB_URL`), satu `postgres(`, tanpa `.unsafe`, dan `checkAppKey` dijalankan sebelum body.
- Tes sumber di `src/data/fsreFunctions.test.ts` diperbarui: daftar fungsi DB yang boleh dipanggil menjadi `can_approve`, `approve_package`, `preview_package`, dan tidak ada yang lain.

**B. Klien**
- `src/data/fsreApproval.ts` mendapat `previewPackage(company, version)` yang mengembalikan `ReadResult`-style (`ok` / `not-connected` / `refused` dengan reasons / `failed`), bukan throw. Ikuti pola `feedFailure` di `eventSource.ts:142-155` untuk teks error (404 berarti fungsi belum di-deploy).

**C. Viewer paket di Personal OS**
- Salin modul situs `src/lib/finance-in-action/contract/*`, `engine/*`, dan `format.ts` ke `src/logic/lab/fsre/modelPackage/`. Setiap file diberi header pin: `// Copied from dikagustiana/dikagustiana.com@<sha> <path>. Do not edit here; re-copy.` Ini keputusan "salin dengan versi terkunci". Kedua repo terpisah dan Personal OS repo publik.
- Tambah satu tes yang memastikan setiap file di folder itu punya header pin dengan SHA 40 karakter.
- Komponen baru `src/views/lab/fsre/FsrePackagePreview.tsx`, read-only:
  - tab sheet `reported` / `model` / `assumptions`
  - grid dengan warna per jenis sel
  - klik sel menampilkan formula atau sumber (issuer, dokumen, periode, halaman) dan status tie-out
  - ringkasan: jumlah sel per jenis, jumlah tie-out `differs` / `not_checked`, daftar `workpaper.gates`, `meta.provenance`, `content_hash`
  - hasil `validatePackage` dan `checkFormulas`: kalau ada pelanggaran, tampilkan daftarnya di atas grid
- Tidak ada edit asumsi di 4F. Ini preview, bukan sandbox.
- Ikuti token Tailwind app (CLAUDE.md §7). Jangan memakai CSS prototipe.

**D. `PublishControl` (4F, live source)**
- Urutannya: `check` → tombol "Lihat paket" memuat `preview` → Approve aktif hanya bila `check.ok` dan preview sudah dimuat untuk versi yang sama. Tampilkan `content_hash` di samping tombol.
- Konfirmasi dua klik yang sudah ada tetap dipakai.
- Kalau `provenance` bukan `filings`, tampilkan peringatan yang jelas: "Paket ini bukan dari filings dan tidak akan tampil di situs production". Approve tidak diblokir di klien; database yang memutuskan.

**E. Live source ditawarkan (bila O1 dicentang)**
- `REPLAY_SOURCES` mendapat `connectedLiveSource`. Saat fungsi tidak terhubung, sumber tetap tampil dengan teks `not-connected` yang sudah ada dan tidak pernah crash.
- Label mode Live di `statuses.ts:337-341` dan `FsreModeSwitch.tsx:13` diselaraskan. Kalau mode `live` di switch tetap berarti `SupabaseTransport` v2, biarkan disabled dan beri nama yang membedakannya dari feed replay live. Catat pilihannya di laporan; jangan menggabungkan keduanya diam-diam.
- `FsreLivePanel.tsx:35` `VERSION_TO_APPROVE = 'v1'` adalah milik mode Synthetic dan **tidak diubah**. Jalur live memakai versi dari event.

**F. Peta actor ke desk (G6)**
- File konfigurasi `src/logic/lab/fsre/actorRoster.ts`: `Record<agentId, skill>`, awalnya kosong plus entri dari `dispatch.json` bila O5 sudah tersedia.
- `liveMap.ts`:
  - event non-transition memakai `skill: rosterSkill(row.actor) ?? row.actor`
  - transition tetap memakai `skills[0]` dari stage, kecuali actor ter-roster ke skill di stage yang sama (agent spesifik menang)
- Tes: `data-staff-a` ter-roster mendarat di desk B1; actor tak dikenal tetap jatuh ke `lobby:fallback` (perilaku yang ada, dengan kontrol negatif).

**G. Deploy (bila O2 dicentang)**
- Deploy `fsre-events` dan `fsre-approve` ke `ascbthsgborseynmmthm`.
- Secret di-set Dika: `FSRE_STATUS_DB_URL` (role `fsre_status_reader`) dan `FSRE_APPROVER_DB_URL` (role `fsre_approver`), keduanya ke database `asypkbkiebjvvpimewfp`. Claude Code menulis bentuk connection string tanpa password, memilih pooler yang benar (session atau transaction; `prepare:false` sudah ada di kode), lalu memverifikasinya.

### 6.3 dikagustiana.com

**A. Jalur production published-only (G7)**
- Flag compile-time baru `__FIA_LIVE__` dari `VITE_FIA_LIVE === 'true'`, dengan pola yang sama seperti `__FIA_PREVIEW__` di `vite.config.ts:13`.
- `VITE_FIA_LIVE=true` dan `VITE_FIA_PREVIEW=false`: route memuat `FiaIndexPage` / `FiaModelRoute` dengan registry **published-only**. Fixture tidak di-glob ke bundle sama sekali; buktikan di tes bundle atau di `assert-no-synthetic.mjs`.
- Paket dengan `meta.provenance` selain `filings` ditolak di registry production. Ia tidak tampil dan dicatat di `rejected`.
- Paket yang gagal `validatePackage` atau `checkFormulas` tidak tampil. Ini sudah begitu; pertahankan.
- Index tanpa paket menampilkan slate (`slate.json`) dengan status "belum ada model". Ini bukan error.
- Kedua flag mati: perilaku hari ini (legacy `FinanceInActionIndex` / `FinanceModelDetail`) tidak berubah.
- `assert-no-synthetic.mjs` tetap memblokir `VITE_FIA_PREVIEW=true` di production, dan sekarang juga memblokir kombinasi `VITE_FIA_LIVE=true` + `VITE_FIA_PREVIEW=true`.

**B. Error yang rapi (G8)**
- `published.ts` membedakan:
  - 404 atau kode PostgREST `PGRST106` / `42P01`: `not-available`, artinya schema belum di-expose atau view belum ada
  - 401/403: `refused`
  - lainnya: `failed`
- Halaman menampilkan kalimat yang jujur ("Model belum bisa dimuat") tanpa angka. Fixture tidak menjadi fallback di production.

**C. Dokumen (G9)**
- Koreksi `docs/company-models/schema-proposal-v3.md`: situs membaca `fsre_published.model_packages` (paket JSON). `model_snapshots` / `workbooks` adalah jalur `tools/publish.py` dan tidak dibaca situs. Ini perubahan dokumen saja.

**D. Aturan repo situs yang tetap berlaku** (`docs/company-models/implementation-brief-v3.1.md:35-86`, `README.md:108-117`):
- Supabase read-only dari repo ini; tidak ada migrasi.
- Tidak ada angka perusahaan asli di repo.
- British English dan satu number formatter.
- Edit viewer tidak pernah meninggalkan browser.
- CI: eslint `--max-warnings=35`, typecheck, vitest, dan floor `MIN_TESTS = 921`. Floor hanya boleh naik.
- Satu pengecualian dari brief lama: branch kerja untuk PRD ini adalah `feat/fia-live`, draft PR, dan Dika yang merge.

## 7. Bring-up database (G1): runbook

Dika yang menjalankan. Claude Code menyiapkan perintah persis dan memverifikasi hasilnya secara read-only. Urutan mengikuti `fsre-skills/db/README.md`:

1. **O4 backup:** `supabase db dump` dari `asypkbkiebjvvpimewfp`, restore ke Postgres 17 scratch, jalankan 0000→0005 di sana, jalankan semua rollback, lalu pastikan katalog kembali ke kondisi awal. Claude Code menyiapkan skripnya; Dika menjalankan dump karena butuh kredensial.
2. **Sebagai `postgres`:** `0000_bootstrap_roles.sql`, lalu set password setiap role di luar repo sebagai SCRAM verifier.
3. **Sebagai `fsre_owner`:** `0001` → `0002` → `0003`.
4. **Sebagai `postgres`:** `0004a_live_roles.sql`, set password `fsre_status_reader` dan `fsre_approver`.
5. **Sebagai `fsre_owner`:** `0004_live.sql`, lalu `0005_preview.sql`.
6. **Dashboard:** expose **hanya** `fsre_published` ke Data API (tambahkan ke exposed schemas; jangan `fsre`, `fsre_private`, atau `fsre_status`). Buat bucket `fsre-public` dan `fsre-documents` sesuai `docs/deployment-notes.md` 1–4.

Larangan: jangan pakai `apply_migration` atau `supabase db push` untuk DDL FSRE. DDL FSRE tercatat di `fsre.schema_migrations`, bukan di ledger migrasi situs (`db/README.md:3-5`).

Verifikasi read-only oleh Claude Code (Supabase MCP `execute_sql`, tanpa menulis apa pun):
- Schema `fsre`, `fsre_private`, `fsre_published`, `fsre_status` ada.
- `fsre.schema_migrations` berisi 0001–0005.
- `has_table_privilege('anon','fsre.package_release','select')` = false.
- `has_function_privilege('fsre_approver','fsre.preview_package(text,text)','execute')` = true.
- `has_function_privilege('anon', ...)` = false.
- curl anon ke profile `fsre` gagal; ke profile `fsre_published` hasilnya `[]`.

## 8. Milestone, pelaksana, dan bukti selesai

| M | Isi | Pelaksana | Gate masuk | Bukti selesai |
|---|---|---|---|---|
| M1 | fsre-skills 0005 dan tes | Claude Code (PR draft `feat/preview-package`) | — | `python -m pytest -q tests` hijau dengan `FSRE_TEST_PG_URL` di Postgres scratch; `tools/check_all.py` hijau; output asli ditempel |
| M2 | Bring-up database | Dika menjalankan, Claude Code menyiapkan dan memverifikasi | O4 dicentang, M1 di-merge | Semua cek §7 lulus, output ditempel |
| M3 | Personal OS 6.2 A–G | Claude Code (PR draft `feat/fsre-publish-path`) | O1, O2 dicentang; F boleh jalan dengan roster kosong | `pnpm typecheck`, `pnpm test:run`, `pnpm build` hijau; `scripts/*-tests.sh` tidak relevan kecuali ada SQL; dua fungsi ter-deploy; `check` di production mengembalikan reasons yang benar ("no package … staged") |
| M4 | Situs 6.3 A–C | Claude Code (PR draft `feat/fia-live`) | O3 dicentang | CI hijau; build preview Vercel dengan `VITE_FIA_LIVE=true` menampilkan slate tanpa fixture; tes bundle membuktikan tidak ada `.SYNTHETIC.json` di output |
| M5 | Uji ujung ke ujung di scratch | Claude Code | M1–M4 | Postgres scratch dengan 0000–0005 + seed SYNP: stage → preview → approve lewat fungsi lokal (`supabase functions serve`) → `model_packages` berisi baris → situs lokal dengan `VITE_SUPABASE_URL` scratch menolak SYNP karena provenance `synthetic` (sesuai §6.3A), sedangkan build preview menampilkannya. Rekaman langkah dan output ditulis ke laporan. |
| M6 | Paket asli pertama | Pipeline FSRE plus Dika | Pilot sub-industri disetujui (`docs/pilot/pilot-proposal.md`) | Di luar Claude Code: Dika approve di 4F, lalu menyalakan `VITE_FIA_LIVE` (O3) |

## 9. Aturan yang tidak boleh dilanggar (ringkasan dari ketiga repo)

1. Tidak ada secret di repo, log, laporan, atau output. Nama env var boleh, nilainya tidak.
2. Claude Code tidak menjalankan DDL ke database production. Dika yang menerapkan migrasi.
3. Tidak ada `push --force`, `reset --hard`, rewrite history, atau hapus branch. Satu commit untuk satu perubahan logis. Refactor tidak digabung dengan perubahan perilaku.
4. Tidak ada dependency baru dan tidak ada bump major.
5. Personal OS: aturan `CLAUDE.md` berlaku penuh, termasuk TypeScript strict, nol `as any`, tes di samping subjeknya, komentar mencatat alasan, dan verifikasi sebelum commit.
6. Tidak ada gate, guard, RLS, atau grant yang dilonggarkan. Semua akses baru harus `SECURITY DEFINER` sempit dengan grant eksplisit.
7. Tidak ada angka perusahaan asli di repo mana pun. Fixture tetap sintetis dengan ticker fiktif.
8. S6 tidak pernah menjadi nilai (K1). StockMap tidak pernah menjadi sumber (K5).
9. Berhenti dan laporkan bila:
   - butuh perubahan kontrak `model_package`
   - butuh grant tabel baru
   - sebuah tes gagal dua kali dengan sebab yang sama
   - perubahan lebih besar dari perkiraan
   - repo berbeda dari PRD dengan cara yang mengubah desain

## 10. Track terpisah: overhaul visual building (bukan bagian PRD ini)

Dicatat supaya tidak hilang. Dikerjakan setelah M3, dengan prompt sendiri.

- **Arah:** lantai ilustrasi bergaya cutaway rumah boneka (referensi Dika), menggantikan SVG wireframe di `FsreFloor.tsx` / `projection.ts`.
- **Cara:**
  - shell lantai raster yang kosong, lima lantai dengan kamera dan cahaya yang sama, plus JSON grid (4 sudut lantai, kotak layar, kotak ruang)
  - desk, karakter, dan ruang kaca sebagai sprite yang diletakkan menurut `departmentLayout.ts` lewat homografi
  - layar dinding dan chip sebagai HTML
  - status dibaca dari pose (working, idle, escalated, done, unstaffed); chip hanya muncul saat hover atau dipilih
- **Aset dibuat Dika.** Renderer harus bisa jalan dengan shell placeholder supaya tidak menunggu aset.
- **Tetap berlaku:** scroll samping hanya di dalam section di 390 px, dan daftar panel tetap bisa dipakai tanpa gambar.

## 11. Laporan akhir yang diharapkan dari Claude Code

Satu file per repo (`docs/.../report-fsre-publish-path.md`):
- SHA awal dan akhir, daftar commit
- output asli semua verifikasi
- perbedaan repo vs PRD
- keputusan yang diambil sendiri beserta alasannya
- yang belum selesai dan alasannya
- langkah yang menunggu Dika, dengan perintah persis
