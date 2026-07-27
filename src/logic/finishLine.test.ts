import { describe, expect, it } from 'vitest';
import {
  FinishLineGuardError,
  guardCellState,
  guardEdgeTarget,
  isGapEligible,
} from '../data/finishLineGuards';
import { isMissingRelation } from '../data/missingRelation';
import type {
  CellState,
  FinishLineCell,
  FinishLineDep,
  FinishLineEdge,
  FinishLineEntity,
  FinishLineItem,
  Milestone,
  Project,
} from '../data/types';
import {
  buildContext,
  buildMatrix,
  cellsByMilestone,
  cellsClosedByProject,
  cellSubState,
  isGap,
  resolveAll,
  resolveCell,
  resolveEdges,
  STATE_GLYPH,
  summarizeMatrix,
  worst,
} from './finishLine';

// Synthetic labels only. The real matrix names consolidation entities and pack
// line items and is seeded into the database, never into this repo.
// THERE ARE NO FIGURES ANYWHERE IN THIS FILE and none may be added.

const ENTITIES: FinishLineEntity[] = [
  { code: 'E1', label: 'E1', order: 1 },
  { code: 'E2', label: 'E2', order: 2 },
];

let n = 0;
const nextId = () => `id-${(n += 1)}`;

function cell(state: CellState, over: Partial<FinishLineCell> = {}): FinishLineCell {
  return { id: nextId(), itemId: 'row', entityCode: 'E1', state, ...over };
}

function milestone(over: Partial<Milestone> = {}): Milestone {
  return { id: nextId(), text: 'm', done: false, status: 'in-progress', ...over };
}

function project(milestones: Milestone[], id = 'p1'): Project {
  return {
    id,
    domain: 'work',
    title: 'Project',
    type: 'other',
    status: 'active',
    milestones,
    order: 1,
  };
}

function edge(cellId: string, over: Partial<FinishLineEdge> = {}): FinishLineEdge {
  return { id: nextId(), cellId, projectId: 'p1', ...over };
}

function item(over: Partial<FinishLineItem> & { id: string }): FinishLineItem {
  return { item: over.id, kind: 'metric', order: 1, ...over };
}

describe('severity order — rewritten, figure is no longer the safe end', () => {
  it('ranks a cycle above everything — wrong data must not be averaged away', () => {
    expect(worst('cycle', 'unplanned')).toBe('cycle');
    expect(worst('backed', 'cycle')).toBe('cycle');
  });

  it('holds the specified order end to end', () => {
    // unplanned > stuck > in-progress > contradiction > backed > undefined > zero
    expect(worst('unplanned', 'stuck')).toBe('unplanned');
    expect(worst('stuck', 'in-progress')).toBe('stuck');
    expect(worst('in-progress', 'contradiction')).toBe('in-progress');
    expect(worst('contradiction', 'backed')).toBe('contradiction');
    expect(worst('backed', 'undefined')).toBe('backed');
    expect(worst('undefined', 'zero')).toBe('undefined');
  });

  it('places pending between contradiction and backed, disturbing no stated pair', () => {
    expect(worst('contradiction', 'pending')).toBe('contradiction');
    expect(worst('pending', 'backed')).toBe('pending');
  });

  it('never counts undefined, zero or backed as a gap', () => {
    expect(isGap('undefined')).toBe(false);
    expect(isGap('zero')).toBe(false);
    expect(isGap('backed')).toBe(false);
    expect(isGap('unplanned')).toBe(true);
    expect(isGap('stuck')).toBe(true);
  });
});

