import { describe, expect, it } from 'vitest';
import type {
  CellState,
  FinishLineCell,
  FinishLineEntity,
  FinishLineItem,
} from '../data/types';
import {
  ancestorPath,
  buildMatrix,
  linksForCell,
  needsInput,
  STATE_GLYPH,
  summarizeMatrix,
} from './finishLine';

// Placeholder structure only. The real matrix names consolidation entities and
// pack line items, and it is seeded into the database, never into this repo.
// THERE ARE NO FIGURES ANYWHERE IN THIS FILE and none may be added: a cell
// carries a state, and the numbers live in Excel.

const ENTITIES: FinishLineEntity[] = [
  { code: 'E1', label: 'E1', order: 1 },
  { code: 'E2', label: 'E2', order: 2 },
  { code: 'E3', label: 'E3', order: 3 },
];

function item(overrides: Partial<FinishLineItem> & { id: string }): FinishLineItem {
  return { item: overrides.id, kind: 'metric', order: 1, links: [], ...overrides };
}

function cell(itemId: string, entityCode: string, state: CellState, note?: string): FinishLineCell {
  return note ? { itemId, entityCode, state, note } : { itemId, entityCode, state };
}

const section = (id: string, order = 1) => item({ id, kind: 'section', order });

describe('buildMatrix', () => {
  it('resolves every row across every entity column, in column order', () => {
    const items = [section('s1'), item({ id: 'm1', parentId: 's1' })];
    const cells = [
      cell('m1', 'E2', 'zero'),
      cell('m1', 'E1', 'figure'),
      cell('m1', 'E3', 'input'),
    ];
    const [built] = buildMatrix(items, cells, ENTITIES);
    expect(built.rows[0].cells.map((c) => c.entity.code)).toEqual(['E1', 'E2', 'E3']);
    expect(built.rows[0].cells.map((c) => c.cell?.state)).toEqual(['figure', 'zero', 'input']);
  });

  it('respects entity sort_order rather than array order', () => {
    const shuffled = [...ENTITIES].reverse();
    const [built] = buildMatrix(
      [section('s1'), item({ id: 'm1', parentId: 's1' })],
      [cell('m1', 'E1', 'figure')],
      shuffled,
    );
    expect(built.rows[0].cells.map((c) => c.entity.code)).toEqual(['E1', 'E2', 'E3']);
  });

  it('leaves a gap — not a state — where the seed wrote no cell', () => {
    const [built] = buildMatrix(
      [section('s1'), item({ id: 'm1', parentId: 's1' })],
      [cell('m1', 'E1', 'figure')],
      ENTITIES,
    );
    expect(built.rows[0].cells[1].cell).toBeUndefined();
    expect(summarizeMatrix([built]).missing).toBe(2);
  });

  it('gives a note row no cells at all', () => {
    const [built] = buildMatrix(
      [section('s1'), item({ id: 'n1', parentId: 's1', kind: 'note' })],
      [],
      ENTITIES,
    );
    expect(built.rows[0].cells).toEqual([]);
  });

  it('orders sections and rows by their own sort_order', () => {
    const items = [
      section('s2', 2),
      section('s1', 1),
      item({ id: 'b', parentId: 's1', order: 2 }),
      item({ id: 'a', parentId: 's1', order: 1 }),
    ];
    const built = buildMatrix(items, [], ENTITIES);
    expect(built.map((s) => s.section.id)).toEqual(['s1', 's2']);
    expect(built[0].rows.map((r) => r.item.id)).toEqual(['a', 'b']);
  });

  it('drops a row whose parent names no section rather than floating it', () => {
    const built = buildMatrix(
      [section('s1'), item({ id: 'orphan', parentId: 'gone' })],
      [],
      ENTITIES,
    );
    expect(built).toHaveLength(1);
    expect(built[0].rows).toEqual([]);
  });

  it('opens a section holding an input cell and collapses one without', () => {
    const items = [
      section('s1', 1),
      item({ id: 'm1', parentId: 's1' }),
      section('s2', 2),
      item({ id: 'm2', parentId: 's2' }),
    ];
    const cells = [cell('m1', 'E1', 'input'), cell('m2', 'E1', 'locked')];
    const built = buildMatrix(items, cells, ENTITIES);
    expect(built[0].defaultOpen).toBe(true);
    expect(built[1].defaultOpen).toBe(false);
  });
});

describe('cell states', () => {
  it('renders zero and locked differently — they are not the same fact', () => {
    expect(STATE_GLYPH.zero).not.toBe(STATE_GLYPH.locked);
    expect(STATE_GLYPH.zero).toBe('–');
    expect(STATE_GLYPH.locked).toBe('·');
  });

  it('renders a figure as xxx — the number stays in Excel', () => {
    expect(STATE_GLYPH.figure).toBe('xxx');
  });

  it('has exactly five states and no verified/trusted among them', () => {
    const states = Object.keys(STATE_GLYPH);
    expect(states.sort()).toEqual(['figure', 'input', 'locked', 'undefined', 'zero']);
  });
});

describe('summarizeMatrix', () => {
  it('counts every state separately', () => {
    const items = [section('s1'), item({ id: 'm1', parentId: 's1' })];
    const cells = [
      cell('m1', 'E1', 'figure'),
      cell('m1', 'E2', 'undefined'),
      cell('m1', 'E3', 'locked'),
    ];
    const s = summarizeMatrix(buildMatrix(items, cells, ENTITIES));
    expect(s).toEqual({
      figure: 1,
      zero: 0,
      undefinedCells: 1,
      input: 0,
      locked: 1,
      missing: 0,
      totalCells: 3,
    });
  });
});

describe('linksForCell', () => {
  it('includes row-level links and excludes links naming another entity', () => {
    const row = item({
      id: 'm1',
      links: [
        { id: 'l1', projectId: 'p1' },
        { id: 'l2', projectId: 'p2', entityCode: 'E1' },
        { id: 'l3', projectId: 'p3', entityCode: 'E2' },
      ],
    });
    expect(linksForCell(row, 'E1').map((l) => l.id)).toEqual(['l1', 'l2']);
    expect(linksForCell(row, 'E3').map((l) => l.id)).toEqual(['l1']);
  });
});

describe('ancestorPath', () => {
  it('returns the section a row sits under, for the deep link', () => {
    const items = [section('s1'), item({ id: 'm1', parentId: 's1' })];
    expect(ancestorPath(items, 'm1')).toEqual(['s1']);
  });

  it('terminates on a cycle instead of hanging the render', () => {
    const items = [
      item({ id: 'a', parentId: 'b', kind: 'section' }),
      item({ id: 'b', parentId: 'a', kind: 'section' }),
    ];
    expect(() => ancestorPath(items, 'a')).not.toThrow();
  });
});

describe('needsInput', () => {
  it('lists only the rows a person can act on today', () => {
    const items = [
      section('s1'),
      item({ id: 'actionable', parentId: 's1', order: 1 }),
      item({ id: 'waiting', parentId: 's1', order: 2 }),
    ];
    const cells = [cell('actionable', 'E1', 'input'), cell('waiting', 'E1', 'locked')];
    const [built] = buildMatrix(items, cells, ENTITIES);
    expect(needsInput(built).map((r) => r.item.id)).toEqual(['actionable']);
  });
});
