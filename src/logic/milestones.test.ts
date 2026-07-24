import { describe, expect, it } from 'vitest';
import type { Milestone, Project } from '../data/types';
import {
  collectEscalations,
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
