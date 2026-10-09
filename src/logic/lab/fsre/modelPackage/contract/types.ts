// Copied from dikagustiana/dikagustiana.com@bed215d8046986843dcb30b4e88d0977f834f90d src/lib/finance-in-action/contract/types.ts. Do not edit here; re-copy.
/**
 * Finance in Action: the published output contract.
 *
 * PROPOSAL v3.1, pending owner approval and FSRE P-2.
 *
 * One JSON package per model version. FSRE will be made to emit this shape;
 * the viewer only reads it. The same shape is in model-package.schema.json.
 * Additions to the brief's v3.1 shape are marked "ADDITION" and listed in
 * docs/company-models/commit-0-report.md §9; each is optional except the
 * addressing convention below, which the brief left undefined.
 *
 * ADDITION: cell addresses. A formula refers to cells as `<sheet>!<col><row>`,
 * where <sheet> is the sheet id (compared without regard to case, as Excel
 * does), row 1 is the header row, `rows[n]` sits on row n + 2, column A holds
 * the label, column B the unit, and column C the first period. The exported
 * workbook uses the same layout, so formulas are written out unchanged.
 */
import type {
  CellKind,
  Depth,
  GateStatus,
  ModelStatus,
  PeriodKind,
  Provenance,
  RowStyle,
  SheetId,
  TieOutStatus,
  UELineRole,
} from '../constants';

export type { CellKind, Depth, GateStatus, ModelStatus, PeriodKind, Provenance, RowStyle, SheetId, TieOutStatus, UELineRole };

export const CONTRACT_VERSION = 'proposal-v3.1';

/** The addressing convention, as numbers the model layer and the export share. */
export const ADDRESSING = {
  headerRow: 1,
  firstDataRow: 2,
  labelColumn: 1,
  unitColumn: 2,
  firstPeriodColumn: 3,
} as const;

export interface PackageMeta {
  ticker: string;
  name: string;
  /** FSRE sub-industry code. */
  subIndustry: string;
  /**
   * Id from the chain map's stage data (src/data/industryChain.ts STAGES).
   * ADDITION: or one of the two spanning layers, `band-energy` or `band-logistics`.
   */
  chainStage: string;
  /** Other tickers in the same sub-industry. */
  pair: string[];
  /** For example "PTBA-2026Q2-r1". */
  version: string;
  contentHash: string;
  /** Period ids. */
  asOf: { latestQuarter: string; fullStatementsTo: string };
  provenance: Provenance;
  status: ModelStatus;
  depth: Depth;
  /** Section 05 condition numbers. */
  conditionIds: number[];
  skillVersions: Record<string, string>;
  /** ADDITION: the decimals stored values are rounded to; sets the subtotal tolerance. */
  rounding?: { decimals: number };
  /** ADDITION: one line per condition on what this model supplies to it, keyed by condition number. */
  conditionNotes?: Record<string, string>;
}

export interface Period {
  id: string;
  label: string;
  kind: PeriodKind;
  forecast: boolean;
}

export interface CellSource {
  issuer: string;
  document: string;
  period: string;
  page?: number;
  /** Note number in the statements, for example "28". */
  note?: string;
  xbrlConcept?: string;
  docSha256?: string;
}

export interface TieOut {
  externalValue: number;
  sourceText: string;
  difference: number;
  status: TieOutStatus;
}

export interface Cell {
  value: number | null;
  kind: CellKind;
  /** Engine syntax, sheet-qualified references. */
  formula?: string;
  source?: CellSource;
  tieOut?: TieOut;
  /** For example why an assumption holds its value. */
  note?: string;
}

export interface Row {
  id: string;
  label: string;
  unit: string;
  style?: RowStyle;
  /** One per period, same order as periods. */
  cells: Cell[];
}

export interface Sheet {
  id: SheetId;
  rows: Row[];
}

export interface TreeNode {
  id: string;
  label: string;
  /** "sheet!rowId" */
  rowRef: string;
}

export interface DriverTree {
  nodes: TreeNode[];
  edges: { from: string; to: string }[];
}

export interface UEDriver {
  /** For example "Cost per bcm × stripping ratio". */
  description: string;
  /** For example "Rp per bcm". */
  physicalUnit: string;
  /** Rows of the physical drivers behind the line. */
  inputRowRefs: string[];
}

export interface UELine {
  id: string;
  label: string;
  role: UELineRole;
  /** The row holding this line's rupiah value. */
  rowRef: string;
  driver?: UEDriver;
  /** Role 'unsplit' only: what sits inside it. */
  contains?: string[];
}

export interface UnitEconomics {
  /** Native unit, for example "tonne". */
  unit: string;
  /** For example "per tonne of coal sold". */
  basisLabel: string;
  /** The row holding the volume, for example "model!vol_sold". */
  denominatorRowRef: string;
  /** Period ids with note-level detail. */
  periods: string[];
  /** In waterfall order, revenue first. */
  lines: UELine[];
}

export interface PeerBandEntry {
  metric: string;
  unit: string;
  period: string;
  value: number | null;
  /** ADDITION: the row the value is read from; validation holds the two equal. */
  rowRef?: string;
}

export interface Gate {
  name: string;
  status: GateStatus;
  note?: string;
}

export interface Workpaper {
  gates: Gate[];
  /** ADDITION */
  preparedBy?: string;
  approvedBy?: string;
  approvedAt?: string;
}

export interface ModelPackage {
  meta: PackageMeta;
  periods: Period[];
  sheets: Sheet[];
  driverTree: DriverTree;
  unitEconomics: UnitEconomics;
  peerBand: PeerBandEntry[];
  workpaper: Workpaper;
}

/** Splits "sheet!rowId" into its parts. */
export function splitRowRef(rowRef: string): { sheet: string; rowId: string } | null {
  const i = rowRef.indexOf('!');
  if (i <= 0 || i === rowRef.length - 1) return null;
  return { sheet: rowRef.slice(0, i).toLowerCase(), rowId: rowRef.slice(i + 1) };
}
