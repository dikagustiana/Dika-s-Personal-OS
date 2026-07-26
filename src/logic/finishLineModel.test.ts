import { describe, expect, it } from 'vitest';
import { isGapEligible } from '../data/finishLineGuards';
import {
  cardState,
  derivedCardState,
  firstFailure,
  okRows,
  readFailure,
  readThrew,
  rowsOf,
} from '../data/readResult';
import type {
  CellState,
  FinishLineCell,
  FinishLineDep,
  FinishLineEdge,
  FinishLineEntity,
  FinishLineItem,
  Milestone,
  OrphanMilestone,
  Project,
} from '../data/types';
import {
  buildContext,
  buildMatrix,
  cellsForMilestone,
  filterMatrix,
  gapCells,
  gapsByEntity,
  groupOrphans,
  resolveAll,
  resolveCell,
  slotMatches,
  summarizeMatrix,
} from './finishLine';

// Synthetic labels only. The real matrix names consolidation entities and pack
// line items and is seeded into the database, never into this repo.
// THERE ARE NO FIGURES ANYWHERE IN THIS FILE and none may be added.

let n = 0;
const nextId = () => `id-${(n += 1)}`;

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

// ---------------------------------------------------------------------------
// §9.1 — the gap population is 136, and it decomposes per column
// ---------------------------------------------------------------------------

/**
 * THE LIVE CENSUS, QUERIED 26 JUL, AS A FIXTURE.
 *
 * The total alone is a weak assertion: 136 is reachable by more than one wrong
 * predicate. The PER-COLUMN decomposition is not, and each way of getting the
 * predicate wrong has its own fingerprint here —
 *   including `zero`      KDU goes 8 -> 30, SAMB 37 -> 40
 *   excluding `figure`    SAMB goes 37 -> 8, KDU is unchanged at 8
 *   including `undefined` KNI goes 15 -> 29
 * so a passing suite pins the shape of the answer and not just its size.
 */
const CENSUS: Record<string, Partial<Record<CellState, number>>> = {
  SAMB: { figure: 29, input: 8, zero: 3, undefined: 0, locked: 7 },
  ASI: { figure: 29, input: 10, zero: 1, undefined: 0, locked: 7 },
  ARBI: { figure: 27, input: 10, zero: 3, undefined: 0, locked: 7 },
  KNI: { figure: 7, input: 8, zero: 15, undefined: 14, locked: 3 },
  KDU: { figure: 0, input: 8, zero: 22, undefined: 14, locked: 3 },
};

const ENTITY_ORDER = ['SAMB', 'ASI', 'ARBI', 'KNI', 'KDU'];

function censusFixture(): {
  items: FinishLineItem[];
  cells: FinishLineCell[];
  entities: FinishLineEntity[];
} {
  const entities: FinishLineEntity[] = ENTITY_ORDER.map((code, index) => ({
    code,
    label: code,
    order: index + 1,
  }));
  const items: FinishLineItem[] = [{ id: 'S', item: 'S', kind: 'section', order: 1 }];
  const cells: FinishLineCell[] = [];

  // One row per (state, occurrence), each carrying its five entity cells only
  // where the census says that entity has one. Row identity does not matter —
  // the column totals do.
  const maxRows = Math.max(
    ...Object.values(CENSUS).flatMap((byState) => Object.values(byState) as number[]),
  );
  for (const state of ['figure', 'input', 'zero', 'undefined', 'locked'] as CellState[]) {
    for (let i = 0; i < maxRows; i += 1) {
      const id = `${state}-${i}`;
      let used = false;
      for (const entity of entities) {
        if ((CENSUS[entity.code][state] ?? 0) <= i) continue;
        used = true;
        cells.push({ id: `${id}:${entity.code}`, itemId: id, entityCode: entity.code, state });
      }
      if (used) items.push({ id, item: id, kind: 'metric', parentId: 'S', order: i + 1 });
    }
  }
  return { items, cells, entities };
}

