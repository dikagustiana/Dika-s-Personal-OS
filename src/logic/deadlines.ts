import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import type { DateConfidence } from '../data/types';

export type Urgency = 'overdue' | 'due-soon' | 'on-track';

/** Calendar days from `today` to `date` (negative = overdue). */
export function daysLeft(date: string, today: Date): number {
  return differenceInCalendarDays(parseISO(date), today);
}

/**
 * Urgency bucket for a deadline. `dueSoonDays` is the amber window — 7 for
 * WORK, 14 for GROWTH per spec. Overdue is red, due-soon amber, else emerald.
 */
export function urgencyFor(date: string, today: Date, dueSoonDays: number): Urgency {
  const days = daysLeft(date, today);
  if (days < 0) return 'overdue';
  if (days <= dueSoonDays) return 'due-soon';
  return 'on-track';
}

export function daysLeftLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Due today';
  return `${days}d left`;
}

/** Absent confidence means `confirmed` — see the DateConfidence doc comment. */
export function resolveConfidence(confidence?: DateConfidence): DateConfidence {
  return confidence ?? 'confirmed';
}

/**
 * Urgency for a date, softened by how much that date can be trusted. Only a
 * `confirmed` date is ever allowed to read as overdue or due-soon; a
 * placeholder must not drive red styling, because the deadline it describes
 * was never published.
 */
export function urgencyForConfident(
  date: string,
  today: Date,
  dueSoonDays: number,
  confidence?: DateConfidence,
): Urgency {
  if (resolveConfidence(confidence) !== 'confirmed') return 'on-track';
  return urgencyFor(date, today, dueSoonDays);
}

/**
 * Countdown text marked with its confidence: `12d left`, `~12d left`, or
 * `TBC` when there is genuinely no known date to count down to.
 */
export function daysLeftLabelFor(days: number, confidence?: DateConfidence): string {
  const resolved = resolveConfidence(confidence);
  if (resolved === 'unknown') return 'TBC';
  const label = daysLeftLabel(days);
  return resolved === 'estimated' ? `~${label}` : label;
}

/** Calendar date text marked with its confidence: `Oct 6, 2026`, `~Oct 6, 2026`, `TBC`. */
export function formatDateFor(date: string, confidence?: DateConfidence): string {
  const resolved = resolveConfidence(confidence);
  if (resolved === 'unknown') return 'TBC';
  const label = format(parseISO(date), 'MMM d, yyyy');
  return resolved === 'estimated' ? `~${label}` : label;
}
