import { describe, expect, it } from 'vitest';
import type { IeltsBandConversion } from '../../data/types';
import { conversionTableFor, isValidPrepBand, lookupBand } from './bandConversion';
import { PUBLISHED_BAND_CONVERSION } from './bandTable';

/**
 * The table under test mirrors the seed in the `ielts_prep_surface_seed`
 * migration. It is written out per raw score rather than generated, so a
 * boundary that moves in the migration and not here shows up as a failure
 * rather than as two generators agreeing with each other.
 */
const LISTENING: Array<[number, number | undefined]> = [
  [40, 9], [39, 9], [38, 8.5], [37, 8.5], [36, 8], [35, 8],
  [34, 7.5], [33, 7.5], [32, 7.5], [31, 7], [30, 7],
  [29, 6.5], [28, 6.5], [27, 6.5], [26, 6.5], [25, 6], [24, 6], [23, 6],
  [22, 5.5], [21, 5.5], [20, 5.5], [19, 5.5], [18, 5.5], [17, 5], [16, 5],
  [15, 4.5], [14, 4.5], [13, 4.5], [12, 4], [11, 4], [10, 4],
  [9, undefined], [0, undefined],
];

const READING: Array<[number, number | undefined]> = [
  [40, 9], [39, 9], [38, 8.5], [37, 8.5], [36, 8], [35, 8],
  [34, 7.5], [33, 7.5], [32, 7], [31, 7], [30, 7],
  [29, 6.5], [28, 6.5], [27, 6.5], [26, 6], [25, 6], [24, 6], [23, 6],
  [22, 5.5], [21, 5.5], [20, 5.5], [19, 5.5], [18, 5], [17, 5], [16, 5], [15, 5],
  [14, 4.5], [13, 4.5], [12, 4], [11, 4], [10, 4],
  [9, undefined], [0, undefined],
];

const TABLE: IeltsBandConversion[] = [
  ...LISTENING.map(([rawScore, band]) => ({ skill: 'listening' as const, rawScore, band })),
  ...READING.map(([rawScore, band]) => ({ skill: 'reading_academic' as const, rawScore, band })),
];

describe('conversionTableFor', () => {
  it('maps reading to the ACADEMIC table, not a generic one', () => {
    expect(conversionTableFor('reading')).toBe('reading_academic');
  });

  it('returns null for the skills with no raw score', () => {
    expect(conversionTableFor('writing')).toBeNull();
    expect(conversionTableFor('speaking')).toBeNull();
  });
});

describe('lookupBand', () => {
  it('derives band 7.0 from a listening raw score of 30', () => {
    // The gate-4 case, pinned: this is the number the log form must fill in
    // without anyone typing a band.
    expect(lookupBand('listening', 30, TABLE)).toEqual({ kind: 'derived', band: 7 });
  });

  it('keeps listening and reading apart where their tables disagree', () => {
    // Raw 32 is the clearest divergence: 7.5 in listening, 7.0 in reading.
    // One shared table would silently overstate one of them by half a band.
    expect(lookupBand('listening', 32, TABLE)).toEqual({ kind: 'derived', band: 7.5 });
    expect(lookupBand('reading', 32, TABLE)).toEqual({ kind: 'derived', band: 7 });
  });

  it.each(LISTENING.filter(([, band]) => band !== undefined))(
    'listening raw %i derives band %f',
    (rawScore, band) => {
      expect(lookupBand('listening', rawScore, TABLE)).toEqual({ kind: 'derived', band });
    },
  );

  it.each(READING.filter(([, band]) => band !== undefined))(
    'reading raw %i derives band %f',
    (rawScore, band) => {
      expect(lookupBand('reading', rawScore, TABLE)).toEqual({ kind: 'derived', band });
    },
  );

  it('reports below-published-range rather than inventing a band under raw 10', () => {
    expect(lookupBand('listening', 9, TABLE)).toEqual({ kind: 'below-published-range' });
    expect(lookupBand('reading', 0, TABLE)).toEqual({ kind: 'below-published-range' });
  });

  it('refuses to convert for writing and speaking', () => {
    expect(lookupBand('writing', 30, TABLE)).toEqual({ kind: 'no-table-for-skill' });
    expect(lookupBand('speaking', 30, TABLE)).toEqual({ kind: 'no-table-for-skill' });
  });

  it('treats out-of-range and non-integer raw scores as unavailable', () => {
    expect(lookupBand('listening', 41, TABLE)).toEqual({ kind: 'unavailable' });
    expect(lookupBand('listening', -1, TABLE)).toEqual({ kind: 'unavailable' });
    expect(lookupBand('listening', 30.5, TABLE)).toEqual({ kind: 'unavailable' });
    expect(lookupBand('listening', undefined, TABLE)).toEqual({ kind: 'unavailable' });
  });

  it('is unavailable rather than wrong when the table has not loaded', () => {
    expect(lookupBand('listening', 30, [])).toEqual({ kind: 'unavailable' });
  });
});

describe('PUBLISHED_BAND_CONVERSION (the offline table the mock serves)', () => {
  // The explicit lists above are written out score by score on purpose. This
  // is where they earn that: bandTable.ts states the same table as ranges, and
  // if the expansion drifts by one boundary these comparisons fail. Without
  // it the two copies could disagree and only production would notice.
  it('expands to one row per raw score 0..40 for both skills', () => {
    expect(PUBLISHED_BAND_CONVERSION).toHaveLength(82);
  });

  it.each(LISTENING)('matches the expanded listening table at raw %i', (rawScore, band) => {
    const row = PUBLISHED_BAND_CONVERSION.find(
      (entry) => entry.skill === 'listening' && entry.rawScore === rawScore,
    );
    expect(row?.band).toBe(band);
  });

  it.each(READING)('matches the expanded reading table at raw %i', (rawScore, band) => {
    const row = PUBLISHED_BAND_CONVERSION.find(
      (entry) => entry.skill === 'reading_academic' && entry.rawScore === rawScore,
    );
    expect(row?.band).toBe(band);
  });

  it('derives band 7.0 for listening raw 30 through the real table', () => {
    expect(lookupBand('listening', 30, PUBLISHED_BAND_CONVERSION)).toEqual({
      kind: 'derived',
      band: 7,
    });
  });
});

describe('isValidPrepBand', () => {
  it('accepts whole and half bands in range', () => {
    expect(isValidPrepBand(6.5)).toBe(true);
    expect(isValidPrepBand(9)).toBe(true);
    expect(isValidPrepBand(0)).toBe(true);
  });

  it('rejects quarter steps and out-of-range values', () => {
    expect(isValidPrepBand(6.25)).toBe(false);
    expect(isValidPrepBand(9.5)).toBe(false);
    expect(isValidPrepBand(-0.5)).toBe(false);
    expect(isValidPrepBand(Number.NaN)).toBe(false);
  });
});