describe('§9.1 the gap population — 136, not 44', () => {
  const { items, cells, entities } = censusFixture();

  it('reproduces the live cell census exactly', () => {
    expect(cells.length).toBe(235);
    const byState = new Map<string, number>();
    for (const cell of cells) byState.set(cell.state, (byState.get(cell.state) ?? 0) + 1);
    expect(byState.get('figure')).toBe(92);
    expect(byState.get('input')).toBe(44);
    expect(byState.get('zero')).toBe(44);
    expect(byState.get('undefined')).toBe(28);
    expect(byState.get('locked')).toBe(27);
  });

  it('counts 136 gap-eligible cells — 92 figure plus 44 input', () => {
    expect(cells.filter((cell) => isGapEligible(cell.state)).length).toBe(136);
  });

  it('resolves all 136 as unplanned while no edge exists, matching the view', () => {
    // os_finish_line_item_projects holds 0 rows today, so every gap-eligible
    // cell is unplanned and the view returns 136.
    const context = buildContext(cells, [], [], []);
    const matrix = buildMatrix(items, cells, entities, resolveAll(context));
    const summary = summarizeMatrix(matrix);

    expect(summary.gapEligible).toBe(136);
    expect(summary.gaps).toBe(136);
    expect(summary.unplanned).toBe(136);
    expect(gapCells(matrix, 'unplanned').length).toBe(136);
  });

  it('decomposes per column — the assertion a wrong predicate cannot survive', () => {
    const context = buildContext(cells, [], [], []);
    const matrix = buildMatrix(items, cells, entities, resolveAll(context));
    const byEntity = gapsByEntity(matrix);

    expect(byEntity.get('SAMB')).toBe(37); // 29 figure + 8 input
    expect(byEntity.get('ASI')).toBe(39); // 29 + 10
    expect(byEntity.get('ARBI')).toBe(37); // 27 + 10
    expect(byEntity.get('KNI')).toBe(15); // 7 + 8
    expect(byEntity.get('KDU')).toBe(8); // 0 + 8
    expect([...byEntity.values()].reduce((a, b) => a + b, 0)).toBe(136);
  });

  it('excludes zero and undefined from the count — the deferral, observed', () => {
    const context = buildContext(cells, [], [], []);
    const matrix = buildMatrix(items, cells, entities, resolveAll(context));
    // 44 zero + 28 undefined = 72 cells that are emphatically not gaps.
    expect(summarizeMatrix(matrix).gapEligible).toBe(235 - 44 - 28 - 27);
  });
});

// ---------------------------------------------------------------------------
// §9.1 / §5.2 — the trace cell
// ---------------------------------------------------------------------------

describe('§5.2 the rollup trace — Cash conversion cycle over DSO/DIO/DPO', () => {
  /**
   * The named trace. Locked over three locked cells, each over an unbacked
   * leaf. A wrong severity order still renders and still produces plausible
   * colours; this is the observation that separates right from wrong.
   */
  function cycleTrace(leafStates: CellState[]) {
    const cells: FinishLineCell[] = [];
    const deps: FinishLineDep[] = [];
    const top: FinishLineCell = { id: 'ccc', itemId: 'r', entityCode: 'SAMB', state: 'locked' };
    cells.push(top);
    leafStates.forEach((state, index) => {
      const mid: FinishLineCell = {
        id: `mid-${index}`,
        itemId: 'r',
        entityCode: 'SAMB',
        state: 'locked',
      };
      const leaf: FinishLineCell = {
        id: `leaf-${index}`,
        itemId: 'r',
        entityCode: 'SAMB',
        state,
      };
      cells.push(mid, leaf);
      deps.push({ cellId: top.id, inputId: mid.id });
      deps.push({ cellId: mid.id, inputId: leaf.id });
    });
    return { cells, deps, top };
  }

  it('reads unplanned today — three locked layers over unbacked leaves', () => {
    const { cells, deps, top } = cycleTrace(['figure', 'input', 'figure']);
    const context = buildContext(cells, deps, [], []);
    expect(resolveCell(top.id, context)).toBe('unplanned');
  });

  it('reads backed once every leaf has done work behind it', () => {
    const done = milestone({ done: true, status: 'done' });
    const { cells, deps, top } = cycleTrace(['figure', 'figure', 'figure']);
    const edges: FinishLineEdge[] = cells
      .filter((cell) => cell.id.startsWith('leaf-'))
      .map((cell) => ({
        id: nextId(),
        cellId: cell.id,
        projectId: 'p1',
        milestoneId: done.id,
      }));
    const context = buildContext(cells, deps, edges, [project([done])]);
    expect(resolveCell(top.id, context)).toBe('backed');
  });

  it('reads undefined — not a gap — when every leaf is nil or arithmetic', () => {
    const { cells, deps, top } = cycleTrace(['zero', 'undefined', 'zero']);
    const context = buildContext(cells, deps, [], []);
    expect(resolveCell(top.id, context)).toBe('undefined');
  });

  it('takes the WORST leaf, not the first or the last', () => {
    const blocked = milestone({ status: 'blocked' });
    const { cells, deps, top } = cycleTrace(['figure', 'figure']);
    const leaves = cells.filter((cell) => cell.id.startsWith('leaf-'));
    // leaf-0 stuck (its only milestone is blocked), leaf-1 unplanned.
    const edges: FinishLineEdge[] = [
      { id: nextId(), cellId: leaves[0].id, projectId: 'p1', milestoneId: blocked.id },
    ];
    const context = buildContext(cells, deps, edges, [project([blocked])]);
    expect(resolveCell(top.id, context)).toBe('unplanned');
  });
});

