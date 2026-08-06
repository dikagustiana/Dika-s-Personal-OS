/**
 * View-models for the swimlane and register tabs of the Finish line, and for
 * the closing-conditions block in its cell panel.
 *
 * THE MISSING-RELATION RULE IS INVERTED HERE, DELIBERATELY. Finish-line
 * cards count problems, so a missing relation must say COULD NOT CHECK. The
 * process views draw a diagram whose tables ship AFTER the frontend
 * (migrations 20260806000050/51): a missing os_process_* relation is the
 * EXPECTED pre-deploy state, and the spec pins it to the ordinary one-line
 * empty state — not a warning, not a crash. A read that failed for any OTHER
 * reason still surfaces as 'failed', because a network error rendered as
 * "belum diisi" would lie.
 */
import type { ReadResult } from '../data/readResult';
import type {
  FinishLineItem,
  ProcessGate,
  ProcessLane,
  ProcessNeed,
  ProcessNeedKind,
  ProcessNeedStatus,
  ProcessPhase,
  ProcessStep,
  ProcessStepItem,
} from '../data/types';
import { stepVisible, type TrackFilter } from './process';

export type ProcessModel =
  | { kind: 'empty' }
  | { kind: 'failed'; detail: string }
  | {
      kind: 'ready';
      lanes: ProcessLane[];
      phases: ProcessPhase[];
      steps: ProcessStep[];
      gates: ProcessGate[];
      needs: ProcessNeed[];
      stepItems: ProcessStepItem[];
    };

export type ProcessReadFold =
  | { kind: 'empty' }
  | { kind: 'failed'; detail: string }
  | { kind: 'ok' };

/**
 * The shared folding rule: any missing relation → empty (42P01 before the
 * migration is the normal state); any other failure → failed with the first
 * detail. Used by both views so the register cannot disagree with the
 * swimlane about what a missing table means.
 */
export function foldProcessReads(reads: ReadResult<unknown>[]): ProcessReadFold {
  if (reads.some((read) => !read.ok && read.reason === 'missing-relation')) {
    return { kind: 'empty' };
  }
  const failure = reads.find((read) => !read.ok);
  if (failure && !failure.ok) return { kind: 'failed', detail: failure.detail };
  return { kind: 'ok' };
}

/**
 * Fold the five reads into one canvas decision. Missing relation / failure
 * per foldProcessReads; zero steps → empty (a diagram with lanes but no
 * boxes would read as a broken render, not an empty dataset).
 */
export function buildProcessModel(input: {
  lanes: ReadResult<ProcessLane>;
  phases: ReadResult<ProcessPhase>;
  steps: ReadResult<ProcessStep>;
  gates: ReadResult<ProcessGate>;
  needs: ReadResult<ProcessNeed>;
  stepItems: ReadResult<ProcessStepItem>;
}): ProcessModel {
  const folded = foldProcessReads([
    input.lanes,
    input.phases,
    input.steps,
    input.gates,
    input.needs,
    input.stepItems,
  ]);
  if (folded.kind !== 'ok') return folded;
  if (
    !input.lanes.ok ||
    !input.phases.ok ||
    !input.steps.ok ||
    !input.gates.ok ||
    !input.needs.ok ||
    !input.stepItems.ok
  ) {
    return { kind: 'empty' }; // unreachable; narrows the types below
  }
  if (input.steps.rows.length === 0) return { kind: 'empty' };
  return {
    kind: 'ready',
    lanes: input.lanes.rows,
    phases: input.phases.rows,
    steps: input.steps.rows,
    gates: input.gates.rows,
    needs: input.needs.rows,
    stepItems: input.stepItems.rows,
  };
}

// --- the register ----------------------------------------------------------

export interface RegisterFilters {
  track: TrackFilter;
  status: Record<ProcessNeedStatus, boolean>;
  kind: Record<ProcessNeedKind, boolean>;
}

export interface RegisterRow {
  need: ProcessNeed;
  step: ProcessStep;
}

export function registerRows(
  needs: ProcessNeed[],
  steps: ProcessStep[],
  filters: RegisterFilters,
): RegisterRow[] {
  const stepsById = new Map(steps.map((step) => [step.id, step]));
  const rows: RegisterRow[] = [];
  for (const need of needs) {
    const step = stepsById.get(need.stepId);
    if (!step) continue;
    if (!stepVisible(step, filters.track)) continue;
    if (!filters.status[need.status]) continue;
    if (!filters.kind[need.kind]) continue;
    rows.push({ need, step });
  }
  return rows;
}

export interface NeedSummary {
  ada: number;
  sebagian: number;
  belum: number;
  total: number;
}

/**
 * The proportion bar. Follows the jalur filter (a track's register must not
 * quote global totals) but NOT the status/kind toggles — it summarizes the
 * population those toggles slice.
 */
