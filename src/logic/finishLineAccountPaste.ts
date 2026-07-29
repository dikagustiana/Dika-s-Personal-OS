/**
 * Paste-to-update for the Finish-line account level.
 *
 * The workbook remains authoritative for driver, owner, target state and the
 * function/business that decide an account's cell. Those fields stay
 * read-only in the app; THIS is the one write path, and it is manual — the
 * owner copies rows out of the consolidation sheet and pastes them. The
 * difference from the banned importer is a cron versus a button: a paste is
 * explicit, triggered by a person, and `imported_at` records when.
 *
 * THE PARSER IS TOLERANT, NOT STRICT — the same stance as the IELTS error
 * log, for the same reason: the input is copied out of Excel, the shape
 * drifts, and a path that rejects a whole paste over one line does not get
 * used. Rows that cannot be identified are rejected VISIBLY and individually;
 * the valid rest commits.
 *
 * The diff is computed here, in one place, because the preview and the commit
 * must describe the same change — a preview computed one way and a commit
 * another is how a quiet cell move slips through.
 */
import type {
  FinishLineAccount,
  FinishLineAccountMapRow,
  FinishLineCell,
  FinishLineItem,
} from '../data/types';

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * The sheet's column order, as copied. Columns AFTER pic may be truncated by
 * the copy and are not required; columns between are positional.
 */
const COL = {
  entity: 0,
  status: 1,
  coaEntity: 2,
  coaConsol: 3,
  accountName: 4,
  function: 5,
  nature: 6,
  business: 7,
  // 8 BS/PL, 9 Balance, 10 Source COA Consol, 11 Source FSLI, 12 Notes/Flag —
  // present in the copy, deliberately unused: balances live in the workbook.
  driverType: 13,
  driverSource: 14,
  dataIdeal: 15,
  pic: 16,
} as const;

/**
 * Values the workbook writes where it means "nothing". `#N/A` is what an
 * unresolved lookup looks like; storing it would make an account appear to
 * have a driver called #N/A.
 */
const EMPTY_MARKS = new Set(['', 'none', '—', '-', '#n/a']);

function cleanField(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (trimmed === undefined || EMPTY_MARKS.has(trimmed.toLowerCase())) return undefined;
  return trimmed;
}

export interface PastedAccountRow {
  /**
   * The sheet's Entity column. Resolves which cell the account belongs to AND
   * is stored on the row: discarding it after the lookup was the gap that left
   * unmapped accounts unreachable by every entity view and made the remap
   * function unable to match anything.
   */
  entity?: string;
  coaEntity?: string;
  coaConsol: string;
  accountName: string;
  function?: string;
  nature?: string;
  business?: string;
  /**
   * From the Status column: `dummy` (case-insensitive) is true, any other
   * non-empty value is false, an EMPTY status is undefined — meaning "the
   * paste does not say", which keeps the existing value on update and
   * defaults to false on insert.
   */
  isDummy?: boolean;
  driverType?: string;
  driverSource?: string;
  dataIdeal?: string;
  pic?: string;
}

export interface RejectedPasteRow {
  /** 1-based line number in the pasted text, so the preview can point at it. */
  line: number;
  /** The line as pasted, truncated for display. */
  raw: string;
  reason: string;
}

export interface AccountPasteParse {
  rows: PastedAccountRow[];
  rejected: RejectedPasteRow[];
  /** Header rows discarded silently — discarded is not an error. */
  discardedHeaders: number;
}

/**
 * Parses a block copied straight out of the consolidation sheet.
 *
 * Tolerated, because Excel copies produce all of them: \r\n line endings,
 * trailing tabs, trailing blank lines, an included header row, and columns
 * truncated after PIC. A row missing COA Consol or Account Name cannot be
 * identified against the natural key and is rejected visibly — never guessed
 * at, and never allowed to sink the rest of the paste.
 */
