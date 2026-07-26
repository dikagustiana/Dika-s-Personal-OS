import { describe, expect, it } from 'vitest';
import { MockRepository } from '../data/mockRepository';
import type { FinishLineItem, Milestone, Project } from '../data/types';
import {
  ancestorPath,
  buildPack,
  buildPackLine,
  linesForProject,
  linkedMilestoneIds,
  packLines,
  resolveLinks,
  silentBlockers,
  summarizePack,
} from './finishLine';

/**
 * EVERY LABEL HERE IS SYNTHETIC — "Block one", "Line one". The real pack names
 * entities, drivers and open methodology decisions, and this repo is public;
 * no real block, section or line label may appear in any fixture.
 */

let n = 0;
function item(overrides: Partial<FinishLineItem>): FinishLineItem {
  n += 1;
  return {
    id: overrides.id ?? `item-${n}`,
    area: 'pack',
    item: `Row ${n}`,
    kind: 'line',
    status: 'trusted',
    order: n,
    links: [],
    ...overrides,
  };
}

function milestone(overrides: Partial<Milestone>): Milestone {
  n += 1;
  return {
    id: overrides.id ?? `m-${n}`,
    text: `Milestone ${n}`,
    done: false,
    status: 'in-progress',
    ...overrides,
  };
}

function project(overrides: Partial<Project>): Project {
  n += 1;
  return {
    id: overrides.id ?? `p-${n}`,
    domain: 'work',
    title: `Project ${n}`,
    type: 'other',
    status: 'active',
    milestones: [],
    order: n,
    ...overrides,
  };
}

/** A three-block synthetic structure, the §7 shape. */
function synthetic(): FinishLineItem[] {
  return [
    item({ id: 'b1', item: 'Block one', kind: 'block', order: 1 }),
    item({ id: 'b1s1', item: 'Section one', kind: 'section', parentId: 'b1', order: 1 }),
    item({ id: 'l1', item: 'Line one', kind: 'line', parentId: 'b1s1', order: 1 }),
    item({ id: 'l2', item: 'LINE TWO', kind: 'line', parentId: 'b1s1', order: 2, status: 'blocked' }),
    item({ id: 'b2', item: 'Block two', kind: 'block', order: 2 }),
    item({ id: 'b2l1', item: 'Line three', kind: 'line', parentId: 'b2', order: 1 }),
    item({ id: 'b3', item: 'Block three', kind: 'block', order: 3 }),
  ];
}

describe('buildPack', () => {
  it('builds the tree in document order, blocks at the roots', () => {
    const pack = buildPack(synthetic(), []);
    expect(pack.map((node) => node.item.id)).toEqual(['b1', 'b2', 'b3']);
    expect(pack[0].children.map((node) => node.item.id)).toEqual(['b1s1']);
    expect(pack[0].children[0].children.map((node) => node.item.id)).toEqual(['l1', 'l2']);
  });

  it('counts lines only — structural rows are not lines', () => {
    const pack = buildPack(synthetic(), []);
    expect(pack[0].totalLines).toBe(2);
    expect(pack[0].trusted).toBe(1);
    expect(pack[0].needsWork).toBe(1);
    expect(pack[2].totalLines).toBe(0);
  });

  it('ignores status on structural rows — a block seeded blocked must not paint the pack', () => {
    const items = [
      item({ id: 'b1', item: 'Block one', kind: 'block', status: 'blocked', order: 1 }),
      item({ id: 'l1', item: 'Line one', kind: 'line', parentId: 'b1', status: 'trusted' }),
    ];
    const [block] = buildPack(items, []);
    expect(block.needsWork).toBe(0);
    expect(block.defaultOpen).toBe(false);
  });

  it('opens a block by default only when it contains a non-trusted line', () => {
    const pack = buildPack(synthetic(), []);
    expect(pack[0].defaultOpen).toBe(true); // holds the blocked LINE TWO
    expect(pack[1].defaultOpen).toBe(false); // all trusted
    expect(pack[2].defaultOpen).toBe(false); // empty
  });

  it('keeps an item whose parent does not resolve, as a root', () => {
    const orphan = item({ id: 'lost', item: 'Line lost', kind: 'line', parentId: 'gone' });
    const pack = buildPack([orphan], []);
    expect(pack).toHaveLength(1);
    expect(pack[0].item.id).toBe('lost');
  });

  it('supports lines nested under lines — a ratio under its subtotal', () => {
    const items = [
      item({ id: 'b', item: 'Block one', kind: 'block' }),
      item({ id: 'sub', item: 'SUBTOTAL ONE', kind: 'line', parentId: 'b', order: 1 }),
      item({ id: 'ratio', item: 'Ratio one', kind: 'line', parentId: 'sub', order: 1 }),
    ];
    const [block] = buildPack(items, []);
    expect(block.totalLines).toBe(2);
    expect(block.children[0].children[0].item.id).toBe('ratio');
  });

  it('terminates on a parent cycle instead of recursing forever', () => {
    const a = item({ id: 'a', item: 'Row a', parentId: 'b' });
    const b = item({ id: 'b', item: 'Row b', parentId: 'a' });
    expect(() => packLines(buildPack([a, b], []))).not.toThrow();
  });
});

