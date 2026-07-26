import type {
  CellState,
  FinishLineCell,
  FinishLineEntity,
  FinishLineItem,
} from '../data/types';

/**
 * Derivations for the Finish line entity matrix.
 *
 * Line items down, consolidation entities across; the grain is the CELL, one
 * (line item x entity) pair. Every cell carries a STATE and never a value —
 * the numbers live in the Excel pack and do not enter this app.
 *
 * `figure` means A NUMBER EXISTS. It does not mean verified, agreed or
 * trusted, and nothing here may present it as though it did.
 *
 * Nothing is stored that could be derived: section membership comes from
 * `parentId`, column order from the entities table, row order from
 * `sort_order`. There is no rank, no score, and no computed aggregate — `agg`
 * records how a future aggregate column WOULD compute and nothing reads it yet.
 */

/** A cell resolved against the entity column it belongs to. */
export interface MatrixCell {
  entity: FinishLineEntity;
  /**
   * Absent when the seed never wrote a cell for this (row, entity). That is a
   * DATA GAP, not a state: it renders as a gap and is counted by
   * `missingCells` so a row silently missing an entity is visible rather than
   * looking like an empty-by-design cell.
   */
  cell?: FinishLineCell;
}

export interface MatrixRow {
  item: FinishLineItem;
  /** One entry per entity, in column order. Never sparse. */
  cells: MatrixCell[];
}

export interface MatrixSection {
  section: FinishLineItem;
  rows: MatrixRow[];
  /**
   * Sections holding a cell that needs an input arrive open; the rest arrive
   * collapsed. `input` is the only state a person can act on today — `locked`
   * is waiting on those inputs and `undefined` is arithmetic.
   */
  defaultOpen: boolean;
}

export interface MatrixSummary {
  figure: number;
  zero: number;
  undefinedCells: number;
  input: number;
  locked: number;
  /** (row, entity) pairs with no cell at all. Should be 0 after a clean seed. */
  missing: number;
  totalCells: number;
}

const cellKey = (itemId: string, entityCode: string) => `${itemId}:${entityCode}`;

/**
 * Groups metric and note rows under their section, resolving every row across
 * every entity column.
 *
 * Rows whose `parentId` names no section are dropped rather than floated to
 * the top: the matrix is the pack's own structure, and a row outside it is
 * data corruption, not a row to invent a home for.
 */
export function buildMatrix(
  items: FinishLineItem[],
  cells: FinishLineCell[],
  entities: FinishLineEntity[],
): MatrixSection[] {
  const columns = [...entities].sort((a, b) => a.order - b.order);
  const byKey = new Map(cells.map((cell) => [cellKey(cell.itemId, cell.entityCode), cell]));

  const sections = items
    .filter((item) => item.kind === 'section')
    .sort((a, b) => a.order - b.order);

  return sections.map((section) => {
    const rows = items
      .filter((item) => item.parentId === section.id && item.kind !== 'section')
      .sort((a, b) => a.order - b.order)
      .map<MatrixRow>((item) => ({
        item,
        // A note row carries no cells by design — it is a sentence in the
        // document, not a measured line.
        cells:
          item.kind === 'note'
            ? []
            : columns.map((entity) => {
                const cell = byKey.get(cellKey(item.id, entity.code));
                return cell ? { entity, cell } : { entity };
              }),
      }));

    return {
      section,
      rows,
      defaultOpen: rows.some((row) =>
        row.cells.some((cell) => cell.cell?.state === 'input'),
      ),
    };
  });
}

export function summarizeMatrix(sections: MatrixSection[]): MatrixSummary {
  const summary: MatrixSummary = {
    figure: 0,
    zero: 0,
    undefinedCells: 0,
    input: 0,
    locked: 0,
    missing: 0,
    totalCells: 0,
  };
  for (const section of sections) {
    for (const row of section.rows) {
      for (const slot of row.cells) {
        summary.totalCells += 1;
        if (!slot.cell) {
          summary.missing += 1;
          continue;
        }
        if (slot.cell.state === 'undefined') summary.undefinedCells += 1;
        else summary[slot.cell.state] += 1;
      }
    }
  }
  return summary;
}

