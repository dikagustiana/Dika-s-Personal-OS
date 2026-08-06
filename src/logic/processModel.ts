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
  ProcessTrackDef,
} from '../data/types';
import { stepVisible, type TrackFilter } from './process';

/**
 * ===========================================================================
 * THE PRE-52 COMPATIBILITY VOCABULARY — §4.6, and the ONE place it lives.
 * ===========================================================================
 * This frontend ships before migration 20260806000052. In that window the
 * process tables exist and hold SAMB, but os_process_tracks does not exist
 * and no table carries entity_code. The repository already papers over the
 * missing column (rows arrive tagged SAMB); what cannot be read from
 * anywhere is the track vocabulary — so this constant IS migration 52's
 * SAMB seed, verbatim, used only when listProcessTracks reports the table
 * absent while steps carry rows. After 52 applies, this constant is dead
 * code. If it ever disagrees with the migration, the swimlane would draw
 * the wrong walks for exactly the pre-apply window — which is why the seed
 * parity test pins it against the SQL.
 */
export const LEGACY_SAMB_TRACKS: ProcessTrackDef[] = [
  { entityCode: 'SAMB', code: 'TRADE', label: 'TRADE', ordinal: 1, isShared: false },
  { entityCode: 'SAMB', code: 'LP', label: 'LP', ordinal: 2, isShared: false },
  { entityCode: 'SAMB', code: 'KEDUANYA', label: 'BERSAMA', ordinal: 3, isShared: true },
];

/**
 * ===========================================================================
 * WHY EMPTY CARRIES A CAUSE.
 * ===========================================================================
 * "The table is not there" and "the table is there and has no rows" are two
 * different facts about the world, and for most of a day in August they
 * pointed at two different people: the first is a migration nobody applied,
 * the second is a seed that landed in halves. Both rendered the SAME sentence
 * — "migration proses belum diterapkan" — so the view accused the migration of
 * a fault the seed had committed, and the register that read 0 of 118 rows
 * said so in the confident voice of a known state.
 *
 * Neither of them is a failure and neither may show a number, so they stay one
 * `kind`. But they must never again share a sentence.
 */
export type EmptyCause =
  /** A relation is genuinely absent (42P01 / PGRST205) — pre-migration. */
  | 'absent'
  /** Every relation answered; the tables are there and hold no rows. */
  | 'unseeded';

