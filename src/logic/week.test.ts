import { describe, expect, it } from 'vitest';
import type { DailyLog, WeeklyPlan } from '../data/types';
import {
  getIsoWeekKey,
  getNextWeekKey,
  getPreviousWeekKey,
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
  it('summarizes scores, habits, and goal outcomes', () => {
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

    expect(summarizeWeek(logs, plan)).toEqual({
      averageScore: 70,
      habitConsistency: 75,
      daysLogged: 2,
      goalsHit: ['Ship draft'],
      goalsMissed: ['Book exam'],
    });
  });
});