// ---------------------------------------------------------------------------
// §9.5 / §9.6 — nothing persisted, and a cycle terminates
// ---------------------------------------------------------------------------

describe('§9.6 recursion terminates on a cycle', () => {
  it('does not hang and surfaces a hard error', () => {
    // A three-cell loop, deeper than the two-cell case already covered. If the
    // guard regressed this would not fail an assertion — it would never
    // return, so the timeout is the real assertion.
    const a: FinishLineCell = { id: 'a', itemId: 'r', entityCode: 'E', state: 'locked' };
    const b: FinishLineCell = { id: 'b', itemId: 'r', entityCode: 'E', state: 'locked' };
    const c: FinishLineCell = { id: 'c', itemId: 'r', entityCode: 'E', state: 'locked' };
    const deps: FinishLineDep[] = [
      { cellId: a.id, inputId: b.id },
      { cellId: b.id, inputId: c.id },
      { cellId: c.id, inputId: a.id },
    ];
    const context = buildContext([a, b, c], deps, [], []);
    expect(resolveCell(a.id, context)).toBe('cycle');
    // resolveAll walks every cell; a cycle must not poison the shared memo.
    expect(resolveAll(context).size).toBeLessThanOrEqual(3);
  }, 2000);

  it('a self-referencing cell is a cycle, not an infinite descent', () => {
    const a: FinishLineCell = { id: 'a', itemId: 'r', entityCode: 'E', state: 'locked' };
    const context = buildContext([a], [{ cellId: 'a', inputId: 'a' }], [], []);
    expect(resolveCell(a.id, context)).toBe('cycle');
  }, 2000);

  it('a cycle beside healthy cells does not take them down with it', () => {
    const a: FinishLineCell = { id: 'a', itemId: 'r', entityCode: 'E', state: 'locked' };
    const b: FinishLineCell = { id: 'b', itemId: 'r', entityCode: 'E', state: 'locked' };
    const fine: FinishLineCell = { id: 'fine', itemId: 'r', entityCode: 'E', state: 'zero' };
    const deps: FinishLineDep[] = [
      { cellId: a.id, inputId: b.id },
      { cellId: b.id, inputId: a.id },
    ];
    const resolutions = resolveAll(buildContext([a, b, fine], deps, [], []));
    expect(resolutions.get('fine')).toBe('zero');
  }, 2000);
});

// ---------------------------------------------------------------------------
// §9.7 — a forced failed read shows no number
// ---------------------------------------------------------------------------

describe('§9.7 could-not-check never shows a number', () => {
  it('distinguishes a missing relation from a failure from an empty table', () => {
    const missing = readFailure('listOrphanMilestones', { code: '42P01' });
    const broken = readFailure('listOrphanMilestones', {
      code: '42501',
      message: 'permission denied',
    });
    const empty = okRows<OrphanMilestone>([]);

    expect(missing.ok).toBe(false);
    expect(missing.reason).toBe('missing-relation');
    expect(broken.reason).toBe('failed');
    expect(empty.ok).toBe(true);
  });

  it('an EMPTY table and a FAILED read are different card states', () => {
    // This is the whole defect. Before the result type they were both `[]` and
    // the card rendered `0 milestones ... — None` for a read that never ran.
    const fromEmpty = cardState(okRows<OrphanMilestone>([]));
    const fromFailure = cardState(readFailure('listOrphanMilestones', { code: '42P01' }));
    expect(fromEmpty.kind).toBe('confirmed-zero');
    expect(fromFailure.kind).toBe('could-not-check');
    expect(fromEmpty.kind).not.toBe(fromFailure.kind);
  });

  it('carries NO count field on could-not-check — the zero is unrenderable', () => {
    const state = cardState(readThrew('listOrphanMilestones', new Error('network down')));
    expect(state.kind).toBe('could-not-check');
    expect('count' in state).toBe(false);
    expect('rows' in state).toBe(false);
  });

  it('a failed read anywhere behind the matrix makes the derived count unreportable', () => {
    const failure = firstFailure(
      okRows<FinishLineItem>([]),
      readFailure('listFinishLineCells', { code: '42P01' }),
    );
    expect(failure?.reason).toBe('missing-relation');
    const state = derivedCardState(failure, []);
    // Zero rows AND a failure: it must be could-not-check, never confirmed-zero.
    expect(state.kind).toBe('could-not-check');
    expect('count' in state).toBe(false);
  });

  it('rowsOf degrades for computation without ever becoming a reportable zero', () => {
    const failed = readFailure('listFinishLineEdges', { code: '42P01' });
    expect(rowsOf(failed)).toEqual([]);
    // The escape hatch exists, but the card state derived from the SAME result
    // still refuses to report.
    expect(cardState(failed).kind).toBe('could-not-check');
  });
});

