import { eachDayOfInterval, format, subDays } from 'date-fns';
import type { DailyLog } from '../data/types';

export interface ContributionDay {
  date: string;
  consistency: number | null;
  bucket: 0 | 1 | 2 | 3 | 4;
}

export function getHabitConsistency(log: DailyLog | null): number | null {
  if (!log) return null;
  const values = Object.values(log.habits);
  if (values.length === 0) return null;
  return values.filter(Boolean).length / values.length;
}

export function getContributionBucket(consistency: number | null): 0 | 1 | 2 | 3 | 4 {
  if (consistency === null || consistency <= 0) return 0;
  if (consistency <= 0.25) return 1;
  if (consistency <= 0.5) return 2;
  if (consistency <= 0.75) return 3;
  return 4;
}

/**
 * Mean habit consistency across a FIXED window of calendar days.
 *
 * The subtlety that made the old dashboard figure a lie: it divided ticked
 * habits by "habit entries that exist in logs". With one logged day on which
 * the habits were ticked, that is 1/1 — it reported 100% under a label
 * saying "30 days", when the honest answer was about 3%.
 *
 * A day with no log is a day the habits were not done, not a day to exclude
 * from the denominator. So every day in the window contributes a value:
 * ticked/total where a log exists, 0 where none does, and the headline is
 * the mean over the whole window.
 */
export function windowHabitConsistency(
  logs: DailyLog[],
  endDate: Date,
  dayCount = 30,
): number {
  const days = buildContributionDays(logs, endDate, dayCount);
  if (days.length === 0) return 0;
  const total = days.reduce((sum, day) => sum + (day.consistency ?? 0), 0);
  return Math.round((100 * total) / days.length);
}

export function buildContributionDays(
  logs: DailyLog[],
  endDate: Date,
  dayCount = 30,
): ContributionDay[] {
  const byDate = new Map(logs.map((log) => [log.date, log]));
  const dates = eachDayOfInterval({
    start: subDays(endDate, dayCount - 1),
    end: endDate,
  });

  return dates.map((date) => {
    const dateKey = format(date, 'yyyy-MM-dd');
    const consistency = getHabitConsistency(byDate.get(dateKey) ?? null);
    return {
      date: dateKey,
      consistency,
      bucket: getContributionBucket(consistency),
    };
  });
}
