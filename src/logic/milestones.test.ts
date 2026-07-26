import { describe, expect, it } from 'vitest';
import type { Milestone, Project } from '../data/types';
import {
  collectEscalations,
  milestoneEnd,
  milestoneRange,
  projectAlertState,
  withMilestoneDone,
  withMilestoneStatus,
} from './milestones';

function milestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: 'm1',
    text: 'A milestone',
    done: false,
    status: 'not-started',
    ...overrides,
  };
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    domain: 'work',
    title: 'Project One',
    type: 'other',
    status: 'active',
    milestones: [],
    order: 1,
    ...overrides,
  };
}

describe('withMilestoneStatus', () => {
  it('keeps done in sync when status becomes done', () => {
    const result = withMilestoneStatus(milestone(), 'done');
    expect(result.status).toBe('done');
    expect(result.done).toBe(true);
  });

  it('keeps done in sync when status leaves done', () => {
    const result = withMilestoneStatus(
      milestone({ status: 'done', done: true }),
      'blocked',
    );
    expect(result.status).toBe('blocked');
    expect(result.done).toBe(false);
  });

  it('preserves escalation flag and note across status changes', () => {
    const result = withMilestoneStatus(
      milestone({ escalateTo: 'pak-teddy', note: 'waiting on data' }),
      'in-progress',
    );
    expect(result.escalateTo).toBe('pak-teddy');
    expect(result.note).toBe('waiting on data');
  });
});

describe('withMilestoneDone', () => {
  it('marks status done when done is set', () => {
    const result = withMilestoneDone(milestone({ status: 'in-progress' }), true);
    expect(result.status).toBe('done');
    expect(result.done).toBe(true);
  });

  it('falls back to not-started when un-doing a done milestone', () => {
    const result = withMilestoneDone(milestone({ status: 'done', done: true }), false);
    expect(result.status).toBe('not-started');
    expect(result.done).toBe(false);
  });

  it('keeps a non-done status when done is already false', () => {
    const result = withMilestoneDone(milestone({ status: 'blocked' }), false);
    expect(result.status).toBe('blocked');
  });
});

describe('collectEscalations', () => {
  it('returns an empty list when nothing is escalated', () => {
    const projects = [
      project({
        milestones: [milestone(), milestone({ id: 'm2', escalateTo: 'none' })],
      }),
    ];
    expect(collectEscalations(projects)).toEqual([]);
  });

  it('treats a missing escalateTo as none', () => {
    const projects = [project({ milestones: [milestone({ escalateTo: undefined })] })];
    expect(collectEscalations(projects)).toEqual([]);
  });

  it('groups milestones by target in board-review order, tagged with their project', () => {
    const projects = [
      project({
        id: 'p1',
        title: 'Alpha',
        milestones: [
          milestone({ id: 'a1', escalateTo: 'pak-teddy', status: 'blocked' }),
          milestone({ id: 'a2', escalateTo: 'pak-jo-bu-lenny' }),
        ],
      }),
      project({
        id: 'p2',
        title: 'Beta',
        milestones: [milestone({ id: 'b1', escalateTo: 'pak-teddy' })],
      }),
    ];

    const groups = collectEscalations(projects);
    expect(groups.map((group) => group.target)).toEqual(['pak-jo-bu-lenny', 'pak-teddy']);
    expect(groups[0].label).toBe('Pak Jo & Bu Lenny');

    const pakTeddy = groups[1];
    expect(pakTeddy.items).toHaveLength(2);
    expect(pakTeddy.items.map((item) => item.milestone.id)).toEqual(['a1', 'b1']);
    expect(pakTeddy.items[0].projectTitle).toBe('Alpha');
    expect(pakTeddy.items[1].projectTitle).toBe('Beta');
  });

  it('omits empty groups entirely', () => {
    const projects = [
      project({ milestones: [milestone({ escalateTo: 'mbak-muti' })] }),
    ];
    const groups = collectEscalations(projects);
    expect(groups).toHaveLength(1);
    expect(groups[0].target).toBe('mbak-muti');
  });
});

