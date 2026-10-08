// Copied from dikagustiana/dikagustiana.com@bed215d8046986843dcb30b4e88d0977f834f90d src/lib/finance-in-action/constants.ts. Do not edit here; re-copy.
/**
 * Finance in Action: the lists the contract and the viewer share, each defined
 * once (constraint 6). Types in ./contract derive from these; the JSON Schema
 * repeats the value lists because JSON cannot import, and
 * tests/unit/fiaContract.test.ts holds the two equal.
 *
 * Colour never carries meaning alone (constraint 13): every entry that has a
 * colour also has a glyph or a pattern and a word.
 */

/** Publication status of a company model. Glyph plus word, always. */
export const STATUSES = [
  { id: 'published', label: 'Published', glyph: 'full', means: 'An approved model version.' },
  { id: 'preview', label: 'Preview', glyph: 'half', means: 'Built and shown for review; not yet approved.' },
  { id: 'in_progress', label: 'In progress', glyph: 'quarter', means: 'Being built by the suite.' },
  { id: 'not_started', label: 'Not started', glyph: 'empty', means: 'Planned; nothing built yet.' },
] as const;

/** How a cell came to hold its value. */
export const CELL_KINDS = [
  {
    id: 'sourced',
    label: 'Sourced',
    means: 'Read out of a filing; the source is named.',
    className: 'text-fia-sourced',
  },
  {
    id: 'formula',
    label: 'Formula',
    means: 'Worked from other cells.',
    className: 'text-foreground',
  },
  {
    id: 'assumption',
    label: 'Assumption',
    means: 'Set by the model for a forecast period. Editable here, in this browser only.',
    className: 'bg-fia-assumption-bg text-fia-assumption-fg',
  },
  {
    id: 'missing',
    label: 'Missing',
    means: 'Not disclosed, so not filled in.',
    className: 'text-fia-missing italic',
  },
] as const;

/** The role of a line in the unit-economics waterfall. */
export const UE_LINE_ROLES = [
  { id: 'revenue', label: 'Revenue', fill: 'primary' },
  { id: 'cost', label: 'Named cost line', fill: 'cost' },
  { id: 'subtotal', label: 'Subtotal', fill: 'primary' },
  { id: 'unsplit', label: 'Unsplit remainder', fill: 'unsplit' },
] as const;

/**
 * The colour roles of the Connections lens and of edits. Each has its glyph:
 * precedents ▲, dependents ▼ (constraint 13). `className` is a tint for a
 * cell, a node or a table row; bars use the same tokens through `token`.
 */
export const LENS_ROLES = [
  { id: 'selected', label: 'Selected', glyph: '●', className: 'ring-2 ring-ring ring-inset', token: '--ring' },
  { id: 'precedent', label: 'Feeds the selection', glyph: '▲', className: 'bg-fia-precedent', token: '--fia-precedent' },
  { id: 'dependent', label: 'Fed by the selection', glyph: '▼', className: 'bg-fia-dependent', token: '--fia-dependent' },
  { id: 'changed', label: 'Changed by your edit', glyph: 'Δ', className: 'bg-fia-changed', token: '--fia-changed' },
  { id: 'edited', label: 'Edited by you', glyph: '✎', className: 'outline outline-2 -outline-offset-2 outline-fia-edited', token: '--fia-edited' },
] as const;

/** Workpaper gate outcomes. A pass with an open escalation never looks like a clean pass. */
export const GATE_STATUSES = [
  { id: 'passed', label: 'Passed', glyph: '✓' },
  { id: 'passed_with_escalation', label: 'Passed with an open escalation', glyph: '!' },
  { id: 'failed', label: 'Failed', glyph: '✗' },
  { id: 'not_run', label: 'Not run', glyph: '–' },
] as const;

/** Where a package's figures come from; the sentence is the provenance note. */
export const PROVENANCES = [
  { id: 'filings', label: 'Filings', note: '' },
  {
    id: 'fixture',
    label: 'Fixture',
    note: 'Development fixture: these figures are leads for testing the viewer, not checked against filings.',
  },
  {
    id: 'synthetic',
    label: 'SYNTHETIC',
    note: 'SYNTHETIC: every figure on this page is invented, in round numbers, to exercise the viewer. No company and no filing stands behind it.',
  },
] as const;

export const DEPTHS = [
  { id: 'foundation', label: 'Foundation' },
  { id: 'executive', label: 'Executive' },
  { id: 'institutional', label: 'Institutional' },
] as const;

/** The three sheets of a package, in tab order. */
export const SHEETS = [
  { id: 'reported', label: 'Reported', means: 'Figures as filed, with their sources.' },
  { id: 'model', label: 'Model', means: 'The operation rebuilt: drivers, cost lines and profit, all formulas.' },
  { id: 'assumptions', label: 'Assumptions', means: 'History worked from the model, and the forecast inputs you can edit.' },
] as const;

export const PERIOD_KINDS = ['quarter', 'fy'] as const;
export const ROW_STYLES = ['total', 'ratio'] as const;
export const TIE_OUT_STATUSES = [
  { id: 'agrees', label: 'Agrees' },
  { id: 'differs', label: 'Differs' },
  { id: 'not_checked', label: 'Not checked' },
] as const;

type Ids<T extends readonly { id: string }[]> = T[number]['id'];
export type ModelStatus = Ids<typeof STATUSES>;
export type CellKind = Ids<typeof CELL_KINDS>;
export type UELineRole = Ids<typeof UE_LINE_ROLES>;
export type LensRole = Ids<typeof LENS_ROLES>;
export type GateStatus = Ids<typeof GATE_STATUSES>;
export type Provenance = Ids<typeof PROVENANCES>;
export type Depth = Ids<typeof DEPTHS>;
export type SheetId = Ids<typeof SHEETS>;
export type PeriodKind = (typeof PERIOD_KINDS)[number];
export type RowStyle = (typeof ROW_STYLES)[number];
export type TieOutStatus = Ids<typeof TIE_OUT_STATUSES>;

export const ids = <T extends readonly { id: string }[]>(list: T): Ids<T>[] => list.map((x) => x.id as Ids<T>);

export function byId<T extends readonly { id: string }[]>(list: T, id: string): T[number] | undefined {
  return list.find((x) => x.id === id);
}
