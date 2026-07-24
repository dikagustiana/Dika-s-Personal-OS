import type { IeltsResult } from '../data/types';

export const IELTS_TARGET = 7.0;

export const IELTS_SKILLS = [
  { key: 'listening', label: 'Listening' },
  { key: 'reading', label: 'Reading' },
  { key: 'writing', label: 'Writing' },
  { key: 'speaking', label: 'Speaking' },
] as const;

export type IeltsSkill = (typeof IELTS_SKILLS)[number]['key'];

/**
 * Official IELTS overall band: the mean of the four skills rounded to the
 * nearest 0.5, halves rounding up (x.25 -> x.5, x.75 -> x+1). Derived, never
 * stored.
 */
export function overallBand(result: Pick<IeltsResult, IeltsSkill>): number {
  const mean =
    (result.listening + result.reading + result.writing + result.speaking) / 4;
  return Math.round(mean * 2) / 2;
}

/** True for values expressible as whole or half bands within 0–9. */
export function isValidBand(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 9 && (value * 2) % 1 === 0;
}

export function formatBand(value: number): string {
  return value.toFixed(1);
}
