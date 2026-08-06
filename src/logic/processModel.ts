/**
 * View-models for the two process views and the Finish line closing block.
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
}): ProcessModel {
  const folded = foldProcessReads([
    input.lanes,
    input.phases,
    input.steps,
    input.gates,
    input.needs,
  ]);
  if (folded.kind !== 'ok') return folded;
  if (!input.lanes.ok || !input.phases.ok || !input.steps.ok || !input.gates.ok || !input.needs.ok) {
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

// --- the Finish line closing block (§8.1 / §8.2) ---------------------------

const STATUS_ORDER: ProcessNeedStatus[] = ['BELUM', 'SEBAGIAN', 'ADA'];

export interface ClosingNeed {
  need: ProcessNeed;
  stepLabel: string;
}

export interface ClosingGroup {
  status: ProcessNeedStatus;
  rows: ClosingNeed[];
}

/**
 * The needs that define "closed" for one Finish line row, grouped
 * BELUM → SEBAGIAN → ADA. Empty result = the block does not render at all.
 * READ-ONLY toward the cell: nothing derived here may write cell state.
 */
export function closingNeedsForItem(
  itemId: string,
  needs: ProcessNeed[],
  steps: ProcessStep[],
): ClosingGroup[] {
  const stepLabelById = new Map(steps.map((step) => [step.id, step.label]));
  const matched = needs.filter((need) => need.finishLineItemId === itemId);
  return STATUS_ORDER.map((status) => ({
    status,
    rows: matched
      .filter((need) => need.status === status)
      .sort((a, b) => a.item.localeCompare(b.item))
      .map((need) => ({
        need,
        stepLabel: stepLabelById.get(need.stepId) ?? '?',
      })),
  })).filter((group) => group.rows.length > 0);
}

/**
 * The reverse direction (§8.2): the Finish line rows a step feeds — the
 * deduped finishLineItemId targets of its needs, resolved to items.
 */
export function finishLineRowsForStep(
  stepId: string,
  needs: ProcessNeed[],
  items: FinishLineItem[],
): FinishLineItem[] {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const rows: FinishLineItem[] = [];
  for (const need of needs) {
    if (need.stepId !== stepId || !need.finishLineItemId) continue;
    if (seen.has(need.finishLineItemId)) continue;
    seen.add(need.finishLineItemId);
    const item = itemsById.get(need.finishLineItemId);
    if (item) rows.push(item);
  }
  return rows.sort((a, b) => a.order - b.order);
}