describe('milestoneEnd', () => {
  it('reads endDate when it is set', () => {
    expect(milestoneEnd(milestone({ endDate: '2026-08-01' }))).toBe('2026-08-01');
  });

  it('falls back to the legacy dueDate so old milestones keep counting down', () => {
    expect(milestoneEnd(milestone({ dueDate: '2026-08-01' }))).toBe('2026-08-01');
  });

  it('prefers endDate over a dueDate left behind on the same milestone', () => {
    expect(
      milestoneEnd(milestone({ dueDate: '2026-08-01', endDate: '2026-08-09' })),
    ).toBe('2026-08-09');
  });

  it('is undefined when the milestone has no date at all', () => {
    expect(milestoneEnd(milestone())).toBeUndefined();
  });
});

describe('milestoneRange', () => {
  it('is null without an end date, whatever the start says', () => {
    expect(milestoneRange(milestone())).toBeNull();
    expect(milestoneRange(milestone({ startDate: '2026-08-01' }))).toBeNull();
  });

  it('treats an end date alone as a single day', () => {
    expect(milestoneRange(milestone({ endDate: '2026-08-01' }))).toEqual({
      start: '2026-08-01',
      end: '2026-08-01',
    });
  });

  it('keeps a real span', () => {
    expect(
      milestoneRange(milestone({ startDate: '2026-07-28', endDate: '2026-08-01' })),
    ).toEqual({ start: '2026-07-28', end: '2026-08-01' });
  });

  it('collapses a start later than the end rather than inverting the bar', () => {
    expect(
      milestoneRange(milestone({ startDate: '2026-08-09', endDate: '2026-08-01' })),
    ).toEqual({ start: '2026-08-01', end: '2026-08-01' });
  });
});

describe('projectAlertState', () => {
  const today = new Date(2026, 6, 26); // 2026-07-26

  it('is null when nothing is late or stuck', () => {
    expect(projectAlertState(project(), today)).toBeNull();
    expect(
      projectAlertState(
        project({ milestones: [milestone({ endDate: '2026-08-01' })] }),
        today,
      ),
    ).toBeNull();
  });

  it('reports overdue for a past end date, and prefers it over blocked', () => {
    expect(
      projectAlertState(
        project({ milestones: [milestone({ endDate: '2026-07-25' })] }),
        today,
      ),
    ).toBe('overdue');
    // Same precedence the needs-action list uses: the collapsed row must not
    // say "blocked" when something is already late.
    expect(
      projectAlertState(
        project({
          milestones: [
            milestone({ id: 'm1', status: 'blocked' }),
            milestone({ id: 'm2', endDate: '2026-07-01' }),
          ],
        }),
        today,
      ),
    ).toBe('overdue');
  });

  it('reads a legacy dueDate as the tracked date', () => {
    expect(
      projectAlertState(
        project({ milestones: [milestone({ dueDate: '2026-07-01' })] }),
        today,
      ),
    ).toBe('overdue');
  });

  it('ignores completed milestones and completed projects', () => {
    expect(
      projectAlertState(
        project({
          milestones: [milestone({ done: true, status: 'done', endDate: '2026-01-01' })],
        }),
        today,
      ),
    ).toBeNull();
    expect(
      projectAlertState(
        project({
          status: 'done',
          milestones: [milestone({ endDate: '2026-01-01' })],
        }),
        today,
      ),
    ).toBeNull();
  });

  it('reports blocked when nothing is late', () => {
    expect(
      projectAlertState(
        project({ milestones: [milestone({ status: 'blocked' })] }),
        today,
      ),
    ).toBe('blocked');
  });

  it('does not treat today as overdue', () => {
    expect(
      projectAlertState(
        project({ milestones: [milestone({ endDate: '2026-07-26' })] }),
        today,
      ),
    ).toBeNull();
  });
});
