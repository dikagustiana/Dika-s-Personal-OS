import { describe, expect, it } from 'vitest';
import { calculateDailyScore } from './score';

describe('calculateDailyScore', () => {
  it('applies the 40/40/20 weights', () => {
    expect(
      calculateDailyScore({
        habits: { completed: 3, total: 4 },
        tasks: { completed: 1, total: 2 },
        timeblocks: { completed: 2, total: 2 },
      }).score,
    ).toBe(70);
  });

  it('renormalizes when a component has no items', () => {
    expect(
      calculateDailyScore({
        habits: { completed: 2, total: 4 },
        tasks: { completed: 0, total: 0 },
        timeblocks: { completed: 1, total: 1 },
      }).score,
    ).toBe(67);
  });

  it('returns a neutral empty result when every component is empty', () => {
    expect(
      calculateDailyScore({
        habits: { completed: 0, total: 0 },
        tasks: { completed: 0, total: 0 },
        timeblocks: { completed: 0, total: 0 },
      }),
    ).toEqual({ score: 0, isEmpty: true, activeComponents: 0 });
  });

  it('clamps completed counts to their valid range', () => {
    expect(
      calculateDailyScore({
        habits: { completed: 7, total: 4 },
        tasks: { completed: -1, total: 2 },
        timeblocks: { completed: 0, total: 0 },
      }).score,
    ).toBe(50);
  });
});
