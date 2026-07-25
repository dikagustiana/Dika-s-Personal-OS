/**
 * The three recurring review loops.
 *
 * PORTED VERBATIM from the owner's research console. Every string in this file
 * IS the specification rather than a description of it: the check items are the review protocol, and each `why` carries the evidence for why that loop recurs at all instead of running once.
 *
 * Do not paraphrase, shorten, reorder, translate or "improve" any string here.
 * research.spec.test.ts pins both objects by SHA-256 for that reason — an
 * innocuous rewording fails the suite instead of silently changing the method.
 */

export interface ResearchLoop {
  name: string;
  /** One-letter badge for dense views. */
  short: string;
  /** Why this loop recurs rather than running once. */
  why: string;
  /** What makes it fall due. */
  trig: string;
  /** The cycle checklist. */
  check: string[];
  /** Provenance of the framework behind the checklist. */
  ref: string;
}

export type LoopKey = 'data' | 'cite' | 'method';

export const LOOPS: Record<LoopKey, ResearchLoop> = {
  "data": {
    "name": "Review data",
    "short": "D",
    "why": "Verifikasi bukan kejadian sekali. Angka dirilis ulang, definisi bergeser, dan kelayakan data hanya bisa dinilai relatif terhadap pemakaian yang direncanakan — jadi data harus dinilai ulang setiap kali pemakaiannya berubah, bukan sekali di awal.",
    "trig": "Jatuh tempo kalau: ada item V yang as of-nya melewati batas kebasian, ada item baru sejak siklus terakhir, siklus terakhir memutuskan rework, atau belum pernah dijalankan.",
    "check": [
      "Akurasi: buka ulang URL-nya. Nilai di sumber hari ini masih sama dengan yang di register — jangan percaya catatan sendiri.",
      "Kebasian: as of masih di dalam batas; kalau tidak, cari rilis terbaru dan catat kalau memang belum ada.",
      "Kelengkapan: item yang seharusnya ada tapi kosong sudah teridentifikasi sebagai NA, bukan diabaikan.",
      "Konsistensi lintas riset: item yang sama di riset lain punya nilai dan definisi yang sama (cek tab blocker).",
      "Konformans: unit, cakupan, dan tahun dasar sama dengan yang dipakai di analisis.",
      "Plausibilitas: nilainya masih wajar dibanding satu pembanding independen.",
      "Fitness for use: definisi item masih cocok dengan cara ia dipakai di stage yang sedang berjalan — pemakaian berubah, kelayakan berubah."
    ],
    "ref": "Dimensi mengikuti kerangka data quality arus utama (akurasi, kelengkapan, konsistensi, ketepatan waktu, konformans, plausibilitas) plus prinsip fitness-for-intended-use."
  },
  "cite": {
    "name": "Review sitasi",
    "short": "C",
    "why": "Meta-analisis lintas 46 studi menemukan sekitar 17% kutipan salah — separuhnya error mayor: sumbernya tidak mendukung klaim yang dipasang padanya. Tidak ada perbaikan lintas tahun. Artinya ini bukan soal kehati-hatian pribadi, tapi butuh pemeriksaan terjadwal.",
    "trig": "Jatuh tempo kalau: ada sumber atau klaim (b) baru sejak siklus terakhir, siklus terakhir memutuskan rework, atau belum pernah dijalankan.",
    "check": [
      "Setiap klaim (b) punya sitasi yang benar-benar kamu buka — bukan dari abstrak, bukan dari ingatan, bukan dari output model.",
      "ERROR MAYOR: sumber benar-benar MENDUKUNG klaimnya, bukan cuma bertopik sama, tidak bertentangan, dan tidak diam soal itu.",
      "Sitasi tidak langsung: yang dikutip sumber primer, bukan paper yang mengutip sumber primer.",
      "ERROR MINOR: tidak ada oversimplifikasi atau overgeneralisasi temuan sumber — tetap harus dibetulkan.",
      "Metadata benar: penulis, tahun, judul, jurnal, volume, halaman, DOI.",
      "Klaim yang tidak punya sumber pendukung diturunkan ke lapisan (c) atau dihapus. Bukan dibiarkan menggantung.",
      "Sampel acak minimal 10 pasangan klaim–sumber diperiksa tiap siklus, termasuk yang lama — bukan hanya yang baru."
    ],
    "ref": "Taksonomi error (mayor / minor / sitasi tidak langsung) dan laju error mengikuti literatur quotation accuracy."
  },
  "method": {
    "name": "Review metodologi",
    "short": "M",
    "why": "Ketika 73 tim menganalisis data yang sama untuk hipotesis yang sama, lebih dari 95% varians hasil tidak bisa dijelaskan bahkan setelah semua keputusan analitik dikodekan. Kamu bekerja sendiri, jadi tidak punya 73 tim sebagai kontrol — penggantinya adalah mencatat jalur yang kamu tolak dan melaporkan spektrum spesifikasi, bukan satu yang terpilih.",
    "trig": "Jatuh tempo kalau: lebih dari 3 bulan sejak siklus terakhir, ada perubahan spesifikasi di log keputusan, siklus terakhir memutuskan rework, atau belum pernah dijalankan.",
    "check": [
      "Semua derajat kebebasan analitik ditulis: spesifikasi, operasionalisasi variabel, batas sampel, penanganan outlier, pilihan distribusi.",
      "Jalur yang DITOLAK tercatat beserta alasannya di log keputusan — ini penggantimu untuk tidak punya analis pembanding.",
      "Kesimpulan diuji terhadap spesifikasi alternatif; kalau berubah, itu dilaporkan — bukan dipilih yang paling cocok.",
      "Uji circularity: desain masih mengizinkan hipotesis utama DITOLAK, dan itu betul-betul terjadi di sebagian kondisi.",
      "Asumsi bermuatan nilai dipisahkan dari asumsi teknis dan dinyatakan terbuka.",
      "Validasi konseptual: struktur model masih cocok dengan tujuan pemakaian, bukan cuma dengan data.",
      "Perubahan metodologi sejak siklus terakhir sudah ada di log keputusan, bukan cuma di kepala."
    ],
    "ref": "Kerangka V&V iteratif untuk studi simulasi, plus literatur many-analysts / researcher degrees of freedom."
  }
};

export const LOOP_KEYS = Object.keys(LOOPS) as LoopKey[];
