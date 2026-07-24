import { describe, expect, it } from 'vitest';
import { formatBand, isValidBand, overallBand } from './ielts';

describe('overallBand', () => {
  it('averages the four skills', () => {
    expect(overallBand({ listening: 7, reading: 7, writing: 7, speaking: 7 })).toBe(7);
  });

  it('rounds x.25 up to x.5 (official IELTS rule)', () => {
    // mean 6.25 -> 6.5
    expect(overallBand({ listening: 6.5, reading: 6.5, writing: 6, speaking: 6 })).toBe(6.5);
  });

  it('rounds x.75 up to the next whole band', () => {
    // mean 6.75 -> 7.0
    expect(overallBand({ listening: 7, reading: 7, writing: 6.5, speaking: 6.5 })).toBe(7);
  });

  it('rounds x.125 down to the nearest half', () => {
    // mean 6.125 -> 6.0
    expect(overallBand({ listening: 6.5, reading: 6, writing: 6, speaking: 6 })).toBe(6);
  });
});

describe('isValidBand', () => {
  it('accepts whole and half bands within range', () => {
    expect(isValidBand(0)).toBe(true);
    expect(isValidBand(6.5)).toBe(true);
    expect(isValidBand(9)).toBe(true);
  });

  it('rejects out-of-range and non-half-step values', () => {
    expect(isValidBand(-0.5)).toBe(false);
    expect(isValidBand(9.5)).toBe(false);
    expect(isValidBand(6.25)).toBe(false);
    expect(isValidBand(Number.NaN)).toBe(false);
  });
});

describe('formatBand', () => {
  it('always shows one decimal', () => {
    expect(formatBand(7)).toBe('7.0');
    expect(formatBand(6.5)).toBe('6.5');
  });
});
