import { describe, expect, it } from 'vitest';
import type {
  FinishLineAccount,
  FinishLineAccountMapRow,
  FinishLineCell,
  FinishLineItem,
} from '../data/types';
import {
  buildAccountPasteDiff,
  parseAccountPaste,
  REPLACE_MIN_ROWS,
  replaceRefusalReason,
} from './finishLineAccountPaste';

// ===========================================================================
// ENTIRELY SYNTHETIC. No real account name, COA code, entity, driver, owner
// or figure appears here — the owner's chart of accounts is internal and this
// repo is public.
// ===========================================================================

/** A sheet row in the copied column order, tab-joined. */
function sheetRow(over: Partial<Record<string, string>> = {}): string {
  const cells = [
    over.entity ?? 'ALPHA', // 0 Entity
    over.status ?? 'Active', // 1 Status
    over.coaEntity ?? '900.001', // 2 COA Entity
    over.coaConsol ?? '9.9.99.0001', // 3 COA Consol
    over.accountName ?? 'Widget sales', // 4 Account Name
    over.function ?? 'Widget Function', // 5 Function
    over.nature ?? 'Widget Nature', // 6 Nature (FF)
    over.business ?? 'Channel One', // 7 Business
    over.bspl ?? 'PL', // 8 BS/PL
    over.balance ?? '123', // 9 Balance
    over.sourceConsol ?? '', // 10 Source COA Consol
    over.sourceFsli ?? '', // 11 Source FSLI
    over.notes ?? '', // 12 Notes / Flag
    over.driverType ?? 'Volume x price', // 13 Driver Type
    over.driverSource ?? 'Sheet source', // 14 Driver / Data Source
    over.dataIdeal ?? 'Ideal shape', // 15 Data Ideal
    over.pic ?? 'Team A', // 16 PIC
  ];
  return cells.join('\t');
}

const HEADER =
  'Entity\tStatus\tCOA Entity\tCOA Consol\tAccount Name\tFunction\tNature (FF)\tBusiness\tBS/PL\tBalance\tSource COA Consol\tSource FSLI\tNotes / Flag\tDriver Type\tDriver / Data Source\tData Ideal (wujud)\tPIC (pemilik data)';