describe('cellSubState — layer 2, for figure AND input', () => {
  const p = (ms: Milestone[]) => new Map([['p1', project(ms)]]);

  it('is unplanned with no edge at all', () => {
    expect(cellSubState('input', resolveEdges([], p([])))).toBe('unplanned');
  });

  it('is unplanned for a FIGURE with no edge — a number nothing stands behind', () => {
    expect(cellSubState('figure', resolveEdges([], p([])))).toBe('unplanned');
  });

  it('is stuck when every linked milestone is blocked', () => {
    const m1 = milestone({ status: 'blocked' });
    const m2 = milestone({ status: 'blocked' });
    const edges = [edge('c', { milestoneId: m1.id }), edge('c', { milestoneId: m2.id })];
    expect(cellSubState('input', resolveEdges(edges, p([m1, m2])))).toBe('stuck');
  });

  it('is in-progress when at least one is open and not blocked', () => {
    const m1 = milestone({ status: 'blocked' });
    const m2 = milestone({ status: 'in-progress' });
    const edges = [edge('c', { milestoneId: m1.id }), edge('c', { milestoneId: m2.id })];
    expect(cellSubState('input', resolveEdges(edges, p([m1, m2])))).toBe('in-progress');
  });

  it('is a contradiction when every linked milestone is done and the cell is still input', () => {
    const m1 = milestone({ done: true, status: 'done' });
    const edges = [edge('c', { milestoneId: m1.id })];
    expect(cellSubState('input', resolveEdges(edges, p([m1])))).toBe('contradiction');
  });

  it('is BACKED, not a contradiction, when a figure has all its milestones done', () => {
    // The whole point of the model change: a figure whose work is finished has
    // reached the target state. Only an `input` disagreeing with done work is
    // a contradiction.
    const m1 = milestone({ done: true, status: 'done' });
    const edges = [edge('c', { milestoneId: m1.id })];
    expect(cellSubState('figure', resolveEdges(edges, p([m1])))).toBe('backed');
    expect(isGap('backed')).toBe(false);
  });

  it('does not count a broken edge as coverage', () => {
    const edges = [edge('c', { milestoneId: 'deleted' })];
    const resolved = resolveEdges(edges, p([]));
    expect(resolved[0].broken).toBe(true);
    expect(cellSubState('input', resolved)).toBe('unplanned');
  });
});

describe('resolveCell — layer 3 rollup', () => {
  it('passes through the two terminal states untouched', () => {
    for (const state of ['zero', 'undefined'] as CellState[]) {
      const c = cell(state);
      const ctx = buildContext([c], [], [], []);
      expect(resolveCell(c.id, ctx)).toBe(state);
    }
  });

  it('does NOT pass a figure through — it resolves through its edges', () => {
    const c = cell('figure');
    const ctx = buildContext([c], [], [], []);
    expect(resolveCell(c.id, ctx)).toBe('unplanned');
  });

  it('takes the worst sub-state among a locked cell inputs', () => {
    const blocked = milestone({ status: 'blocked' });
    const open = milestone({ status: 'in-progress' });
    const inA = cell('input');
    const inB = cell('input');
    const locked = cell('locked');
    const deps: FinishLineDep[] = [
      { cellId: locked.id, inputId: inA.id },
      { cellId: locked.id, inputId: inB.id },
    ];
    const edges = [
      edge(inA.id, { milestoneId: blocked.id }),
      edge(inB.id, { milestoneId: open.id }),
    ];
    const ctx = buildContext([inA, inB, locked], deps, edges, [project([blocked, open])]);
    // inA is stuck, inB is in-progress -> the locked cell is stuck.
    expect(resolveCell(locked.id, ctx)).toBe('stuck');
  });

  it('recurses: an unplanned input at the bottom makes the top read unplanned', () => {
    const bottom = cell('input');
    const middle = cell('locked');
    const top = cell('locked');
    const deps: FinishLineDep[] = [
      { cellId: middle.id, inputId: bottom.id },
      { cellId: top.id, inputId: middle.id },
    ];
    const ctx = buildContext([bottom, middle, top], deps, [], []);
    expect(resolveCell(top.id, ctx)).toBe('unplanned');
  });

  it('resolves to undefined — not a gap — when every input is zero or undefined', () => {
    const a = cell('zero');
    const b = cell('undefined');
    const locked = cell('locked');
    const deps: FinishLineDep[] = [
      { cellId: locked.id, inputId: a.id },
      { cellId: locked.id, inputId: b.id },
    ];
    const ctx = buildContext([a, b, locked], deps, [], []);
    expect(resolveCell(locked.id, ctx)).toBe('undefined');
    expect(isGap(resolveCell(locked.id, ctx))).toBe(false);
  });

  it('reports a cycle as a hard error rather than breaking silently', () => {
    const a = cell('locked');
    const b = cell('locked');
    const deps: FinishLineDep[] = [
      { cellId: a.id, inputId: b.id },
      { cellId: b.id, inputId: a.id },
    ];
    const ctx = buildContext([a, b], deps, [], []);
    expect(resolveCell(a.id, ctx)).toBe('cycle');
  });

  it('is pending when a locked cell has nothing recorded to wait on', () => {
    const locked = cell('locked');
    const ctx = buildContext([locked], [], [], []);
    expect(resolveCell(locked.id, ctx)).toBe('pending');
  });

  it('walks a diamond once and gets the same answer', () => {
    const shared = cell('input');
    const left = cell('locked');
    const right = cell('locked');
    const top = cell('locked');
    const deps: FinishLineDep[] = [
      { cellId: left.id, inputId: shared.id },
      { cellId: right.id, inputId: shared.id },
      { cellId: top.id, inputId: left.id },
      { cellId: top.id, inputId: right.id },
    ];
    const ctx = buildContext([shared, left, right, top], deps, [], []);
    expect(resolveCell(top.id, ctx)).toBe('unplanned');
    expect(resolveAll(ctx).get(top.id)).toBe('unplanned');
  });
});

