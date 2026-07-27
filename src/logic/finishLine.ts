import { isGapEligible } from '../data/finishLineGuards';
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
 *   milestone status -> gap-eligible cell sub-state -> `locked` cell rollup.
 *
 * `figure` IS NOT TERMINAL. It resolves through layer 2 exactly as `input`
 * does — a number whose method nothing attests has not reached the target
 * state, and it renders `xxx`, which reads as finished. See
 * data/finishLineGuards.isGapEligible for the one predicate that decides this.
 */

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * What a cell resolves to once the road is taken into account.
 *
 * The gap sub-states apply to every GAP-ELIGIBLE cell — `figure` as well as
 * `input`, see data/finishLineGuards.isGapEligible. `pending` covers a cell
 * that is waiting but has nothing recorded to wait on (a `locked` cell with no
 * dependency edges). `backed`, `undefined` and `zero` are the non-gap ones.
 *
 * THERE IS NO `figure` RESOLUTION. A `figure` cell is not terminal: it
 * resolves through the same sub-state machinery as an `input` cell, because a
 * number with nothing behind it has not reached the target state either.
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
  | 'backed'
  | 'undefined'
  | 'zero'
  | 'cycle';

/**
 * Worst first. A cycle outranks everything because it means the data is wrong,
 * and that must not be averaged away behind a plausible-looking rollup.
 *
 * ===========================================================================
 * THE ORDER CHANGED, AND `figure` IS NO LONGER THE SAFE END.
 * ===========================================================================
 * The earlier order ended `... > undefined > zero > figure`, treating a figure
 * as the safest possible resolution. Under the corrected model an UNBACKED
 * figure is a gap, so it cannot sit at the safe end — and it is not a
 * resolution at all any more. `backed` takes that slot: every linked milestone
 * done, the ONLY resolution that is actually finished.
 *
 * `pending` and `cycle` are not named in the specified order because they are
 * data defects rather than states of the work. They are inserted without
 * disturbing any stated pair: `cycle` above everything, `pending` between
 * `contradiction` and `backed`.
 *
 * A wrong order here is SILENT: it still renders, still produces plausible
 * colours, and is only detectable by tracing a cell by hand. The trace is
 * `Cash conversion cycle` / SAMB — locked over DSO/DIO/DPO, themselves locked
 * over unbacked leaves — which must read `unplanned` while no edges exist.
 */
const SEVERITY: Resolution[] = [
  'cycle',
  'unplanned',
  'stuck',
  'in-progress',
  'contradiction',
  'pending',
  'backed',
  'undefined',
  'zero',
];

const RANK = new Map(SEVERITY.map((state, index) => [state, index]));

export function worst(a: Resolution, b: Resolution): Resolution {
  return (RANK.get(a) ?? 0) <= (RANK.get(b) ?? 0) ? a : b;
}

/**
 * `backed` is finished, `undefined` is arithmetic and `zero` is deferred —
 * none of the three is work outstanding.
 */
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
 * The sub-state of a GAP-ELIGIBLE cell, from its milestones' own status.
 *
 * Takes the cell state as well as the edges because ONE branch depends on it:
 * every linked milestone done is `contradiction` on an `input` (the number
 * still does not exist, so the work and the pack disagree) and `backed` on a
 * `figure` (the number exists and work now stands behind it — that is the
 * goal, not a contradiction). Everything else is identical for both.
 *
 * `contradiction` is a prompt for a human and nothing more. It NEVER flips the
 * cell state; that rule lives in the mutation path, in finishLineGuards.
 */
