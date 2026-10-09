// Copied from dikagustiana/dikagustiana.com@bed215d8046986843dcb30b4e88d0977f834f90d src/lib/finance-in-action/contract/validate.ts. Do not edit here; re-copy.
// One edit on copy: the two `@/data/...` imports (the site's alias) are `../data/...`, the same files copied beside this one.
/**
 * Validation of a model package beyond what JSON Schema can say.
 *
 * The schema checks shape; this checks meaning: every reference resolves,
 * every row has one cell per period, cell kinds are consistent, the
 * unit-economics rules of brief §3 hold, no per-unit figure is stored as a
 * sourced number (constraint 7), the chain stage and the conditions exist in
 * the site's own data (constraint 6), and a synthetic package says so.
 *
 * The viewer runs this on every package before rendering it; a package with
 * issues is not shown, the issues are.
 */
import { BANDS, STAGES } from '../data/industryChain';
import { CONDITIONS } from '../data/capitalConditions';
import { splitRowRef, type Cell, type ModelPackage, type Row, type UELine } from './types';

export interface ValidationIssue {
  path: string;
  message: string;
}

/** The two spanning layers a package may sit on instead of a stage. */
export const SPANNING_LAYER_IDS = ['band-energy', 'band-logistics'] as const;

export const CHAIN_POSITION_IDS: readonly string[] = [
  ...STAGES.map((s) => s.id),
  ...BANDS.filter((b) => (SPANNING_LAYER_IDS as readonly string[]).includes(b.id)).map((b) => b.id),
];

const CONDITION_NUMBERS = new Set(CONDITIONS.map((c) => c.number));

/** The marker a synthetic package carries in its data. */
export const SYNTHETIC_MARK = 'SYNTHETIC';

/** Half a unit of the last stored decimal: the tolerance of one rounded value. */
export function roundingTolerance(pkg: ModelPackage): number {
  const decimals = pkg.meta.rounding?.decimals ?? 0;
  return Math.pow(10, -decimals) / 2;
}

function rowLookup(pkg: ModelPackage): Map<string, Row> {
  const map = new Map<string, Row>();
  for (const sheet of pkg.sheets) for (const row of sheet.rows) map.set(`${sheet.id}!${row.id}`, row);
  return map;
}

function resolve(rows: Map<string, Row>, rowRef: string): Row | undefined {
  const p = splitRowRef(rowRef);
  return p ? rows.get(`${p.sheet}!${p.rowId}`) : undefined;
}

/**
 * The unit-economics rules of brief §3, on the lines alone:
 * exactly one revenue line, first; at least one cost line before the first
 * subtotal; at most one unsplit line per subtotal, carrying `contains`; and at
 * least one subtotal (the per-unit split along the chain needs one).
 */
export function checkUnitEconomicsLines(lines: UELine[]): string[] {
  const out: string[] = [];
  const revenues = lines.filter((l) => l.role === 'revenue');
  if (revenues.length !== 1) out.push(`expected exactly one revenue line, found ${revenues.length}`);
  if (lines.length && lines[0].role !== 'revenue') out.push('the revenue line must come first');
  const firstSubtotal = lines.findIndex((l) => l.role === 'subtotal');
  if (firstSubtotal < 0) out.push('expected at least one subtotal line');
  const beforeFirst = firstSubtotal < 0 ? lines : lines.slice(0, firstSubtotal);
  if (!beforeFirst.some((l) => l.role === 'cost')) out.push('expected at least one cost line before the first subtotal');
  let unsplitInSegment = 0;
  for (const l of lines) {
    if (l.role === 'unsplit') {
      unsplitInSegment++;
      if (unsplitInSegment > 1) out.push(`more than one unsplit line before subtotal (at ${l.id})`);
      if (!l.contains || l.contains.length === 0) out.push(`unsplit line ${l.id} must list what it contains`);
    } else if (l.contains) {
      out.push(`only an unsplit line may carry contains (${l.id})`);
    }
    if (l.role === 'subtotal') unsplitInSegment = 0;
  }
  const ids = lines.map((l) => l.id);
  if (new Set(ids).size !== ids.length) out.push('line ids must be unique');
  return out;
}

