import { describe, expect, it } from 'vitest';
import type { FinishLineCell, FinishLineItem, ScopeGrant } from '../data/types';
import { isCellWritable, sectionOf, writableCellIds } from './cellCapability';

const S1 = 'sec-1';
const S2 = 'sec-2';

const ITEMS: FinishLineItem[] = [
  { id: S1, item: 'Section one', kind: 'section', order: 1 },
  { id: S2, item: 'Section two', kind: 'section', order: 2 },
  { id: 'a1', item: 'A1', kind: 'metric', parentId: S1, order: 3 },
  { id: 'b1', item: 'B1', kind: 'metric', parentId: S2, order: 4 },
  // The D4 case: no parent section, so it resolves to itself.
  { id: 'o1', item: 'Orphan', kind: 'metric', order: 5 },
];

const cell = (id: string, itemId: string, entityCode: string): FinishLineCell =>
  ({ id, itemId, entityCode, state: 'input', actorKind: 'owner' }) as FinishLineCell;

const CELLS = [
  cell('samb-a1', 'a1', 'SAMB'),
  cell('samb-b1', 'b1', 'SAMB'),
  cell('samb-o1', 'o1', 'SAMB'),
  cell('asi-a1', 'a1', 'ASI'),
];

const GRANTS: ScopeGrant[] = [
  { entityCode: 'SAMB', sectionId: S1, capability: 'write' },
  { entityCode: 'SAMB', sectionId: S2, capability: 'read' },
  { entityCode: 'ASI', sectionId: S1, capability: 'read' },
];

describe('sectionOf', () => {
  const byId = new Map(ITEMS.map((i) => [i.id, i]));
  it('resolves a metric to its parent and a parentless metric to itself — the SQL coalesce', () => {
    expect(sectionOf(CELLS[0], byId)).toBe(S1);
    expect(sectionOf(CELLS[2], byId)).toBe('o1');
  });
});

describe('writableCellIds', () => {
  it('mirrors os_member_writable_cells(): write grant on the cell entity and section only', () => {
    const writable = writableCellIds(GRANTS, ITEMS, CELLS);
    expect(writable.has('samb-a1')).toBe(true); // write on (SAMB, S1)
    expect(writable.has('samb-b1')).toBe(false); // read on (SAMB, S2)
    expect(writable.has('asi-a1')).toBe(false); // read on (ASI, S1), the entity matters
    expect(writable.has('samb-o1')).toBe(false); // parentless: no grant can name it
    expect(writable.size).toBe(1);
  });

  it('is empty for a person with no grants — membership alone writes nothing', () => {
    expect(writableCellIds([], ITEMS, CELLS).size).toBe(0);
  });

  it('answers per cell the same way', () => {
    const byId = new Map(ITEMS.map((i) => [i.id, i]));
    expect(isCellWritable(GRANTS, byId, CELLS[0])).toBe(true);
    expect(isCellWritable(GRANTS, byId, CELLS[1])).toBe(false);
  });
});