describe('parseAccountPaste tolerates what Excel actually produces', () => {
  it('parses a clean single row', () => {
    const { rows, rejected } = parseAccountPaste(sheetRow());
    expect(rejected).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entity: 'ALPHA',
      coaEntity: '900.001',
      coaConsol: '9.9.99.0001',
      accountName: 'Widget sales',
      function: 'Widget Function',
      business: 'Channel One',
      driverType: 'Volume x price',
      pic: 'Team A',
      isDummy: false,
    });
  });

  it('discards an included header row instead of rejecting it', () => {
    const parse = parseAccountPaste(`${HEADER}\n${sheetRow()}`);
    expect(parse.discardedHeaders).toBe(1);
    expect(parse.rows).toHaveLength(1);
    expect(parse.rejected).toEqual([]);
  });

  it('handles \\r\\n, trailing tabs and trailing blank lines', () => {
    const text = `${sheetRow()}\t\t\r\n${sheetRow({ accountName: 'Widget returns', coaConsol: '9.9.99.0002' })}\r\n\r\n\r\n`;
    const { rows, rejected } = parseAccountPaste(text);
    expect(rejected).toEqual([]);
    expect(rows).toHaveLength(2);
    // The trailing tabs did not smear into a field.
    expect(rows[0].pic).toBe('Team A');
  });

  it('accepts a row truncated after PIC — and even before it', () => {
    const truncated = sheetRow().split('\t').slice(0, 14).join('\t'); // ends at Driver Type
    const { rows, rejected } = parseAccountPaste(truncated);
    expect(rejected).toEqual([]);
    expect(rows[0].driverType).toBe('Volume x price');
    expect(rows[0].driverSource).toBeUndefined();
    expect(rows[0].pic).toBeUndefined();
  });

  it('treats #N/A, None, — and - as empty, not as values', () => {
    const { rows } = parseAccountPaste(
      sheetRow({ driverType: '#N/A', driverSource: 'None', dataIdeal: '—', pic: '-' }),
    );
    expect(rows[0].driverType).toBeUndefined();
    expect(rows[0].driverSource).toBeUndefined();
    expect(rows[0].dataIdeal).toBeUndefined();
    expect(rows[0].pic).toBeUndefined();
  });

  it('rejects a row missing Account Name visibly without sinking the rest', () => {
    const text = `${sheetRow()}\n${sheetRow({ accountName: '', coaConsol: '9.9.99.0003' })}\n${sheetRow({ accountName: 'Widget rebate', coaConsol: '9.9.99.0004' })}`;
    const { rows, rejected } = parseAccountPaste(text);
    expect(rows).toHaveLength(2);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].line).toBe(2);
    expect(rejected[0].reason).toContain('Account Name');
  });

  it('rejects a row missing COA Consol', () => {
    const { rows, rejected } = parseAccountPaste(sheetRow({ coaConsol: '#N/A' }));
    expect(rows).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toContain('COA Consol');
  });

  it('reads Status: dummy -> true, other -> false, empty -> undefined', () => {
    expect(parseAccountPaste(sheetRow({ status: 'Dummy' })).rows[0].isDummy).toBe(true);
    expect(parseAccountPaste(sheetRow({ status: 'Active' })).rows[0].isDummy).toBe(false);
    expect(parseAccountPaste(sheetRow({ status: '' })).rows[0].isDummy).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The diff
// ---------------------------------------------------------------------------

const ITEMS: FinishLineItem[] = [
  { id: 'i-dist', item: 'Moving cost', kind: 'metric', order: 1 },
  { id: 'i-store', item: 'Holding cost', kind: 'metric', order: 2 },
];
const CELLS: FinishLineCell[] = [
  { id: 'c-dist-alpha', itemId: 'i-dist', entityCode: 'ALPHA', state: 'figure' },
  { id: 'c-store-alpha', itemId: 'i-store', entityCode: 'ALPHA', state: 'input' },
];
const MAP: FinishLineAccountMapRow[] = [
  { id: 'm1', function: 'Moving Function', business: 'Channel One', itemId: 'i-dist' },
  { id: 'm2', function: 'Holding Function', business: 'Channel One', itemId: 'i-store' },
];

function account(over: Partial<FinishLineAccount> & { accountName: string }): FinishLineAccount {
  return {
    id: `acc-${over.accountName}`,
    isDummy: false,
    order: 0,
    importedAt: '2026-07-28T09:00:00.000Z',
    ...over,
  };
}

const EXISTING: FinishLineAccount[] = [
  account({
    accountName: 'Mover fees',
    entityCode: 'ALPHA',
    coaEntity: '900.001',
    coaConsol: '9.9.99.0001',
    cellId: 'c-dist-alpha',
    function: 'Moving Function',
    business: 'Channel One',
    driverType: 'Old driver',
    order: 0,
  }),
  account({
    accountName: 'Untouched account',
    entityCode: 'ALPHA',
    coaEntity: '900.002',
    coaConsol: '9.9.99.0002',
    cellId: 'c-dist-alpha',
    function: 'Moving Function',
    business: 'Channel One',
    order: 1,
  }),
];

function diffOf(text: string, mode: 'upsert' | 'replace' = 'upsert') {
  return buildAccountPasteDiff({
    parsed: parseAccountPaste(text).rows,
    existing: EXISTING,
    map: MAP,
    cells: CELLS,
    items: ITEMS,
    mode,
  });
}

describe('buildAccountPasteDiff', () => {
  const moverRow = (over: Partial<Record<string, string>> = {}) =>
    sheetRow({
      accountName: 'Mover fees',
      coaEntity: '900.001',
      coaConsol: '9.9.99.0001',
      function: 'Moving Function',
      nature: '',
      business: 'Channel One',
      driverType: 'Old driver',
      driverSource: '',
      dataIdeal: '',
      pic: '',
      status: '',
      ...over,
    });

  it('a paste of one matching row touches one account and nothing else', () => {
    const diff = diffOf(moverRow({ driverType: 'New driver' }));
    expect(diff.updated).toHaveLength(1);
    expect(diff.updated[0].id).toBe('acc-Mover fees');
    expect(diff.added).toEqual([]);
    expect(diff.deleted).toEqual([]);
    expect(diff.quietChanges).toBe(1);
    expect(diff.metricMoves).toEqual([]);
  });

  it('an identical row is unchanged, not an update', () => {
    const diff = diffOf(moverRow());
    expect(diff.unchanged).toBe(1);
    expect(diff.updated).toEqual([]);
  });

  it('NAMES THE METRIC MOVE when function changes bucket', () => {
    const diff = diffOf(moverRow({ function: 'Holding Function' }));
    expect(diff.metricMoves).toEqual([
      { accountName: 'Mover fees', fromMetric: 'Moving cost', toMetric: 'Holding cost' },
    ]);
    expect(diff.updated[0].cellId).toBe('c-store-alpha');
    // A cell move is not counted twice as a quiet change.
    expect(diff.quietChanges).toBe(0);
  });

  it('a function x business with no mapping lands unmapped, kept not dropped', () => {
    const diff = diffOf(moverRow({ function: 'Unknown Function' }));
    expect(diff.updated[0].cellId).toBeNull();
    expect(diff.unmappedLandings).toContain('Mover fees');
    expect(diff.metricMoves[0]).toMatchObject({
      fromMetric: 'Moving cost',
      toMetric: '(tidak terpetakan)',
    });
  });

  it('a new natural key is an insert with appended sort order', () => {
    const diff = diffOf(sheetRow({ accountName: 'Brand new', coaConsol: '9.9.99.0009', function: 'Moving Function' }));
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].sortOrder).toBe(2); // after existing max order 1
    expect(diff.added[0].cellId).toBe('c-dist-alpha');
  });

  it('an empty Status keeps the existing dummy flag on update', () => {
    const dummyExisting = [
      account({ accountName: 'Was dummy', coaConsol: '9.9.99.0005', isDummy: true, order: 2 }),
    ];
    const diff = buildAccountPasteDiff({
      parsed: parseAccountPaste(
        sheetRow({ accountName: 'Was dummy', coaEntity: '', coaConsol: '9.9.99.0005', status: '', function: '', business: '', driverType: 'D', driverSource: '', dataIdeal: '', pic: '' }),
      ).rows,
      existing: dummyExisting,
      map: MAP,
      cells: CELLS,
      items: ITEMS,
      mode: 'upsert',
    });
    expect(diff.updated[0].isDummy).toBe(true);
  });

  it('UPSERT NEVER DELETES — the shape cannot express it', () => {
    const diff = diffOf(moverRow({ driverType: 'New driver' }), 'upsert');
    expect(diff.deleted).toEqual([]);
    // And the untouched account is not in any bucket that writes.
    const touchedIds = [...diff.updated, ...diff.added].map((u) => u.id);
    expect(touchedIds).not.toContain('acc-Untouched account');
  });

  it('replace mode lists what the paste omits, for the confirm step', () => {
    const diff = diffOf(moverRow(), 'replace');
    expect(diff.deleted.map((d) => d.accountName)).toEqual(['Untouched account']);
  });

  it('the same key twice in one paste counts once', () => {
    const diff = diffOf(`${moverRow({ driverType: 'First' })}\n${moverRow({ driverType: 'Second' })}`);
    expect(diff.updated).toHaveLength(1);
  });
});

