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

export function summarizeWeek(
  logs: DailyLog[],
  plan: WeeklyPlan | null,
): WeekSummary {
  const scoreTotal = logs.reduce((sum, log) => sum + log.score, 0);
  const habitValues = logs.flatMap((log) => Object.values(log.habits));
  const habitsDone = habitValues.filter(Boolean).length;

  return {
    averageScore: logs.length > 0 ? Math.round(scoreTotal / logs.length) : 0,
    habitConsistency:
      habitValues.length > 0 ? Math.round((100 * habitsDone) / habitValues.length) : 0,
    daysLogged: logs.length,
    goalsHit: plan?.goals.filter((goal) => goal.done).map((goal) => goal.text) ?? [],
    goalsMissed: plan?.goals.filter((goal) => !goal.done).map((goal) => goal.text) ?? [],
  };
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
