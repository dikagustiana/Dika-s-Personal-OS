import { describe, expect, it } from 'vitest';
import type { Milestone, Project, TaskEntry, WeeklyGoal } from '../data/types';
import { workingDay } from './monthlyClose';
import {
  closeEntityCount,
  collectNeedsAction,
  goalProgress,
  isPinnable,
  needsActionBreakdown,
  picInitials,
  sortNeedsAction,
  summarizeCloseCycle,
  type NeedsActionRow,
  type NeedsActionState,
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

function row(id: string, state: NeedsActionState, daysOverdue = 0): NeedsActionRow {
  return {
    milestone: milestone({ id }),
    project: project({ id: `project-${id}` }),
    state,
    daysOverdue,
    alsoBlocked: false,
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

describe('sortNeedsAction', () => {
  // The production shape: every blocked milestone is undated, so blocked rows
  // outnumber everything else and would take all five visible slots.
  const shuffled = () => [
    row('blocked-1', 'blocked'),
    row('blocked-2', 'blocked'),
    row('late-2d', 'overdue', 2),
    row('blocked-3', 'blocked'),
    row('due-today', 'today'),
    row('blocked-4', 'blocked'),
    row('late-11d', 'overdue', 11),
    row('blocked-5', 'blocked'),
  ];

  it('puts an overdue row above every blocked row, not just the first', () => {
    const sorted = sortNeedsAction(shuffled());
    const states = sorted.map((item) => item.state);
    expect(states.lastIndexOf('overdue')).toBeLessThan(states.indexOf('blocked'));
    expect(sorted.map((item) => item.milestone.id).slice(0, 2)).toEqual(['late-11d', 'late-2d']);
  });

  it('orders two overdue rows most-overdue-first', () => {
    const sorted = sortNeedsAction([row('late-2d', 'overdue', 2), row('late-11d', 'overdue', 11)]);
    expect(sorted.map((item) => item.daysOverdue)).toEqual([11, 2]);
  });

  it('sits due-today between overdue and blocked', () => {
    const sorted = sortNeedsAction(shuffled());
    const states = sorted.map((item) => item.state);
    expect(states.indexOf('today')).toBeGreaterThan(states.lastIndexOf('overdue'));
    expect(states.indexOf('today')).toBeLessThan(states.indexOf('blocked'));
  });

  it('leaves the caller its own array', () => {
    const rows = shuffled();
    sortNeedsAction(rows);
    expect(rows[0].milestone.id).toBe('blocked-1');
  });

  it('sorts inside collectNeedsAction, so a consumer cannot render it unsorted', () => {
    const rows = collectNeedsAction(
      [
        project({
          id: 'p',
          milestones: [
            milestone({ id: 'blocked-1', status: 'blocked' }),
            milestone({ id: 'blocked-2', status: 'blocked' }),
            milestone({ id: 'blocked-3', status: 'blocked' }),
            milestone({ id: 'blocked-4', status: 'blocked' }),
            milestone({ id: 'blocked-5', status: 'blocked' }),
            milestone({ id: 'late', endDate: '2026-07-14' }),
          ],
        }),
      ],
      today,
    );
    expect(rows[0].milestone.id).toBe('late');
  });
});

describe('needsActionBreakdown', () => {
  it('counts each state', () => {
    expect(
      needsActionBreakdown([
        row('a', 'overdue', 3),
        row('b', 'overdue', 1),
        row('c', 'today'),
        row('d', 'blocked'),
        row('e', 'blocked'),
        row('f', 'blocked'),
      ]),
    ).toEqual({ overdue: 2, today: 1, blocked: 3 });
  });

  it('is all zeroes for an empty list', () => {
    expect(needsActionBreakdown([])).toEqual({ overdue: 0, today: 0, blocked: 0 });
  });

  it('counts an also-blocked row once, under the badge it leads with', () => {
    const rows = collectNeedsAction(
      [
        project({
          id: 'p',
          milestones: [milestone({ id: 'both', endDate: '2026-07-20', status: 'blocked' })],
        }),
      ],
      today,
    );
    expect(needsActionBreakdown(rows)).toEqual({ overdue: 1, today: 0, blocked: 0 });
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
        // Derived, not literal: the generator's deadline is the 8th WORKING
        // day, so a hardcoded date is wrong for one of the two periods here.
        deadline: workingDay(period, 8),
        milestones: [
          milestone({ id: `${series}-1`, done: doneAll, status: doneAll ? 'done' : 'not-started' }),
          milestone({ id: `${series}-2`, done: doneAll, status: doneAll ? 'done' : 'not-started' }),
        ],
      }),
    );

  it('still shows a fully-ticked cycle — the checklist is not what ends a period', () => {
    // Hiding it here would hide the card's own "sudah selesai?" question, and
    // the question is the only thing that marks the six projects done.
    const projects = [...cycle('2026-07', true), ...cycle('2026-06', true)];
    const summary = summarizeCloseCycle(projects, today);
    expect(summary?.period).toBe('2026-07');
    expect(summary?.done).toBe(summary?.total);
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

  it('describes the same period the entity tile does, never the month before', () => {
    // A fully-ticked July used to send the card back to June while the tile
    // still counted July, so "Sudah" wrote June's rows and the July tile could
    // never leave 0 of 6.
    const projects = [...cycle('2026-07', true), ...cycle('2026-06')];
    const summary = summarizeCloseCycle(projects, today);
    expect(summary?.period).toBe('2026-07');
    expect(summary?.label).toBe(closeEntityCount(projects, today).label);
  });

  it('keeps selecting a period whose deadline has already passed', () => {
    // Thu 13 Aug 2026 is one day past WD8 of the July close — the overrun is
    // exactly when the card has to be there to ask.
    const late = summarizeCloseCycle(cycle('2026-07', true), new Date(2026, 7, 13));
    expect(late?.period).toBe('2026-07');
  });

  it('follows the pending period mid-month — on the 5th that is still last month', () => {
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
  const closeProject = (id: string, overrides: Partial<Project> = {}) =>
    project({
      id,
      title: `Closing Juli — ${id}`,
      recurring: 'monthly',
      period: '2026-07',
      ...overrides,
    });

  it('counts a project whose status is done, ticked checklist or not', () => {
    const projects = [
      closeProject('a', { status: 'done', milestones: [milestone({ id: 'm' })] }),
      closeProject('b', { milestones: [milestone({ id: 'm2' })] }),
    ];
    expect(closeEntityCount(projects, today)).toMatchObject({ done: 1, total: 2 });
  });

  it('ignores the milestone checklist — a fully-ticked but active project is not done', () => {
    const projects = [
      closeProject('a', { milestones: [milestone({ id: 'm', done: true, status: 'done' })] }),
    ];
    expect(closeEntityCount(projects, today)).toMatchObject({ done: 0, total: 1 });
  });

  it('reaches 6 of 6 when the period is closed out with milestones left unticked', () => {
    const projects = ['BMG', 'OKI', 'KGR', 'NMG', 'KBF', 'Consolidation'].map((series) =>
      closeProject(series, {
        status: 'done',
        milestones: [milestone({ id: `${series}-1` }), milestone({ id: `${series}-2` })],
      }),
    );
    expect(closeEntityCount(projects, today)).toMatchObject({ done: 6, total: 6 });
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

describe('isPinnable', () => {
  it('never treats a close-cycle project as pinnable', () => {
    expect(isPinnable(project({ id: 'p', recurring: 'monthly' }))).toBe(false);
    expect(isPinnable(project({ id: 'q' }))).toBe(true);
  });
});
