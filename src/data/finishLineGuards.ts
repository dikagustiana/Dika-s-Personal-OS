import type { CellState } from './types';

/**
 * The invariant the finish-line repository enforces on every cell write, in
 * the mutation path rather than in the UI.
 *
 * ===========================================================================
 * A CELL'S STATE MAY ONLY EVER CHANGE THROUGH A DIRECT HUMAN EDIT.
 * ===========================================================================
 * Not by inference. Not by a rollup. Not by a linked milestone being ticked
 * done. The matrix says what is true of the Excel pack, and only a person
 * looking at the pack knows that — a state that could be written by the thing
 * being measured is not a measurement.
 *
 * This is why `contradiction` exists as a DERIVED sub-state (see
 * logic/finishLine.ts): when every milestone linked to an `input` cell is
 * done and the cell is still `input`, the rollup has noticed a disagreement.
 * Its entire job is to raise that for a human and stop. It must never resolve
 * it by writing the state itself.
 *
 * So `origin` is a required argument, not an optional hint. A UI-only guard
 * would be bypassed by the first caller that forgot, and this is exactly the
 * kind of rule that gets forgotten — the same reasoning as researchGuards,
 * which exists because model output can never verify anything.
 * ===========================================================================
 */

/** Who is asking for the write. */
export type CellWriteOrigin = 'human' | 'rollup' | 'model';

export class FinishLineGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FinishLineGuardError';
  }
}

const STATES: ReadonlySet<string> = new Set<CellState>([
  'figure',
  'zero',
  'undefined',
  'input',
  'locked',
]);

/**
 * Narrows a cell-state write to a human edit.
 *
 * Throws for every other origin — deliberately loud rather than a silent
 * no-op, because a rollup that quietly failed to write would look identical to
 * one that had nothing to write.
 */
export function guardCellState(state: CellState, origin: CellWriteOrigin): CellState {
  if (origin !== 'human') {
    throw new FinishLineGuardError(
      `A cell state may only be set by a direct human edit; got origin '${origin}'. ` +
        'A rollup that disagrees with a cell raises a contradiction for a person to ' +
        'resolve — it never writes the state itself.',
    );
  }
  if (!STATES.has(state)) {
    throw new FinishLineGuardError(
      `Unknown cell state '${state}'. There are exactly five, and there is ` +
        'deliberately no state for "a figure exists but the method is unreliable".',
    );
  }
  return state;
}

/**
 * A note is free text about what is missing, not a claim about the pack, so
 * any origin may write one. Kept as its own function so the asymmetry is
 * explicit rather than implied by the absence of a check.
 */
export function guardCellNote(note: string | undefined): string | undefined {
  const trimmed = note?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Only an `input` cell can be closed by a milestone.
 *
 * `locked` is closed transitively when its inputs land — an edge onto one
 * would be a second, contradictory way to say it is done. `undefined` is
 * arithmetic, not work outstanding. `zero` and `figure` are not gaps at all.
 *
 * ENFORCED HERE, not in the UI. The picker only offers `input` cells, but a
 * guard that lives only in the component is one refactor away from being gone,
 * and the row it would write is invisible until someone wonders why a `locked`
 * cell claims to have a milestone.
 */
export function guardEdgeTarget(state: CellState): CellState {
  if (state !== 'input') {
    throw new FinishLineGuardError(
      `A milestone edge may only point at an 'input' cell; this one is '${state}'. ` +
        (state === 'locked'
          ? 'A locked cell closes when its inputs land — link the inputs instead.'
          : 'That state is not closable by work.'),
    );
  }
  return state;
}
