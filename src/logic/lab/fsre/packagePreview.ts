/**
 * FSRE BUILDING — READING A STAGED PACKAGE BEFORE APPROVING IT.
 *
 * The partner room (4F) shows the owner the package the approve button
 * publishes (PRD "FSRE publish path" §6.2 C). The package arrives as the
 * database staged it (fsre.preview_package, through fsreApproval.ts) and is
 * trusted for nothing: this module checks its shape, runs the site's own
 * contract rules (validatePackage) and engine checks (checkFormulas) from the
 * pinned copies under modelPackage/, and works out what the panel shows —
 * cells per kind, tie-outs that differ or were never checked, the workpaper
 * gates, the provenance — so FsrePackagePreview.tsx holds no arithmetic and
 * no literal (rule 2 of fsreRules.test.ts).
 *
 * WHAT IT NEVER DOES. It edits nothing: 4F is a preview, not a sandbox
 * (the site's viewer lets a reader try an assumption; this one does not).
 * It loosens nothing: a package the site would refuse is shown WITH its
 * issues listed above the grid, and the approve button's own rule stays in
 * the database. And it never formats a number itself: package figures go
 * through the site's formatter (modelPackage/format.ts), so 4F shows the
 * figure as the site will show it; the building's counts go through the
 * building's own (format.ts).
 */
import { formatCount, formatNumber } from './format';
import type { Tone } from './glyphs';
import { CELL_KINDS, GATE_STATUSES, PROVENANCES, SHEETS, TIE_OUT_STATUSES, byId, type CellKind, type Provenance, type SheetId, type TieOutStatus } from './modelPackage/constants';
import type { Cell, Gate, ModelPackage, Period, Row, Sheet } from './modelPackage/contract/types';
import { validatePackage, type ValidationIssue } from './modelPackage/contract/validate';
import { formatForRow } from './modelPackage/format';
import { checkFormulas } from './modelPackage/model/checks';
import { Workbook } from './modelPackage/model/workbook';
import { EVENT_KIND_WORDS, FOLDER_STATUS_WORDS } from './statuses';
import type { FsrePackagePreview } from './eventSource';

/** The provenance the production site accepts (PRD §6.3 A); anything else is shown with a warning here and refused there. */
export const PRODUCTION_PROVENANCE: Provenance = 'filings';

/** A release's status, in the building's words (one vocabulary, statuses.ts). */
export const RELEASE_STATUS_WORDS: Record<FsrePackagePreview['status'], string> = {
  staged: EVENT_KIND_WORDS.package_staged,
  published: FOLDER_STATUS_WORDS.published,
};

/** How a cell kind is drawn: a glyph and a tone, never a colour alone (the legend adds the word). */
export const CELL_KIND_MARKS: Record<CellKind, { glyph: string; tone: Tone }> = {
  sourced: { glyph: '●', tone: 'done' },
  formula: { glyph: 'ƒ', tone: 'neutral' },
  assumption: { glyph: '◆', tone: 'escalated' },
  missing: { glyph: '—', tone: 'idle' },
};

export const TIE_OUT_TONES: Record<TieOutStatus, Tone> = { agrees: 'done', differs: 'failed', not_checked: 'idle' };

/** Issues listed above the grid before "and N more". */
export const ISSUES_SHOWN = 12;
/** Characters of the content hash shown beside the approve button; the full hash sits in a title. */
export const HASH_SHOWN = 12;

export interface PackageSummary {
  cells: number;
  byKind: Record<CellKind, number>;
  tieOuts: Record<TieOutStatus, number>;
  gates: Gate[];
  provenance: Provenance;
  /** The sentence PROVENANCES gives this provenance; empty for filings. */
  provenanceNote: string;
  productionReady: boolean;
}

export type PackageReading =
  | { ok: true; pkg: ModelPackage; issues: ValidationIssue[]; summary: PackageSummary; sheets: SheetId[] }
  | { ok: false; detail: string };

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * The shape the contract types assume, checked before the rules run: the
 * site reads packages its own suite built, 4F reads whatever was staged.
 * Only what validatePackage and Workbook dereference is checked here; the
 * rest they report themselves.
 */
