import { describe, expect, it } from 'vitest';
import { formatCount, formatFigure, formatNumber, formatOf, NOT_A_NUMBER } from './format';

describe('formatNumber (ported from the source)', () => {
  it('separates thousands with a point', () => {
    expect(formatNumber(10142)).toBe('10.142');
    expect(formatNumber(1234567)).toBe('1.234.567');
  });

  it('writes decimals with a comma', () => {
    expect(formatNumber(0.83)).toBe('0,83');
    expect(formatNumber(0.45)).toBe('0,45');
    expect(formatNumber(12.5)).toBe('12,5');
  });

  it('leaves small integers and zero alone', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(5)).toBe('5');
    expect(formatNumber(21)).toBe('21');
  });

  it('keeps the sign', () => {
    expect(formatNumber(-209)).toBe('-209');
    expect(formatNumber(-10142.5)).toBe('-10.142,5');
  });
});

describe('formatNumber rounding is explicit and decimal', () => {
  it('rounds binary noise away (the source printed 0,30000000000000004)', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0,3');
  });

  it('rounds half away from zero on the decimal digits, not the binary ones', () => {
    // Number.prototype.toFixed gives "1.00" for 1.005.
    expect(formatNumber(1.005)).toBe('1,01');
    expect(formatNumber(2.5, { decimals: 0 })).toBe('3');
    expect(formatNumber(-2.5, { decimals: 0 })).toBe('-3');
  });

  it('honours the precision asked for', () => {
    expect(formatNumber(1234567.891)).toBe('1.234.567,89');
    expect(formatNumber(1234567.891, { decimals: 1 })).toBe('1.234.567,9');
    expect(formatNumber(0.456, { decimals: 0 })).toBe('0');
  });

  it('pads with zeros only when asked', () => {
    expect(formatNumber(5, { decimals: 2, fixed: true })).toBe('5,00');
    expect(formatNumber(5.1, { decimals: 2 })).toBe('5,1');
  });

  it('never writes a negative zero', () => {
    expect(formatNumber(-0.001)).toBe('0');
    expect(formatNumber(-0)).toBe('0');
  });

  it('says so instead of printing a value it does not have', () => {
    expect(formatNumber(Number.NaN)).toBe(NOT_A_NUMBER);
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe(NOT_A_NUMBER);
  });
});

describe('formatCount, formatOf, formatFigure', () => {
  it('singularises a count of one and formats the count', () => {
    expect(formatCount(1, 'open escalation')).toBe('1 open escalation');
    expect(formatCount(3, 'item')).toBe('3 items');
    expect(formatCount(10142, 'fact')).toBe('10.142 facts');
    expect(formatCount(2, 'escalation', 'escalations')).toBe('2 escalations');
  });

  it('writes a value out of a total', () => {
    expect(formatOf(209, 209)).toBe('209 of 209');
    expect(formatFigure({ value: 1200, of: 3600 })).toBe('1.200 of 3.600');
    expect(formatFigure(10142)).toBe('10.142');
    expect(formatFigure({ value: 7 })).toBe('7');
  });
});