export function cellSubState(state: CellState, resolved: ResolvedEdge[]): Resolution {
  // A broken edge is not coverage. Counting it would tell the owner the cell
  // is planned when the milestone behind it was deleted. THE VIEW DOES THE
  // SAME — a client that differed here would disagree with the count it is
  // supposed to match, and the client would be the wrong one.
  const live = resolved.filter((r) => !r.broken && r.milestone !== undefined);
  const projectLevel = resolved.filter((r) => r.edge.milestoneId === undefined && r.project);

  if (live.length === 0 && projectLevel.length === 0) return 'unplanned';
  // A project-level link with no milestone-level ones is a declared intention
  // without a step: in progress, not stuck and not unplanned.
  if (live.length === 0) return 'in-progress';

  if (live.every((r) => r.milestone?.done)) return state === 'input' ? 'contradiction' : 'backed';
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
  if (isGapEligible(cell.state)) {
    // `figure` AND `input`. A figure is not terminal — the number existing
    // says nothing about whether its method is sound, and only work standing
    // behind it does.
    result = cellSubState(
      cell.state,
      resolveEdges(context.edgesByCell.get(cellId) ?? [], context.projectsById),
    );
  } else if (cell.state === 'locked') {
    const inputs = context.depsByCell.get(cellId) ?? [];
    if (inputs.length === 0) {
      // Waiting, but with nothing recorded to wait on. Not a silent pass.
      result = 'pending';
    } else {
      const next = new Set(seen).add(cellId);
      const resolutions = inputs.map((inputId) => resolveCell(inputId, context, memo, next));
      // If every input is arithmetic or nil, so is this — and not a gap.
      // `backed` is the seed because it is now the safest resolution: reducing
      // from anything worse would make a fully-backed locked cell read as a gap.
      result = resolutions.every((r) => r === 'zero' || r === 'undefined')
        ? 'undefined'
        : resolutions.reduce(worst, 'backed');
    }
  } else {
    // `zero` and `undefined` are the only terminal states left — and the
    // compiler knows it, because isGapEligible is a type predicate. If `zero`
    // is ever moved into the gap-eligible set this branch narrows to
    // `undefined` alone and nothing else here needs touching.
    result = cell.state;
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
  /**
   * Cells whose state needs work behind it (`figure` or `input`). This is the
   * population `os_finish_line_unplanned` draws from: 136 today, not 44.
   */
  gapEligible: number;
  /**
   * Gap-eligible cells resolving to a gap. THE NUMBER THAT MUST MATCH THE VIEW.
   *
   * Locked cells are deliberately EXCLUDED even when their rollup is a gap.
   * The view counts only `state in ('figure','input')`, so folding locked
   * rollups in here would produce a headline above 136 that still looked
   * entirely plausible — the exact shape of failure this feature exists to
   * stop. A locked cell's amber is a consequence of a gap counted elsewhere,
   * never a gap of its own.
   */
  gaps: number;
  unplanned: number;
  stuck: number;
  /** Every linked milestone done. The only resolution that is finished. */
  backed: number;
  /** Locked cells inheriting a gap from their inputs. Shown, never counted. */
  lockedGaps: number;
  cycles: number;
}

export function summarizeMatrix(sections: MatrixSection[]): MatrixSummary {
  const summary: MatrixSummary = {
    totalCells: 0,
    missing: 0,
    gapEligible: 0,
    gaps: 0,
    unplanned: 0,
    stuck: 0,
    backed: 0,
    lockedGaps: 0,
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
        if (r === 'cycle') summary.cycles += 1;

        if (!isGapEligible(slot.cell.state)) {
          if (isGap(r)) summary.lockedGaps += 1;
          continue;
        }
        summary.gapEligible += 1;
        if (isGap(r)) summary.gaps += 1;
        if (r === 'unplanned') summary.unplanned += 1;
        if (r === 'stuck') summary.stuck += 1;
        if (r === 'backed') summary.backed += 1;
      }
    }
  }
  return summary;
}

// ---------------------------------------------------------------------------
// The filter — one matrix, not a second view
// ---------------------------------------------------------------------------

/**
 * `unplanned` and `stuck` need different responses and so are filtered apart:
 * unplanned means no road exists and a milestone must be created; stuck means
 * a road exists and is blocked, and one must be unblocked.
 */
export type MatrixFilter = 'all' | 'unplanned' | 'stuck';

/** Does this slot match the filter? Gap-eligible only — locked never matches. */
export function slotMatches(slot: MatrixCell, filter: MatrixFilter): boolean {
  if (filter === 'all') return true;
  if (!slot.cell || !isGapEligible(slot.cell.state)) return false;
  return slot.resolution === filter;
}

/**
 * The matrix narrowed to rows holding a match, with empty sections dropped.
 *
 * Rows keep ALL their cells, not just the matching ones — a filtered row that
 * hid its other four entities would stop being a row of the pack and start
 * being a list entry, which is precisely the failure the flat "Unplanned
 * cells" card had: it made one problem look like 44 unrelated small ones.
 */
export function filterMatrix(
  sections: MatrixSection[],
  filter: MatrixFilter,
): MatrixSection[] {
  if (filter === 'all') return sections;
  return sections
    .map((section) => ({
      ...section,
      rows: section.rows.filter((row) => row.cells.some((slot) => slotMatches(slot, filter))),
      defaultOpen: true,
    }))
    .filter((section) => section.rows.length > 0);
}

export interface UnplannedCell {
  cell: FinishLineCell;
  item: FinishLineItem;
  entity: FinishLineEntity;
  resolution: Resolution;
}

/**
 * The flat gap population, for counting and for the project -> pack link.
 *
 * Gap-eligible cells only, so `length` is directly comparable with
 * `os_finish_line_unplanned` when `filter` is 'unplanned'.
 */
export function gapCells(
  sections: MatrixSection[],
  filter: Exclude<MatrixFilter, 'all'> | 'any' = 'any',
): UnplannedCell[] {
  const out: UnplannedCell[] = [];
  for (const section of sections) {
    for (const row of section.rows) {
      for (const slot of row.cells) {
        if (!slot.cell || !slot.resolution) continue;
        if (!isGapEligible(slot.cell.state)) continue;
        const matches = filter === 'any' ? isGap(slot.resolution) : slot.resolution === filter;
        if (!matches) continue;
        out.push({
          cell: slot.cell,
          item: row.item,
          entity: slot.entity,
          resolution: slot.resolution,
        });
      }
    }
  }
  return out;
}

