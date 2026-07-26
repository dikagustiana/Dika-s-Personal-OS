import { describe, expect, it } from 'vitest';
import { parseErrorLog, validateFields } from './parseErrorLog';

/**
 * A WHOLE, UNEDITED marking response — examiner review in Bahasa Indonesia,
 * prose between blocks, and the log. This is what the box actually receives; a
 * hand-cleaned block would test a path the owner never takes.
 *
 * Every quote here is INVENTED for the fixture. The owner's real practice
 * writing lives in the database and never in the repo.
 */
const WHOLE_RESPONSE = `Baik, saya sudah membaca keseluruhan esai. Berikut penilaiannya.

**Paragraf 1 — Pendahuluan**
Overview sudah ada, tetapi hanya menyebut satu tren. Untuk Task 1, overview harus
menyebut nilai tertinggi, terendah, dan kontras utamanya.

**Paragraf 2**
Ada beberapa masalah gramatikal mendasar di sini yang menurunkan estimasi band.

**Skor**
- Task Achievement: 6.0
- Coherence & Cohesion: 6.5
- Lexical Resource: 6.0
- Grammatical Range & Accuracy: 5.5
**Estimasi band keseluruhan: 6.0**

Yang membaik: struktur paragraf jauh lebih rapi dibanding sebelumnya.
Yang masih perlu dikerjakan: konsistensi tense pada data historis.
Satu hal yang berhasil: pengelompokan kategori di paragraf kedua sudah tepat.

Berikut log kesalahannya.

\`\`\`
2026-07-20 | writing_task1 | Task Achievement | overview_not_synthesised | The chart shows that the numbers went up. | Overview hanya menyebut satu tren, tidak menyebut tertinggi/terendah.
2026-07-20 | writing_task1 | Grammatical Range & Accuracy | tense_drift | In 2015 the figure has risen to 40 per cent. | Data historis ditulis dengan present perfect, seharusnya Simple Past.
2026-07-20 | writing_task1 | Grammatical Range & Accuracy | function_word_slip | another 20 per cent of the group | Kuantifier salah sebelum angka, seharusnya "a further".
2026-07-20 | writing_task1 | Task Achievement | coverage_gap | [absent: kategori "over 65" tidak pernah disebut] | Satu kategori dari prompt tidak dibahas sama sekali.
2026-07-20 | writing_task1 | Lexical Resource | UNCLASSIFIED | The percentage increased by a dramatic 40 per cent increase. | PROPOSED: doubled_construction — struktur diulang dua kali dalam satu frasa. Tidak cocok dengan mode mana pun.
\`\`\`

Untuk bagian speaking yang Anda kirim terpisah, ini lognya:

\`\`\`text
2026-07-20 | speaking | Lexical Resource | topic_vocabulary_gap | it is a kind of thing that people do | Kata umum dipakai di tempat yang butuh kata spesifik.
2026-07-20 | speaking | Pronunciation | inflection_dropped | he walk to the station yesterday | Akhiran -ed tidak diartikulasikan sehingga tense hilang di audio.
\`\`\`

Dan satu baris terakhir dari catatan pembanding, di mana ada tanda pipa di dalam kutipan:

2026-07-20 | reading | transfer | answer_form_error | the answer was written as "cost \\| benefit" | Format jawaban tidak scoreable karena memuat karakter tambahan.

Semoga membantu.`;

describe('parseErrorLog — the whole unedited response', () => {
  const result = parseErrorLog(WHOLE_RESPONSE);

  it('finds every row across two fences, prose, and one unfenced line', () => {
    expect(result.rows).toHaveLength(8);
  });

  it('spans more than one skill in a single paste', () => {
    expect(new Set(result.rows.map((row) => row.fields.skill))).toEqual(
      new Set(['writing_task1', 'speaking', 'reading']),
    );
  });

  it('ignores the examiner review silently — prose is expected, not an error', () => {
    // The review contains lines with no pipes and lines with colons; none of
    // them may surface as a candidate row or as a rejection.
    expect(result.rows.every((row) => row.raw.includes('|'))).toBe(true);
  });

  it('validates all eight rows, including UNCLASSIFIED and [absent: …]', () => {
    const invalid = result.rows.filter((row) => row.problems.length > 0);
    expect(invalid.map((row) => `${row.line}: ${row.problems.join(' ')}`)).toEqual([]);
  });

  it('unescapes a literal pipe inside a quote without splitting the row', () => {
    const row = result.rows.find((candidate) => candidate.fields.skill === 'reading');
    expect(row?.fields.quote).toBe('the answer was written as "cost | benefit"');
  });

  it('keeps an [absent: …] quote as a valid quote', () => {
    const row = result.rows.find(
      (candidate) => candidate.fields.failureMode === 'coverage_gap',
    );
    expect(row?.fields.quote).toBe('[absent: kategori "over 65" tidak pernah disebut]');
    expect(row?.problems).toEqual([]);
  });

  it('lets an UNCLASSIFIED row through with its proposal intact', () => {
    const row = result.rows.find(
      (candidate) => candidate.fields.failureMode === 'UNCLASSIFIED',
    );
    expect(row?.problems).toEqual([]);
    expect(row?.fields.note).toContain('PROPOSED: doubled_construction');
  });
});

