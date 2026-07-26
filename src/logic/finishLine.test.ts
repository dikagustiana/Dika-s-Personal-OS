import { describe, expect, it } from 'vitest';
import { MockRepository } from '../data/mockRepository';
import type { FinishLineItem, Milestone, Project } from '../data/types';
import {
  buildFinishLine,
  buildGapRow,
  compareGapRows,
  silentBlockers,
  summarize,
} from './finishLine';

// Placeholder fixtures only. The real gap items name entities, internal
// drivers and open methodology decisions, and this repo is public — nothing
// resembling one appears here, deliberately.

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

function gap(overrides: Partial<FinishLineItem> & { id: string }): FinishLineItem {
  return {
    area: 'Area one',
    item: overrides.id,
    targetState: 'target',
    status: 'blocked',
    order: 0,
    projectIds: [],
    ...overrides,
  };
}

describe('silentBlockers', () => {
  it('counts blocked milestones with no escalation target', () => {
    const p = project({
      id: 'p1',
      milestones: [
        milestone({ id: 'm1', status: 'blocked' }),
        milestone({ id: 'm2', status: 'blocked', escalateTo: 'none' }),
      ],
    });
    expect(silentBlockers(p).map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('does not fire once the milestone has an escalation target', () => {
    const p = project({
      id: 'p1',
      milestones: [milestone({ id: 'm1', status: 'blocked', escalateTo: 'pak-teddy' })],
    });
    expect(silentBlockers(p)).toHaveLength(0);
  });

  it('ignores blockers that were overcome — history, not a live silence', () => {
    const p = project({
      id: 'p1',
      milestones: [milestone({ id: 'm1', status: 'blocked', done: true })],
    });
    expect(silentBlockers(p)).toHaveLength(0);
  });
});

describe('buildGapRow', () => {
  const twoProjects = [
    project({
      id: 'p1',
      milestones: [milestone({ id: 'm1', done: true, status: 'done' }), milestone({ id: 'm2' })],
    }),
    project({
      id: 'p2',
      milestones: [milestone({ id: 'm3', status: 'blocked' })],
    }),
  ];

  it('resolves every linked project, so both render with their own progress', () => {
    const row = buildGapRow(gap({ id: 'g1', projectIds: ['p1', 'p2'] }), twoProjects);
    expect(row.projects.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(row.done).toBe(1);
    expect(row.total).toBe(3);
    expect(row.unowned).toBe(false);
  });

  it('marks an item with no linked project as unowned', () => {
    expect(buildGapRow(gap({ id: 'g1' }), twoProjects).unowned).toBe(true);
  });

  it('drops ids that no longer resolve rather than rendering a ghost project', () => {
    const row = buildGapRow(gap({ id: 'g1', projectIds: ['p1', 'gone'] }), twoProjects);
    expect(row.projects.map((p) => p.id)).toEqual(['p1']);
    expect(row.unowned).toBe(false);
  });

  it('is provisional exactly when a proxy is standing in', () => {
    expect(buildGapRow(gap({ id: 'g1' }), twoProjects).provisional).toBe(false);
    expect(
      buildGapRow(gap({ id: 'g2', interim: 'a stand-in' }), twoProjects).provisional,
    ).toBe(true);
  });

  it('flags the gap when a linked project is stuck and nobody was told', () => {
    const stuck = project({
      id: 'p3',
      milestones: [milestone({ id: 'm4', status: 'blocked' })],
    });
    const told = project({
      id: 'p4',
      milestones: [milestone({ id: 'm5', status: 'blocked', escalateTo: 'mbak-muti' })],
    });
    expect(buildGapRow(gap({ id: 'g1', projectIds: ['p3'] }), [stuck, told]).silentBlockers).toBe(1);
    expect(buildGapRow(gap({ id: 'g2', projectIds: ['p4'] }), [stuck, told]).silentBlockers).toBe(0);
    // Blocked either way — the silence is the separate finding.
    expect(
      buildGapRow(gap({ id: 'g2', projectIds: ['p4'] }), [stuck, told]).blockedMilestones,
    ).toBe(1);
  });
});

describe('compareGapRows', () => {
  const projects = ['p1', 'p2', 'p3'].map((id) => project({ id }));
  const row = (item: FinishLineItem) => buildGapRow(item, projects);

  it('ranks by blast radius: unowned blocker, then most projects, then status', () => {
    const rows = [
      row(gap({ id: 'trusted', status: 'trusted', projectIds: ['p1'] })),
      row(gap({ id: 'progress', status: 'in-progress', projectIds: ['p1'] })),
      row(gap({ id: 'one', projectIds: ['p1'] })),
      row(gap({ id: 'three', projectIds: ['p1', 'p2', 'p3'] })),
      row(gap({ id: 'unowned' })),
    ];
    expect([...rows].sort(compareGapRows).map((r) => r.item.item)).toEqual([
      'unowned',
      'three',
      'one',
      'progress',
      'trusted',
    ]);
  });

  it('breaks a tie on whether the downstream consequence is named', () => {
    const rows = [
      row(gap({ id: 'silent-radius', projectIds: ['p1'] })),
      row(gap({ id: 'named-radius', projectIds: ['p1'], blocks: 'a downstream figure' })),
    ];
    expect([...rows].sort(compareGapRows).map((r) => r.item.item)).toEqual([
      'named-radius',
      'silent-radius',
    ]);
  });

  it('is stable for otherwise identical rows', () => {
    const rows = [
      row(gap({ id: 'b', order: 2, projectIds: ['p1'] })),
      row(gap({ id: 'a', order: 1, projectIds: ['p1'] })),
    ];
    expect([...rows].sort(compareGapRows).map((r) => r.item.item)).toEqual(['a', 'b']);
  });
});

describe('buildFinishLine', () => {
  const projects = [
    project({
      id: 'p1',
      milestones: [milestone({ id: 'm1', status: 'blocked' })],
    }),
    project({ id: 'p2' }),
  ];

  it('groups by area and sorts the unowned item first within its area', () => {
    const areas = buildFinishLine(
      [
        gap({ id: 'owned', area: 'Area one', projectIds: ['p1'] }),
        gap({ id: 'unowned', area: 'Area one' }),
        gap({ id: 'elsewhere', area: 'Area two', status: 'in-progress', projectIds: ['p2'] }),
      ],
      projects,
    );
    expect(areas.map((a) => a.area)).toEqual(['Area one', 'Area two']);
    expect(areas[0].open.map((r) => r.item.item)).toEqual(['unowned', 'owned']);
    expect(areas[0].unownedCount).toBe(1);
  });

  it('opens an area holding a blocked item and collapses one that has none', () => {
    const areas = buildFinishLine(
      [
        gap({ id: 'closed', area: 'Closed area', status: 'trusted' }),
        gap({ id: 'moving', area: 'Moving area', status: 'in-progress', projectIds: ['p2'] }),
        gap({ id: 'stuck', area: 'Stuck area', projectIds: ['p1'] }),
      ],
      projects,
    );
    const byArea = new Map(areas.map((a) => [a.area, a]));
    expect(byArea.get('Stuck area')?.defaultOpen).toBe(true);
    expect(byArea.get('Moving area')?.defaultOpen).toBe(false);
    expect(byArea.get('Closed area')?.defaultOpen).toBe(false);
    // The area with the blocker leads regardless of its name.
    expect(areas[0].area).toBe('Stuck area');
  });

  it('keeps trusted items out of the open list so they do not compete for attention', () => {
    const [area] = buildFinishLine(
      [
        gap({ id: 'done-with', area: 'Area one', status: 'trusted', projectIds: ['p1'] }),
        gap({ id: 'still-open', area: 'Area one', projectIds: ['p1'] }),
      ],
      projects,
    );
    expect(area.open.map((r) => r.item.item)).toEqual(['still-open']);
    expect(area.closed.map((r) => r.item.item)).toEqual(['done-with']);
  });

  it('shows one project under every gap it closes', () => {
    const areas = buildFinishLine(
      [
        gap({ id: 'first', area: 'Area one', projectIds: ['p1'] }),
        gap({ id: 'second', area: 'Area two', projectIds: ['p1'] }),
      ],
      projects,
    );
    expect(areas.flatMap((a) => a.open).filter((r) => r.projects.some((p) => p.id === 'p1'))).toHaveLength(2);
  });
});

describe('summarize', () => {
  it('counts open items only — a closed item needs no owner and no proxy', () => {
    const projects = [project({ id: 'p1', milestones: [milestone({ id: 'm1', status: 'blocked' })] })];
    const summary = summarize(
      buildFinishLine(
        [
          gap({ id: 'a', area: 'One' }),
          gap({ id: 'b', area: 'One', interim: 'a stand-in', projectIds: ['p1'] }),
          gap({ id: 'c', area: 'Two', status: 'in-progress', projectIds: ['p1'] }),
          gap({ id: 'd', area: 'Two', status: 'trusted' }),
        ],
        projects,
      ),
    );
    expect(summary).toEqual({
      open: 3,
      blocked: 2,
      unowned: 1,
      provisional: 1,
      silent: 2,
      trusted: 1,
    });
  });
});

describe('deleting a project', () => {
  it('removes its links and leaves the gap item standing, now unowned and first', async () => {
    const repository = new MockRepository();
    const closer = await repository.createProject({
      domain: 'work',
      title: 'closer',
      type: 'other',
      status: 'active',
      milestones: [],
      order: 1,
    });
    const other = await repository.createProject({
      domain: 'work',
      title: 'other',
      type: 'other',
      status: 'active',
      milestones: [],
      order: 2,
    });
    await repository.createFinishLineItem({
      area: 'Area one',
      item: 'owned gap',
      targetState: 'target',
      status: 'blocked',
      order: 0,
      projectIds: [closer.id],
    });
    await repository.createFinishLineItem({
      area: 'Area one',
      item: 'still owned gap',
      targetState: 'target',
      status: 'blocked',
      order: 1,
      projectIds: [other.id],
    });

    await repository.deleteProject(closer.id);

    const items = await repository.listFinishLineItems();
    expect(items).toHaveLength(2);
    const orphan = items.find((entry) => entry.item === 'owned gap');
    expect(orphan?.projectIds).toEqual([]);

    const [area] = buildFinishLine(items, await repository.listProjects('work'));
    expect(area.open.map((row) => row.item.item)).toEqual(['owned gap', 'still owned gap']);
    expect(area.open[0].unowned).toBe(true);
  });
});
