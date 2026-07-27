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
      `Unknown cell state '${state}'. There are exactly five, and no sixth is ` +
        'pending: "a figure exists but the method is unreliable" is DERIVED, not ' +
        'stored — it is a gap-eligible cell with no live edge. See isGapEligible.',
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
 * ===========================================================================
 * THE ONE PREDICATE. `figure` IS NOT TERMINAL.
 * ===========================================================================
 *
 * Which cell states need work standing behind them — and therefore which can
 * carry an edge, and which count as gaps. The two questions have the same
 * answer, so they get one function and not two lists that can drift.
 *
 *   figure     YES — the number exists; NOTHING attests its method is sound
 *                    until work stands behind it. It renders `xxx`, which
 *                    reads as finished, and it is not.
 *   input      YES — the number does not exist yet.
 *   locked     no  — derived; resolves transitively from its inputs through
 *                    os_finish_line_deps. An edge onto one would be a second,
 *                    contradictory way to say it is done.
 *   undefined  no  — arithmetic, not work. Zero divisor.
 *   zero       DEFERRED — see below.
 *
 * The earlier model said `figure` and `zero` have no edge and are not gaps.
 * That contradicted the target state: if the target is "a number exists AND
 * the method behind it is sound", an unbacked figure has not reached it. The
 * live view `os_finish_line_unplanned` already encodes the corrected model
 * (`state in ('figure','input')`) and returns 136 rows, not 44. A UI that
 * shows 44 shows a third of the truth, and the two thirds it hides are the
 * ones that look finished.
 *
 * ---------------------------------------------------------------------------
 * WHY `zero` IS DEFERRED, AND WHY THE DEFERRAL LIVES HERE AND NOWHERE ELSE
 * ---------------------------------------------------------------------------
 * 44 cells are `zero` and they are two different facts: 7 in trading entities
 * where nil is an assertion someone must stand behind, and 37 where nil means
 * the entity is not trading yet. Telling them apart needs a `trading` flag on
 * the entity that does not exist, so the whole question is deferred.
 *
 * THIS DECISION WILL BE REVERSED. When it is, it must be one line — moving
 * 'zero' into the set below. That is the entire reason this is a named
 * predicate rather than `state !== 'zero'` scattered across five files: the
 * guard, the client mirror of the view's predicate, and the cards all call
 * THIS. If any of them kept its own list, the deferral would exist in two
 * places and come apart the moment it is lifted.
 *
 * The case that will force it, recorded so it is recognised on arrival:
 * `COGS — Logistic provider` / SAMB is `zero`, carries a seeded note saying
 * the cost was never separated, and four blocked milestones in `SAMB (parent)`
 * are visibly about exactly that. Under the current rule those four can attach
 * to nothing. Known, accepted, and deliberately not solved here.
 */
export type GapEligibleState = Extract<CellState, 'figure' | 'input'>;

const GAP_ELIGIBLE: ReadonlySet<CellState> = new Set<CellState>(['figure', 'input']);

/**
 * A type predicate, so the compiler carries the deferral too: after this
 * returns false, `zero` is still in the narrowed type and a caller that forgot
 * to handle it fails to build rather than falling through to a default.
 */
export function isGapEligible(state: CellState): state is GapEligibleState {
  return GAP_ELIGIBLE.has(state);
}

/**
 * A milestone edge may only point at a gap-eligible cell.
 *
 * ENFORCED HERE, not in the UI. The picker only offers gap-eligible cells, but
 * a guard that lives only in the component is one refactor away from being
 * gone, and the row it would write is invisible until someone wonders why a
 * `locked` cell claims to have a milestone.
 */
export function guardEdgeTarget(state: CellState): CellState {
  if (!isGapEligible(state)) {
    throw new FinishLineGuardError(
      `A milestone edge may only point at a cell that needs work behind it; ` +
        `this one is '${state}'. ` +
        (state === 'locked'
          ? 'A locked cell closes when its inputs land — link the inputs instead.'
          : state === 'zero'
            ? 'Nil is deferred until entities carry a trading flag; see isGapEligible.'
            : 'That state is arithmetic, not work outstanding.'),
    );
  }
  return state;
}