describe('resolveLinks — the broken link is a state, not a filter', () => {
  const m1 = milestone({ id: 'm1', text: 'Milestone one' });
  const p1 = project({ id: 'p1', milestones: [m1] });

  it('resolves a milestone-level link to its milestone', () => {
    const line = item({ links: [{ id: 'k1', projectId: 'p1', milestoneId: 'm1' }] });
    const [resolved] = resolveLinks(line, [p1]);
    expect(resolved.milestone?.id).toBe('m1');
    expect(resolved.broken).toBe(false);
  });

  it('returns a BROKEN link when the milestone id no longer resolves', () => {
    const line = item({ links: [{ id: 'k1', projectId: 'p1', milestoneId: 'deleted-m' }] });
    const resolved = resolveLinks(line, [p1]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].broken).toBe(true);
    expect(resolved[0].project.id).toBe('p1');
    expect(resolved[0].milestone).toBeUndefined();
  });

  it('drops a link whose project is gone — the database cascade owns that case', () => {
    const line = item({ links: [{ id: 'k1', projectId: 'gone', milestoneId: 'm1' }] });
    expect(resolveLinks(line, [p1])).toHaveLength(0);
  });

  it('keeps a project-level link alongside milestone-level ones', () => {
    const line = item({
      links: [
        { id: 'k1', projectId: 'p1' },
        { id: 'k2', projectId: 'p1', milestoneId: 'm1' },
      ],
    });
    const resolved = resolveLinks(line, [p1]);
    expect(resolved).toHaveLength(2);
    expect(resolved.filter((r) => r.milestone)).toHaveLength(1);
  });
});

describe('silent blockers', () => {
  const silent = () => milestone({ id: 'sb', status: 'blocked' });
  const escalated = () => milestone({ id: 'eb', status: 'blocked', escalateTo: 'mbak-muti' });
  const doneBlocked = () => milestone({ id: 'db', status: 'blocked', done: true });

  it('counts blocked milestones with no escalation target, live only', () => {
    const p = project({ milestones: [silent(), escalated(), doneBlocked()] });
    expect(silentBlockers(p).map((m) => m.id)).toEqual(['sb']);
  });

  it('does not fire when the milestone has an escalateTo', () => {
    const p = project({ milestones: [escalated()] });
    expect(silentBlockers(p)).toHaveLength(0);
  });

  it('scopes milestone-level links to their own milestone', () => {
    const p = project({
      id: 'p1',
      milestones: [silent(), milestone({ id: 'other', status: 'blocked' })],
    });
    // Linked to ONE blocked milestone of a project with two: the line is
    // stuck on its own milestone only, not the neighbour's.
    const line = buildPackLine(
      item({ status: 'blocked', links: [{ id: 'k', projectId: 'p1', milestoneId: 'sb' }] }),
      [p],
    );
    expect(line.silentBlockers).toBe(1);
  });

  it('counts the whole project for a project-level link', () => {
    const p = project({
      id: 'p1',
      milestones: [silent(), milestone({ id: 'sb2', status: 'blocked' })],
    });
    const line = buildPackLine(
      item({ status: 'blocked', links: [{ id: 'k', projectId: 'p1' }] }),
      [p],
    );
    expect(line.silentBlockers).toBe(2);
  });

  it('does not fire through a broken link', () => {
    const p = project({ id: 'p1', milestones: [silent()] });
    const line = buildPackLine(
      item({ status: 'blocked', links: [{ id: 'k', projectId: 'p1', milestoneId: 'gone' }] }),
      [p],
    );
    expect(line.silentBlockers).toBe(0);
    expect(line.brokenLinks).toBe(1);
  });

  it('counts a milestone once when project-level and milestone-level links overlap', () => {
    const p = project({ id: 'p1', milestones: [silent()] });
    const line = buildPackLine(
      item({
        status: 'blocked',
        links: [
          { id: 'k1', projectId: 'p1' },
          { id: 'k2', projectId: 'p1', milestoneId: 'sb' },
        ],
      }),
      [p],
    );
    expect(line.silentBlockers).toBe(1);
  });
});

