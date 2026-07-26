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

/**
 * The Finish line matrix and the connection layer.
 *
 * Line items down, consolidation entities across; the grain is the CELL. Every
 * cell carries a STATE and never a value — the numbers live in the Excel pack.
 *
 * FINISH LINE IS THE DESTINATION; THE PROJECTS ARE THE ROAD. Nothing here is
 * persisted: sub-states and rollups are computed on every render, deliberately.
 * A stored rollup is a second thing that can disagree with the cells it came
 * from, and it would also be a write path into cell state — which the guard in
 * data/finishLineGuards.ts forbids absolutely.
 *
 * THREE LAYERS OF SEVERITY, IN THIS ORDER AND NEVER THE REVERSE:
 *   milestone status -> `input` cell sub-state -> `locked` cell rollup.
 */

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * What a cell resolves to once the road is taken into account.
 *
 * The four gap sub-states apply to `input` cells; `pending` covers a cell that
 * is waiting but has nothing recorded to wait on (a `locked` cell with no
 * dependency edges); the last three are the non-gap states.
 *
 * `cycle` is a HARD ERROR, surfaced in the UI rather than silently broken — a
 * dependency loop means the seed is wrong, and quietly returning something
 * plausible would hide that.
 */
export type Resolution =
  | 'unplanned'
  | 'stuck'
  | 'in-progress'
  | 'contradiction'
  | 'pending'
  | 'undefined'
  | 'zero'
  | 'figure'
  | 'cycle';

/**
 * Worst first. A cycle outranks everything because it means the data is wrong,
 * and that must not be averaged away behind a plausible-looking rollup.
 */
const SEVERITY: Resolution[] = [
  'cycle',
  'unplanned',
  'stuck',
  'in-progress',
  'contradiction',
  'pending',
  'undefined',
  'zero',
  'figure',
];

const RANK = new Map(SEVERITY.map((state, index) => [state, index]));

export function worst(a: Resolution, b: Resolution): Resolution {
  return (RANK.get(a) ?? 0) <= (RANK.get(b) ?? 0) ? a : b;
}

/** `undefined` is arithmetic, not work outstanding, and never counts as a gap. */
export function isGap(resolution: Resolution): boolean {
  return (
    resolution === 'unplanned' ||
    resolution === 'stuck' ||
    resolution === 'in-progress' ||
    resolution === 'contradiction' ||
    resolution === 'pending'
  );
}

// ---------------------------------------------------------------------------
// Layer 2 — the sub-state of an `input` cell, from its milestones' own status
// ---------------------------------------------------------------------------

export interface ResolvedEdge {
  edge: FinishLineEdge;
  project?: Project;
  milestone?: Milestone;
  /** The milestone id no longer exists in the project's array. */
  broken: boolean;
}

export function resolveEdges(
  edges: FinishLineEdge[],
  projectsById: Map<string, Project>,
): ResolvedEdge[] {
  return edges.map((edge) => {
    const project = projectsById.get(edge.projectId);
    const milestone = edge.milestoneId
      ? project?.milestones.find((m) => m.id === edge.milestoneId)
      : undefined;
    return {
      edge,
      project,
      milestone,
      // A dangling id is NAMED, never silently dropped.
      broken: edge.milestoneId !== undefined && milestone === undefined,
    };
  });
}

/**
 * `input` is the ONLY state a milestone can close, so this is the only place a
 * milestone's status reaches the matrix.
 *
 * `contradiction` — every linked milestone done, cell still `input` — is a
 * prompt for a human and nothing more. It NEVER flips the cell state; that
 * rule lives in the mutation path, in finishLineGuards.
 */
export function inputSubState(resolved: ResolvedEdge[]): Resolution {
  // A broken edge is not coverage. Counting it would tell the owner the cell
  // is planned when the milestone behind it was deleted.
  const live = resolved.filter((r) => !r.broken && r.milestone !== undefined);
  const projectLevel = resolved.filter((r) => r.edge.milestoneId === undefined && r.project);

  if (live.length === 0 && projectLevel.length === 0) return 'unplanned';
  // A project-level link with no milestone-level ones is a declared intention
  // without a step: in progress, not stuck and not unplanned.
  if (live.length === 0) return 'in-progress';

  if (live.every((r) => r.milestone?.done)) return 'contradiction';
  if (live.every((r) => r.milestone?.status === 'blocked')) return 'stuck';
  return 'in-progress';
}