/**
 * Each subtotal equals revenue less every cost and unsplit line above it,
 * worked from the rows, within the package's rounding (one half-unit per
 * value summed). Returns one message per subtotal and period that fails.
 */
export function checkSubtotals(pkg: ModelPackage): string[] {
  const rows = rowLookup(pkg);
  const tol = roundingTolerance(pkg);
  const out: string[] = [];
  const ue = pkg.unitEconomics;
  for (const periodId of ue.periods) {
    const pi = pkg.periods.findIndex((p) => p.id === periodId);
    if (pi < 0) continue;
    let running: number | null = null;
    let terms = 0;
    for (const line of ue.lines) {
      const v = resolve(rows, line.rowRef)?.cells[pi]?.value ?? null;
      if (line.role === 'revenue') {
        running = v;
        terms = 1;
      } else if (line.role === 'cost' || line.role === 'unsplit') {
        running = running === null || v === null ? null : running - v;
        terms++;
      } else if (line.role === 'subtotal') {
        if (running !== null && v !== null && Math.abs(v - running) > tol * (terms + 1)) {
          out.push(`${line.id} in ${periodId} is ${v}; revenue less the lines above it is ${running}`);
        }
      }
    }
  }
  return out;
}

function checkCell(cell: Cell, path: string, forecast: boolean, out: ValidationIssue[]) {
  const issue = (message: string) => out.push({ path, message });
  if (cell.kind === 'formula' && !cell.formula) issue('a formula cell needs a formula');
  if (cell.kind !== 'formula' && cell.formula) issue(`a ${cell.kind} cell must not carry a formula`);
  if (cell.kind === 'sourced' && !cell.source) issue('a sourced cell needs a source');
  if (cell.kind !== 'sourced' && cell.source) issue(`a ${cell.kind} cell must not carry a source`);
  if (cell.kind === 'missing' && cell.value !== null) issue('a missing cell has no value');
  if ((cell.kind === 'sourced' || cell.kind === 'assumption') && cell.value === null) issue(`a ${cell.kind} cell needs a value`);
  if (cell.kind === 'assumption' && !forecast) issue('assumptions belong to forecast periods only');
  if (cell.tieOut && cell.tieOut.status !== 'not_checked' && cell.value !== null) {
    const diff = cell.value - cell.tieOut.externalValue;
    if (Math.abs(diff - cell.tieOut.difference) > 1e-9 * Math.max(1, Math.abs(diff))) {
      issue('tie-out difference must equal value less the external value');
    }
    if ((cell.tieOut.status === 'agrees') !== (cell.tieOut.difference === 0)) {
      issue('a tie-out agrees exactly when its difference is zero');
    }
  }
}