export type ProcessModel =
  | { kind: 'empty'; cause: EmptyCause }
  | { kind: 'failed'; detail: string }
  | {
      kind: 'ready';
      lanes: ProcessLane[];
      phases: ProcessPhase[];
      steps: ProcessStep[];
      gates: ProcessGate[];
      needs: ProcessNeed[];
      stepItems: ProcessStepItem[];
      tracks: ProcessTrackDef[];
      /**
       * True when the vocabulary table was absent (pre-52 schema) and
       * `tracks` is LEGACY_SAMB_TRACKS: render SAMB as before, plus the one
       * visible line saying multi-entity is not active yet.
       */
      legacyEntity: boolean;
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
 * Fold the six reads into one canvas decision. Absent relation / failure per
 * foldProcessReads; zero steps → empty (a diagram with lanes but no boxes
 * would read as a broken render, not an empty dataset) — but tagged
 * `unseeded`, because that is a different fact from `absent` and the view owes
 * the reader the difference.
 */
export function buildProcessModel(input: {
  lanes: ReadResult<ProcessLane>;
  phases: ReadResult<ProcessPhase>;
  steps: ReadResult<ProcessStep>;
  gates: ReadResult<ProcessGate>;
  needs: ReadResult<ProcessNeed>;
  stepItems: ReadResult<ProcessStepItem>;
  tracks: ReadResult<ProcessTrackDef>;
}): ProcessModel {
  const folded = foldProcessReads([
    input.lanes,
    input.phases,
    input.steps,
    input.gates,
    input.needs,
    input.stepItems,
  ]);
  if (folded.kind === 'failed') return folded;
  if (folded.kind === 'empty') return { kind: 'empty', cause: 'absent' };
  if (
    !input.lanes.ok ||
    !input.phases.ok ||
    !input.steps.ok ||
    !input.gates.ok ||
    !input.needs.ok ||
    !input.stepItems.ok
  ) {
    return { kind: 'empty', cause: 'absent' }; // unreachable; narrows the types below
  }
  if (input.steps.rows.length === 0) {
    // The whole feature absent vs present-but-unseeded is decided by the six
    // core reads; a missing VOCABULARY table changes nothing when there are
    // no steps to draw.
    return { kind: 'empty', cause: 'unseeded' };
  }

  // The vocabulary read folds separately (§4.6): absent while steps carry
  // rows is the expected PRE-52 window — SAMB renders from the compatibility
  // constant, flagged so the view says so. Any other failure of the tracks
  // read surfaces; and a PRESENT vocabulary with zero rows while steps exist
  // would silently draw a diagram with no walks and no arrows, so it is a
  // failure too, not an empty state.
  if (!input.tracks.ok) {
    if (input.tracks.reason === 'missing-relation') {
      return {
        kind: 'ready',
        lanes: input.lanes.rows,
        phases: input.phases.rows,
        steps: input.steps.rows,
        gates: input.gates.rows,
        needs: input.needs.rows,
        stepItems: input.stepItems.rows,
        tracks: LEGACY_SAMB_TRACKS,
        legacyEntity: true,
      };
    }
    return { kind: 'failed', detail: input.tracks.detail };
  }
  if (input.tracks.rows.length === 0) {
    return {
      kind: 'failed',
      detail:
        'listProcessTracks: os_process_tracks ada tapi kosong — kosakata track hilang, alur tidak bisa diturunkan.',
    };
  }
  return {
    kind: 'ready',
    lanes: input.lanes.rows,
    phases: input.phases.rows,
    steps: input.steps.rows,
    gates: input.gates.rows,
    needs: input.needs.rows,
    stepItems: input.stepItems.rows,
    tracks: input.tracks.rows,
    legacyEntity: false,
  };
}

// --- the register ----------------------------------------------------------

export type RegisterState =
  | { kind: 'empty'; cause: EmptyCause }
  | { kind: 'failed'; detail: string }
  | { kind: 'ready'; tracks: ProcessTrackDef[]; legacyEntity: boolean };

/**
 * The register's three-way decision, extracted from the view so the case that
 * actually shipped is testable.
 *
 * THE BUG THIS REPLACES: the tab rendered "Register belum ada di database —
 * migration proses belum diterapkan" whenever `needs` was empty, whatever the
 * reason. On 6 August os_process_needs existed, answered 200, and held zero
 * rows because the seed had been applied in two transactions and the second
 * had not run yet — so the app confidently blamed a migration that was in
 * fact applied, and the true state (table present, seed half-landed) had no
 * way to be said. A read that SUCCEEDED and returned nothing is a fact worth
 * its own sentence; it is not the same as a table that is not there.
 */
export function buildRegisterState(
  steps: ReadResult<ProcessStep>,
  needs: ReadResult<ProcessNeed>,
  tracks: ReadResult<ProcessTrackDef>,
): RegisterState {
  const folded = foldProcessReads([steps, needs]);
  if (folded.kind === 'failed') return folded;
  if (folded.kind === 'empty') return { kind: 'empty', cause: 'absent' };
  if (!steps.ok || !needs.ok) return { kind: 'empty', cause: 'absent' }; // unreachable
  if (needs.rows.length === 0) return { kind: 'empty', cause: 'unseeded' };
  // Same §4.6 fold as the canvas: vocabulary absent while the register has
  // rows = the pre-52 window, rendered from the compatibility constant with
  // the visible notice; any other tracks failure surfaces.
  if (!tracks.ok) {
    if (tracks.reason === 'missing-relation') {
      return { kind: 'ready', tracks: LEGACY_SAMB_TRACKS, legacyEntity: true };
    }
    return { kind: 'failed', detail: tracks.detail };
  }
  if (tracks.rows.length === 0) {
    return {
      kind: 'failed',
      detail:
        'listProcessTracks: os_process_tracks ada tapi kosong — kosakata track hilang, register tidak bisa difilter.',
    };
  }
  return { kind: 'ready', tracks: tracks.rows, legacyEntity: false };
}

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
  shared: ReadonlySet<string>,
): RegisterRow[] {
  const stepsById = new Map(steps.map((step) => [step.id, step]));
  const rows: RegisterRow[] = [];
  for (const need of needs) {
    const step = stepsById.get(need.stepId);
    if (!step) continue;
    if (!stepVisible(step, filters.track, shared)) continue;
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
  shared: ReadonlySet<string>,
): NeedSummary {
  const visibleIds = new Set(
    steps.filter((step) => stepVisible(step, track, shared)).map((step) => step.id),
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
 * directions, so this is a filter, never a lookup of one id. Entity scoping
 * happens through the STEPS argument: pass one entity's steps and only that
 * entity's feeders come back — the bridge rows themselves carry no entity.
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
 * What "closed" means for one CELL — (Finish line row, entity): every need of
 * every step OF THAT ENTITY that feeds the row, grouped BELUM → SEBAGIAN →
 * ADA. The entity comes from the cell itself, never from a hardcode: a SAMB
 * cell reads SAMB's chain, an ARBI cell reads ARBI's, and a cell of an
 * entity with no chain gets null — no block — without any special case.
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
  entityCode: string,
  stepItems: ProcessStepItem[],
  needs: ProcessNeed[],
  steps: ProcessStep[],
): ClosingConditions | null {
  const feeding = stepsForItem(
    itemId,
    stepItems,
    steps.filter((step) => step.entityCode === entityCode),
  );
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
