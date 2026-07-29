import { describe, expect, it } from 'vitest';
import type {
  FinishLineAccount,
  FinishLineAccountMapRow,
  FinishLineCell,
} from '../data/types';
import {
  accountsByCell,
  accountsForEntity,
  accountsWithNoEntity,
  coverageForCell,
  coverageOf,
  gapCounts,
  groupUnmapped,
  hasDriver,
  latestImportedAt,
  resolveCellId,
  sortAccounts,
  unmappedAccounts,
} from './finishLineAccounts';

// ===========================================================================
// ENTIRELY SYNTHETIC. Every account name, function, business and entity below
// is invented for this file. The owner's chart of accounts is SAMB internal
// financial detail and this repo is public: no real account name, driver,
// entity or figure appears here, and none may be added.
// ===========================================================================

const IMPORTED = '2026-07-28T09:00:00.000Z';

function account(over: Partial<FinishLineAccount> & { accountName: string }): FinishLineAccount {
  return {
    id: `acc-${over.accountName}`,
    isDummy: false,
    order: 0,
    importedAt: IMPORTED,
    ...over,
  };
}

function cell(id: string, itemId: string, entityCode: string): FinishLineCell {
  return { id, itemId, entityCode, state: 'input' };
}

// Two synthetic entities, three synthetic metrics.
const CELLS: FinishLineCell[] = [
  cell('c-widget-alpha', 'metric-widget', 'ALPHA'),
  cell('c-widget-beta', 'metric-widget', 'BETA'),
  cell('c-gadget-alpha', 'metric-gadget', 'ALPHA'),
  cell('c-sprocket-alpha', 'metric-sprocket', 'ALPHA'),
];

const MAP: FinishLineAccountMapRow[] = [
  { id: 'm1', function: 'Widget Function', business: 'Channel One', itemId: 'metric-widget' },
  { id: 'm2', function: 'Gadget Function', business: 'Channel Two', itemId: 'metric-gadget' },
];

describe('driver presence', () => {
  it('treats a blank or whitespace driver as absent', () => {
    expect(hasDriver(account({ accountName: 'A', driverType: 'Some driver' }))).toBe(true);
    expect(hasDriver(account({ accountName: 'B' }))).toBe(false);
    expect(hasDriver(account({ accountName: 'C', driverType: '   ' }))).toBe(false);
  });
});

describe('coverage counts add up, and dummy is reported alongside', () => {
  const accounts = [
    account({ accountName: 'One', cellId: 'c-widget-alpha', driverType: 'D1' }),
    account({ accountName: 'Two', cellId: 'c-widget-alpha', driverType: 'D2' }),
    account({ accountName: 'Three', cellId: 'c-widget-alpha' }),
    account({ accountName: 'Four', cellId: 'c-widget-alpha', driverType: 'D1', isDummy: true }),
  ];

  it('reports N accounts, M with a driver, K without — and they sum to N', () => {
    const coverage = coverageOf(accounts);
    expect(coverage.total).toBe(4);
    expect(coverage.withDriver).toBe(3);
    expect(coverage.withoutDriver).toBe(1);
    expect(coverage.withDriver + coverage.withoutDriver).toBe(coverage.total);
  });

  it('counts dummy SEPARATELY from driver coverage', () => {
    // A dummy account can still carry a driver — the driver just describes a
    // placeholder. Folding dummy into the driver counts would hide that.
    const coverage = coverageOf(accounts);
    expect(coverage.dummy).toBe(1);
    expect(coverage.withDriver).toBe(3);
  });

  it('a mostly-dummy cell reports its dummy count even at full driver coverage', () => {
    const dummyHeavy = [
      account({ accountName: 'D1', cellId: 'x', driverType: 'D', isDummy: true }),
      account({ accountName: 'D2', cellId: 'x', driverType: 'D', isDummy: true }),
      account({ accountName: 'D3', cellId: 'x', driverType: 'D', isDummy: true }),
      account({ accountName: 'R1', cellId: 'x', driverType: 'D' }),
    ];
    const coverage = coverageOf(dummyHeavy);
    expect(coverage.withoutDriver).toBe(0);
    expect(coverage.dummy).toBe(3);
  });

  it('is safe on a cell with no accounts', () => {
    expect(coverageForCell('nothing-here', new Map())).toEqual({
      total: 0,
      withDriver: 0,
      withoutDriver: 0,
      dummy: 0,
    });
  });
});

