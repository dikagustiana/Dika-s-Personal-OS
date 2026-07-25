import { describe, expect, it } from 'vitest';
import type { DailyLog } from '../data/types';
import {
  buildContributionDays,
  getHabitConsistency,
  windowHabitConsistency,
} from './contribution';

const today = new Date(2026, 6, 25); // 2026-07-25

function log(date: string, habits: Record<string, boolean>): DailyLog {
  return { date, domain: 'work', habits, score: 0 };
}

describe('getHabitConsistency', () => {
  it('is the ticked share of that day, or null when there is no log', () => {
    expect(getHabitConsistency(log('2026-07-25', { a: true, b: false }))).toBe(0.5);
    expect(getHabitConsistency(null)).toBeNull();
  });

  it('is null for a log with no habits at all, not 0', () => {
    expect(getHabitConsistency(log('2026-07-25', {}))).toBeNull();
  });
});

describe('windowHabitConsistency', () => {
  // This is the regression the dashboard figure existed to hide: dividing by
  // "habit entries that exist" instead of by the window made one perfect day
  // read as a perfect month.
  it('reports ~3%, not 100%, for a single fully-ticked day in a 30-day window', () => {
    const logs = [log('2026-07-25', { a: true, b: true, c: true })];
    expect(windowHabitConsistency(logs, today, 30)).toBe(3);

    // The old formula, for contrast: ticked / total-entries-present = 100%.
    const values = logs.flatMap((entry) => Object.values(entry.habits));
    const oldFormula = Math.round((100 * values.filter(Boolean).length) / values.length);
    expect(oldFormula).toBe(100);
  });

  it('counts an unlogged day as zero rather than excluding it', () => {
    // Two perfect days out of thirty.
    const logs = [
      log('2026-07-25', { a: true, b: true }),
      log('2026-07-24', { a: true, b: true }),
    ];
    expect(windowHabitConsistency(logs, today, 30)).toBe(7); // 2/30 = 6.67
  });

  it('averages partial days across the window', () => {
    const logs = [
      log('2026-07-25', { a: true, b: false }), // 0.5
      log('2026-07-24', { a: true, b: true }), // 1.0
    ];
    expect(windowHabitConsistency(logs, today, 30)).toBe(5); // 1.5/30 = 5%
  });

  it('is 100% only when every day in the window is fully ticked', () => {
    const days = buildContributionDays([], today, 30).map((day) =>
      log(day.date, { a: true }),
    );
    expect(windowHabitConsistency(days, today, 30)).toBe(100);
  });

  it('is 0 with no logs at all', () => {
    expect(windowHabitConsistency([], today, 30)).toBe(0);
  });

  it('ignores logs outside the window', () => {
    expect(windowHabitConsistency([log('2026-01-01', { a: true })], today, 30)).toBe(0);
  });
});
