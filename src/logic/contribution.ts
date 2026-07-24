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