describe('summarizePack', () => {
  it('counts trusted over total — the only honest progress number', () => {
    const summary = summarizePack(buildPack(synthetic(), []));
    expect(summary.trusted).toBe(2);
    expect(summary.totalLines).toBe(3);
    expect(summary.needsWork).toBe(1);
    expect(summary.blocked).toBe(1);
  });

  it('marks an untrusted line with no links unowned', () => {
    const summary = summarizePack(buildPack(synthetic(), []));
    expect(summary.unowned).toBe(1); // LINE TWO has no links
  });

  it('does not count a trusted line as unowned or provisional', () => {
    const items = [item({ status: 'trusted', interim: 'proxy in place' })];
    const summary = summarizePack(buildPack(items, []));
    expect(summary.unowned).toBe(0);
    expect(summary.provisional).toBe(0);
  });

  it('counts provisional and silent on open lines', () => {
    const blocked = milestone({ id: 'mb', status: 'blocked' });
    const p = project({ id: 'p1', milestones: [blocked] });
    const items = [
      item({ status: 'in-progress', interim: 'a proxy' }),
      item({ status: 'blocked', links: [{ id: 'k', projectId: 'p1' }] }),
    ];
    const summary = summarizePack(buildPack(items, [p]));
    expect(summary.provisional).toBe(1);
    expect(summary.silent).toBe(1);
  });
});

describe('ancestorPath', () => {
  it('returns the ids to expand, root first', () => {
    expect(ancestorPath(synthetic(), 'l2')).toEqual(['b1', 'b1s1']);
  });

  it('is empty for a root and safe on a cycle', () => {
    expect(ancestorPath(synthetic(), 'b1')).toEqual([]);
    const a = item({ id: 'a', parentId: 'b' });
    const b = item({ id: 'b', parentId: 'a' });
    expect(() => ancestorPath([a, b], 'a')).not.toThrow();
  });
});

