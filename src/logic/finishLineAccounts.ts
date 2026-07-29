import type {
  FinishLineAccount,
  FinishLineAccountMapRow,
  FinishLineCell,
} from '../data/types';

/**
 * The account level underneath the Finish-line cells.
 *
 * ===========================================================================
 * THE TWO GAP LISTS ARE DIFFERENT PROBLEMS AND MUST NEVER BE SUMMED.
 * ===========================================================================
 *   accounts with no driverType  -> not yet DESIGNED   -> the owner must think
 *   cells with no milestone link -> designed, not ASSIGNED -> must delegate
 *
 * Until now the app could only show the second, so both looked like one
 * problem. They need completely different actions: one is an afternoon at a
 * whiteboard, the other is a conversation. A combined "gaps" figure would hide
 * the only distinction that matters, which is why no function in this file
 * returns one and `AccountCoverage` has no total field to tempt a caller.
 * ===========================================================================
 */

export interface AccountCoverage {
  /** Accounts attached to this cell. */
  total: number;
  /** Have a driver_type — designed. */
  withDriver: number;
  /** No driver_type — NOT YET DESIGNED. Gap list one. */
  withoutDriver: number;
  /**
   * Dummy accounts. Reported ALONGSIDE driver coverage, never folded into it:
   * a cell can be 100% driver-complete and still untrustworthy because the
   * drivers describe placeholder accounts.
   */
  dummy: number;
}

const EMPTY_COVERAGE: AccountCoverage = {
  total: 0,
  withDriver: 0,
  withoutDriver: 0,
  dummy: 0,
};

/** A driver counts as present only when it is a non-blank string. */
export function hasDriver(account: FinishLineAccount): boolean {
  return Boolean(account.driverType?.trim());
}

/**
 * Groups accounts by the cell they belong to.
 *
 * Unmapped accounts (no cellId) are EXCLUDED here on purpose — they belong to
 * no cell by definition. They are not lost: `unmappedAccounts` returns them,
 * and the UI renders that list with its own count.
 */
export function accountsByCell(
  accounts: FinishLineAccount[],
): Map<string, FinishLineAccount[]> {
  const byCell = new Map<string, FinishLineAccount[]>();
  for (const account of accounts) {
    if (!account.cellId) continue;
    const bucket = byCell.get(account.cellId);
    if (bucket) bucket.push(account);
    else byCell.set(account.cellId, [account]);
  }
  return byCell;
}

/**
 * ACCOUNTS WITHOUT A DRIVER SORT FIRST. They are the ones that need thinking,
 * and burying them under sixteen complete ones defeats the purpose of showing
 * the list at all. Within each group, the workbook's own order, then name.
 */
export function sortAccounts(accounts: FinishLineAccount[]): FinishLineAccount[] {
  return [...accounts].sort((a, b) => {
    const aHas = hasDriver(a);
    const bHas = hasDriver(b);
    if (aHas !== bHas) return aHas ? 1 : -1;
    if (a.order !== b.order) return a.order - b.order;
    return a.accountName.localeCompare(b.accountName);
  });
}

export function coverageOf(accounts: FinishLineAccount[]): AccountCoverage {
  if (accounts.length === 0) return EMPTY_COVERAGE;
  let withDriver = 0;
  let dummy = 0;
  for (const account of accounts) {
    if (hasDriver(account)) withDriver += 1;
    if (account.isDummy) dummy += 1;
  }
  return {
    total: accounts.length,
    withDriver,
    withoutDriver: accounts.length - withDriver,
    dummy,
  };
}

/** Coverage for one cell, safe on a cell with no accounts loaded. */
export function coverageForCell(
  cellId: string,
  byCell: Map<string, FinishLineAccount[]>,
): AccountCoverage {
  return coverageOf(byCell.get(cellId) ?? []);
}

/**
 * ===========================================================================
 * THE DISTINCT VALUES, NEVER THE FIRST ONE.
 * ===========================================================================
 * One cell routinely holds accounts that disagree, because more than one
 * mapping row can point at the same metric and each brings its own driver.
 * Rendering `accounts[0].driverType` there would state, flatly and wrongly,
 * that the cell has a single driver — and it would be whichever one happened
 * to sort first.
 *
 * So the panel asks for the whole distinct set and says so when it is plural.
 * Blank and whitespace-only values are dropped rather than shown as an empty
 * option: an account with no driver is counted by `withoutDriver`, and must
 * not also appear here as a nameless third "value".
 *
 * Order is the accounts' own order, so the reading matches the list below.
 */
export type WorkbookField = 'dataIdeal' | 'driverType' | 'pic';

export function distinctFieldValues(
  accounts: FinishLineAccount[],
  field: WorkbookField,
): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const account of accounts) {
    const raw = account[field]?.trim();
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    values.push(raw);
  }
  return values;
}

/**
 * The accounts that matched no metric.
 *
 * MUST BE RENDERED, not filtered away. An unmapped account is a real finding:
 * functions below operating income (finance, other income, tax) have no metric
 * in the current matrix, so this list says what the pack does not yet cover.
 */