describe('parseErrorLog — tolerance, each drift tested separately', () => {
  const row = (skill: string, criterion: string, mode: string) =>
    `2026-07-20 | ${skill} | ${criterion} | ${mode} | some quoted text | catatan singkat`;

  it('reads rows with no fence at all', () => {
    const result = parseErrorLog(row('reading', 'timing', 'time_ran_out'));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].problems).toEqual([]);
  });

  it('reads rows inside a ```text fence', () => {
    const text = ['```text', row('reading', 'timing', 'time_ran_out'), '```'].join('\n');
    expect(parseErrorLog(text).rows).toHaveLength(1);
  });

  it('discards a stray header row rather than rejecting it', () => {
    const text = [
      '```',
      'date | skill | criterion | failure_mode | quote | note',
      row('reading', 'timing', 'time_ran_out'),
      '```',
    ].join('\n');
    const result = parseErrorLog(text);
    expect(result.discardedHeaders).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].problems).toEqual([]);
  });

  it('reads two separate blocks with prose between them', () => {
    const text = [
      'Berikut blok pertama:',
      '```',
      row('reading', 'timing', 'time_ran_out'),
      '```',
      'Dan ini blok kedua, untuk sesi listening:',
      '```',
      row('listening', 'transfer', 'number_or_name_slip'),
      '```',
      'Selesai.',
    ].join('\n');
    expect(parseErrorLog(text).rows).toHaveLength(2);
  });

  it('reads across blank lines inside a block', () => {
    const text = [
      '```',
      row('reading', 'timing', 'time_ran_out'),
      '',
      row('listening', 'transfer', 'number_or_name_slip'),
      '',
      '```',
    ].join('\n');
    expect(parseErrorLog(text).rows).toHaveLength(2);
  });

  it('reads a markdown table, separator row and edge pipes and all', () => {
    const text = [
      '| date | skill | criterion | failure_mode | quote | note |',
      '| --- | --- | --- | --- | --- | --- |',
      `| ${row('reading', 'timing', 'time_ran_out').replaceAll(' | ', ' | ')} |`,
    ].join('\n');
    const result = parseErrorLog(text);
    expect(result.discardedHeaders).toBe(1);
    expect(result.rows).toHaveLength(1);
  });

  it('does not depend on row order', () => {
    const text = [
      row('listening', 'transfer', 'number_or_name_slip'),
      row('reading', 'timing', 'time_ran_out'),
    ].join('\n');
    const result = parseErrorLog(text);
    expect(result.rows.map((candidate) => candidate.fields.skill)).toEqual([
      'listening',
      'reading',
    ]);
  });

  it('reads optional seventh and eighth fields when a model supplies them', () => {
    const text =
      '2026-07-20 | reading | location | keyword_trap | some text | catatan | matching headings | 2026-07-13';
    const [candidate] = parseErrorLog(text).rows;
    expect(candidate.fields.questionType).toBe('matching headings');
    expect(candidate.fields.revisionOf).toBe('2026-07-13');
    expect(candidate.problems).toEqual([]);
  });
});

describe('parseErrorLog — rejection is per row, never per paste', () => {
  it('rejects a criterion that is valid for writing but pasted against listening', () => {
    const text =
      '2026-07-20 | listening | Lexical Resource | paraphrase_missed | some text | catatan';
    const [candidate] = parseErrorLog(text).rows;
    expect(candidate.problems).toHaveLength(1);
    expect(candidate.problems[0]).toContain('not a Listening criterion');
  });

  it('rejects a reading mode pasted against writing_task1', () => {
    const text =
      '2026-07-20 | writing_task1 | Task Achievement | not_given_confusion | some text | catatan';
    const [candidate] = parseErrorLog(text).rows;
    expect(candidate.problems[0]).toContain('not a Writing Task 1 failure mode');
  });

  it('rejects an empty quote and names the [absent: …] escape hatch', () => {
    const text = '2026-07-20 | reading | timing | time_ran_out |  | catatan';
    const [candidate] = parseErrorLog(text).rows;
    expect(candidate.problems[0]).toContain('[absent:');
  });

  it('rejects an impossible date', () => {
    const text = '2026-02-31 | reading | timing | time_ran_out | some text | catatan';
    const [candidate] = parseErrorLog(text).rows;
    expect(candidate.problems[0]).toContain('not a YYYY-MM-DD date');
  });

  it('keeps the valid rows around one malformed row', () => {
    const text = [
      '2026-07-20 | reading | timing | time_ran_out | first | catatan',
      '2026-07-20 | reading | timing | invented_mode | second | catatan',
      '2026-07-20 | reading | location | keyword_trap | third | catatan',
    ].join('\n');
    const result = parseErrorLog(text);
    expect(result.rows).toHaveLength(3);
    expect(result.rows.filter((row) => row.problems.length === 0)).toHaveLength(2);
    expect(result.rows[1].problems[0]).toContain('invented_mode');
  });

  it('finds nothing in a paste with no rows, and does not invent one', () => {
    const result = parseErrorLog('Bagus sekali! Tidak ada kesalahan yang perlu dicatat.');
    expect(result.rows).toEqual([]);
    expect(result.discardedHeaders).toBe(0);
  });

  it('ignores a pipe-shaped line that is not a row', () => {
    // A markdown score table from the review must not become a candidate.
    const result = parseErrorLog('| Task Achievement | 6.0 | Coherence | 6.5 | LR | 6.0 |');
    expect(result.rows).toEqual([]);
  });
});

describe('validateFields — re-run after the preview edits a row', () => {
  it('clears the problem once the mode is corrected in place', () => {
    const fields = {
      date: '2026-07-20',
      skill: 'reading' as const,
      criterion: 'timing',
      failureMode: 'invented_mode',
      quote: 'some text',
    };
    expect(validateFields(fields)).toHaveLength(1);
    expect(validateFields({ ...fields, failureMode: 'time_ran_out' })).toEqual([]);
  });
});
