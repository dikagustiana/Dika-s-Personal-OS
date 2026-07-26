import { describe, expect, it } from 'vitest';
import type { DailyLog, WeeklyPlan } from '../data/types';
import {
  daysElapsedInWeek,
  getIsoWeekKey,
  getNextWeekKey,
  getPreviousWeekKey,
  getReviewTargetWeek,
  getWeekRange,
  summarizeWeek,
} from './week';

describe('ISO week helpers', () => {
  it('handles the ISO week-year boundary', () => {
    expect(getIsoWeekKey(new Date(2021, 0, 1))).toBe('2020-W53');
    expect(getIsoWeekKey(new Date(2021, 0, 4))).toBe('2021-W01');
  });

  it('returns Monday-exclusive-next-Monday ranges', () => {
    expect(getWeekRange('2026-W31')).toEqual({
      from: '2026-07-27',
      to: '2026-08-03',
    });
  });

  it('moves safely between years', () => {
    expect(getPreviousWeekKey('2021-W01')).toBe('2020-W53');
    expect(getNextWeekKey('2020-W53')).toBe('2021-W01');
  });
});

describe('summarizeWeek', () => {
  const logs: DailyLog[] = [
    { date: '2026-07-20', domain: 'work', score: 60, habits: { a: true, b: false } },
    { date: '2026-07-21', domain: 'work', score: 80, habits: { a: true, b: true } },
  ];
  const plan: WeeklyPlan = {
    week: '2026-W30',
    domain: 'work',
    goals: [
      { id: 'a', text: 'Ship draft', done: true },
      { id: 'b', text: 'Book exam', done: false },
    ],
  };

  it('averages over the window, counting unlogged days as zero', () => {
    // Two logged days out of seven: 140/7 = 20, and consistency
    // (0.5 + 1.0) / 7 ≈ 21% — a day with no log is a day nothing was earned,
    // not a day to drop from the denominator.
    expect(summarizeWeek(logs, plan, 7)).toEqual({
      averageScore: 20,
      habitConsistency: 21,
      daysLogged: 2,
      goalsHit: ['Ship draft'],
      goalsMissed: ['Book exam'],
    });
  });

  it('reads as a plain average when every window day is logged', () => {
    const summary = summarizeWeek(logs, plan, 2);
    expect(summary.averageScore).toBe(70);
    expect(summary.habitConsistency).toBe(75);
  });

  it('never divides by less than the days actually logged', () => {
    // A caller passing a too-small window cannot inflate the figures.
    expect(summarizeWeek(logs, plan, 1).averageScore).toBe(70);
  });

  it('one perfect logged day no longer reads as a perfect week', () => {
    const oneDay: DailyLog[] = [
      { date: '2026-07-20', domain: 'work', score: 100, habits: { a: true } },
    ];
    const summary = summarizeWeek(oneDay, null, 7);
    expect(summary.averageScore).toBe(14);
    expect(summary.habitConsistency).toBe(14);
  });
});

describe('daysElapsedInWeek', () => {
  it('counts Monday through today inclusive for the current week', () => {
    // 2026-07-22 is the Wednesday of ISO week 2026-W30.
    expect(daysElapsedInWeek('2026-W30', new Date('2026-07-22T10:00:00'))).toBe(3);
  });

  it('is 7 for a finished week and 1 before the week starts', () => {
    expect(daysElapsedInWeek('2026-W30', new Date('2026-08-05T10:00:00'))).toBe(7);
    expect(daysElapsedInWeek('2026-W30', new Date('2026-07-01T10:00:00'))).toBe(1);
  });
});

describe('getReviewTargetWeek', () => {
  // B4: the review always judges the week before the one on screen. These
  // walk across a Sunday boundary, where the old code was most wrong.
  it('reviews the week that is ending, not the one being planned', () => {
    const sundayEvening = new Date('2026-07-26T19:00:00'); // Sunday, ISO 2026-W30
    const selected = getIsoWeekKey(sundayEvening);
    expect(selected).toBe('2026-W30');
    expect(getReviewTargetWeek(selected)).toBe('2026-W29');
  });

  it('still targets the week just ended once the boundary is crossed', () => {
    const mondayMorning = new Date('2026-07-27T09:00:00'); // Monday, ISO 2026-W31
    const selected = getIsoWeekKey(mondayMorning);
    expect(selected).toBe('2026-W31');
    expect(getReviewTargetWeek(selected)).toBe('2026-W30');
  });

  it('never marks the week on screen as reviewed', () => {
    for (const day of ['2026-07-25', '2026-07-26', '2026-07-27', '2026-07-28']) {
      const selected = getIsoWeekKey(new Date(`${day}T12:00:00`));
      expect(getReviewTargetWeek(selected)).not.toBe(selected);
    }
  });

  it('planning next week on Sunday still reviews the week that just ended', () => {
    // The Sunday-evening banner jumps the planner forward a week; the review
    // card must not follow it.
    const sunday = new Date('2026-07-26T19:00:00');
    const planningWeek = getNextWeekKey(getIsoWeekKey(sunday)); // 2026-W31
    expect(getReviewTargetWeek(getIsoWeekKey(sunday))).toBe('2026-W29');
    expect(planningWeek).toBe('2026-W31');
  });
});