export function summarizeNeeds(
  needs: ProcessNeed[],
  steps: ProcessStep[],
  track: TrackFilter,
): NeedSummary {
  const visibleIds = new Set(
    steps.filter((step) => stepVisible(step, track)).map((step) => step.id),
  );
  const scoped = needs.filter((need) => visibleIds.has(need.stepId));
  return {
    ada: scoped.filter((need) => need.status === 'ADA').length,
    sebagian: scoped.filter((need) => need.status === 'SEBAGIAN').length,
    belum: scoped.filter((need) => need.status === 'BELUM').length,
    total: scoped.length,
  };
}

export interface OwnerGroup {
  owner: string;
  rows: RegisterRow[];
  belum: number;
}

/**
 * The request-composing shape: grouped per owner, most BELUM first, ties
 * alphabetical — the order in which to go asking.
 */
export function groupByOwner(rows: RegisterRow[]): OwnerGroup[] {
  const groups = new Map<string, RegisterRow[]>();
  for (const row of rows) {
    const owner = row.need.owner ?? '—';
    const group = groups.get(owner);
    if (group) group.push(row);
    else groups.set(owner, [row]);
  }
  return [...groups.entries()]
    .map(([owner, grouped]) => ({
      owner,
      rows: grouped,
      belum: grouped.filter((row) => row.need.status === 'BELUM').length,
    }))
    .sort((a, b) => b.belum - a.belum || a.owner.localeCompare(b.owner));
}

// --- the step ↔ Finish line bridge -----------------------------------------

const STATUS_ORDER: ProcessNeedStatus[] = ['BELUM', 'SEBAGIAN', 'ADA'];

/**
 * The steps feeding one Finish line row. The bridge is many-to-many in both
 * directions, so this is a filter, never a lookup of one id.
 */
export function stepsForItem(itemId: string, stepItems: ProcessStepItem[], steps: ProcessStep[]): ProcessStep[] {
  const fed = new Set(
    stepItems.filter((edge) => edge.itemId === itemId).map((edge) => edge.stepId),
  );
  return steps.filter((step) => fed.has(step.id));
}

/** Step LABELS feeding a row — what the swimlane highlights on ?item=. */
export function stepLabelsForItem(
  itemId: string,
  stepItems: ProcessStepItem[],
  steps: ProcessStep[],
): Set<string> {
  return new Set(stepsForItem(itemId, stepItems, steps).map((step) => step.label));
}

export interface ClosingNeed {
  need: ProcessNeed;
  stepLabel: string;
}

export interface ClosingGroup {
  status: ProcessNeedStatus;
  rows: ClosingNeed[];
}

export interface ClosingConditions {
  /** How many steps feed this row — the first half of the summary line. */
  stepCount: number;
  counts: Record<ProcessNeedStatus, number>;
  groups: ClosingGroup[];
}

/**
 * What "closed" means for one Finish line row: every need of every step that
 * feeds it, grouped BELUM → SEBAGIAN → ADA.
 *
 * Returns null when NO step feeds the row — that is what hides the block
 * entirely rather than rendering an empty one. A row with feeding steps but
 * no needs still returns a value: "three steps feed this and none of them
 * needs anything" is information, an empty block is not.
 *
 * READ-ONLY toward the cell. A row whose needs are all ADA still does not
 * change its cell state; that happens only through an explicit human edit,
 * and this function has no way to say otherwise.
 */
export function closingConditionsForItem(
  itemId: string,
  stepItems: ProcessStepItem[],
  needs: ProcessNeed[],
  steps: ProcessStep[],
): ClosingConditions | null {
  const feeding = stepsForItem(itemId, stepItems, steps);
  if (feeding.length === 0) return null;
  const labelById = new Map(feeding.map((step) => [step.id, step.label]));
  const matched = needs.filter((need) => labelById.has(need.stepId));
  const counts: Record<ProcessNeedStatus, number> = { ADA: 0, SEBAGIAN: 0, BELUM: 0 };
  for (const need of matched) counts[need.status] += 1;
  const groups = STATUS_ORDER.map((status) => ({
    status,
    rows: matched
      .filter((need) => need.status === status)
      .map((need) => ({ need, stepLabel: labelById.get(need.stepId) ?? '?' }))
      // Grouped by step first so a reader scanning one status still sees the
      // needs of one step together, then by item for a stable order.
      .sort(
        (a, b) =>
          a.stepLabel.localeCompare(b.stepLabel, undefined, { numeric: true }) ||
          a.need.item.localeCompare(b.need.item),
      ),
  })).filter((group) => group.rows.length > 0);
  return { stepCount: feeding.length, counts, groups };
}

/**
 * The reverse direction: the Finish line rows one step feeds, resolved to
 * items and ordered as the matrix orders them. An id with no matching item
 * (a row deleted live before the app reloaded) is dropped rather than shown
 * as a broken link.
 */
export function finishLineRowsForStep(
  stepId: string,
  stepItems: ProcessStepItem[],
  items: FinishLineItem[],
): FinishLineItem[] {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const rows: FinishLineItem[] = [];
  for (const edge of stepItems) {
    if (edge.stepId !== stepId || seen.has(edge.itemId)) continue;
    seen.add(edge.itemId);
    const item = itemsById.get(edge.itemId);
    if (item) rows.push(item);
  }
  return rows.sort((a, b) => a.order - b.order);
}
