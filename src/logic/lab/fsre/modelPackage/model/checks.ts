// Copied from dikagustiana/dikagustiana.com@bed215d8046986843dcb30b4e88d0977f834f90d src/lib/finance-in-action/model/checks.ts. Do not edit here; re-copy.
/**
 * Checks that need the engine: every formula parses and reads cells that
 * exist, nothing is circular, the engine agrees with every value the package
 * stores, and every edge of the driver tree is backed by the formulas.
 *
 * The last one keeps the rule that the graph is the only source of a
 * relationship: the package's tree is drawn, but an edge the formulas do not
 * support is reported, never trusted.
 */
import type { ValidationIssue } from '../contract/validate';
import { isErr, isNum, type Value } from '../engine/engine';
import type { Workbook } from './workbook';

/** Relative tolerance between the engine and a stored formula value. */
export const PARITY_TOLERANCE = 1e-9;

function agrees(engine: Value, stored: number | null): boolean {
  if (stored === null) return engine === null;
  if (!isNum(engine)) return false;
  return Math.abs(engine - stored) <= PARITY_TOLERANCE * Math.max(1, Math.abs(stored));
}

export function checkFormulas(wb: Workbook): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const keys = new Set(wb.allKeys());
  const values = wb.values();

  for (const key of keys) {
    const cell = wb.engine.cells.get(key);
    if (!cell || cell.kind !== 'formula') continue;
    const where = `${wb.rowRefOf(key)}[${wb.pkg.periods[wb.address(key)!.periodIndex].id}]`;
    if (cell.parseError) {
      out.push({ path: where, message: `formula does not parse: ${cell.parseError}` });
      continue;
    }
    for (const r of wb.engine.refs(key)) {
      if (!keys.has(r)) out.push({ path: where, message: `reads ${r}, which is outside the package` });
    }
    const v = values.get(key) ?? null;
    if (isErr(v)) out.push({ path: where, message: `evaluates to ${v.err}` });
    const stored = wb.cell(key)?.value ?? null;
    if (!isErr(v) && !agrees(v, stored)) {
      out.push({ path: where, message: `stored value ${stored} differs from the engine's ${JSON.stringify(v)}` });
    }
  }

  for (const cycle of wb.graph.cycles()) {
    out.push({ path: 'formulas', message: `circular reference: ${cycle.join(' → ')}` });
  }

  out.push(...checkTreeEdges(wb));
  return out;
}

/**
 * An edge from → to holds when, in at least one period, the `to` row's cell
 * reads the `from` row's cell somewhere along its chain of precedents.
 */
export function checkTreeEdges(wb: Workbook): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const nodes = new Map(wb.pkg.driverTree.nodes.map((n) => [n.id, n]));
  for (const e of wb.pkg.driverTree.edges) {
    const from = nodes.get(e.from);
    const to = nodes.get(e.to);
    if (!from || !to) continue;
    const held = wb.pkg.periods.some((p) => {
      const toKey = wb.keyOf(to.rowRef, p.id);
      const fromKey = wb.keyOf(from.rowRef, p.id);
      return !!toKey && !!fromKey && wb.graph.precedents(toKey, 'full').includes(fromKey);
    });
    if (!held) out.push({ path: 'driverTree.edges', message: `${e.from} → ${e.to} is not backed by any formula` });
  }
  return out;
}