describe('cell state is human-only', () => {
  it('rejects a rollup writing a state', () => {
    expect(() => guardCellState('figure', 'rollup')).toThrow(FinishLineGuardError);
  });

  it('rejects a model writing a state', () => {
    expect(() => guardCellState('figure', 'model')).toThrow(FinishLineGuardError);
  });

  it('accepts a human edit', () => {
    expect(guardCellState('figure', 'human')).toBe('figure');
  });

  it('rejects a state outside the five', () => {
    expect(() => guardCellState('unreliable' as CellState, 'human')).toThrow(
      FinishLineGuardError,
    );
  });
});

describe('buildMatrix', () => {
  const items = [
    item({ id: 's1', kind: 'section', order: 1 }),
    item({ id: 'm1', parentId: 's1', order: 1 }),
    item({ id: 'n1', parentId: 's1', kind: 'note', order: 2 }),
  ];

  it('resolves every row across every entity column, in sort_order', () => {
    const c1 = cell('figure', { itemId: 'm1', entityCode: 'E1' });
    const c2 = cell('zero', { itemId: 'm1', entityCode: 'E2' });
    const [section] = buildMatrix(items, [c1, c2], [...ENTITIES].reverse());
    expect(section.rows[0].cells.map((c) => c.entity.code)).toEqual(['E1', 'E2']);
    expect(section.rows[0].cells.map((c) => c.cell?.state)).toEqual(['figure', 'zero']);
  });

  it('leaves a gap — not a state — where the seed wrote no cell', () => {
    const [section] = buildMatrix(items, [], ENTITIES);
    expect(section.rows[0].cells.every((c) => c.cell === undefined)).toBe(true);
    expect(summarizeMatrix([section]).missing).toBe(2);
  });

  it('gives a note row no cells', () => {
    const [section] = buildMatrix(items, [], ENTITIES);
    expect(section.rows[1].cells).toEqual([]);
  });

  it('opens a section holding a gap and collapses one whose cells are all settled', () => {
    const gapCell = cell('input', { itemId: 'm1', entityCode: 'E1' });
    const settled = cell('figure', { itemId: 'm1', entityCode: 'E1' });
    const withGap = buildMatrix(items, [gapCell], ENTITIES, new Map([[gapCell.id, 'unplanned']]));
    const without = buildMatrix(items, [settled], ENTITIES, new Map([[settled.id, 'backed']]));
    expect(withGap[0].defaultOpen).toBe(true);
    expect(without[0].defaultOpen).toBe(false);
  });

  it('does not open a section whose only non-figure cells are undefined', () => {
    const c = cell('undefined', { itemId: 'm1', entityCode: 'E1' });
    const [section] = buildMatrix(items, [c], ENTITIES, new Map([[c.id, 'undefined']]));
    expect(section.defaultOpen).toBe(false);
  });
});

