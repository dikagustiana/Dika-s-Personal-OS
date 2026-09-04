/**
 * WHICH CELLS A CONTRIBUTOR MAY WRITE — the client's copy of
 * os_member_writable_cells().
 *
 * Since 20260904000095 a contributor's access is a set of (entity, section,
 * capability) grants, and the database decides: a read grant makes the UPDATE
 * match zero rows. That is correct and it is also a terrible first hint — the
 * repository turns zero rows into "Cell not found", which reads as a bug, not
 * as a permission. So the matrix asks the same question up front, from the
 * person's own grant rows (RLS lets them read exactly those), and simply does
 * not offer the editors on a cell they cannot write.
 *
 * COSMETIC GATING ONLY. The join below is the SQL join, restated:
 *   grant.section_id = coalesce(item.parent_id, item.id)
 * so a metric resolves to its section and a parentless metric resolves to
 * itself — which no grant can name, so it is never writable here either. A
 * tampered client changes what renders, never what the trigger and the
 * policy permit.
 */
import type { FinishLineCell, FinishLineItem, ScopeGrant } from '../data/types';

/** The section a cell's metric sits under — or the metric itself when it has none. */
export function sectionOf(cell: FinishLineCell, itemById: Map<string, FinishLineItem>): string {
  return itemById.get(cell.itemId)?.parentId ?? cell.itemId;
}

export function isCellWritable(
  grants: ScopeGrant[],
  itemById: Map<string, FinishLineItem>,
  cell: FinishLineCell,
): boolean {
  const section = sectionOf(cell, itemById);
  return grants.some(
    (grant) =>
      grant.capability === 'write' &&
      grant.entityCode === cell.entityCode &&
      grant.sectionId === section,
  );
}

/** Every writable cell id at once, for a matrix that asks per cell. */
export function writableCellIds(
  grants: ScopeGrant[],
  items: FinishLineItem[],
  cells: FinishLineCell[],
): Set<string> {
  const itemById = new Map(items.map((item) => [item.id, item]));
  return new Set(cells.filter((cell) => isCellWritable(grants, itemById, cell)).map((c) => c.id));
}