/**
 * Gap-eligible counts per entity column.
 *
 * Exists so the census can be asserted per column rather than only in total:
 * a total of 136 is reachable by more than one wrong predicate, but the
 * per-column decomposition is not. Including `zero` sends KDU from 8 to 30;
 * excluding `figure` sends SAMB from 37 to 8.
 */
export function gapsByEntity(sections: MatrixSection[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const gap of gapCells(sections)) {
    counts.set(gap.entity.code, (counts.get(gap.entity.code) ?? 0) + 1);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// The entity level — one entity's column, and its two mirror lists
// ---------------------------------------------------------------------------

/**
 * One entity's unplanned cells — the same population as the group filter,
 * narrowed to a column. DERIVED, NEVER STORED: this list and *Closes nothing*
 * are mirrors, and one link removes a row from both at once precisely because
 * neither is a second source of truth.
 */
export function unplannedForEntity(
  sections: MatrixSection[],
  entityCode: string,
): UnplannedCell[] {
  return gapCells(sections, 'unplanned').filter((gap) => gap.entity.code === entityCode);
}

/**
 * *Closes nothing*, per entity: milestones belonging to THIS entity's tagged
 * projects that close no cell.
 *
 * A milestone that closes no cell has no entity attribution by any other
 * route — deriving it from the linked cell is circular, since the whole point
 * is milestones with NO linked cell. So attribution rides on
 * `Project.entityTag`, and when no project carries this entity's tag the
 * caller must render an explanatory row, NOT an empty state: a false zero
 * here reports perfect coverage on an entity that may have dozens of
 * unplanned cells.
 */
export interface EntityClosesNothing {
  /** Projects tagged to this entity. Empty means NOTHING CAN BE ATTRIBUTED. */
  tagged: Project[];
  /** Orphan milestones of those projects, grouped by project, worst first. */
  groups: OrphanGroup[];
  /** Orphan milestone count across the groups. Meaningless when tagged is empty. */
  count: number;
}

export function closesNothingForEntity(
  orphans: OrphanMilestone[],
  projects: Project[],
  entityCode: string,
): EntityClosesNothing {
  const tagged = projects.filter((project) => project.entityTag === entityCode);
  const taggedIds = new Set(tagged.map((project) => project.id));
  const groups = groupOrphans(orphans.filter((orphan) => taggedIds.has(orphan.projectId)));
  return {
    tagged,
    groups,
    count: groups.reduce((sum, group) => sum + group.milestones.length, 0),
  };
}

/**
 * Where a click on this cell goes — DECIDED BY THE CELL, not by a mode.
 *
 * A cell with live work behind it goes to that work; a gap-eligible cell with
 * none goes to its own row in *Unplanned*; everything else only has an
 * explanation to give. `Sales — B2B` on one entity may have work while the
 * same metric on another does not, and each cell answers for itself.
 */
export type EntityCellRoute =
  | { kind: 'milestone'; projectId: string }
  | { kind: 'unplanned' }
  | { kind: 'explain' };

export function routeForCell(
  cell: FinishLineCell,
  resolved: ResolvedEdge[],
): EntityCellRoute {
  if (!isGapEligible(cell.state)) return { kind: 'explain' };
  // A broken edge is not coverage — same rule as cellSubState. A project-level
  // link (no milestone id) is still declared work and still routable.
  const live = resolved.find((r) => (r.milestone !== undefined && !r.broken) || (r.edge.milestoneId === undefined && r.project));
  if (live?.project) return { kind: 'milestone', projectId: live.project.id };
  return { kind: 'unplanned' };
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

/**
 * The cells one milestone currently closes.
 *
 * The authoring anchor (§6.4) reads this to arrive with the right boxes
 * already ticked, so re-opening a picker shows the existing selection and
 * committing it unchanged is a no-op.
 */
export function cellsForMilestone(
  edges: FinishLineEdge[],
  projectId: string,
  milestoneId: string,
): Set<string> {
  const ids = new Set<string>();
  for (const edge of edges) {
    if (edge.projectId === projectId && edge.milestoneId === milestoneId) ids.add(edge.cellId);
  }
  return ids;
}

/**
 * Orphan milestones grouped by their project.
 *
 * 15 rows that open, not 121 rows that scroll. The flat list made one problem
 * look like 121 unrelated small ones — the same failure the unplanned card had.
 * Nothing here hardcodes either number; both come from the rows.
 */
export interface OrphanGroup {
  projectId: string;
  projectTitle: string;
  milestones: OrphanMilestone[];
}

export function groupOrphans(orphans: OrphanMilestone[]): OrphanGroup[] {
  const groups = new Map<string, OrphanGroup>();
  for (const orphan of orphans) {
    const existing = groups.get(orphan.projectId);
    if (existing) existing.milestones.push(orphan);
    else
      groups.set(orphan.projectId, {
        projectId: orphan.projectId,
        projectTitle: orphan.projectTitle,
        milestones: [orphan],
      });
  }
  // Worst first: the project carrying the most work that serves nothing.
  return [...groups.values()].sort(
    (a, b) => b.milestones.length - a.milestones.length || a.projectTitle.localeCompare(b.projectTitle),
  );
}
