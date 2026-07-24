import { describe, expect, it } from 'vitest';
import { getCurrentSlot, slotsForDomain } from './timebox';

describe('slotsForDomain', () => {
  it('gives WORK the 08:30–18:30 office grid in 30-minute slots', () => {
    const slots = slotsForDomain('work');
    expect(slots).toHaveLength(20);
    expect(slots[0]).toEqual({ start: '08:30', end: '09:00' });
    expect(slots[slots.length - 1]).toEqual({ start: '18:00', end: '18:30' });
  });

  it('gives GROWTH the 18:30–23:30 evening grid in 30-minute slots', () => {
    const slots = slotsForDomain('growth');
    expect(slots).toHaveLength(10);
    expect(slots[0]).toEqual({ start: '18:30', end: '19:00' });
    expect(slots[slots.length - 1]).toEqual({ start: '23:00', end: '23:30' });
  });

  it('never overlaps the two grids', () => {
    const work = new Set(slotsForDomain('work').map((slot) => slot.start));
    const growthOverlap = slotsForDomain('growth').filter((slot) => work.has(slot.start));
    expect(growthOverlap).toEqual([]);
  });
});

describe('getCurrentSlot', () => {
  const at = (hours: number, minutes: number) => new Date(2026, 6, 24, hours, minutes);

  it('snaps to the containing 30-minute slot inside the domain hours', () => {
    expect(getCurrentSlot(at(9, 40), 'work')).toBe('09:30');
    expect(getCurrentSlot(at(19, 5), 'growth')).toBe('19:00');
  });

  it('returns null outside the domain hours', () => {
    expect(getCurrentSlot(at(7, 0), 'work')).toBeNull();
    expect(getCurrentSlot(at(19, 0), 'work')).toBeNull(); // evening is GROWTH's
    expect(getCurrentSlot(at(9, 40), 'growth')).toBeNull(); // office is WORK's
    expect(getCurrentSlot(at(23, 45), 'growth')).toBeNull();
  });

  it('treats the boundaries as start-inclusive, end-exclusive', () => {
    expect(getCurrentSlot(at(8, 30), 'work')).toBe('08:30');
    expect(getCurrentSlot(at(18, 30), 'work')).toBeNull();
    expect(getCurrentSlot(at(18, 30), 'growth')).toBe('18:30');
    expect(getCurrentSlot(at(23, 30), 'growth')).toBeNull();
  });
});
