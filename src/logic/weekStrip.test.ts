import { describe, expect, it } from 'vitest';
import type { Milestone } from '../data/types';
import { buildWeekStrip, weekStripLabel } from './weekStrip';

function milestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: 'm1',
    text: 'A milestone',
    done: false,
    status: 'not-started',
    ...overrides,
  };
}

// 2026-07-24 is a Friday; its ISO week runs Mon 20 Jul – Sun 26 Jul.
const today = new Date(2026, 6, 24);

describe('buildWeekStrip', () => {
  it('spans the exact days a milestone covers', () => {
    const strip = buildWeekStrip(
      [milestone({ startDate: '2026-07-21', endDate: '2026-07-23' })],
      today,
    );
    expect(strip.bars).toHaveLength(1);
    expect(strip.bars[0].startIndex).toBe(1); // Tuesday
    expect(strip.bars[0].span).toBe(3); // Tue–Thu
    expect(strip.bars[0].clippedStart).toBe(false);
    expect(strip.bars[0].clippedEnd).toBe(false);
  });

  it('treats an end date with no start as a single day', () => {
    const strip = buildWeekStrip([milestone({ endDate: '2026-07-22' })], today);
    expect(strip.bars[0].startIndex).toBe(2);
    expect(strip.bars[0].span).toBe(1);
  });

  it('clips a milestone that began before Monday', () => {
    const strip = buildWeekStrip(
      [milestone({ startDate: '2026-07-10', endDate: '2026-07-22' })],
      today,
    );
    expect(strip.bars[0].startIndex).toBe(0);
    expect(strip.bars[0].span).toBe(3);
    expect(strip.bars[0].clippedStart).toBe(true);
    expect(strip.bars[0].clippedEnd).toBe(false);
  });

  it('clips a milestone that runs past Sunday', () => {
    const strip = buildWeekStrip(
      [milestone({ startDate: '2026-07-24', endDate: '2026-08-15' })],
      today,
    );
    expect(strip.bars[0].startIndex).toBe(4);
    expect(strip.bars[0].span).toBe(3);
    expect(strip.bars[0].clippedEnd).toBe(true);
  });

  it('keeps a milestone that passes straight through the week', () => {
    const strip = buildWeekStrip(
      [milestone({ startDate: '2026-06-01', endDate: '2026-09-01' })],
      today,
    );
    expect(strip.bars[0].startIndex).toBe(0);
    expect(strip.bars[0].span).toBe(7);
    expect(strip.bars[0].clippedStart).toBe(true);
    expect(strip.bars[0].clippedEnd).toBe(true);
  });

  it('falls back to the legacy dueDate when endDate is absent', () => {
    const strip = buildWeekStrip([milestone({ dueDate: '2026-07-23' })], today);
    expect(strip.bars).toHaveLength(1);
    expect(strip.bars[0].startIndex).toBe(3);
  });

  it('prefers endDate over a stale dueDate', () => {
    const strip = buildWeekStrip(
      [milestone({ dueDate: '2026-07-21', endDate: '2026-07-24' })],
      today,
    );
    expect(strip.bars[0].startIndex).toBe(4);
  });

  it('excludes milestones outside the week and milestones with no dates', () => {
    const strip = buildWeekStrip(
      [
        milestone({ id: 'before', endDate: '2026-07-19' }),
        milestone({ id: 'after', startDate: '2026-07-27', endDate: '2026-07-28' }),
        milestone({ id: 'undated' }),
      ],
      today,
    );
    expect(strip.bars).toHaveLength(0);
  });

  it('includes the boundary days themselves', () => {
    const strip = buildWeekStrip(
      [
        milestone({ id: 'monday', endDate: '2026-07-20' }),
        milestone({ id: 'sunday', endDate: '2026-07-26' }),
      ],
      today,
    );
    expect(strip.bars.map((bar) => bar.startIndex)).toEqual([0, 6]);
  });

  it('collapses a backwards range onto its end date rather than inverting', () => {
    const strip = buildWeekStrip(
      [milestone({ startDate: '2026-07-24', endDate: '2026-07-22' })],
      today,
    );
    expect(strip.bars[0].startIndex).toBe(2);
    expect(strip.bars[0].span).toBe(1);
  });

  it('always exposes seven day columns', () => {
    const strip = buildWeekStrip([], today);
    expect(strip.days).toHaveLength(7);
    expect(strip.weekStart.getDate()).toBe(20);
    expect(strip.weekEnd.getDate()).toBe(26);
  });
});

describe('weekStripLabel', () => {
  it('drops the repeated month inside one month', () => {
    expect(weekStripLabel(buildWeekStrip([], today))).toBe('20–26 Jul');
  });

  it('keeps both months when the week straddles them', () => {
    // 2026-07-02 is a Thursday: Mon 29 Jun – Sun 5 Jul.
    expect(weekStripLabel(buildWeekStrip([], new Date(2026, 6, 2)))).toBe('29 Jun–5 Jul');
  });
});
