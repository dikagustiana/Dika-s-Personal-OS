import { describe, expect, it } from 'vitest';
import type { Project } from '../data/types';
import { buildGanttChart } from './gantt';

function project(overrides: Partial<Project>): Project {
  return {
    id: 'p',
    domain: 'growth',
    title: 'Initiative',
    type: 'study',
    status: 'active',
    milestones: [],
    order: 1,
    ...overrides,
  };
}

const today = new Date(2026, 6, 24); // 2026-07-24

describe('buildGanttChart', () => {
  it('lays out bars inside the window with the today line between them', () => {
    const chart = buildGanttChart(
      [project({ id: 'a', startDate: '2026-07-01', deadline: '2026-09-01' })],
      today,
    );
    const [row] = chart.rows;
    expect(row.hasDates).toBe(true);
    expect(row.startPct).toBeGreaterThan(0);
    expect(row.startPct + row.widthPct).toBeLessThan(100);
    expect(chart.todayPct).toBeGreaterThan(row.startPct); // today after start
  });

  it('falls back to a short lead-in when startDate is missing', () => {
    const chart = buildGanttChart(
      [project({ id: 'a', deadline: '2026-09-01' })],
      today,
    );
    const [row] = chart.rows;
    expect(row.hasDates).toBe(true);
    expect(row.widthPct).toBeGreaterThan(0);
  });

  it('marks projects without a deadline as dateless placeholder rows', () => {
    const chart = buildGanttChart([project({ id: 'a' })], today);
    expect(chart.rows[0].hasDates).toBe(false);
  });

  it('applies the GROWTH urgency buckets to bars', () => {
    const chart = buildGanttChart(
      [
        project({ id: 'over', deadline: '2026-07-20' }),
        project({ id: 'soon', deadline: '2026-08-01' }),
        project({ id: 'ok', deadline: '2026-10-01' }),
      ],
      today,
    );
    expect(chart.rows.map((row) => row.urgency)).toEqual([
      'overdue',
      'due-soon',
      'on-track',
    ]);
  });

  it('keeps one row per project, in input order', () => {
    const chart = buildGanttChart(
      [
        project({ id: 'a', title: 'IELTS', deadline: '2026-10-16' }),
        project({ id: 'b', title: 'Chevening', deadline: '2026-11-01' }),
      ],
      today,
    );
    expect(chart.rows.map((row) => row.project.title)).toEqual(['IELTS', 'Chevening']);
  });
});
