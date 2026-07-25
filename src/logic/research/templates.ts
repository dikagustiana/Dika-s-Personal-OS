/**
 * The five research method families and their ordered stages.
 *
 * PORTED VERBATIM from the owner's research console. Every string in this file
 * IS the specification rather than a description of it: the gate criteria are the methodology, so rewording one changes what the pipeline enforces.
 *
 * Do not paraphrase, shorten, reorder, translate or "improve" any string here.
 * research.spec.test.ts pins both objects by SHA-256 for that reason — an
 * innocuous rewording fails the suite instead of silently changing the method.
 */

/** One stage of a method family. */
export interface ResearchStage {
  /** Stage number as displayed, e.g. "00" — a label, hence a string. */
  n: string;
  /** Stage title. */
  t: string;
  /** Short qualifier beside the title; empty on the minimal family. */
  tag: string;
  /** Input. */
  i: string;
  /** Process. */
  p: string;
  /** Output. */
  o: string;
  /** Gate criteria — every one must be checked before the stage passes. */
  g: string[];
  /** Warning line, where the family carries one. */
  w?: string;
}

export interface ResearchTemplate {
  name: string;
  desc: string;
  stages: ResearchStage[];
}

export type TemplateKey = 'sim' | 'emp' | 'slr' | 'policy' | 'min';