// ---------------------------------------------------------------------------
// Layer 3 — the rollup on a `locked` cell
// ---------------------------------------------------------------------------

export interface ResolveContext {
  cellsById: Map<string, FinishLineCell>;
  /** cell id -> its input cell ids. */
  depsByCell: Map<string, string[]>;
  /** cell id -> the edges pointing at it. */
  edgesByCell: Map<string, FinishLineEdge[]>;
  projectsById: Map<string, Project>;
}

export function buildContext(
  cells: FinishLineCell[],
  deps: FinishLineDep[],
  edges: FinishLineEdge[],
  projects: Project[],
): ResolveContext {
  const depsByCell = new Map<string, string[]>();
  for (const dep of deps) {
    const existing = depsByCell.get(dep.cellId);
    if (existing) existing.push(dep.inputId);
    else depsByCell.set(dep.cellId, [dep.inputId]);
  }
  const edgesByCell = new Map<string, FinishLineEdge[]>();
  for (const edge of edges) {
    const existing = edgesByCell.get(edge.cellId);
    if (existing) existing.push(edge);
    else edgesByCell.set(edge.cellId, [edge]);
  }
  return {
    cellsById: new Map(cells.map((cell) => [cell.id, cell])),
    depsByCell,
    edgesByCell,
    projectsById: new Map(projects.map((project) => [project.id, project])),
  };
}

/**
 * Resolves one cell, recursing through `locked` dependencies.
 *
 * RECURSIVE WITH CYCLE PROTECTION, because Cash conversion cycle depends on
 * DSO/DIO/DPO which are themselves locked. `seen` is the path currently being
 * walked, so a cell revisited on its own path is a cycle; `memo` caches
 * settled answers so a diamond (two locked cells sharing an input) is walked
 * once.
 *
 * This is what makes the feature worth building: one missing input at the
 * bottom of Volume & capacity makes the whole of Unit economics read as a gap
 * without anyone writing that down.
 */
export function resolveCell(
  cellId: string,
  context: ResolveContext,
  memo: Map<string, Resolution> = new Map(),
  seen: Set<string> = new Set(),
): Resolution {
  const cached = memo.get(cellId);
  if (cached) return cached;
  if (seen.has(cellId)) return 'cycle';

  const cell = context.cellsById.get(cellId);
  if (!cell) return 'pending';

  let result: Resolution;
  switch (cell.state) {
    case 'figure':
    case 'zero':
    case 'undefined':
      result = cell.state;
      break;
    case 'input':
      result = inputSubState(
        resolveEdges(context.edgesByCell.get(cellId) ?? [], context.projectsById),
      );
      break;
    case 'locked': {
      const inputs = context.depsByCell.get(cellId) ?? [];
      if (inputs.length === 0) {
        // Waiting, but with nothing recorded to wait on. Not a silent pass.
        result = 'pending';
        break;
      }
      const next = new Set(seen).add(cellId);
      const resolutions = inputs.map((inputId) => resolveCell(inputId, context, memo, next));
      // If every input is arithmetic or nil, so is this — and not a gap.
      result = resolutions.every((r) => r === 'zero' || r === 'undefined')
        ? 'undefined'
        : resolutions.reduce(worst, 'figure');
      break;
    }
  }

  // A cycle result is path-dependent, so it must not be cached as settled.
  if (result !== 'cycle') memo.set(cellId, result);
  return result;
}

/** Resolves every cell once, sharing the memo. */
export function resolveAll(context: ResolveContext): Map<string, Resolution> {
  const memo = new Map<string, Resolution>();
  for (const cellId of context.cellsById.keys()) resolveCell(cellId, context, memo);
  return memo;
}

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

export interface MatrixCell {
  entity: FinishLineEntity;
  /** Absent when the seed wrote no cell here — a DATA GAP, not a state. */
  cell?: FinishLineCell;
  resolution?: Resolution;
}