describe('cell glyphs', () => {
  it('renders zero and locked differently — they are not the same fact', () => {
    expect(STATE_GLYPH.zero).toBe('–');
    expect(STATE_GLYPH.locked).toBe('·');
    expect(STATE_GLYPH.zero).not.toBe(STATE_GLYPH.locked);
  });

  it('renders a figure as xxx — the number stays in Excel', () => {
    expect(STATE_GLYPH.figure).toBe('xxx');
  });

  it('has exactly the five states', () => {
    expect(Object.keys(STATE_GLYPH).sort()).toEqual([
      'figure',
      'input',
      'locked',
      'undefined',
      'zero',
    ]);
  });
});

describe('project -> pack direction', () => {
  it('counts the cells a project closes', () => {
    const edges = [edge('c1'), edge('c2'), edge('c1', { projectId: 'other' })];
    expect(cellsClosedByProject(edges, 'p1').size).toBe(2);
  });

  it('counts cells per milestone and omits one that closes nothing', () => {
    const edges = [
      edge('c1', { milestoneId: 'm1' }),
      edge('c2', { milestoneId: 'm1' }),
      edge('c3', { milestoneId: 'm2' }),
    ];
    const counts = cellsByMilestone(edges, 'p1');
    expect(counts.get('m1')).toBe(2);
    expect(counts.get('m2')).toBe(1);
    expect(counts.get('m3')).toBeUndefined();
  });
});

describe('the one predicate: isGapEligible', () => {
  it('covers figure and input, and nothing else', () => {
    expect(isGapEligible('figure')).toBe(true);
    expect(isGapEligible('input')).toBe(true);
    expect(isGapEligible('locked')).toBe(false);
    expect(isGapEligible('undefined')).toBe(false);
  });

  it('defers zero — and this is the ONE line that reverses when it is lifted', () => {
    expect(isGapEligible('zero')).toBe(false);
  });

  it('is the same answer the edge guard enforces, by construction', () => {
    for (const state of ['figure', 'zero', 'undefined', 'input', 'locked'] as CellState[]) {
      if (isGapEligible(state)) expect(guardEdgeTarget(state)).toBe(state);
      else expect(() => guardEdgeTarget(state)).toThrow(FinishLineGuardError);
    }
  });
});

describe('edges may only point at a gap-eligible cell (mutation path)', () => {
  it('rejects an edge onto a locked cell — it closes when its inputs land', () => {
    expect(() => guardEdgeTarget('locked')).toThrow(FinishLineGuardError);
  });

  it('rejects an edge onto undefined and zero', () => {
    for (const state of ['undefined', 'zero'] as CellState[]) {
      expect(() => guardEdgeTarget(state)).toThrow(FinishLineGuardError);
    }
  });

  it('ACCEPTS an edge onto a figure — this is the model change', () => {
    expect(guardEdgeTarget('figure')).toBe('figure');
  });

  it('accepts an edge onto an input cell', () => {
    expect(guardEdgeTarget('input')).toBe('input');
  });
});

describe('a dangling edge counts as no edge (§7.2)', () => {
  it('leaves a cell whose only edges dangle as unplanned, not in-progress', () => {
    const c = cell('input');
    const edges = [edge(c.id, { milestoneId: 'deleted' })];
    const ctx = buildContext([c], [], edges, [project([])]);
    expect(resolveCell(c.id, ctx)).toBe('unplanned');
  });
});

describe('missing relation degrades to empty (§10.7)', () => {
  it('treats 42P01 and 42703 as missing', () => {
    expect(isMissingRelation({ code: '42P01' })).toBe(true);
    expect(isMissingRelation({ code: '42703' })).toBe(true);
  });

  it("treats PostgREST's schema-cache miss as missing", () => {
    expect(isMissingRelation({ code: 'PGRST205' })).toBe(true);
    expect(
      isMissingRelation({ message: "Could not find the table 'public.x' in the schema cache" }),
    ).toBe(true);
  });

  it('does NOT swallow a permission or network failure — those stay loud', () => {
    expect(isMissingRelation({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isMissingRelation({ message: 'network error' })).toBe(false);
    expect(isMissingRelation(null)).toBe(false);
  });
});