export const TEMPLATES: Record<TemplateKey, ResearchTemplate> = {
  "sim": {
    "name": "Simulasi & eksplorasi ketidakpastian",
    "desc": "Untuk pertanyaan berbentuk 'di kondisi apa X berlaku'. Model dipakai untuk eksplorasi, bukan prediksi: Monte Carlo → sensitivitas global → scenario discovery. Cocok kalau data mikro tidak ada dan yang dicari adalah threshold, bukan titik estimasi.",
    "stages": [
      {
        "n": "00",
        "t": "Verifikasi data",
        "tag": "blocker — butuh akses web / dataset",
        "i": "Daftar parameter dan sumber kandidat",
        "p": "Sapuan sumber primer per item; unduh dataset; catat publisher, dokumen, URL, tanggal akses",
        "o": "Register berstatus V + sumber + tanggal",
        "g": [
          "Tidak ada item kritikal yang masih IND",
          "Setiap item NA punya catatan konsekuensi eksplisit",
          "Definisi tiap angka jelas: cakupan, unit, tahun dasar, termasuk pajak atau tidak",
          "Fakta baseline dari tulisan sebelumnya sudah dicek ulang ke sumber aslinya"
        ],
        "w": "Selama gate ini merah, semua stage di bawahnya hanya demonstrasi mekanisme — bukan temuan."
      },
      {
        "n": "01",
        "t": "Kalibrasi & checkpoint kasus",
        "tag": "protokol kalibrasi",
        "i": "Parameter V + deskripsi stylized kasus jangkar",
        "p": "Set parameter ke wilayah kasus; jalankan engine; bandingkan dengan pola yang diketahui dari kasus",
        "o": "Titik kalibrasi terdokumentasi + laporan checkpoint",
        "g": [
          "Engine mereproduksi pola kualitatif kasus pada parameter V",
          "Kalau gagal: sudah dicek dulu apakah parameter di luar wilayah kasus, sebelum menyalahkan struktur model",
          "Tidak ada parameter yang di-tune semata agar checkpoint lulus"
        ],
        "w": "Checkpoint yang gagal adalah informasi. Catat penyebabnya sebelum mengubah apa pun."
      },
      {
        "n": "02",
        "t": "Engine & sintesis populasi",
        "tag": "reproducible by construction",
        "i": "Distribusi parameter + marginal populasi",
        "p": "Bangun populasi unit sintetis berbobot; definisikan outcome secara operasional; intervensi sebagai transformasi eksplisit",
        "o": "Engine + workbook audit, tervalidasi silang",
        "g": [
          "Dua implementasi independen memberi hasil identik pada kasus deterministik",
          "Semua simplifikasi ter-disclose di tempat pemakaiannya",
          "Prosedur sintesis populasi terdokumentasi dan bisa diulang dengan seed tetap",
          "Bobot populasi punya sumber V — atau dinyatakan sebagai asumsi"
        ]
      },
      {
        "n": "03",
        "t": "Monte Carlo & dekomposisi varians",
        "tag": "sensitivitas global",
        "i": "Engine tervalidasi + distribusi",
        "p": "Latin Hypercube Sampling; indeks sensitivitas global; uji konvergensi jumlah draw",
        "o": "Ranking driver ketidakpastian pada outcome",
        "g": [
          "Konvergensi ditunjukkan, bukan diasumsikan",
          "Seed dan config tersimpan; hasil reproducible",
          "Driver teratas masuk akal secara substantif — kalau tidak, cari bug sebelum cari cerita"
        ]
      },
      {
        "n": "04",
        "t": "Frontier: kapan mekanisme mengikat",
        "tag": "pertanyaan tunggal terpenting",
        "i": "Hasil Monte Carlo",
        "p": "Threshold analysis (logistic + pohon keputusan); bandingkan probabilitas outcome antar rezim kondisi; hitung selisih per subkelompok",
        "o": "Frontier + aturan threshold yang bisa dibaca kebijakan",
        "g": [
          "Model MENGIZINKAN hasil yang membantah hipotesis — dan itu betul-betul muncul di sebagian subkelompok",
          "Aturan threshold stabil terhadap perubahan spesifikasi",
          "Struktur model diperiksa untuk circularity: kesimpulan tidak ditanam di asumsi"
        ],
        "w": "Kalau desain model membuat hipotesismu selalu menang, itu yang akan ditembak reviewer lebih dulu dari apa pun."
      },
      {
        "n": "05",
        "t": "Dinamika & counterfactual",
        "tag": "urutan sebagai variabel",
        "i": "Frontier stage sebelumnya",
        "p": "Loop antar-periode; skenario yang dibedakan HANYA oleh urutan intervensi",
        "o": "Grafik counterfactual + uji apakah efek jebakan muncul",
        "g": [
          "Hasil dilaporkan apa adanya, termasuk kalau efek yang dicari tidak muncul",
          "Mekanismenya bisa dijelaskan tanpa merujuk angka hasil",
          "Antar-skenario tidak ada parameter lain yang ikut berubah"
        ]
      },
      {
        "n": "06",
        "t": "Generalisasi lintas kelas objek",
        "tag": "uji invariansi",
        "i": "Engine tervalidasi",
        "p": "Instansiasi ke kelas objek kedua; identifikasi apa yang invarian dan apa yang spesifik",
        "o": "Bukti framework berlaku lintas kelas + frontier per kelas",
        "g": [
          "Klaim untuk kelas baru hanya sejauh kalibrasinya mendukung",
          "Perluasan scope di-flag terhadap kompas riset aslinya",
          "Debat literatur di kelas baru di-engage, bukan didiamkan"
        ]
      },
      {
        "n": "07",
        "t": "Penulisan",
        "tag": "output + appendix",
        "i": "Semua di atas",
        "p": "Draft section; appendix: tabel distribusi + sumber, prosedur sintesis, disclosure asumsi",
        "o": "Tulisan yang bisa dibaca tanpa perlu percaya angka tanpa jejak",
        "g": [
          "Setiap klaim di teks berlabel (a)/(b)/(c)",
          "Tidak ada angka IND yang lolos ke teks atau grafik",
          "Setiap kontradiksi dengan tulisan sebelumnya ter-flag eksplisit",
          "Transparency checklist terisi dan ikut sebagai appendix"
        ]
      }
    ]
  },
  "emp": {
    "name": "Empiris / ekonometrik",
    "desc": "Untuk pertanyaan sebab-akibat atas data yang sudah ada. Titik beratnya strategi identifikasi dan pra-spesifikasi: apa yang membuat estimasi ini bisa dibaca sebagai efek, bukan korelasi.",
    "stages": [
      {
        "n": "00",
        "t": "Pertanyaan & strategi identifikasi",
        "tag": "sebelum menyentuh data",
        "i": "Literatur + institusi yang menghasilkan variasi",
        "p": "Rumuskan estimand; pilih sumber variasi; tulis asumsi identifikasi dan apa yang membatalkannya",
        "o": "Catatan identifikasi 2 halaman",
        "g": [
          "Estimand ditulis eksplisit, bukan tersirat dari regresi",
          "Asumsi identifikasi ditulis beserta ancaman utamanya",
          "Ada minimal satu uji yang bisa memalsukan strategi ini"
        ],
        "w": "Melihat hasil sebelum spesifikasi ditulis akan mengontaminasi semua keputusan sesudahnya."
      },
      {
        "n": "01",
        "t": "Akuisisi data & izin",
        "tag": "provenance & legalitas",
        "i": "Daftar sumber data",
        "p": "Peroleh data; catat versi, tanggal unduh, lisensi, batasan penggunaan",
        "o": "Data mentah tersimpan read-only + register sumber",
        "g": [
          "Setiap dataset punya versi, tanggal, lisensi tercatat",
          "Data mentah tidak pernah diubah di tempat",
          "Batasan lisensi/etika untuk publikasi sudah dipahami sebelum analisis"
        ]
      },
      {
        "n": "02",
        "t": "Konstruksi variabel & pembersihan",
        "tag": "kode, bukan tangan",
        "i": "Data mentah",
        "p": "Skrip pembersihan; definisi variabel; penanganan missing dan outlier didokumentasi",
        "o": "Dataset analisis + codebook",
        "g": [
          "Seluruh transformasi ada di skrip yang bisa dijalankan ulang dari mentah",
          "Jumlah observasi yang hilang di setiap langkah dilaporkan",
          "Codebook menjelaskan setiap variabel turunan"
        ]
      },
      {
        "n": "03",
        "t": "Deskriptif & pra-spesifikasi",
        "tag": "komitmen sebelum estimasi",
        "i": "Dataset analisis",
        "p": "Statistik deskriptif; tulis spesifikasi utama dan daftar robustness SEBELUM melihat koefisien",
        "o": "Tabel deskriptif + dokumen pra-spesifikasi bertanggal",
        "g": [
          "Spesifikasi utama dan robustness tertulis dan bertanggal sebelum estimasi",
          "Sampel dan eksklusi dijustifikasi tanpa merujuk hasil",
          "Uji balance / pre-trend sudah dilihat"
        ]
      },
      {
        "n": "04",
        "t": "Estimasi & uji identifikasi",
        "tag": "hasil utama",
        "i": "Pra-spesifikasi",
        "p": "Jalankan spesifikasi utama; uji diagnostik sesuai desain; inference yang benar untuk struktur data",
        "o": "Tabel hasil utama + diagnostik",
        "g": [
          "Standard error sesuai struktur data (klaster/panel/spasial)",
          "Diagnostik yang relevan dijalankan dan dilaporkan apa adanya",
          "Deviasi dari pra-spesifikasi dicatat beserta alasannya"
        ]
      },
      {
        "n": "05",
        "t": "Robustness & falsifikasi",
        "tag": "mencoba merusak sendiri",
        "i": "Hasil utama",
        "p": "Daftar robustness dari pra-spesifikasi; uji plasebo; spesifikasi alternatif; batas sensitivitas terhadap asumsi",
        "o": "Appendix robustness",
        "g": [
          "Uji plasebo / falsifikasi dijalankan dan dilaporkan meski hasilnya tidak nyaman",
          "Kesimpulan tidak bergantung pada satu spesifikasi",
          "Multiple testing / p-hacking ditangani dan dinyatakan"
        ]
      },
      {
        "n": "06",
        "t": "Penulisan",
        "tag": "output",
        "i": "Semua di atas",
        "p": "Draft; paket replikasi; disclosure keterbatasan",
        "o": "Tulisan + paket replikasi",
        "g": [
          "Setiap klaim berlabel (a)/(b)/(c)",
          "Paket replikasi jalan dari data mentah sampai tabel akhir di mesin lain",
          "Keterbatasan eksternal validitas dinyatakan, bukan disembunyikan di footnote"
        ]
      }
    ]
  },
  "slr": {
    "name": "Tinjauan literatur sistematis",
    "desc": "Untuk pertanyaan 'apa yang sudah diketahui'. Yang membedakan dari membaca banyak paper: protokol ditulis lebih dulu, pencarian didokumentasi sampai bisa diulang, dan penyingkiran paper punya alasan tercatat.",
    "stages": [
      {
        "n": "00",
        "t": "Protokol & kriteria",
        "tag": "sebelum mencari",
        "i": "Pertanyaan tinjauan",
        "p": "Tulis kriteria inklusi/eksklusi, rentang tahun, bahasa, jenis publikasi, dan rencana ekstraksi",
        "o": "Protokol bertanggal",
        "g": [
          "Kriteria inklusi dan eksklusi ditulis sebelum pencarian dimulai",
          "Pertanyaan tinjauan cukup sempit untuk dijawab, cukup luas untuk berguna",
          "Rencana ekstraksi menyebut field apa saja yang diambil dari setiap paper"
        ]
      },
      {
        "n": "01",
        "t": "Pencarian & dokumentasi query",
        "tag": "harus bisa diulang",
        "i": "Protokol",
        "p": "Jalankan query di beberapa basis data; catat query persis, tanggal, jumlah hasil per sumber",
        "o": "Log pencarian + korpus mentah",
        "g": [
          "Query persis dan tanggalnya tercatat per basis data",
          "Minimal dua basis data independen dipakai",
          "Jumlah hasil per tahap tercatat untuk diagram alur"
        ]
      },
      {
        "n": "02",
        "t": "Skrining",
        "tag": "judul-abstrak lalu full text",
        "i": "Korpus mentah",
        "p": "Skrining dua tahap; catat alasan eksklusi per paper",
        "o": "Korpus final + diagram alur",
        "g": [
          "Alasan eksklusi tercatat per paper, bukan hanya jumlah agregat",
          "Sampel skrining diuji ulang untuk konsistensi keputusan",
          "Diagram alur dari hasil mentah ke korpus final lengkap"
        ]
      },
      {
        "n": "03",
        "t": "Ekstraksi",
        "tag": "tabel, bukan ringkasan bebas",
        "i": "Korpus final",
        "p": "Ekstrak field terstruktur per paper: setting, metode, ukuran efek, keterbatasan",
        "o": "Tabel ekstraksi",
        "g": [
          "Setiap baris merujuk halaman atau tabel spesifik di papernya",
          "Field kosong dibedakan dari field bernilai nol",
          "Tidak ada angka yang masuk tabel dari abstrak saja kalau full text tersedia"
        ],
        "w": "Ringkasan dari abstrak sering menggeser makna. Kalau hanya abstrak yang tersedia, tandai barisnya."
      },
      {
        "n": "04",
        "t": "Penilaian kualitas & risiko bias",
        "tag": "bobot bukti",
        "i": "Tabel ekstraksi",
        "p": "Terapkan instrumen penilaian yang sesuai desain; catat penilaian per studi",
        "o": "Tabel kualitas",
        "g": [
          "Instrumen penilaian disebut namanya dan diterapkan konsisten",
          "Studi berkualitas rendah tidak dihapus diam-diam — dampaknya diuji",
          "Bias publikasi dipertimbangkan secara eksplisit"
        ]
      },
      {
        "n": "05",
        "t": "Sintesis & penulisan",
        "tag": "output",
        "i": "Semua di atas",
        "p": "Sintesis naratif atau kuantitatif; identifikasi gap dengan bukti dari protokol pencarian",
        "o": "Tinjauan + tabel appendix",
        "g": [
          "Setiap klaim berlabel (a)/(b)/(c)",
          "Klaim gap didukung protokol pencarian yang dilaporkan, bukan kesan pribadi",
          "Perbedaan antar studi dijelaskan, bukan dirata-ratakan begitu saja"
        ]
      }
    ]
  },
  "policy": {
    "name": "Studi kasus & desain instrumen kebijakan",
    "desc": "Untuk pertanyaan 'kenapa transaksi ini tidak terjadi, dan instrumen apa yang membuatnya terjadi'. Bergerak dari diagnosis kegagalan ke desain alokasi risiko, dengan pembanding lintas yurisdiksi.",
    "stages": [
      {
        "n": "00",
        "t": "Framing & unit analisis",
        "tag": "apa yang mau dijelaskan",
        "i": "Kasus + pertanyaan kebijakan",
        "p": "Tetapkan unit analisis, batas kasus, dan apa yang dihitung sebagai kegagalan",
        "o": "Catatan framing",
        "g": [
          "Unit analisis dan batas kasus eksplisit",
          "Kriteria 'gagal' operasional, bisa diamati",
          "Alasan pemilihan kasus dinyatakan — termasuk risiko selection bias"
        ]
      },
      {
        "n": "01",
        "t": "Basis bukti & verifikasi",
        "tag": "blocker",
        "i": "Dokumen publik, statistik, regulasi",
        "p": "Kumpulkan dan verifikasi; pisahkan dokumen resmi dari laporan sekunder",
        "o": "Register bukti berstatus V",
        "g": [
          "Tidak ada item kritikal yang masih IND",
          "Setiap regulasi dirujuk ke nomor dan pasalnya, bukan ke berita tentangnya",
          "Data internal organisasi tidak masuk output kecuali sudah publik"
        ]
      },
      {
        "n": "02",
        "t": "Pemetaan aktor & kelembagaan",
        "tag": "siapa memutuskan apa",
        "i": "Basis bukti",
        "p": "Peta aktor, mandat, insentif, dan titik keputusan; identifikasi siapa menanggung risiko apa hari ini",
        "o": "Peta aktor + matriks risiko",
        "g": [
          "Setiap aktor punya mandat yang dirujuk ke dasar hukum atau dokumen resmi",
          "Alokasi risiko saat ini tergambar, bukan diasumsikan",
          "Aktor yang punya kuasa memblokir teridentifikasi, bukan hanya yang mendukung"
        ]
      },
      {
        "n": "03",
        "t": "Diagnosis kegagalan",
        "tag": "kenapa tidak terjadi",
        "i": "Peta aktor + basis bukti",
        "p": "Uraikan penyebab kandidat; bedakan kendala harga, kendala risiko, kendala koordinasi, dan kendala kelembagaan",
        "o": "Diagnosis berperingkat",
        "g": [
          "Minimal dua penjelasan bersaing diuji, bukan satu yang disukai",
          "Setiap penyebab dikaitkan ke bukti yang bisa diperiksa",
          "Kemungkinan bahwa transaksinya memang tidak layak ikut diuji"
        ],
        "w": "Kalau diagnosis selalu berujung pada instrumen yang sudah kamu sukai, diagnosisnya belum bekerja."
      },
      {
        "n": "04",
        "t": "Desain instrumen & alokasi risiko",
        "tag": "inti kontribusi",
        "i": "Diagnosis",
        "p": "Rancang instrumen sebagai transformasi eksplisit atas arus kas dan alokasi risiko; tentukan siapa menanggung apa dan dengan harga berapa",
        "o": "Term sheet konseptual + peringkat instrumen",
        "g": [
          "Setiap instrumen dinyatakan sebagai perubahan konkret pada arus kas dan risiko, bukan slogan",
          "Biaya fiskal dan risiko moral hazard dinyatakan",
          "Ada kriteria pembanding antar instrumen yang bisa dihitung"
        ]
      },
      {
        "n": "05",
        "t": "Uji banding lintas yurisdiksi",
        "tag": "apakah pernah jalan",
        "i": "Desain instrumen",
        "p": "Bandingkan dengan yurisdiksi yang pernah menempuh rute serupa; catat prakondisi yang berbeda",
        "o": "Tabel komparasi",
        "g": [
          "Pembanding dipilih dengan alasan, bukan karena datanya mudah",
          "Prakondisi yang tidak ada di kasusmu dinyatakan sebagai batas transferabilitas",
          "Kasus yang gagal ikut dibahas, bukan hanya yang berhasil"
        ]
      },
      {
        "n": "06",
        "t": "Validasi & penulisan",
        "tag": "output",
        "i": "Semua di atas",
        "p": "Uji ke praktisi atau pemegang mandat; revisi; tulis dengan rekomendasi yang bisa dieksekusi",
        "o": "Memo atau working paper",
        "g": [
          "Setiap klaim berlabel (a)/(b)/(c)",
          "Rekomendasi menyebut siapa pelaksananya dan instrumen hukum apa yang dibutuhkan",
          "Keberatan dari praktisi dicatat, termasuk yang tidak bisa dijawab"
        ]
      }
    ]
  },
  "min": {
    "name": "Generik minimal",
    "desc": "Empat stage untuk riset kecil atau eksplorasi awal yang belum jelas bentuknya. Naikkan ke template lain begitu bentuknya kelihatan.",
    "stages": [
      {
        "n": "00",
        "t": "Scoping",
        "tag": "",
        "i": "Pertanyaan kasar",
        "p": "Persempit pertanyaan; tetapkan apa yang dihitung sebagai jawaban",
        "o": "Satu pertanyaan yang bisa salah",
        "g": [
          "Pertanyaan bisa dijawab dengan sumber yang bisa diakses",
          "Kriteria 'sudah cukup' ditulis di depan"
        ]
      },
      {
        "n": "01",
        "t": "Bukti",
        "tag": "",
        "i": "Pertanyaan",
        "p": "Kumpulkan dan verifikasi bukti",
        "o": "Register bukti",
        "g": [
          "Tidak ada item kritikal yang masih IND",
          "Sumber yang bertentangan dicatat, bukan dipilih yang cocok"
        ]
      },
      {
        "n": "02",
        "t": "Analisis",
        "tag": "",
        "i": "Register bukti",
        "p": "Analisis; uji penjelasan alternatif",
        "o": "Temuan",
        "g": [
          "Minimal satu penjelasan alternatif diuji",
          "Batas kesimpulan dinyatakan"
        ]
      },
      {
        "n": "03",
        "t": "Penulisan",
        "tag": "",
        "i": "Temuan",
        "p": "Tulis",
        "o": "Output",
        "g": [
          "Setiap klaim berlabel (a)/(b)/(c)",
          "Tidak ada angka IND di teks"
        ]
      }
    ]
  }
};

export const TPL_KEYS = Object.keys(TEMPLATES) as TemplateKey[];

/** Falls back to the minimal family rather than throwing, as the console does. */
export function templateOf(key: string | undefined | null): ResearchTemplate {
  return TEMPLATES[key as TemplateKey] ?? TEMPLATES.min;
}

/** A fresh all-false gate matrix shaped to a template. */
export function gatesFor(key: string | undefined | null): boolean[][] {
  return templateOf(key).stages.map((stage) => stage.g.map(() => false));
}