export interface MatrixRow {
  item: FinishLineItem;
  cells: MatrixCell[];
}

export interface MatrixSection {
  section: FinishLineItem;
  rows: MatrixRow[];
  /** Sections holding a gap arrive open; the rest arrive collapsed. */
  defaultOpen: boolean;
}

export function buildMatrix(
  items: FinishLineItem[],
  cells: FinishLineCell[],
  entities: FinishLineEntity[],
  resolutions?: Map<string, Resolution>,
): MatrixSection[] {
  const columns = [...entities].sort((a, b) => a.order - b.order);
  const byKey = new Map(cells.map((cell) => [`${cell.itemId}:${cell.entityCode}`, cell]));

  return items
    .filter((item) => item.kind === 'section')
    .sort((a, b) => a.order - b.order)
    .map((section) => {
      const rows = items
        .filter((item) => item.parentId === section.id && item.kind !== 'section')
        .sort((a, b) => a.order - b.order)
        .map<MatrixRow>((item) => ({
          item,
          // A note row carries no cells: it is a sentence in the document.
          cells:
            item.kind === 'note'
              ? []
              : columns.map((entity) => {
                  const cell = byKey.get(`${item.id}:${entity.code}`);
                  if (!cell) return { entity };
                  const resolution = resolutions?.get(cell.id);
                  return resolution ? { entity, cell, resolution } : { entity, cell };
                }),
        }));

      return {
        section,
        rows,
        defaultOpen: rows.some((row) =>
          row.cells.some((slot) => slot.resolution !== undefined && isGap(slot.resolution)),
        ),
      };
    });
}

export interface MatrixSummary {
  totalCells: number;
  /** Cells with no record at all — a seed that missed an entity. */
  missing: number;
  gaps: number;
  unplanned: number;
  stuck: number;
  cycles: number;
}

export function summarizeMatrix(sections: MatrixSection[]): MatrixSummary {
  const summary: MatrixSummary = {
    totalCells: 0,
    missing: 0,
    gaps: 0,
    unplanned: 0,
    stuck: 0,
    cycles: 0,
  };
  for (const section of sections) {
    for (const row of section.rows) {
      for (const slot of row.cells) {
        summary.totalCells += 1;
        if (!slot.cell) {
          summary.missing += 1;
          continue;
        }
        const r = slot.resolution;
        if (r === undefined) continue;
        if (isGap(r)) summary.gaps += 1;
        if (r === 'unplanned') summary.unplanned += 1;
        if (r === 'stuck') summary.stuck += 1;
        if (r === 'cycle') summary.cycles += 1;
      }
    }
  }
  return summary;
}

/** Every section id an item sits under, for expanding on a deep link. */
export function ancestorPath(items: FinishLineItem[], itemId: string): string[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const path: string[] = [];
  let current = byId.get(itemId);
  for (let guard = 0; current && guard <= byId.size; guard += 1) {
    if (current.kind === 'section') path.push(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

/**
 * How each state renders when it has no resolution to show.
 *
 * `zero` and `locked` MUST differ — they rendered identically in the old mock,
 * which made "reported nil" and "waiting on its inputs" look like the same
 * fact. A test asserts the difference so it cannot regress.
 */
export const STATE_GLYPH: Record<CellState, string> = {
  figure: 'xxx',
  zero: '–',
  undefined: '',
  input: '',
  locked: '·',
};

// ---------------------------------------------------------------------------
// The project -> pack direction
// ---------------------------------------------------------------------------

/** Cell ids this project's milestones close. */
export function cellsClosedByProject(edges: FinishLineEdge[], projectId: string): Set<string> {
  const ids = new Set<string>();
  for (const edge of edges) if (edge.projectId === projectId) ids.add(edge.cellId);
  return ids;
}

/**
 * Cell count per milestone id. A milestone that closes nothing is absent from
 * the map and the card renders `0` plainly — the zero is never hidden.
 */
export function cellsByMilestone(edges: FinishLineEdge[], projectId: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const edge of edges) {
    if (edge.projectId !== projectId || !edge.milestoneId) continue;
    counts.set(edge.milestoneId, (counts.get(edge.milestoneId) ?? 0) + 1);
  }
  return counts;
}
