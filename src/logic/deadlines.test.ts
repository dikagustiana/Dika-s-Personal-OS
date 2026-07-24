import { describe, expect, it } from 'vitest';
import { daysLeft, daysLeftLabel, urgencyFor } from './deadlines';

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