export function parseAccountPaste(text: string): AccountPasteParse {
  const rows: PastedAccountRow[] = [];
  const rejected: RejectedPasteRow[] = [];
  let discardedHeaders = 0;

  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  lines.forEach((rawLine, index) => {
    const line = index + 1;
    if (rawLine.trim() === '') return; // blank lines, trailing or not

    const cells = rawLine.split('\t');
    const first = cells[0]?.trim().toLowerCase();
    const second = cells[1]?.trim().toLowerCase();
    // A header row may or may not be included — discard, do not reject.
    if (first === 'entity' && second === 'status') {
      discardedHeaders += 1;
      return;
    }

    const coaConsol = cleanField(cells[COL.coaConsol]);
    const accountName = cleanField(cells[COL.accountName]);
    if (!coaConsol || !accountName) {
      rejected.push({
        line,
        raw: rawLine.length > 120 ? `${rawLine.slice(0, 120)}…` : rawLine,
        reason: !accountName
          ? 'Account Name kosong — baris tidak bisa diidentifikasi'
          : 'COA Consol kosong — baris tidak bisa diidentifikasi',
      });
      return;
    }

    const status = cleanField(cells[COL.status]);
    rows.push({
      entity: cleanField(cells[COL.entity]),
      coaEntity: cleanField(cells[COL.coaEntity]),
      coaConsol,
      accountName,
      function: cleanField(cells[COL.function]),
      nature: cleanField(cells[COL.nature]),
      business: cleanField(cells[COL.business]),
      isDummy: status === undefined ? undefined : status.toLowerCase() === 'dummy',
      driverType: cleanField(cells[COL.driverType]),
      driverSource: cleanField(cells[COL.driverSource]),
      dataIdeal: cleanField(cells[COL.dataIdeal]),
      pic: cleanField(cells[COL.pic]),
    });
  });

  return { rows, rejected, discardedHeaders };
}

// ---------------------------------------------------------------------------
// The diff — what a commit would actually do
// ---------------------------------------------------------------------------

/**
 * Natural-key identity, mirroring the database's unique index semantics:
 * COALESCE(coa_entity,'') · COALESCE(coa_consol,'') · account_name. Tab is a
 * safe separator because every field arrived out of a tab-split.
 */
function naturalKey(coaEntity: string | undefined, coaConsol: string | undefined, name: string): string {
  return `${coaEntity ?? ''}\t${coaConsol ?? ''}\t${name}`;
}

/**
 * Resolves the cell a pasted row belongs to, EXACTLY as the original load
 * did: function × business finds the mapping row, the mapping row's metric ×
 * the SHEET'S entity column finds the cell, and no match means null — the
 * row persists unmapped rather than being dropped.
 *
 * Deliberately NOT os_finish_line_remap_accounts(): that function joins the
 * cell's entity against coa_entity, which holds a chart-of-accounts number,
 * so running it against the loaded data would null every mapping. The paste
 * carries the real entity per row, so it resolves the way the loader did.
 */
function resolveCell(
  row: Pick<PastedAccountRow, 'entity' | 'function' | 'business'>,
  map: FinishLineAccountMapRow[],
  cells: FinishLineCell[],
): string | null {
  if (!row.entity || !row.function || !row.business) return null;
  const mapRow = map.find((m) => m.function === row.function && m.business === row.business);
  if (!mapRow) return null;
  const cell = cells.find((c) => c.itemId === mapRow.itemId && c.entityCode === row.entity);
  return cell?.id ?? null;
}

/** The workbook-owned fields a paste may change on an existing account. */
const PASTE_FIELDS = [
  'function',
  'nature',
  'business',
  'driverType',
  'driverSource',
  'dataIdeal',
  'pic',
] as const;

export interface PlannedUpsert {
  /** Present for an update, absent for an insert. */
  id?: string;
  cellId: string | null;
  /** The sheet's Entity column, stored — not merely used and discarded. */
  entityCode?: string;
  coaEntity?: string;
  coaConsol: string;
  accountName: string;
  function?: string;
  nature?: string;
  business?: string;
  isDummy: boolean;
  driverType?: string;
  driverSource?: string;
  dataIdeal?: string;
  pic?: string;
  sortOrder: number;
}

export interface MetricMove {
  accountName: string;
  /** Metric labels; '(tidak terpetakan)' when a side resolves to no cell. */
  fromMetric: string;
  toMetric: string;
}

export interface AccountPasteDiff {
  updated: PlannedUpsert[];
  added: PlannedUpsert[];
  /** Replace mode only: rows in the table but absent from the paste. */
  deleted: FinishLineAccount[];
  unchanged: number;
  /**
   * THE HIGHEST-CONSEQUENCE EDIT IN THIS PATH. An account changing cell moves
   * two coverage figures and two gap counts, and nothing else in the preview
   * would reveal it — so every move is named, old metric and new.
   */
  metricMoves: MetricMove[];
  /** Rows whose new function × business maps to no metric — kept, unmapped. */
  unmappedLandings: string[];
  /** Workbook facts changed, cell unchanged — the quiet, common case. */
  quietChanges: number;
}

const UNMAPPED_LABEL = '(tidak terpetakan)';

function metricLabelOfCell(
  cellId: string | null,
  cells: Map<string, FinishLineCell>,
  items: Map<string, FinishLineItem>,
): string {
  if (!cellId) return UNMAPPED_LABEL;
  const cell = cells.get(cellId);
  const item = cell ? items.get(cell.itemId) : undefined;
  return item?.item ?? UNMAPPED_LABEL;
}

