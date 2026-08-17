// The echo check (Phase 1.1): an extracted value must APPEAR in the text it
// was supposedly extracted from. A false rejection costs a `skipped` line;
// a false acceptance costs the whole extraction guarantee — so the vectors
// lean on rejection cases.
import { describe, expect, it } from 'vitest';
import { numberAppearsIn, tokenReadings } from '../../../supabase/functions/_shared/numberEcho';

describe('tokenReadings', () => {
  it('reads unambiguous forms one way', () => {
    expect(tokenReadings('1,234.56')).toEqual([1234.56]); // en only
    expect(tokenReadings('1.234,56')).toEqual([1234.56]); // id only
    expect(tokenReadings('1.234.567')).toEqual([1234567]); // id grouping only
  });
  it('returns both readings of a genuinely ambiguous token', () => {
    expect(new Set(tokenReadings('1.234'))).toEqual(new Set([1.234, 1234]));
    expect(new Set(tokenReadings('2,15'))).toEqual(new Set([2.15]));
  });
});

describe('numberAppearsIn', () => {
  const enText = 'Total transfers reached 1,234.56 in 2024, up 12% on the year.';
  const idText = 'Realisasi mencapai Rp 1.234,56 miliar pada 2024, naik 2,15 persen.';

  it('accepts en formatting', () => {
    expect(numberAppearsIn(1234.56, enText)).toBe(true);
    expect(numberAppearsIn(12, enText)).toBe(true);
    expect(numberAppearsIn(2024, enText)).toBe(true);
  });

  it('accepts id formatting', () => {
    expect(numberAppearsIn(1234.56, idText)).toBe(true);
    expect(numberAppearsIn(2.15, idText)).toBe(true);
  });

  it('accepts space grouping and plain forms', () => {
    expect(numberAppearsIn(1234, 'jumlah 1 234 unit')).toBe(true);
    expect(numberAppearsIn(1234, 'jumlah 1234 unit')).toBe(true);
  });

  it('accepts either reading of an ambiguous token', () => {
    expect(numberAppearsIn(1234, 'tercatat 1.234 unit')).toBe(true);
    expect(numberAppearsIn(1.234, 'tercatat 1.234 unit')).toBe(true);
  });

  it('rejects a value that is genuinely absent', () => {
    expect(numberAppearsIn(9100, enText)).toBe(false);
    expect(numberAppearsIn(7.3, idText)).toBe(false);
  });

  it('rejects the mis-parse the old code would have accepted: 215 vs "2,15"', () => {
    expect(numberAppearsIn(215, idText)).toBe(false);
  });

  it('rejects scale-word arithmetic, conservatively', () => {
    // "2,15 triliun" backs 2.15 (the literal), never the multiplied value —
    // the scale belongs in the unit field, and ambiguity resolves to reject.
    const scaled = 'senilai 2,15 triliun rupiah';
    expect(numberAppearsIn(2.15, scaled)).toBe(true);
    expect(numberAppearsIn(2_150_000_000_000, scaled)).toBe(false);
  });

  it('accepts a negative only with a visible sign or accounting parenthesis', () => {
    expect(numberAppearsIn(-1.5, 'margin turun -1,5% tahun ini')).toBe(true);
    expect(numberAppearsIn(-1234, 'selisih (1.234) dicatat')).toBe(true);
    expect(numberAppearsIn(-1.5, 'margin 1,5% tahun ini')).toBe(false);
  });

  it('never accepts a fabricated-but-plausible near miss', () => {
    expect(numberAppearsIn(1234.57, enText)).toBe(false);
    expect(numberAppearsIn(1235, enText)).toBe(false);
  });
});