// ---------------------------------------------------------------------------
// §6.2 — the filter, and §6.5 — the grouping
// ---------------------------------------------------------------------------

describe('§6.2 unplanned is a filter on the matrix, not a second view', () => {
  const entities: FinishLineEntity[] = [
    { code: 'E1', label: 'E1', order: 1 },
    { code: 'E2', label: 'E2', order: 2 },
  ];
  const items: FinishLineItem[] = [
    { id: 'S', item: 'S', kind: 'section', order: 1 },
    { id: 'gap', item: 'gap', kind: 'metric', parentId: 'S', order: 1 },
    { id: 'calm', item: 'calm', kind: 'metric', parentId: 'S', order: 2 },
  ];
  const cells: FinishLineCell[] = [
    { id: 'c1', itemId: 'gap', entityCode: 'E1', state: 'figure' },
    { id: 'c2', itemId: 'gap', entityCode: 'E2', state: 'zero' },
    { id: 'c3', itemId: 'calm', entityCode: 'E1', state: 'zero' },
    { id: 'c4', itemId: 'calm', entityCode: 'E2', state: 'undefined' },
  ];
  const matrix = buildMatrix(items, cells, entities, resolveAll(buildContext(cells, [], [], [])));

  it('keeps only rows holding a match, and drops emptied sections', () => {
    const filtered = filterMatrix(matrix, 'unplanned');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].rows.map((row) => row.item.id)).toEqual(['gap']);
  });

  it('keeps every column on a matching row — a filtered row is still a row', () => {
    // The flat list made one problem look like n unrelated small ones. A row
    // that dropped its other entities would do the same thing again.
    const filtered = filterMatrix(matrix, 'unplanned');
    expect(filtered[0].rows[0].cells).toHaveLength(2);
    expect(slotMatches(filtered[0].rows[0].cells[0], 'unplanned')).toBe(true);
    expect(slotMatches(filtered[0].rows[0].cells[1], 'unplanned')).toBe(false);
  });

  it('never matches a non-gap-eligible cell, whatever its rollup', () => {
    const locked: FinishLineCell = { id: 'l', itemId: 'gap', entityCode: 'E1', state: 'locked' };
    const input: FinishLineCell = { id: 'i', itemId: 'calm', entityCode: 'E1', state: 'input' };
    const withLock = buildMatrix(
      items,
      [locked, input],
      entities,
      resolveAll(
        buildContext([locked, input], [{ cellId: 'l', inputId: 'i' }], [], []),
      ),
    );
    const summary = summarizeMatrix(withLock);
    // The locked cell inherits `unplanned` and is SHOWN, but it is not counted
    // as a gap — otherwise the headline would drift above the view's number.
    expect(summary.unplanned).toBe(1);
    expect(summary.lockedGaps).toBe(1);
    expect(gapCells(withLock, 'unplanned').map((g) => g.cell.id)).toEqual(['i']);
  });

  it('leaves the matrix untouched under the "all" filter', () => {
    expect(filterMatrix(matrix, 'all')).toBe(matrix);
  });
});

