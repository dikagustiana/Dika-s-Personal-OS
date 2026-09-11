import { describe, expect, it } from 'vitest';
import { KEYFRAMES, PRESETS, lightingAtHour, segmentAt, wrapHour } from './presets';

describe('lighting presets and clock blend', () => {
  it('keyframes are sorted within the day and cover all four presets', () => {
    for (let i = 1; i < KEYFRAMES.length; i++) expect(KEYFRAMES[i][0]).toBeGreaterThan(KEYFRAMES[i - 1][0]);
    expect(new Set(KEYFRAMES.map((k) => k[1]))).toEqual(new Set(['MORNING', 'MIDDAY', 'DUSK', 'NIGHT']));
  });

  it('wraps hours into [0, 24)', () => {
    expect(wrapHour(25)).toBe(1);
    expect(wrapHour(-1)).toBe(23);
    expect(wrapHour(24)).toBe(0);
  });

  it('returns a pure preset exactly on a keyframe', () => {
    const s = lightingAtHour(12);
    expect(s.dominant).toBe('MIDDAY');
    expect(s.sunIntensity).toBeCloseTo(PRESETS.MIDDAY.sunIntensity, 9);
    expect(s.interiorEmissiveIntensity).toBeCloseTo(0, 9);
  });

  it('holds NIGHT across midnight (the segment from the last keyframe wraps)', () => {
    for (const h of [21, 23.5, 0, 2, 4, 5.4]) {
      const seg = segmentAt(h);
      expect(seg.from).toBe('NIGHT');
      expect(seg.to).toBe('NIGHT');
      expect(lightingAtHour(h).interiorEmissiveIntensity).toBeCloseTo(1, 9);
      expect(lightingAtHour(h).sunIntensity).toBeCloseTo(PRESETS.NIGHT.sunIntensity, 9);
    }
  });

  it('interior emissive rises monotonically from late afternoon into night while the sun falls', () => {
    let lastEm = -1;
    let lastSun = Number.POSITIVE_INFINITY;
    for (let h = 16.5; h <= 20; h += 0.25) {
      const s = lightingAtHour(h);
      expect(s.interiorEmissiveIntensity).toBeGreaterThanOrEqual(lastEm - 1e-9);
      expect(s.sunIntensity).toBeLessThanOrEqual(lastSun + 1e-9);
      lastEm = s.interiorEmissiveIntensity;
      lastSun = s.sunIntensity;
    }
    expect(lightingAtHour(16.5).interiorEmissiveIntensity).toBeCloseTo(0, 9);
    expect(lightingAtHour(20).interiorEmissiveIntensity).toBeCloseTo(1, 9);
  });

  it('at 18:00 the office is at dusk with interior lights coming on (Part E)', () => {
    const s = lightingAtHour(18);
    expect(s.to).toBe('DUSK');
    expect(s.interiorEmissiveIntensity).toBeGreaterThan(0.3);
    expect(s.interiorEmissiveIntensity).toBeLessThan(0.5);
    expect(s.sunIntensity).toBeLessThan(PRESETS.MIDDAY.sunIntensity);
  });

  it('blends are continuous across keyframes (no pop)', () => {
    for (const [h] of KEYFRAMES) {
      const before = lightingAtHour(h - 1e-4);
      const after = lightingAtHour(h + 1e-4);
      expect(Math.abs(before.sunIntensity - after.sunIntensity)).toBeLessThan(1e-2);
      expect(Math.abs(before.interiorEmissiveIntensity - after.interiorEmissiveIntensity)).toBeLessThan(1e-2);
      for (let i = 0; i < 3; i++) expect(Math.abs(before.skyZenith[i] - after.skyZenith[i])).toBeLessThan(1e-2);
    }
  });

  it('sun direction stays normalised and above the horizon-ish through the day', () => {
    for (let h = 0; h < 24; h += 0.5) {
      const d = lightingAtHour(h).sunDirection;
      expect(Math.hypot(d[0], d[1], d[2])).toBeCloseTo(1, 6);
      expect(d[1]).toBeGreaterThan(0.05);
    }
  });
});
