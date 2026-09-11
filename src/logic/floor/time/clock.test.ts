import { describe, expect, it } from 'vitest';
import { formatHour, hourFloatInZone, isValidTimeZone } from './clock';

describe('clock', () => {
  it('converts a UTC instant to the local hour of a zone', () => {
    const d = new Date('2026-09-10T21:45:30.000Z');
    expect(hourFloatInZone(d, 'UTC')).toBeCloseTo(21.758333, 5);
    expect(hourFloatInZone(d, 'Asia/Jakarta')).toBeCloseTo(4.758333, 5); // UTC+7, next day
    expect(hourFloatInZone(d, 'Asia/Dubai')).toBeCloseTo(1.758333, 5); // UTC+4
    expect(hourFloatInZone(d, 'America/New_York')).toBeCloseTo(17.758333, 5); // EDT, UTC-4
  });

  it('never returns 24 at midnight', () => {
    const d = new Date('2026-01-01T00:00:00.000Z');
    expect(hourFloatInZone(d, 'UTC')).toBeCloseTo(0, 9);
  });

  it('falls back to UTC for an unknown zone instead of throwing', () => {
    const d = new Date('2026-09-10T06:30:00.000Z');
    expect(hourFloatInZone(d, 'Mars/Olympus')).toBeCloseTo(6.5, 6);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('Europe/London')).toBe(true);
  });

  it('formats hours as HH:MM', () => {
    expect(formatHour(18.5)).toBe('18:30');
    expect(formatHour(0.0166)).toBe('00:00');
    expect(formatHour(24.25)).toBe('00:15');
  });
});
