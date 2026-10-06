/**
 * FSRE BUILDING — THE ONE NUMBER FORMATTER.
 *
 * Point for thousands, comma for decimals: 10142 → "10.142", 0.45 → "0,45".
 * Every number the building puts on screen goes through formatNumber —
 * metrics, chips, panels, the notification badge and the replay counter.
 * The source's header badge bypassed its formatter, and its formatter had
 * no rounding control (0.1 + 0.2 printed as "0,30000000000000004").
 *
 * Rounding is explicit and decimal, not binary: half away from zero at
 * `decimals` places, done on the decimal string so 1.005 rounds to "1,01"
 * (Number.prototype.toFixed gives "1.00" there). Trailing zeros are trimmed
 * unless `fixed` asks for them. Locale APIs are deliberately not used: the
 * separators are a rule of this screen, not of whichever browser renders it.
 */
import { figureOf, figureValue, type FsreFigure } from './events';

export const DEFAULT_DECIMALS = 2;

export interface FormatOptions {
  /** Decimal places to round to. Default 2. */
  decimals?: number;
  /** Keep trailing zeros up to `decimals` ("5,00"). Default false. */
  fixed?: boolean;
}

/** Shown in place of a value that is not a finite number. data.ts rejects those, so this is a guard. */
export const NOT_A_NUMBER = 'n/a';

function roundHalfAwayFromZero(abs: number, decimals: number): number {
  // Shift by exponent notation, not by multiplying: 1.005 * 100 is
  // 100.49999999999999 in binary, `1.005e2` parses to exactly 100.5.
  const shifted = Number(`${abs}e${decimals}`);
  const rounded = Number.isFinite(shifted) ? Math.round(shifted) : Math.round(abs * 10 ** decimals);
  const back = Number(`${rounded}e-${decimals}`);
  return Number.isFinite(back) ? back : rounded / 10 ** decimals;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function formatNumber(value: number, options: FormatOptions = {}): string {
  if (!Number.isFinite(value)) return NOT_A_NUMBER;
  const decimals = Math.max(0, Math.trunc(options.decimals ?? DEFAULT_DECIMALS));
  const rounded = roundHalfAwayFromZero(Math.abs(value), decimals);
  // A value that rounds to zero carries no sign: "-0" is not a number anyone wrote.
  const negative = value < 0 && rounded !== 0;
  const [integerPart, fractionPart = ''] = rounded.toFixed(decimals).split('.');
  const fraction = options.fixed ? fractionPart : fractionPart.replace(/0+$/, '');
  const body = fraction ? `${groupThousands(integerPart)},${fraction}` : groupThousands(integerPart);
  return `${negative ? '-' : ''}${body}`;
}

/** "1 open escalation" / "2 open escalations" — the count and its noun in one place. */
export function formatCount(value: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(value)} ${value === 1 ? singular : plural}`;
}

/** "209 of 209". */
export function formatOf(value: number, of: number): string {
  return `${formatNumber(value)} of ${formatNumber(of)}`;
}

/** A payload figure: a bare number, or "value of total". */
export function formatFigure(figure: FsreFigure): string {
  const of = figureOf(figure);
  return of === null ? formatNumber(figureValue(figure)) : formatOf(figureValue(figure), of);
}

/* ---------- times and dates (v2): the house forms ---------- */

/** Two digits, zero-padded: the hour and minute halves of HH.MM. */
function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/** Shown in place of a time that does not parse. */
export const NOT_A_TIME = '--.--';

/** Local "HH.MM" of an ISO time: the house time format (brief v2 §2). */
export function formatHHMM(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NOT_A_TIME;
  return `${twoDigits(d.getHours())}.${twoDigits(d.getMinutes())}`;
}

const MONTH_ABBREVIATIONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** Local house date form, e.g. "6 Oct 2026" (the workpaper note's date). */
export function formatDateLong(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTH_ABBREVIATIONS[d.getMonth()]} ${d.getFullYear()}`;
}
