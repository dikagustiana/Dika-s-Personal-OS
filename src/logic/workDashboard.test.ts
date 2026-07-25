import { describe, expect, it } from 'vitest';
import type { Milestone, Project, TaskEntry, WeeklyGoal } from '../data/types';
import {
  closeEntityCount,
  collectNeedsAction,
  goalProgress,
  isPinnable,
  picInitials,
  pinnedProjectRows,
  summarizeCloseCycle,
} from './workDashboard';

const today = new Date(2026, 6, 25); // Sat 2026-07-25

function milestone(overrides: Partial<Milestone> & { id: string }): Milestone {
  return { text: overrides.id, done: false, status: 'not-started', ...overrides };
}

function project(overrides: Partial<Project> & { id: string }): Project {
  return {
    domain: 'work',
    title: overrides.id,
    type: 'other',
    status: 'active',
    milestones: [],
    order: 1,
    ...overrides,
  };
}

function task(overrides: Partial<TaskEntry> & { id: string }): TaskEntry {
  return {
    type: 'task',
    domain: 'work',
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    tags: [],
    title: overrides.id,
    priority: 'normal',
    done: false,
    ...overrides,
  };
}

describe('collectNeedsAction', () => {
  it('admits exactly overdue, due-today and blocked — nothing else', () => {
    const rows = collectNeedsAction(
      [
        project({
          id: 'p',
          milestones: [
            milestone({ id: 'overdue', endDate: '2026-07-20' }),
            milestone({ id: 'today', endDate: '2026-07-25' }),
            milestone({ id: 'blocked', status: 'blocked' }),
            milestone({ id: 'in-three-days', endDate: '2026-07-28' }),
            milestone({ id: 'far-off', endDate: '2026-12-01' }),
            milestone({ id: 'undated' }),
          ],
        }),
      ],
      today,
    );
    expect(rows.map((row) => row.milestone.id)).toEqual(['overdue', 'today', 'blocked']);
  });

  it('does not surface a milestone due in three days', () => {
    const rows = collectNeedsAction(
      [project({ id: 'p', milestones: [milestone({ id: 'soon', endDate: '2026-07-28' })] })],
      today,
    );
    expect(rows).toHaveLength(0);
  });

  it('sorts overdue first (most overdue at top), then today, then blocked', () => {
    const rows = collectNeedsAction(
      [
        project({
          id: 'p',
          milestones: [
            milestone({ id: 'blocked', status: 'blocked' }),
            milestone({ id: 'today', endDate: '2026-07-25' }),
            milestone({ id: 'late-2d', endDate: '2026-07-23' }),
            milestone({ id: 'late-9d', endDate: '2026-07-16' }),
          ],
        }),
      ],
      today,
    );
    expect(rows.map((row) => row.milestone.id)).toEqual([
      'late-9d',
      'late-2d',
      'today',
      'blocked',
    ]);
    expect(rows[0].daysOverdue).toBe(9);
    expect(rows[2].daysOverdue).toBe(0);
  });

  it('reads the legacy dueDate through milestoneEnd', () => {
    const rows = collectNeedsAction(
      [project({ id: 'p', milestones: [milestone({ id: 'legacy', dueDate: '2026-07-20' })] })],
      today,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe('overdue');
  });

  it('keeps the blocked fact on a row that leads with overdue', () => {
    const rows = collectNeedsAction(
      [
        project({
          id: 'p',
          milestones: [milestone({ id: 'both', endDate: '2026-07-20', status: 'blocked' })],
        }),
      ],
      today,
    );
    expect(rows[0].state).toBe('overdue');
    expect(rows[0].alsoBlocked).toBe(true);
  });

  it('skips done milestones and projects that are finished', () => {
    const rows = collectNeedsAction(
      [
        project({
          id: 'p',
          milestones: [milestone({ id: 'a', endDate: '2026-07-01', done: true, status: 'done' })],
        }),
        project({
          id: 'q',
          status: 'done',
          milestones: [milestone({ id: 'b', endDate: '2026-07-01' })],
        }),
      ],
      today,
    );
    expect(rows).toHaveLength(0);
  });

  it('includes close-cycle milestones — an overdue close is exactly a today problem', () => {
    const rows = collectNeedsAction(
      [
        project({
          id: 'Closing Juli — BMG',
          recurring: 'monthly',
          period: '2026-07',
          milestones: [milestone({ id: 'close', endDate: '2026-07-20' })],
        }),
      ],
      today,
    );
    expect(rows).toHaveLength(1);
  });
});

describe('picInitials', () => {
  it('takes one letter from each of the first two words', () => {
    expect(picInitials('Alex Kim')).toBe('AK');
  });

  it('takes the first two letters of a single word', () => {
    expect(picInitials('Morgan')).toBe('MO');
  });

  it('is null when there is no PIC', () => {
    expect(picInitials(undefined)).toBeNull();
    expect(picInitials('   ')).toBeNull();
  });
});

describe('summarizeCloseCycle', () => {
  const cycle = (period: string, doneAll = false) =>
    ['BMG', 'OKI', 'KGR', 'NMG', 'KBF', 'Consolidation'].map((series, index) =>
      project({
        id: `${period}-${series}`,
        title: `Closing X — ${series}`,
        recurring: 'monthly',
        period,
        order: 100 + index,
        deadline: '2026-08-08',
        milestones: [
          milestone({ id: `${series}-1`, done: doneAll, status: doneAll ? 'done' : 'not-started' }),
          milestone({ id: `${series}-2`, done: doneAll, status: doneAll ? 'done' : 'not-started' }),
        ],
      }),
    );

  it('is null when the current and previous cycles are both fully closed', () => {
    const projects = [...cycle('2026-07', true), ...cycle('2026-06', true)];
    expect(summarizeCloseCycle(projects, today)).toBeNull();
  });

  it('is null when there is no close cycle at all', () => {
    expect(summarizeCloseCycle([project({ id: 'p' })], today)).toBeNull();
  });

  it('shows the current period while it has unfinished work', () => {
    const summary = summarizeCloseCycle(cycle('2026-07'), today);
    expect(summary?.period).toBe('2026-07');
    expect(summary?.total).toBe(12);
    expect(summary?.done).toBe(0);
    expect(summary?.series.map((s) => s.series)).toEqual([
      'BMG',
      'OKI',
      'KGR',
      'NMG',
      'KBF',
      'Consolidation',
    ]);
  });

  it('falls back to the previous period rather than showing an all-done cycle', () => {
    const projects = [...cycle('2026-07', true), ...cycle('2026-06')];
    expect(summarizeCloseCycle(projects, today)?.period).toBe('2026-06');
  });

  it('is not gated on a date — mid-month with work outstanding still shows', () => {
    // The 5th: an old date-window condition would have been in-cycle anyway,
    // which is the point — a date gate is barely a gate.
    const early = summarizeCloseCycle(cycle('2026-06'), new Date(2026, 6, 5));
    expect(early?.period).toBe('2026-06');
  });

  it('reports series with no project as 0/0 rather than dropping them', () => {
    const partial = cycle('2026-07').slice(0, 2);
    const summary = summarizeCloseCycle(partial, today);
    expect(summary?.series).toHaveLength(6);
    expect(summary?.series.filter((s) => s.total === 0)).toHaveLength(4);
  });

  it('counts entities separately from milestones — the two denominators differ', () => {
    const projects = cycle('2026-07');
    projects[0].milestones = projects[0].milestones.map((m) => ({
      ...m,
      done: true,
      status: 'done' as const,
    }));
    const summary = summarizeCloseCycle(projects, today);
    expect(summary?.entitiesDone).toBe(1);
    expect(summary?.entitiesTotal).toBe(6);
    expect(summary?.done).toBe(2);
    expect(summary?.total).toBe(12);
  });
});

describe('closeEntityCount', () => {
  it('counts entities fully closed in the current period', () => {
    const projects = [
      project({
        id: 'a',
        title: 'Closing Juli — BMG',
        recurring: 'monthly',
        period: '2026-07',
        milestones: [milestone({ id: 'm', done: true, status: 'done' })],
      }),
      project({
        id: 'b',
        title: 'Closing Juli — OKI',
        recurring: 'monthly',
        period: '2026-07',
        milestones: [milestone({ id: 'm2' })],
      }),
    ];
    expect(closeEntityCount(projects, today)).toMatchObject({ done: 1, total: 2 });
  });
});

describe('goalProgress', () => {
  const goal: WeeklyGoal = { id: 'g1', text: 'Ship it', done: false };

  it('is binary 0% when nothing is linked and the goal is open', () => {
    expect(goalProgress(goal, [])).toMatchObject({ percent: 0, binary: true, total: 0 });
  });

  it('is binary 100% when nothing is linked and the goal is done', () => {
    expect(goalProgress({ ...goal, done: true }, [])).toMatchObject({
      percent: 100,
      binary: true,
    });
  });

  it('derives progress from linked tasks when there are any', () => {
    const tasks = [
      task({ id: 't1', weeklyGoalId: 'g1', done: true }),
      task({ id: 't2', weeklyGoalId: 'g1' }),
      task({ id: 't3', weeklyGoalId: 'g1' }),
      task({ id: 't4', weeklyGoalId: 'other', done: true }),
    ];
    expect(goalProgress(goal, tasks)).toMatchObject({
      done: 1,
      total: 3,
      percent: 33,
      binary: false,
    });
  });
});

describe('pinnedProjectRows / isPinnable', () => {
  it('never treats a close-cycle project as pinnable', () => {
    expect(isPinnable(project({ id: 'p', recurring: 'monthly' }))).toBe(false);
    expect(isPinnable(project({ id: 'q' }))).toBe(true);
  });

  it('excludes close-cycle projects even if the flag somehow got set', () => {
    const rows = pinnedProjectRows(
      [
        project({ id: 'close', recurring: 'monthly', period: '2026-07', dashboardPinned: true }),
        project({ id: 'normal', dashboardPinned: true }),
      ],
      today,
    );
    expect(rows.map((row) => row.project.id)).toEqual(['normal']);
  });

  it('returns nothing when nothing is pinned', () => {
    expect(pinnedProjectRows([project({ id: 'a' }), project({ id: 'b' })], today)).toEqual([]);
  });

  it('reports rollup counts including children, matching the project card', () => {
    const rows = pinnedProjectRows(
      [
        project({
          id: 'parent',
          dashboardPinned: true,
          milestones: [milestone({ id: 'a', done: true, status: 'done' })],
        }),
        project({
          id: 'child',
          parentId: 'parent',
          milestones: [milestone({ id: 'b' }), milestone({ id: 'c' })],
        }),
      ],
      today,
    );
    expect(rows[0]).toMatchObject({ done: 1, total: 3 });
  });

  it('takes the earliest open milestone date and flags overdue and blocked', () => {
    const rows = pinnedProjectRows(
      [
        project({
          id: 'p',
          dashboardPinned: true,
          milestones: [
            milestone({ id: 'late', endDate: '2026-07-18', status: 'blocked' }),
            milestone({ id: 'later', endDate: '2026-09-01' }),
            milestone({ id: 'closed', endDate: '2026-01-01', done: true, status: 'done' }),
          ],
        }),
      ],
      today,
    );
    expect(rows[0].nextDate).toBe('2026-07-18');
    expect(rows[0].overdue).toBe(true);
    expect(rows[0].blocked).toBe(true);
  });
});