describe('replace-all refuses a small paste', () => {
  it('refuses below the floor and says why', () => {
    expect(replaceRefusalReason(99)).toContain('99');
    expect(replaceRefusalReason(99)).toContain(String(REPLACE_MIN_ROWS));
    expect(replaceRefusalReason(1)).toBeTruthy();
  });
  it('allows at the floor', () => {
    expect(replaceRefusalReason(100)).toBeUndefined();
    expect(replaceRefusalReason(560)).toBeUndefined();
  });
});

describe('the paste stores the entity instead of discarding it', () => {
  const base = (over: Partial<Record<string, string>> = {}) =>
    sheetRow({
      accountName: 'Mover fees',
      entity: 'ALPHA',
      coaEntity: '900.001',
      coaConsol: '9.9.99.0001',
      function: 'Moving Function',
      nature: '',
      business: 'Channel One',
      driverType: 'Old driver',
      driverSource: '',
      dataIdeal: '',
      pic: '',
      status: '',
      ...over,
    });

  it('sets entityCode on an insert, from the sheet Entity column', () => {
    const diff = diffOf(base({ accountName: 'Brand new', coaConsol: '9.9.99.0077', entity: 'BETA' }));
    expect(diff.added[0].entityCode).toBe('BETA');
  });

  it('an entity change alone is a real change, not "unchanged"', () => {
    const diff = diffOf(base({ entity: 'BETA' }));
    expect(diff.updated).toHaveLength(1);
    expect(diff.updated[0].entityCode).toBe('BETA');
  });

  it('a paste whose Entity column was truncated keeps the entity already stored', () => {
    const truncated = base().split('\t').slice(1).join('\t'); // shifts columns — not this case
    expect(truncated.length).toBeGreaterThan(0);
    // The real truncation case: Entity present but empty.
    const diff = diffOf(base({ entity: '' }));
    if (diff.updated.length > 0) expect(diff.updated[0].entityCode).toBe('ALPHA');
    else expect(diff.unchanged).toBe(1);
  });
});