export function packageShapeProblem(raw: unknown): string | null {
  if (!isRecord(raw)) return 'the package is not an object';
  const meta = raw.meta;
  if (!isRecord(meta) || typeof meta.ticker !== 'string' || typeof meta.version !== 'string' || typeof meta.name !== 'string') return 'meta lacks ticker, name or version';
  if (!isRecord(meta.asOf) || typeof meta.provenance !== 'string' || !Array.isArray(meta.conditionIds) || !Array.isArray(meta.pair)) return 'meta lacks asOf, provenance, pair or conditionIds';
  if (!byId(PROVENANCES, meta.provenance)) return `meta.provenance "${meta.provenance}" is not a provenance the contract knows`;
  if (!Array.isArray(raw.periods) || !raw.periods.every((p) => isRecord(p) && typeof p.id === 'string' && typeof p.label === 'string')) return 'periods is not a list of periods';
  if (!Array.isArray(raw.sheets)) return 'sheets is not a list';
  for (const sheet of raw.sheets) {
    if (!isRecord(sheet) || typeof sheet.id !== 'string' || !byId(SHEETS, sheet.id)) return 'a sheet lacks an id the contract knows';
    if (!Array.isArray(sheet.rows)) return `sheet ${sheet.id} has no rows list`;
    for (const row of sheet.rows) {
      if (!isRecord(row) || typeof row.id !== 'string' || typeof row.label !== 'string' || typeof row.unit !== 'string' || !Array.isArray(row.cells)) return `sheet ${sheet.id} has a row without id, label, unit or cells`;
      for (const cell of row.cells) {
        if (!isRecord(cell) || !('value' in cell) || typeof cell.kind !== 'string' || !byId(CELL_KINDS, cell.kind)) return `row ${sheet.id}!${row.id} has a cell without a value or a known kind`;
        if (cell.value !== null && typeof cell.value !== 'number') return `row ${sheet.id}!${row.id} has a cell whose value is not a number or null`;
      }
    }
  }
  const tree = raw.driverTree;
  if (!isRecord(tree) || !Array.isArray(tree.nodes) || !Array.isArray(tree.edges)) return 'driverTree lacks nodes or edges';
  const ue = raw.unitEconomics;
  if (!isRecord(ue) || typeof ue.unit !== 'string' || typeof ue.denominatorRowRef !== 'string' || !Array.isArray(ue.periods) || !Array.isArray(ue.lines)) return 'unitEconomics lacks unit, denominatorRowRef, periods or lines';
  if (!Array.isArray(raw.peerBand)) return 'peerBand is not a list';
  const workpaper = raw.workpaper;
  if (!isRecord(workpaper) || !Array.isArray(workpaper.gates) || !workpaper.gates.every((g) => isRecord(g) && typeof g.name === 'string' && typeof g.status === 'string' && byId(GATE_STATUSES, g.status))) {
    return 'workpaper.gates is not a list of gates with a known status';
  }
  return null;
}

function emptyCounts<K extends string>(ids: readonly K[]): Record<K, number> {
  return Object.fromEntries(ids.map((id) => [id, 0])) as Record<K, number>;
}

export function summarise(pkg: ModelPackage): PackageSummary {
  const byKind = emptyCounts(CELL_KINDS.map((k) => k.id));
  const tieOuts = emptyCounts(TIE_OUT_STATUSES.map((t) => t.id));
  let cells = 0;
  for (const sheet of pkg.sheets) {
    for (const row of sheet.rows) {
      for (const cell of row.cells) {
        cells += 1;
        byKind[cell.kind] += 1;
        if (cell.tieOut) tieOuts[cell.tieOut.status] += 1;
      }
    }
  }
  const provenance = pkg.meta.provenance;
  return {
    cells,
    byKind,
    tieOuts,
    gates: pkg.workpaper.gates,
    provenance,
    provenanceNote: byId(PROVENANCES, provenance)?.note ?? '',
    productionReady: provenance === PRODUCTION_PROVENANCE,
  };
}