describe('accounts without a driver sort FIRST', () => {
  it('puts the undesigned ones at the top, whatever their order field', () => {
    const sorted = sortAccounts([
      account({ accountName: 'Has one', driverType: 'D', order: 1 }),
      account({ accountName: 'None B', order: 9 }),
      account({ accountName: 'Has two', driverType: 'D', order: 2 }),
      account({ accountName: 'None A', order: 8 }),
    ]);
    expect(sorted.map((a) => a.accountName)).toEqual(['None A', 'None B', 'Has one', 'Has two']);
  });

  it('does not mutate the input', () => {
    const input = [
      account({ accountName: 'Has', driverType: 'D' }),
      account({ accountName: 'None' }),
    ];
    sortAccounts(input);
    expect(input[0].accountName).toBe('Has');
  });
});

describe('unmapped accounts are kept, never dropped', () => {
  const accounts = [
    account({ accountName: 'Mapped', cellId: 'c-widget-alpha', driverType: 'D' }),
    // Deliberately constructed: a function with no mapping row at all.
    account({
      accountName: 'Below the line',
      function: 'Unmapped Function',
      business: 'Channel One',
      entityCode: 'ALPHA',
    }),
    account({
      accountName: 'Below the line two',
      function: 'Unmapped Function',
      business: 'Channel One',
      entityCode: 'BETA',
    }),
  ];

  it('excludes them from the per-cell grouping (they belong to no cell)', () => {
    const byCell = accountsByCell(accounts);
    expect(byCell.get('c-widget-alpha')).toHaveLength(1);
    expect([...byCell.values()].flat()).toHaveLength(1);
  });

  it('but returns them from the unmapped list — this is the not-dropped proof', () => {
    expect(unmappedAccounts(accounts).map((a) => a.accountName)).toEqual([
      'Below the line',
      'Below the line two',
    ]);
  });

  it('groups them by the pair that failed to match, with a count and entities', () => {
    const groups = groupUnmapped(accounts);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      function: 'Unmapped Function',
      business: 'Channel One',
      count: 2,
    });
    expect(groups[0].entities).toEqual(['ALPHA', 'BETA']);
  });

  it('every account is in exactly one of the two places — none vanishes', () => {
    const inCells = [...accountsByCell(accounts).values()].flat().length;
    const unmapped = unmappedAccounts(accounts).length;
    expect(inCells + unmapped).toBe(accounts.length);
  });
});

describe('the mapping is data — a changed row moves the account', () => {
  const subject = {
    function: 'Widget Function',
    business: 'Channel One',
    entityCode: 'ALPHA',
  };

  it('resolves through the mapping table to the cell for its own entity', () => {
    expect(resolveCellId(subject, MAP, CELLS)).toBe('c-widget-alpha');
    // Same pair, different entity — the entity comes from the account itself.
    expect(resolveCellId({ ...subject, entityCode: 'BETA' }, MAP, CELLS)).toBe('c-widget-beta');
  });

  it('EDITING ONE MAPPING ROW moves the account to a different metric', () => {
    // No code changed here — only the data. This is the whole point of the
    // mapping living in a table rather than a switch statement.
    const edited = MAP.map((row) =>
      row.id === 'm1' ? { ...row, itemId: 'metric-sprocket' } : row,
    );
    expect(resolveCellId(subject, edited, CELLS)).toBe('c-sprocket-alpha');
  });

  it('returns undefined — not a guess — when the pair has no mapping row', () => {
    expect(
      resolveCellId(
        { function: 'Unmapped Function', business: 'Channel One', entityCode: 'ALPHA' },
        MAP,
        CELLS,
      ),
    ).toBeUndefined();
  });

  it('returns undefined when the mapped metric has no cell for that entity', () => {
    // Gadget has a cell for ALPHA only; an account in BETA cannot be placed.
    expect(
      resolveCellId(
        { function: 'Gadget Function', business: 'Channel Two', entityCode: 'BETA' },
        MAP,
        CELLS,
      ),
    ).toBeUndefined();
  });
});