describe('§6.5 orphan milestones group by project', () => {
  const orphan = (projectId: string, title: string): OrphanMilestone => ({
    projectId,
    projectTitle: title,
    milestoneId: nextId(),
    milestoneText: 'm',
    status: 'in-progress',
  });

  it('collapses n rows into one row per project, worst first', () => {
    const rows = [
      orphan('p1', 'One'),
      orphan('p2', 'Two'),
      orphan('p1', 'One'),
      orphan('p1', 'One'),
    ];
    const groups = groupOrphans(rows);
    expect(groups).toHaveLength(2);
    expect(groups[0].projectTitle).toBe('One');
    expect(groups[0].milestones).toHaveLength(3);
    expect(groups[1].milestones).toHaveLength(1);
  });

  it('preserves every row — grouping hides nothing', () => {
    const rows = [orphan('p1', 'One'), orphan('p2', 'Two'), orphan('p3', 'Three')];
    const total = groupOrphans(rows).reduce((sum, g) => sum + g.milestones.length, 0);
    expect(total).toBe(rows.length);
  });

  it('is empty for no rows rather than inventing a group', () => {
    expect(groupOrphans([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §6.4 — the authoring anchor arrives with the existing selection
// ---------------------------------------------------------------------------

describe('§6.4 authoring anchors on the milestone', () => {
  it('re-opening a picker shows the cells already linked', () => {
    const edges: FinishLineEdge[] = [
      { id: 'e1', cellId: 'c1', projectId: 'p1', milestoneId: 'm1' },
      { id: 'e2', cellId: 'c2', projectId: 'p1', milestoneId: 'm1' },
      { id: 'e3', cellId: 'c3', projectId: 'p1', milestoneId: 'm2' },
      { id: 'e4', cellId: 'c4', projectId: 'p2', milestoneId: 'm1' },
    ];
    const selected = cellsForMilestone(edges, 'p1', 'm1');
    expect([...selected].sort()).toEqual(['c1', 'c2']);
  });

  it('is empty for a milestone that closes nothing — not undefined', () => {
    expect(cellsForMilestone([], 'p1', 'm1').size).toBe(0);
  });

  it('offers a checkbox on exactly the gap-eligible cells of a row', () => {
    // One milestone, six cells, one action: the arithmetic that reversed the
    // anchor. A row offers a box per gap-eligible entity and nothing else.
    const entities: FinishLineEntity[] = ['A', 'B', 'C', 'D'].map((code, i) => ({
      code,
      label: code,
      order: i + 1,
    }));
    const cells: FinishLineCell[] = [
      { id: 'a', itemId: 'row', entityCode: 'A', state: 'figure' },
      { id: 'b', itemId: 'row', entityCode: 'B', state: 'figure' },
      { id: 'c', itemId: 'row', entityCode: 'C', state: 'input' },
      { id: 'd', itemId: 'row', entityCode: 'D', state: 'locked' },
    ];
    const offered = cells.filter((cell) => isGapEligible(cell.state)).map((cell) => cell.id);
    expect(offered).toEqual(['a', 'b', 'c']);
    expect(entities).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// §9.3 / §9.5 — no invented states, nothing persisted
// ---------------------------------------------------------------------------

describe('§9.3 the vocabulary is closed', () => {
  it('resolves only to states the model names', () => {
    const allowed = new Set([
      'cycle',
      'unplanned',
      'stuck',
      'in-progress',
      'contradiction',
      'pending',
      'backed',
      'undefined',
      'zero',
    ]);
    const states: CellState[] = ['figure', 'zero', 'undefined', 'input', 'locked'];
    const cells = states.map<FinishLineCell>((state, i) => ({
      id: `c${i}`,
      itemId: 'r',
      entityCode: 'E',
      state,
    }));
    for (const resolution of resolveAll(buildContext(cells, [], [], [])).values()) {
      expect(allowed.has(resolution)).toBe(true);
    }
  });

  it('resolving twice from the same inputs writes nothing and changes nothing', () => {
    // Sub-state and rollup are computed on read. If either were cached or
    // persisted, a second pass over untouched inputs could differ.
    const cells: FinishLineCell[] = [
      { id: 'i', itemId: 'r', entityCode: 'E', state: 'input' },
      { id: 'l', itemId: 'r', entityCode: 'E', state: 'locked' },
    ];
    const deps: FinishLineDep[] = [{ cellId: 'l', inputId: 'i' }];
    const first = resolveAll(buildContext(cells, deps, [], []));
    const second = resolveAll(buildContext(cells, deps, [], []));
    expect([...second.entries()]).toEqual([...first.entries()]);
    // The source cells are untouched by resolution.
    expect(cells.map((cell) => cell.state)).toEqual(['input', 'locked']);
  });
});
