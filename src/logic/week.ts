import {
  addWeeks,
  format,
  getISOWeek,
  getISOWeekYear,
  parseISO,
  setISOWeek,
  setISOWeekYear,
  startOfISOWeek,
  subWeeks,
} from 'date-fns';
import type { DailyLog, WeeklyPlan } from '../data/types';

export interface WeekRange {
  from: string;
  to: string;
}

export interface WeekSummary {
  averageScore: number;
  habitConsistency: number;
  daysLogged: number;
  goalsHit: string[];
  goalsMissed: string[];
}

export function getIsoWeekKey(date: Date): string {
  return `${getISOWeekYear(date)}-W${String(getISOWeek(date)).padStart(2, '0')}`;
}

export function dateFromIsoWeekKey(weekKey: string): Date {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!match) {
    throw new Error(`Invalid ISO week key: ${weekKey}`);
  }

  const year = Number(match[1]);
  const week = Number(match[2]);
  const seeded = setISOWeekYear(setISOWeek(new Date(year, 0, 4), week), year);
  return startOfISOWeek(seeded);
}

export function getWeekRange(weekKey: string): WeekRange {
  const monday = dateFromIsoWeekKey(weekKey);
  return {
    from: format(monday, 'yyyy-MM-dd'),
    to: format(addWeeks(monday, 1), 'yyyy-MM-dd'),
  };
}

export function getPreviousWeekKey(weekKey: string): string {
  return getIsoWeekKey(subWeeks(dateFromIsoWeekKey(weekKey), 1));
}

export function getNextWeekKey(weekKey: string): string {
  return getIsoWeekKey(addWeeks(dateFromIsoWeekKey(weekKey), 1));
}

export function isDateInWeek(date: string, weekKey: string): boolean {
  const range = getWeekRange(weekKey);
  return date >= range.from && date < range.to;
}

/**
 * Summarizes a week over an explicit number of days, not over logged days.
 *
 * The old divisor was `logs.length` — the same lie the 30-day habit figure
 * told before it was fixed: one logged day scoring 74 reported "average 74"
 * for a seven-day week. A day with no log is a day nothing was earned, so it
 * belongs in the denominator at zero. Callers pass how many days the summary
 * claims to cover: 7 for a finished week, days-elapsed-so-far for the current
 * one. `daysLogged` stays in the result as the disclosure.
 */
export function summarizeWeek(
  logs: DailyLog[],
  plan: WeeklyPlan | null,
  windowDays: number,
): WeekSummary {
  const days = Math.max(windowDays, logs.length, 1);
  const scoreTotal = logs.reduce((sum, log) => sum + log.score, 0);
  // Per-day consistency averaged over the window — an unlogged day counts 0,
  // and a day's habits are judged against that day's own habit set.
  const consistencyTotal = logs.reduce((sum, log) => {
    const values = Object.values(log.habits);
    if (values.length === 0) return sum;
    return sum + values.filter(Boolean).length / values.length;
  }, 0);

  return {
    averageScore: Math.round(scoreTotal / days),
    habitConsistency: Math.round((100 * consistencyTotal) / days),
    daysLogged: logs.length,
    goalsHit: plan?.goals.filter((goal) => goal.done).map((goal) => goal.text) ?? [],
    goalsMissed: plan?.goals.filter((goal) => !goal.done).map((goal) => goal.text) ?? [],
  };
}

/**
 * The honest window for a week still in progress: Monday through `today`,
 * inclusive, capped at 7. Yesterday's week is always 7.
 */
export function daysElapsedInWeek(weekKey: string, today: Date): number {
  const range = getWeekRange(weekKey);
  const todayKey = format(today, 'yyyy-MM-dd');
  if (todayKey >= range.to) return 7;
  if (todayKey < range.from) return 1;
  const monday = dateFromIsoWeekKey(weekKey);
  const elapsed =
    Math.floor((today.getTime() - monday.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  return Math.min(Math.max(elapsed, 1), 7);
}

export function formatWeekLabel(weekKey: string): string {
  const monday = dateFromIsoWeekKey(weekKey);
  return `Week ${getISOWeek(parseISO(format(monday, 'yyyy-MM-dd')))} · ${format(monday, 'MMM d')}`;
}

/**
 * The week a Sunday review is actually closing out.
 *
 * The review card summarizes the week *before* the one being planned, so its
 * `reviewedAt` belongs on that week's plan. Writing it to the plan on screen
 * marked the week you are about to start as reviewed while the week you just
 * reviewed stayed open — and on a Sunday, when planning has moved on to the
 * next week, it landed two weeks away from the data being read.
 */
export function getReviewTargetWeek(selectedWeek: string): string {
  return getPreviousWeekKey(selectedWeek);
}