describe('the reverse direction — project back to the pack', () => {
  const p1 = project({
    id: 'p1',
    milestones: [milestone({ id: 'm1' }), milestone({ id: 'm2' })],
  });
  const pUnlinked = project({ id: 'p-unlinked' });
  const items = [
    item({ id: 'b1', item: 'Block one', kind: 'block', order: 1 }),
    item({ id: 's1', item: 'Section one', kind: 'section', parentId: 'b1', order: 1 }),
    item({
      id: 'l1',
      item: 'Line one',
      kind: 'line',
      parentId: 's1',
      order: 1,
      status: 'blocked',
      links: [
        { id: 'k1', projectId: 'p1', milestoneId: 'm1' },
        { id: 'k2', projectId: 'p1', milestoneId: 'm2' },
      ],
    }),
    item({
      id: 'l2',
      item: 'Line two',
      kind: 'line',
      parentId: 's1',
      order: 2,
      status: 'trusted',
      links: [{ id: 'k3', projectId: 'p1' }],
    }),
    item({
      id: 'l3',
      item: 'Line three',
      kind: 'line',
      parentId: 's1',
      order: 3,
      links: [{ id: 'k4', projectId: 'p2', milestoneId: 'm9' }],
    }),
  ];

  it('lists only the lines this project links to, untrusted first', () => {
    const lines = linesForProject(items, p1);
    expect(lines.map((line) => line.item.id)).toEqual(['l1', 'l2']);
  });

  it('carries the Function → Nature → Account path', () => {
    const [first] = linesForProject(items, p1);
    expect(first.path).toEqual(['Block one', 'Section one']);
  });

  it("counts this project's linked milestones and flags a project-level link", () => {
    const lines = linesForProject(items, p1);
    expect(lines[0].milestonesLinked).toBe(2);
    expect(lines[0].projectLevel).toBe(false);
    expect(lines[1].milestonesLinked).toBe(0);
    expect(lines[1].projectLevel).toBe(true);
  });

  it('counts a dangling milestone id as a broken link, never as coverage', () => {
    const withBroken = [
      item({
        id: 'lb',
        kind: 'line',
        status: 'blocked',
        links: [
          { id: 'k1', projectId: 'p1', milestoneId: 'm1' },
          { id: 'k2', projectId: 'p1', milestoneId: 'deleted' },
        ],
      }),
    ];
    const [line] = linesForProject(withBroken, p1);
    expect(line.milestonesLinked).toBe(1);
    expect(line.brokenLinks).toBe(1);
  });

  it('returns [] when nothing is linked — the card renders no section at all', () => {
    expect(linesForProject(items, pUnlinked)).toEqual([]);
  });

  it('collects the marker set of linked milestone ids per project', () => {
    expect(linkedMilestoneIds(items, 'p1')).toEqual(new Set(['m1', 'm2']));
    expect(linkedMilestoneIds(items, 'p2')).toEqual(new Set(['m9']));
    expect(linkedMilestoneIds(items, 'p-unlinked').size).toBe(0);
  });
});

describe('MockRepository mirrors the database cascades', () => {
  it('deleting a block cascades to its sections and lines', async () => {
    const repo = new MockRepository();
    const block = await repo.createFinishLineItem({
      area: 'pack', item: 'Block one', kind: 'block', status: 'trusted', order: 1, links: [],
    });
    const section = await repo.createFinishLineItem({
      area: 'pack', item: 'Section one', kind: 'section', status: 'trusted', order: 1,
      parentId: block.id, links: [],
    });
    await repo.createFinishLineItem({
      area: 'pack', item: 'Line one', kind: 'line', status: 'blocked', order: 1,
      parentId: section.id, links: [],
    });
    await repo.deleteFinishLineItem(block.id);
    expect(await repo.listFinishLineItems()).toEqual([]);
  });

  it('deleting a project clears its links and leaves the line standing, unowned', async () => {
    const repo = new MockRepository();
    const p = await repo.createProject({
      domain: 'work', title: 'Synthetic project', type: 'other', status: 'active',
      milestones: [], order: 99,
    });
    const line = await repo.createFinishLineItem({
      area: 'pack', item: 'Line one', kind: 'line', status: 'blocked', order: 1,
      links: [{ projectId: p.id, milestoneId: 'm-synth' }],
    });
    await repo.deleteProject(p.id);
    const [after] = (await repo.listFinishLineItems()).filter((candidate) => candidate.id === line.id);
    expect(after).toBeDefined();
    expect(after.links).toEqual([]);
  });

  it('dedupes the same (project, milestone) pair on write', async () => {
    const repo = new MockRepository();
    const line = await repo.createFinishLineItem({
      area: 'pack', item: 'Line one', kind: 'line', status: 'blocked', order: 1,
      links: [
        { projectId: 'p1', milestoneId: 'm1' },
        { projectId: 'p1', milestoneId: 'm1' },
        { projectId: 'p1' },
      ],
    });
    expect(line.links).toHaveLength(2);
  });
});
