import { describe, expect, it } from 'vitest';
import {
  daysLeft,
  daysLeftLabel,
  daysLeftLabelFor,
  formatDateFor,
  resolveConfidence,
  urgencyFor,
  urgencyForConfident,
} from './deadlines';

const today = new Date(2026, 6, 24); // 2026-07-24

describe('daysLeft', () => {
  it('counts calendar days forward and backward', () => {
    expect(daysLeft('2026-07-24', today)).toBe(0);
    expect(daysLeft('2026-07-31', today)).toBe(7);
    expect(daysLeft('2026-07-20', today)).toBe(-4);
  });
});

describe('urgencyFor', () => {
  it('flags overdue deadlines', () => {
    expect(urgencyFor('2026-07-23', today, 7)).toBe('overdue');
  });

  it('uses the WORK 7-day amber window', () => {
    expect(urgencyFor('2026-07-31', today, 7)).toBe('due-soon');
    expect(urgencyFor('2026-08-01', today, 7)).toBe('on-track');
  });

  it('uses the GROWTH 14-day amber window', () => {
    expect(urgencyFor('2026-08-07', today, 14)).toBe('due-soon');
    expect(urgencyFor('2026-08-08', today, 14)).toBe('on-track');
  });

  it('treats due-today as due-soon, not overdue', () => {
    expect(urgencyFor('2026-07-24', today, 7)).toBe('due-soon');
  });
});

describe('daysLeftLabel', () => {
  it('formats the three states', () => {
    expect(daysLeftLabel(-3)).toBe('3d overdue');
    expect(daysLeftLabel(0)).toBe('Due today');
    expect(daysLeftLabel(12)).toBe('12d left');
  });
});

describe('date confidence', () => {
  const today = new Date('2026-07-24T09:00:00Z');

  it('treats an absent confidence as confirmed, so WORK deadlines are unchanged', () => {
    expect(resolveConfidence(undefined)).toBe('confirmed');
    expect(urgencyForConfident('2026-07-20', today, 7, undefined)).toBe('overdue');
    expect(daysLeftLabelFor(-4, undefined)).toBe('4d overdue');
  });

  it('never lets a placeholder date read as overdue or due-soon', () => {
    expect(urgencyForConfident('2026-07-20', today, 7, 'estimated')).toBe('on-track');
    expect(urgencyForConfident('2026-07-26', today, 7, 'estimated')).toBe('on-track');
    expect(urgencyForConfident('2026-07-20', today, 7, 'unknown')).toBe('on-track');
  });

  it('marks estimated countdowns with ~ and unknown ones as TBC', () => {
    expect(daysLeftLabelFor(12, 'estimated')).toBe('~12d left');
    expect(daysLeftLabelFor(-4, 'estimated')).toBe('~4d overdue');
    expect(daysLeftLabelFor(12, 'unknown')).toBe('TBC');
  });

  it('marks calendar dates the same way', () => {
    expect(formatDateFor('2026-10-06', 'confirmed')).toBe('Oct 6, 2026');
    expect(formatDateFor('2026-10-06', 'estimated')).toBe('~Oct 6, 2026');
    expect(formatDateFor('2026-10-06', 'unknown')).toBe('TBC');
  });
});
