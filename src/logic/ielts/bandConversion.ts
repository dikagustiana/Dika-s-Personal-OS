import type { IeltsBandConversion, IeltsPrepSkill } from '../../data/types';

/**
 * RAW SCORE → BAND, for the two skills that have a raw score.
 *
 * The table is INDICATIVE. Published Academic conversions vary slightly by
 * test version — Cambridge prints a different key in each book — so a band
 * from here is an estimate, and the log form always allows a manual override.
 * That override is also why the derived band is STORED on the practice row
 * rather than re-derived on every read: a value that is never stored cannot
 * be overridden, and correcting the table later must not silently rewrite the
 * band on a session he already checked against an official key.
 *
 * Academic only. General Training Reading uses a different and more generous
 * table; nothing here covers it, and asking for it returns undefined rather
 * than quietly handing back the Academic answer.
 */

/** Which conversion table a skill reads. Writing and speaking have none. */
export function conversionTableFor(skill: IeltsPrepSkill): IeltsBandConversion['skill'] | null {
  if (skill === 'listening') return 'listening';
  if (skill === 'reading') return 'reading_academic';
  return null;
}

export type BandLookup =
  /** A published band for this raw score. */
  | { kind: 'derived'; band: number }
  /** In range, but the published table stops below raw 10. Enter a band by
   *  hand — inventing one would be a guess presented as a conversion. */
  | { kind: 'below-published-range' }
  /** Writing or speaking: there is no raw score to convert. */
  | { kind: 'no-table-for-skill' }
  /** Outside 0..40, or the table has not loaded. */
  | { kind: 'unavailable' };

export function lookupBand(
  skill: IeltsPrepSkill,
  rawScore: number | undefined,
  table: readonly IeltsBandConversion[],
): BandLookup {
  const tableSkill = conversionTableFor(skill);
  if (tableSkill === null) return { kind: 'no-table-for-skill' };
  if (rawScore === undefined || !Number.isInteger(rawScore) || rawScore < 0 || rawScore > 40) {
    return { kind: 'unavailable' };
  }
  const row = table.find((entry) => entry.skill === tableSkill && entry.rawScore === rawScore);
  if (!row) return { kind: 'unavailable' };
  // A row with a null band is a FACT, not a miss: it says the published table
  // has no entry this low. Distinguishing the two is why the seed writes rows
  // for 0..9 at all rather than leaving them absent.
  if (row.band === undefined || row.band === null) return { kind: 'below-published-range' };
  return { kind: 'derived', band: row.band };
}

/** IELTS bands are whole or half points. */
export function isValidPrepBand(band: number): boolean {
  return Number.isFinite(band) && band >= 0 && band <= 9 && Math.round(band * 2) === band * 2;
}
