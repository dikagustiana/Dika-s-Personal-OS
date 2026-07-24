import { differenceInCalendarDays, parseISO } from 'date-fns';

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