/**
 * The links that close one cell.
 *
 * A link with no `entityCode` is row-level and therefore closes this cell too;
 * a link naming a different entity does not. Both directions matter: the
 * project side of the app deep-links here, and it must land on the same set.
 */
export function linksForCell(item: FinishLineItem, entityCode: string) {
  return item.links.filter(
    (link) => link.entityCode === undefined || link.entityCode === entityCode,
  );
}

/** Every section id an item sits under, for expanding on a deep link. */
export function ancestorPath(items: FinishLineItem[], itemId: string): string[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const path: string[] = [];
  let current = byId.get(itemId);
  // Bounded by the map size so a cycle in the data cannot hang the render.
  for (let guard = 0; current && guard <= byId.size; guard += 1) {
    if (current.kind === 'section') path.push(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

/** Rows in a section that carry at least one cell needing an input. */
export function needsInput(section: MatrixSection): MatrixRow[] {
  return section.rows.filter((row) =>
    row.cells.some((cell) => cell.cell?.state === 'input'),
  );
}

/**
 * How a state renders. Kept here rather than in the view so the `zero` /
 * `locked` distinction cannot drift: they rendered identically once, which
 * made "reported nil" and "waiting on its inputs" look like the same fact.
 */
export const STATE_GLYPH: Record<CellState, string> = {
  figure: 'xxx',
  zero: '–',
  undefined: '',
  input: '',
  locked: '·',
};

// ---------------------------------------------------------------------------
// The reverse direction: project -> matrix
//
// Preserved from the pack build and REPOINTED AT CELLS. A project card answers
// "why does this project matter" with the pack lines its milestones would
// unblock; in the matrix that answer carries the entities as well, because the
// same line item can be closed for one entity and untouched for another.
// ---------------------------------------------------------------------------

export interface TrustLine {
  item: FinishLineItem;
  /** Ancestor labels, root first — the section path. */
  path: string[];
  /**
   * The entity codes this project's links name. EMPTY means the links are
   * row-level, i.e. they close the line for every entity — which is a
   * different claim from naming none, and the card says which.
   */
  entityCodes: string[];
  /**
   * How many of THIS project's milestones are linked — RESOLVED ones only. A
   * dangling id is counted under `brokenLinks` instead: saying "2 milestones
   * here" when one was deleted is the looks-owned failure the broken-link
   * state exists to prevent.
   */
  milestonesLinked: number;
  brokenLinks: number;
  /** A project-level link (no milestone) also exists. */
  projectLevel: boolean;
}

/**
 * The matrix rows this project's work would close. Returns [] when nothing is
 * linked, and the card renders NOTHING in that case — no empty state, no
 * prompt. Most projects have no links at first, and 21 cards each carrying an
 * empty invitation is noise.
 */
export function linesForProject(
  items: FinishLineItem[],
  project: { id: string; milestones: { id: string }[] },
): TrustLine[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const milestoneIds = new Set(project.milestones.map((milestone) => milestone.id));
  const result: TrustLine[] = [];

  for (const item of items) {
    if (item.kind !== 'metric') continue;
    const mine = item.links.filter((link) => link.projectId === project.id);
    if (mine.length === 0) continue;

    const path: string[] = [];
    let cursor = item.parentId ? byId.get(item.parentId) : undefined;
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor.id)) {
      guard.add(cursor.id);
      path.unshift(cursor.item);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }

    const milestoneLevel = mine.filter((link) => link.milestoneId !== undefined);
    result.push({
      item,
      path,
      entityCodes: [
        ...new Set(
          mine
            .map((link) => link.entityCode)
            .filter((code): code is string => code !== undefined),
        ),
      ],
      milestonesLinked: milestoneLevel.filter(
        (link) => link.milestoneId !== undefined && milestoneIds.has(link.milestoneId),
      ).length,
      brokenLinks: milestoneLevel.filter(
        (link) => link.milestoneId !== undefined && !milestoneIds.has(link.milestoneId),
      ).length,
      projectLevel: mine.some((link) => link.milestoneId === undefined),
    });
  }
  return result;
}

/** Milestone ids of this project that any matrix row links to. */
export function linkedMilestoneIds(items: FinishLineItem[], projectId: string): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    for (const link of item.links) {
      if (link.projectId === projectId && link.milestoneId) ids.add(link.milestoneId);
    }
  }
  return ids;
}