/** Shape, then the site's rules, then the engine; the issues are listed, never hidden, and a bad shape is a reading that failed. */
export function readPackage(raw: unknown): PackageReading {
  const problem = packageShapeProblem(raw);
  if (problem) return { ok: false, detail: `The staged package does not have the shape of a model package: ${problem}.` };
  const pkg = raw as ModelPackage;
  let issues: ValidationIssue[];
  try {
    issues = validatePackage(pkg);
    if (issues.length === 0) issues = checkFormulas(new Workbook(pkg));
  } catch (error) {
    return { ok: false, detail: `The package could not be checked: ${error instanceof Error ? error.message : String(error)}` };
  }
  const sheets = SHEETS.map((s) => s.id).filter((id) => pkg.sheets.some((sheet) => sheet.id === id));
  return { ok: true, pkg, issues, summary: summarise(pkg), sheets };
}

/** The provenance of a staged package, read without the full checks (the warning beside the approve button needs only this). */
export function provenanceOf(raw: unknown): Provenance | null {
  if (!isRecord(raw) || !isRecord(raw.meta) || typeof raw.meta.provenance !== 'string') return null;
  return byId(PROVENANCES, raw.meta.provenance)?.id ?? null;
}

export const shortHash = (hash: string): string => hash.slice(0, HASH_SHOWN);

/** The issues the panel lists, and how many it does not. */
export function issuesShown(issues: readonly ValidationIssue[]): { lines: string[]; more: number } {
  return { lines: issues.slice(0, ISSUES_SHOWN).map((i) => `${i.path}: ${i.message}`), more: Math.max(0, issues.length - ISSUES_SHOWN) };
}

export const sheetOf = (pkg: ModelPackage, id: SheetId): Sheet | undefined => pkg.sheets.find((s) => s.id === id);

/** The tab that is open: the chosen sheet when the package has it, else the first in contract order. */
export const activeSheetId = (sheets: readonly SheetId[], chosen: SheetId | null): SheetId | undefined =>
  chosen && sheets.includes(chosen) ? chosen : sheets.at(0);

/** One cell's text for the grid: the site's house format for the row (ratios as percentages). */
export const cellText = (cell: Cell, row: Row): string => formatForRow(cell.value, row);

/** "12 cells" and the like, in the building's own formatter. */
export const cellsText = (count: number): string => formatCount(count, 'cell');

/** A page number, a count or a tie-out figure as text (rule 7: never a raw number in a component). */
export const numberText = (value: number): string => formatNumber(value);

export interface CellSelection {
  sheetId: SheetId;
  rowIndex: number;
  periodIndex: number;
}

export interface CellDetail {
  row: Row;
  period: Period;
  cell: Cell;
  kindWord: string;
  value: string;
  tieOut: { word: string; tone: Tone; external: string; difference: string; sourceText: string } | null;
}

/** What the inspector says about the selected cell, or null when the selection no longer names a cell. */
export function cellDetail(pkg: ModelPackage, selection: CellSelection): CellDetail | null {
  const row = sheetOf(pkg, selection.sheetId)?.rows[selection.rowIndex];
  const period = pkg.periods[selection.periodIndex];
  const cell = row?.cells[selection.periodIndex];
  if (!row || !period || !cell) return null;
  const tie = cell.tieOut;
  return {
    row,
    period,
    cell,
    kindWord: byId(CELL_KINDS, cell.kind)?.label ?? cell.kind,
    value: cellText(cell, row),
    tieOut: tie
      ? {
          word: byId(TIE_OUT_STATUSES, tie.status)?.label ?? tie.status,
          tone: TIE_OUT_TONES[tie.status],
          external: formatForRow(tie.externalValue, row),
          difference: formatForRow(tie.difference, row),
          sourceText: tie.sourceText,
        }
      : null,
  };
}

/** A gate's glyph and word, from the contract's own list. */
export function gateMark(gate: Gate): { glyph: string; word: string; tone: Tone } {
  const entry = byId(GATE_STATUSES, gate.status);
  const tone: Tone = gate.status === 'passed' ? 'done' : gate.status === 'failed' ? 'failed' : gate.status === 'passed_with_escalation' ? 'escalated' : 'idle';
  return { glyph: entry?.glyph ?? '', word: entry?.label ?? gate.status, tone };
}
