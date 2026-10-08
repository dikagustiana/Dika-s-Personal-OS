// Copied from dikagustiana/dikagustiana.com@bed215d8046986843dcb30b4e88d0977f834f90d src/lib/finance-in-action/engine/recalc.ts. Do not edit here; re-copy.
/**
 * Recalculation after an edit, with the delta of every cell that moved.
 *
 * An edit replaces the value of a value cell (the model layer allows this for
 * assumption cells only) and recalculates through the engine. The result names
 * each changed cell with its value before and after, so the page can mark
 * cells, tree nodes and waterfall bars, and list "what changed" without
 * working anything out itself.
 */
import { isErr, isNum, type Engine, type Value } from './engine';

export interface Edit {
  key: string;
  value: number | null;
}

export interface CellChange {
  key: string;
  before: Value;
  after: Value;
  /** after − before when both are numbers; otherwise null. */
  delta: number | null;
}

export interface RecalcResult {
  values: Map<string, Value>;
  changed: CellChange[];
}

function same(a: Value, b: Value): boolean {
  if (isErr(a) || isErr(b)) return isErr(a) && isErr(b) && a.err === b.err;
  return Object.is(a, b);
}

/** Applies the edits, recalculates every cell, and reports what changed. */
export function recalcWithEdits(engine: Engine, before: Map<string, Value>, edits: Edit[]): RecalcResult {
  for (const e of edits) engine.setValue(e.key, e.value);
  const values = engine.recalc();
  const changed: CellChange[] = [];
  for (const [key, after] of values) {
    const prev = before.has(key) ? (before.get(key) as Value) : null;
    if (same(prev, after)) continue;
    changed.push({ key, before: prev, after, delta: isNum(prev) && isNum(after) ? after - prev : null });
  }
  return { values, changed };
}
