// Copied from dikagustiana/dikagustiana.com@bed215d8046986843dcb30b4e88d0977f834f90d src/lib/finance-in-action/format.ts. Do not edit here; re-copy.
/**
 * The one number formatter of Finance in Action (constraint 14).
 *
 * The site's convention, from src/components/consolidation/WorkingPaperTable.tsx
 * and the v2 brief, and FSRE's shared/house_format.py: a point separates
 * thousands, a comma marks decimals, negatives sit in brackets. `1.234,5`,
 * `(665)`, `15,5%`. Written without Intl so the output does not depend on the
 * ICU data of the machine it runs on.
 */
import type { Row } from './contract/types';

/** Stated once under the grid and once under the chart. */
export const NUMBER_CONVENTION = 'A point separates thousands and a comma marks decimals; negatives are in brackets.';

/** What an empty value shows. */
export const EMPTY = '—';

const PERCENT = 100;

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function digits(abs: number, decimals: number): string {
  const fixed = abs.toFixed(decimals);
  const [i, d] = fixed.split('.');
  return d ? `${group(i)},${d}` : group(i);
}

/** `1.234,5`; `(665)`; null → —. A value that rounds to zero is never bracketed. */
export function formatNumber(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  const body = digits(Math.abs(value), decimals);
  const isZero = Number(Math.abs(value).toFixed(decimals)) === 0;
  return value < 0 && !isZero ? `(${body})` : body;
}

/** A fraction as a percentage: 0,155 → `15,5%`; −0,02 → `(2,0%)`. */
export function formatPercent(fraction: number | null | undefined, decimals = 1): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return EMPTY;
  const body = `${digits(Math.abs(fraction * PERCENT), decimals)}%`;
  const isZero = Number(Math.abs(fraction * PERCENT).toFixed(decimals)) === 0;
  return fraction < 0 && !isZero ? `(${body})` : body;
}

/** A change: `+12` or `(12)`, and `0` when it rounds away. */
export function formatDelta(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  const s = formatNumber(value, decimals);
  return value > 0 && Number(value.toFixed(decimals)) !== 0 ? `+${s}` : s;
}

/** A change in a ratio, in percentage points: `+1,2 pp` or `(1,2 pp)`. */
export function formatPointsDelta(fractionDelta: number | null | undefined, decimals = 1): string {
  if (fractionDelta === null || fractionDelta === undefined || !Number.isFinite(fractionDelta)) return EMPTY;
  const pts = fractionDelta * PERCENT;
  const body = `${digits(Math.abs(pts), decimals)} pp`;
  const isZero = Number(Math.abs(pts).toFixed(decimals)) === 0;
  if (isZero) return `0 pp`;
  return pts < 0 ? `(${body})` : `+${body}`;
}

const DECIMALS_LARGE = 0;
const DECIMALS_MEDIUM = 1;
const DECIMALS_SMALL = 2;
const LARGE = 100;
const MEDIUM = 10;

/** Decimals by size, so 7.270 has none, 72,7 has one and 2,40 has two. */
export function decimalsFor(value: number): number {
  const a = Math.abs(value);
  if (a >= LARGE) return DECIMALS_LARGE;
  if (a >= MEDIUM) return DECIMALS_MEDIUM;
  return DECIMALS_SMALL;
}

/** True when a row holds fractions shown as percentages. */
export const isRatioRow = (row: Pick<Row, 'style' | 'unit'>): boolean => row.style === 'ratio' || row.unit.trim().startsWith('%');

/** A cell value, formatted for its row. */
export function formatForRow(value: number | null | undefined, row: Pick<Row, 'style' | 'unit'>): string {
  if (value === null || value === undefined) return EMPTY;
  if (isRatioRow(row)) return formatPercent(value);
  return formatNumber(value, decimalsFor(value));
}

/** A change in a cell value, formatted for its row. */
export function formatDeltaForRow(delta: number | null | undefined, row: Pick<Row, 'style' | 'unit'>): string {
  if (delta === null || delta === undefined) return EMPTY;
  if (isRatioRow(row)) return formatPointsDelta(delta);
  return formatDelta(delta, decimalsFor(delta));
}

/**
 * Reads a number typed in the house format: `1.234,5`, `(665)`, `-665`,
 * `15,5%`. For a ratio row the result is a fraction (15,5 → 0,155). Returns
 * null when the input is not a number.
 */
export function parseHouseNumber(input: string, ratio: boolean): number | null {
  let s = input.trim().replace(/\s+/g, '');
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-') || s.startsWith('−')) {
    negative = !negative;
    s = s.slice(1);
  }
  const percent = s.endsWith('%');
  if (percent) s = s.slice(0, -1);
  if (!/^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+(,\d+)?$/.test(s)) return null;
  const n = Number(s.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  const v = ratio ? n / PERCENT : n;
  return negative ? -v : v;
}
