/**
 * ===========================================================================
 * TEXT IS EDITABLE. STRUCTURE IS NOT. THIS MODULE IS WHERE THAT LINE LIVES.
 * ===========================================================================
 * The process feature used to be read-only except os_process_needs.
 * requested_on. That is deliberately over — the map is a written artefact and
 * will keep being revised, and changing one word in a note should not cost a
 * migration.
 *
 * What did NOT change is the other half. `slot`, `lane_key`, `track` and
 * `label` decide the diagram's TOPOLOGY: which column a box sits in, which
 * cells stack, how the two path walks pair up, whether the phase ribbon tiles
 * its slots. Editing those from the app could break an invariant WITHOUT ANY
 * SYMPTOM — the canvas would still draw, the numbers would just quietly stop
 * being the pinned ones. So they are not editable, and the guarantee is not a
 * disabled input somewhere: the write types below cannot NAME those columns,
 * so a payload carrying one does not typecheck.
 *
 * `gate_id` IS editable, and the distinction is the point: a gate changes an
 * annotation and the gap spotlight, never the topology.
 *
 * The parsers are here rather than in the panel because their failure mode is
 * the interesting part. `docs`, `drivers` and `coa` are edited as one item per
 * line, and the tempting implementation drops whatever does not parse. That is
 * silent data loss — the user saves, the malformed line vanishes, and nothing
 * says so. These reject instead, naming the LINE NUMBER, and the save does not
 * proceed.
 */
import type { ProcessCoaRef } from '../data/types';

// --- the editable surface, as types the wrong payload cannot satisfy --------

/**
 * Steps: prose, the three list columns, and the gate reference. NOT label,
 * slot, laneKey, track or entityCode — see the header; their absence here is
 * the enforcement.
 */
export interface ProcessStepTextWrite {
  name: string;
  co: string | null;
  risk: string | null;
  control: string | null;
  note: string | null;
  gateId: string | null;
  docs: string[];
  coa: ProcessCoaRef[];
  drivers: string[];
}

/** Needs: everything except the step it belongs to. */
export interface ProcessNeedTextWrite {
  item: string;
  kind: string;
  src: string | null;
  owner: string | null;
  status: string;
  requestedOn: string | null;
}

/** Gates: the prose. NOT the id (it is the key) and NOT the type. */
export interface ProcessGateTextWrite {
  title: string;
  sub: string | null;
  owner: string | null;
  unblock: string | null;
}

/** Lanes: what the label says. NOT key, ordinal or isExternal. */
export interface ProcessLaneTextWrite {
  label: string;
  description: string | null;
}

/** Phases: the name only. slotFrom/slotTo are the ribbon's geometry. */
export interface ProcessPhaseTextWrite {
  name: string;
}

/**
 * The vocabularies, mirrored from the CHECK constraints. The UI offers these
 * as selects so a value outside them cannot be typed; the database would
 * reject it anyway, and a rejection the user cannot see coming is a worse way
 * to learn the rule.
 */
export const NEED_KINDS = ['MASTER', 'TRANSAKSI', 'PARAMETER', 'REFERENSI'] as const;
export const NEED_STATUSES = ['ADA', 'SEBAGIAN', 'BELUM'] as const;

// --- line-oriented parsing, with failures that name the line ---------------

export interface ParseFailure {
  /** 1-based, as the person editing counts them. */
  line: number;
  message: string;
}

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: ParseFailure[] };

/**
 * Blank lines are skipped, not errors: a trailing newline is how textareas
 * end, and an empty line between entries is how people group them. A line
 * with only whitespace is the same thing.
 */
function meaningfulLines(text: string): Array<{ line: number; content: string }> {
  return text
    .split('\n')
    .map((content, index) => ({ line: index + 1, content: content.trim() }))
    .filter((entry) => entry.content.length > 0);
}

/** docs and drivers: one item per line, no further structure. */
export function parseLineList(text: string): ParseResult<string[]> {
  return { ok: true, value: meaningfulLines(text).map((entry) => entry.content) };
}

export function formatLineList(items: string[]): string {
  return items.join('\n');
}

/**
 * coa: `code | label` per line. Both halves required — a code with no label
 * is unreadable in the panel, and a label with no code cannot be looked up.
 * Every bad line is reported, not just the first: fixing them one round trip
 * at a time is its own small punishment.
 */
export function parseCoaList(text: string): ParseResult<ProcessCoaRef[]> {
  const errors: ParseFailure[] = [];
  const value: ProcessCoaRef[] = [];
  for (const entry of meaningfulLines(text)) {
    const parts = entry.content.split('|');
    if (parts.length < 2) {
      errors.push({
        line: entry.line,
        message: `Baris ${entry.line}: tidak ada tanda "|". Format satu baris: kode | keterangan`,
      });
      continue;
    }
    if (parts.length > 2) {
      errors.push({
        line: entry.line,
        message: `Baris ${entry.line}: ada lebih dari satu "|". Format satu baris: kode | keterangan`,
      });
      continue;
    }
    const code = parts[0].trim();
    const label = parts[1].trim();
    if (!code) {
      errors.push({ line: entry.line, message: `Baris ${entry.line}: kode kosong sebelum "|"` });
      continue;
    }
    if (!label) {
      errors.push({
        line: entry.line,
        message: `Baris ${entry.line}: keterangan kosong sesudah "|"`,
      });
      continue;
    }
    value.push({ code, label });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}

export function formatCoaList(entries: ProcessCoaRef[]): string {
  return entries.map((entry) => `${entry.code} | ${entry.label}`).join('\n');
}

// --- the audit diff ---------------------------------------------------------

export interface TextHistoryRow {
  tableName: string;
  rowId: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

/** Empty string and absent are the same absence; '' vs null must not log. */
function normalise(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return JSON.stringify(value);
  const text = String(value);
  return text.length === 0 ? null : text;
}

/**
 * One row PER CHANGED FIELD, so "what changed" is answerable without diffing
 * two snapshots. Fields that did not move produce nothing — a save that
 * touched one word must not write nine rows claiming otherwise.
 */
export function diffForHistory(
  tableName: string,
  rowId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): TextHistoryRow[] {
  const rows: TextHistoryRow[] = [];
  for (const field of Object.keys(after)) {
    const oldValue = normalise(before[field]);
    const newValue = normalise(after[field]);
    if (oldValue === newValue) continue;
    rows.push({ tableName, rowId, field, oldValue, newValue });
  }
  return rows;
}

/** True when anything in the form differs from what was loaded. */
export function isDirty(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): boolean {
  return diffForHistory('', '', before, after).length > 0;
}
