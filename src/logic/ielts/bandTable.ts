import type { IeltsBandConversion } from '../../data/types';

/**
 * THE PUBLISHED CONVERSION TABLE, expressed as ranges.
 *
 * This exists so the MOCK REPOSITORY can serve a working conversion without a
 * database — a bare clone with no credentials has to render a log form that
 * derives a band, or the offline mode is a demo of a broken screen.
 *
 * THE DATABASE IS STILL AUTHORITATIVE. os_ielts_band_conversion is what the
 * live app reads, and it is the copy to correct against an official Cambridge
 * answer key. This file must be corrected alongside it; bandConversion.test.ts
 * holds a third, fully expanded copy written out score by score, and it fails
 * if this expansion drifts from it. Three copies is two too many for comfort,
 * so the test is the thing that keeps them honest.
 *
 * INDICATIVE VALUES — the published Academic tables vary slightly by test
 * version. Below raw 10 the tables stop, and these ranges stop with them: the
 * rows still exist with an undefined band, which is a statement that no band
 * is published, not a failure to look one up.
 */

type Range = readonly [low: number, high: number, band: number];

const LISTENING_RANGES: readonly Range[] = [
  [39, 40, 9], [37, 38, 8.5], [35, 36, 8], [32, 34, 7.5], [30, 31, 7],
  [26, 29, 6.5], [23, 25, 6], [18, 22, 5.5], [16, 17, 5], [13, 15, 4.5], [10, 12, 4],
];

// Reading diverges from listening at four boundaries — 7.5, 7.0, 6.0 and 5.0
// all sit differently. One shared table would overstate one skill by half a
// band at raw 32, which is squarely in his working range.
const READING_ACADEMIC_RANGES: readonly Range[] = [
  [39, 40, 9], [37, 38, 8.5], [35, 36, 8], [33, 34, 7.5], [30, 32, 7],
  [27, 29, 6.5], [23, 26, 6], [19, 22, 5.5], [15, 18, 5], [13, 14, 4.5], [10, 12, 4],
];

function expand(skill: IeltsBandConversion['skill'], ranges: readonly Range[]): IeltsBandConversion[] {
  const rows: IeltsBandConversion[] = [];
  for (let rawScore = 0; rawScore <= 40; rawScore += 1) {
    const match = ranges.find(([low, high]) => rawScore >= low && rawScore <= high);
    rows.push({ skill, rawScore, band: match?.[2] });
  }
  return rows;
}

export const PUBLISHED_BAND_CONVERSION: readonly IeltsBandConversion[] = [
  ...expand('listening', LISTENING_RANGES),
  ...expand('reading_academic', READING_ACADEMIC_RANGES),
];
