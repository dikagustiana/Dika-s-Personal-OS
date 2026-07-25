import { addDays, differenceInCalendarDays, format, parseISO, startOfISOWeek } from 'date-fns';
import type { Milestone } from '../data/types';
import { milestoneRange } from './milestones';

/**
 * The "this week" strip: one project's own milestones, laid out across the
 * seven days of the current ISO week.
 *
 * Scope is deliberately narrow and stays that way. This is not a Gantt: one
 * week, one project, read-only, no navigation to other periods, no dependency
 * lines, no month or quarter view. WORK has a standing no-Gantt rule and this
 * is not an exception to it — it answers exactly one question ("what is
 * targeted to finish this week?") and must not grow past it.
 */

export interface WeekStripBar {
  milestone: Milestone;
  /** 0-based column, Monday = 0. */
  startIndex: number;
  /** Columns covered, always at least 1 and never past Sunday. */
  span: number;
  /** The milestone started before Monday — render a flush left edge. */
  clippedStart: boolean;
  /** The milestone runs past Sunday — render a flush right edge. */
  clippedEnd: boolean;
}

export interface WeekStrip {
  /** Monday of the week `today` falls in. */
  weekStart: Date;
  /** Sunday of that week. */
  weekEnd: Date;
  /** The seven day columns, Monday first. */
  days: Date[];
  /** Bars in milestone order; empty when nothing overlaps the week. */
  bars: WeekStripBar[];
}

export const WEEK_STRIP_COLUMNS = 7;

/**
 * Lays out the milestones whose span overlaps the current ISO week.
 *
 * Overlap is inclusive on both ends (`start <= sunday && end >= monday`), so a
 * milestone that merely passes through the week without starting or ending in
 * it still appears — that is the one shape a "what's in flight" strip must
 * never drop. Milestones with no date at all are excluded; there is nothing
 * to place them against.
 */
export function buildWeekStrip(milestones: Milestone[], today: Date): WeekStrip {
  const weekStart = startOfISOWeek(today);
  const weekEnd = addDays(weekStart, WEEK_STRIP_COLUMNS - 1);
  const days = Array.from({ length: WEEK_STRIP_COLUMNS }, (_, index) =>
    addDays(weekStart, index),
  );

  const bars: WeekStripBar[] = [];
  for (const milestone of milestones) {
    const range = milestoneRange(milestone);
    if (!range) continue;

    const start = parseISO(range.start);
    const end = parseISO(range.end);
    const startOffset = differenceInCalendarDays(start, weekStart);
    const endOffset = differenceInCalendarDays(end, weekStart);
    if (startOffset > WEEK_STRIP_COLUMNS - 1 || endOffset < 0) continue;

    const clippedStartIndex = Math.max(0, startOffset);
    const clippedEndIndex = Math.min(WEEK_STRIP_COLUMNS - 1, endOffset);
    bars.push({
      milestone,
      startIndex: clippedStartIndex,
      span: clippedEndIndex - clippedStartIndex + 1,
      clippedStart: startOffset < 0,
      clippedEnd: endOffset > WEEK_STRIP_COLUMNS - 1,
    });
  }

  return { weekStart, weekEnd, days, bars };
}

/** `20–26 Jul` / `29 Jun – 5 Jul` when the week straddles two months. */
export function weekStripLabel(strip: WeekStrip): string {
  const sameMonth = strip.weekStart.getMonth() === strip.weekEnd.getMonth();
  const from = sameMonth ? format(strip.weekStart, 'd') : format(strip.weekStart, 'd MMM');
  return `${from}–${format(strip.weekEnd, 'd MMM')}`;
}