describe('THE TWO GAP COUNTS ARE NEVER SUMMED', () => {
  const accounts = [
    account({ accountName: 'A', cellId: 'c-widget-alpha', driverType: 'D' }),
    account({ accountName: 'B', cellId: 'c-widget-alpha' }),
    account({ accountName: 'C', cellId: 'c-gadget-alpha' }),
  ];

  it('reports undesigned accounts and unassigned cells as separate fields', () => {
    const gaps = gapCounts(accounts, 7);
    expect(gaps.undesignedAccounts).toBe(2);
    expect(gaps.unassignedCells).toBe(7);
  });

  it('exposes no combined total — the shape itself refuses one', () => {
    // Guards the rule structurally: if someone adds a `total` field, this
    // fails and they have to justify it.
    const gaps = gapCounts(accounts, 7);
    expect(Object.keys(gaps).sort()).toEqual(['unassignedCells', 'undesignedAccounts']);
  });

  it('the two counts are genuinely independent', () => {
    // Same accounts, different cell-assignment situation: only one moves.
    expect(gapCounts(accounts, 0).undesignedAccounts).toBe(2);
    expect(gapCounts(accounts, 99).undesignedAccounts).toBe(2);
  });
});

describe('nothing assumes a fixed number of entities', () => {
  it('scopes accounts to an entity read from the data, mapped or not', () => {
    const accounts = [
      account({ accountName: 'Alpha mapped', cellId: 'c-widget-alpha' }),
      account({ accountName: 'Beta mapped', cellId: 'c-widget-beta' }),
      account({ accountName: 'Alpha unmapped', entityCode: 'ALPHA', function: 'X', business: 'Y' }),
    ];
    expect(accountsForEntity(accounts, 'ALPHA', CELLS).map((a) => a.accountName)).toEqual([
      'Alpha mapped',
      'Alpha unmapped',
    ]);
    expect(accountsForEntity(accounts, 'BETA', CELLS).map((a) => a.accountName)).toEqual([
      'Beta mapped',
    ]);
  });

  it('handles an entity code it has never seen before without special-casing', () => {
    // A sixth or seventh entity added to os_finish_line_entities flows through
    // with no code change.
    const accounts = [
      account({ accountName: 'New entity', entityCode: 'GAMMA', function: 'X', business: 'Y' }),
    ];
    expect(accountsForEntity(accounts, 'GAMMA', CELLS)).toHaveLength(1);
  });
});

describe('imported_at is surfaced', () => {
  it('reports the most recent stamp across a set', () => {
    expect(
      latestImportedAt([
        account({ accountName: 'Old', importedAt: '2026-07-01T00:00:00.000Z' }),
        account({ accountName: 'New', importedAt: '2026-07-28T09:00:00.000Z' }),
      ]),
    ).toBe('2026-07-28T09:00:00.000Z');
  });

  it('is undefined when there is nothing imported', () => {
    expect(latestImportedAt([])).toBeUndefined();
  });
});

describe('an account with no entity at all', () => {
  it('is found, so it can be surfaced rather than vanishing', () => {
    const accounts = [
      account({ accountName: 'Mapped', cellId: 'c-widget-alpha' }),
      account({ accountName: 'Unmapped but placed', entityCode: 'ALPHA', function: 'X', business: 'Y' }),
      account({ accountName: 'No metric, no entity' }),
      account({ accountName: 'Also nowhere' }),
    ];
    expect(accountsWithNoEntity(accounts).map((a) => a.accountName)).toEqual([
      'No metric, no entity',
      'Also nowhere',
    ]);
  });

  /**
   * THE PREMISE THE OLD FIXTURES ENCODED, PINNED AS WRONG. Real data puts a
   * chart-of-accounts number in coaEntity, never an entity code — so an
   * account carrying only coaEntity must reach NO entity view. The old
   * fixtures set coaEntity: 'ALPHA', which made a broken filter look correct.
   */
  it('is NOT reachable by an entity view via coaEntity, which is a COA number', () => {
    const accounts = [
      account({ accountName: 'Real shape', coaEntity: '900001234', function: 'X', business: 'Y' }),
    ];
    expect(accountsForEntity(accounts, 'ALPHA', CELLS)).toEqual([]);
    expect(accountsForEntity(accounts, '900001234', CELLS)).toEqual([]);
    expect(accountsWithNoEntity(accounts)).toHaveLength(1);
  });
});