export function validatePackage(pkg: ModelPackage): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const add = (path: string, message: string) => out.push({ path, message });
  const { meta, periods } = pkg;

  // Periods
  const periodIds = periods.map((p) => p.id);
  if (new Set(periodIds).size !== periodIds.length) add('periods', 'period ids must be unique');
  if (!periodIds.includes(meta.asOf.latestQuarter)) add('meta.asOf.latestQuarter', 'not a period id');
  if (!periodIds.includes(meta.asOf.fullStatementsTo)) add('meta.asOf.fullStatementsTo', 'not a period id');

  // Meta against the site's own lists (constraint 6)
  if (!CHAIN_POSITION_IDS.includes(meta.chainStage)) add('meta.chainStage', `${meta.chainStage} is not a chain map stage or spanning layer`);
  for (const c of meta.conditionIds) if (!CONDITION_NUMBERS.has(c)) add('meta.conditionIds', `condition ${c} is not in section 05`);
  for (const k of Object.keys(meta.conditionNotes ?? {})) {
    if (!meta.conditionIds.includes(Number(k))) add('meta.conditionNotes', `note for condition ${k}, which the package does not list`);
  }
  if (meta.pair.includes(meta.ticker)) add('meta.pair', 'a company is not its own pair');
  if (meta.provenance === 'synthetic') {
    if (!meta.version.includes(SYNTHETIC_MARK)) add('meta.version', `a synthetic package carries ${SYNTHETIC_MARK} in its version`);
    if (!meta.name.includes(SYNTHETIC_MARK)) add('meta.name', `a synthetic package carries ${SYNTHETIC_MARK} in its name`);
  }

  // Sheets, rows, cells
  const sheetIds = pkg.sheets.map((s) => s.id);
  if (new Set(sheetIds).size !== sheetIds.length) add('sheets', 'sheet ids must be unique');
  const ue = pkg.unitEconomics;
  const perUnitSold = new RegExp(`\\bper ${ue.unit}\\b`, 'i');
  for (const sheet of pkg.sheets) {
    const rowIds = sheet.rows.map((r) => r.id);
    if (new Set(rowIds).size !== rowIds.length) add(`sheets.${sheet.id}`, 'row ids must be unique');
    for (const row of sheet.rows) {
      const rpath = `${sheet.id}!${row.id}`;
      if (row.cells.length !== periods.length) add(rpath, `has ${row.cells.length} cells for ${periods.length} periods`);
      row.cells.forEach((cell, i) => {
        const period = periods[i];
        checkCell(cell, `${rpath}[${period?.id ?? i}]`, !!period?.forecast, out);
        // Constraint 7: a per-unit-sold figure is worked from rows, never stored as read.
        if (perUnitSold.test(row.unit) && cell.kind === 'sourced') {
          add(`${rpath}[${period?.id ?? i}]`, `a per-${ue.unit} figure must be a formula over rows, not a stored number`);
        }
      });
    }
  }

  const rows = rowLookup(pkg);
  const mustResolve = (path: string, ref: string) => {
    if (!resolve(rows, ref)) add(path, `${ref} does not name a row`);
  };

  // Driver tree
  const nodeIds = pkg.driverTree.nodes.map((n) => n.id);
  if (new Set(nodeIds).size !== nodeIds.length) add('driverTree.nodes', 'node ids must be unique');
  pkg.driverTree.nodes.forEach((n) => mustResolve(`driverTree.nodes.${n.id}`, n.rowRef));
  for (const e of pkg.driverTree.edges) {
    if (!nodeIds.includes(e.from) || !nodeIds.includes(e.to)) add('driverTree.edges', `${e.from} → ${e.to} names an unknown node`);
  }

  // Unit economics
  mustResolve('unitEconomics.denominatorRowRef', ue.denominatorRowRef);
  for (const p of ue.periods) if (!periodIds.includes(p)) add('unitEconomics.periods', `${p} is not a period id`);
  for (const line of ue.lines) {
    mustResolve(`unitEconomics.lines.${line.id}`, line.rowRef);
    line.driver?.inputRowRefs.forEach((r) => mustResolve(`unitEconomics.lines.${line.id}.driver`, r));
  }
  for (const m of checkUnitEconomicsLines(ue.lines)) add('unitEconomics.lines', m);
  for (const m of checkSubtotals(pkg)) add('unitEconomics.subtotals', m);

  // Peer band
  const tol = roundingTolerance(pkg);
  pkg.peerBand.forEach((entry, i) => {
    const path = `peerBand[${i}]`;
    const pi = periodIds.indexOf(entry.period);
    if (pi < 0) add(path, `${entry.period} is not a period id`);
    if (!entry.rowRef) return;
    const row = resolve(rows, entry.rowRef);
    if (!row) {
      add(path, `${entry.rowRef} does not name a row`);
      return;
    }
    const v = pi >= 0 ? row.cells[pi]?.value ?? null : null;
    const agrees = v === null || entry.value === null ? v === entry.value : Math.abs(v - entry.value) <= tol;
    if (!agrees) add(path, `value ${entry.value} differs from ${entry.rowRef} in ${entry.period} (${v})`);
  });

  return out;
}