export function buildAccountPasteDiff(input: {
  parsed: PastedAccountRow[];
  existing: FinishLineAccount[];
  map: FinishLineAccountMapRow[];
  cells: FinishLineCell[];
  items: FinishLineItem[];
  mode: 'upsert' | 'replace';
}): AccountPasteDiff {
  const { parsed, existing, map, cells, items, mode } = input;
  const cellsById = new Map(cells.map((c) => [c.id, c]));
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const existingByKey = new Map(
    existing.map((a) => [naturalKey(a.coaEntity, a.coaConsol, a.accountName), a]),
  );

  const updated: PlannedUpsert[] = [];
  const added: PlannedUpsert[] = [];
  const metricMoves: MetricMove[] = [];
  const unmappedLandings: string[] = [];
  let unchanged = 0;
  let quietChanges = 0;

  let nextSort = existing.reduce((max, a) => Math.max(max, a.order), -1) + 1;
  const pastedKeys = new Set<string>();

  for (const row of parsed) {
    const key = naturalKey(row.coaEntity, row.coaConsol, row.accountName);
    // Last occurrence wins within one paste; duplicates in one block are the
    // same row copied twice, not two accounts (the natural key says so).
    if (pastedKeys.has(key)) continue;
    pastedKeys.add(key);

    const current = existingByKey.get(key);
    const newCellId = resolveCell(row, map, cells);
    if (newCellId === null && row.function && row.business) {
      unmappedLandings.push(row.accountName);
    }

    if (!current) {
      added.push({
        cellId: newCellId,
        entityCode: row.entity,
        coaEntity: row.coaEntity,
        coaConsol: row.coaConsol,
        accountName: row.accountName,
        function: row.function,
        nature: row.nature,
        business: row.business,
        isDummy: row.isDummy ?? false,
        driverType: row.driverType,
        driverSource: row.driverSource,
        dataIdeal: row.dataIdeal,
        pic: row.pic,
        sortOrder: nextSort++,
      });
      continue;
    }

    const fieldChanged = PASTE_FIELDS.some((f) => (row[f] ?? undefined) !== (current[f] ?? undefined));
    const dummyChanged = row.isDummy !== undefined && row.isDummy !== current.isDummy;
    const entityChanged = row.entity !== undefined && row.entity !== current.entityCode;
    const cellChanged = newCellId !== (current.cellId ?? null);

    if (!fieldChanged && !dummyChanged && !cellChanged && !entityChanged) {
      unchanged += 1;
      continue;
    }

    if (cellChanged) {
      metricMoves.push({
        accountName: row.accountName,
        fromMetric: metricLabelOfCell(current.cellId ?? null, cellsById, itemsById),
        toMetric: metricLabelOfCell(newCellId, cellsById, itemsById),
      });
    } else {
      quietChanges += 1;
    }

    updated.push({
      id: current.id,
      cellId: newCellId,
      // Falls back to what the row already has, so a paste whose Entity column
      // was truncated does not blank an entity that is already correct.
      entityCode: row.entity ?? current.entityCode,
      coaEntity: row.coaEntity,
      coaConsol: row.coaConsol,
      accountName: row.accountName,
      function: row.function,
      nature: row.nature,
      business: row.business,
      isDummy: row.isDummy ?? current.isDummy,
      driverType: row.driverType,
      driverSource: row.driverSource,
      dataIdeal: row.dataIdeal,
      pic: row.pic,
      sortOrder: current.order,
    });
  }

  // UPSERT NEVER DELETES — the diff cannot even express it. Only replace mode
  // computes a deletion set, and the UI adds its own confirm on top.
  const deleted =
    mode === 'replace'
      ? existing.filter((a) => !pastedKeys.has(naturalKey(a.coaEntity, a.coaConsol, a.accountName)))
      : [];

  return { updated, added, deleted, unchanged, metricMoves, unmappedLandings, quietChanges };
}

/**
 * Replace-all refuses a small paste. A partial paste in replace mode would
 * delete hundreds of accounts silently, and the most likely way to trigger
 * that is picking the wrong mode by accident — so the floor is a hard rule
 * here in the logic, not a soft warning in the UI.
 */
export const REPLACE_MIN_ROWS = 100;

export function replaceRefusalReason(parsedRowCount: number): string | undefined {
  if (parsedRowCount >= REPLACE_MIN_ROWS) return undefined;
  return `Ganti semua ditolak: hanya ${parsedRowCount} baris valid, minimum ${REPLACE_MIN_ROWS}. Paste sebagian dalam mode ganti akan menghapus ratusan akun.`;
}