export function unmappedAccounts(accounts: FinishLineAccount[]): FinishLineAccount[] {
  return accounts.filter((account) => !account.cellId);
}

/**
 * Unmapped accounts grouped by the Function x Business pair that failed to
 * match, most numerous first — one row per missing mapping rather than one per
 * account, because the action is "add a mapping", not "fix 84 accounts".
 */
export interface UnmappedGroup {
  function: string;
  business: string;
  count: number;
  /**
   * Entities the pair appears in, so the gap can be scoped. Read from
   * `entityCode` — this reported COA numbers until that column existed.
   */
  entities: string[];
}

export function groupUnmapped(accounts: FinishLineAccount[]): UnmappedGroup[] {
  const groups = new Map<string, UnmappedGroup & { entitySet: Set<string> }>();
  for (const account of unmappedAccounts(accounts)) {
    const fn = account.function ?? '(no function)';
    const business = account.business ?? '(no business)';
    const key = `${fn} ${business}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      if (account.entityCode) existing.entitySet.add(account.entityCode);
    } else {
      groups.set(key, {
        function: fn,
        business,
        count: 1,
        entities: [],
        entitySet: new Set(account.entityCode ? [account.entityCode] : []),
      });
    }
  }
  return [...groups.values()]
    .map(({ entitySet, ...group }) => ({
      ...group,
      entities: [...entitySet].sort(),
    }))
    .sort((a, b) => b.count - a.count || a.function.localeCompare(b.function));
}

/**
 * Accounts for one entity, mapped or not.
 *
 * A MAPPED account takes its entity from its cell; an UNMAPPED one has no
 * cell, so it takes it from its own `entityCode`.
 *
 * This used to read `coaEntity` for the unmapped case, and that could never
 * match: `coaEntity` holds a chart-of-accounts number, never an entity code.
 * Every unmapped account therefore reached zero entity pages and the
 * "accounts with no metric" card could not render at all. The fixtures hid it
 * by setting `coaEntity` to an entity code, which the real data never does.
 *
 * Nothing here assumes how many entities exist — a sixth added to
 * os_finish_line_entities flows through unchanged.
 */
export function accountsForEntity(
  accounts: FinishLineAccount[],
  entityCode: string,
  cells: FinishLineCell[],
): FinishLineAccount[] {
  const cellEntity = new Map(cells.map((cell) => [cell.id, cell.entityCode]));
  return accounts.filter((account) =>
    account.cellId ? cellEntity.get(account.cellId) === entityCode : account.entityCode === entityCode,
  );
}

/**
 * Unmapped accounts that have no entity either — they belong to no metric AND
 * to no column, so no entity view can show them and they would vanish
 * entirely. Their entity exists only in the workbook, and guessing it from the
 * COA number would embed a guess in data that then looks authoritative.
 *
 * Surfaced as a count so the owner can classify them at source. They are also
 * invisible to the paste path's identity rule (no consolidation code), which
 * means a replace-all paste would count them among its deletions.
 */
export function accountsWithNoEntity(accounts: FinishLineAccount[]): FinishLineAccount[] {
  return accounts.filter((account) => !account.cellId && !account.entityCode);
}

/**
 * THE TWO COUNTS, CARRIED TOGETHER BUT NEVER ADDED.
 *
 * Returned as one object so a caller cannot accidentally render one while
 * believing it is the other, and with no `total` — the shape itself refuses to
 * produce the combined figure.
 */
export interface GapCounts {
  /** Accounts with no driver: NOT YET DESIGNED. */
  undesignedAccounts: number;
  /** Cells needing work with no milestone link: DESIGNED, NOT ASSIGNED. */
  unassignedCells: number;
}

export function gapCounts(
  accounts: FinishLineAccount[],
  unassignedCells: number,
): GapCounts {
  return {
    undesignedAccounts: accounts.filter((account) => !hasDriver(account)).length,
    unassignedCells,
  };
}

/**
 * The mapping, resolved in the frontend for the synthetic/mock path only.
 *
 * THE DATABASE IS AUTHORITATIVE: os_finish_line_remap_accounts() computes
 * cell_id, and the app reads that stored column. This mirrors the same rule so
 * the mock repository can behave like the real one; it is deliberately the
 * same shape so the two cannot drift into different answers.
 */
export function resolveCellId(
  account: Pick<FinishLineAccount, 'function' | 'business' | 'entityCode'>,
  map: FinishLineAccountMapRow[],
  cells: FinishLineCell[],
): string | undefined {
  if (!account.function || !account.business || !account.entityCode) return undefined;
  const row = map.find(
    (entry) => entry.function === account.function && entry.business === account.business,
  );
  if (!row) return undefined;
  return cells.find(
    (cell) => cell.itemId === row.itemId && cell.entityCode === account.entityCode,
  )?.id;
}

/** The most recent import stamp across a set of accounts, for the header. */
export function latestImportedAt(accounts: FinishLineAccount[]): string | undefined {
  let latest: string | undefined;
  for (const account of accounts) {
    if (!latest || account.importedAt > latest) latest = account.importedAt;
  }
  return latest;
}
