import { describe, expect, it } from 'vitest';
import { okRows, readAbsence } from '../data/readResult';
import type { FinishLineItem, ScopeGrant } from '../data/types';
import {
  applyGrant,
  capabilityAt,
  describeCapability,
  lastSignIn,
  nextCapability,
  removeGrant,
  sectionColumns,
} from './accessMatrix';

const S1 = 'f1a70000-0000-4000-8000-000000000a01';
const S2 = 'f1a70000-0000-4000-8000-000000000a02';

const GRANTS: ScopeGrant[] = [
  { entityCode: 'SAMB', sectionId: S2, capability: 'read' },
  { entityCode: 'SAMB', sectionId: S1, capability: 'write' },
  { entityCode: 'ARBI', sectionId: S1, capability: 'write' },
];

describe('capabilityAt', () => {
  it('reads the grant for the (entity, section) and reports none when absent', () => {
    expect(capabilityAt(GRANTS, 'SAMB', S1)).toBe('write');
    expect(capabilityAt(GRANTS, 'SAMB', S2)).toBe('read');
    expect(capabilityAt(GRANTS, 'ARBI', S2)).toBe('none');
    expect(capabilityAt([], 'SAMB', S1)).toBe('none');
  });
});

describe('nextCapability', () => {
  it('climbs before it clears: none → read → write → none', () => {
    expect(nextCapability('none')).toBe('read');
    expect(nextCapability('read')).toBe('write');
    expect(nextCapability('write')).toBe('none');
  });
});

describe('applyGrant', () => {
  it('upserts on the (entity, section) key — a capability change replaces the row', () => {
    const next = applyGrant(GRANTS, 'SAMB', [S2], 'write');
    expect(next.filter((g) => g.entityCode === 'SAMB' && g.sectionId === S2)).toEqual([
      { entityCode: 'SAMB', sectionId: S2, capability: 'write' },
    ]);
    expect(next).toHaveLength(GRANTS.length);
  });

  it('adds every section of a whole-entity grant and leaves the input untouched', () => {
    const copy = [...GRANTS];
    const next = applyGrant(GRANTS, 'ARBI', [S1, S2], 'write');
    expect(next.filter((g) => g.entityCode === 'ARBI')).toHaveLength(2);
    expect(GRANTS).toEqual(copy);
  });

  it('returns rows ordered by entity then section', () => {
    const next = applyGrant([], 'SAMB', [S2, S1], 'read');
    expect(next.map((g) => g.sectionId)).toEqual([S1, S2]);
  });
});

describe('removeGrant', () => {
  it('drops exactly the one row and nothing else', () => {
    const next = removeGrant(GRANTS, 'SAMB', S2);
    expect(next).toHaveLength(2);
    expect(capabilityAt(next, 'SAMB', S2)).toBe('none');
    expect(capabilityAt(next, 'SAMB', S1)).toBe('write');
  });

  it('is a no-op for a row that is not there', () => {
    expect(removeGrant(GRANTS, 'KGR', S1)).toHaveLength(3);
  });
});

describe('sectionColumns', () => {
  const items: FinishLineItem[] = [
    { id: 'm1', item: 'Metric', kind: 'metric', parentId: 's-b', order: 5 },
    { id: 's-b', item: 'B section', kind: 'section', order: 2 },
    { id: 's-a', item: 'A section', kind: 'section', order: 1 },
    { id: 'n1', item: 'Note', kind: 'note', parentId: 's-a', order: 3 },
  ];
  it('keeps sections only, in pack order', () => {
    expect(sectionColumns(items).map((s) => s.id)).toEqual(['s-a', 's-b']);
  });
});

describe('lastSignIn', () => {
  const LOG = okRows([
    { userId: 'u1', signedInAt: '2026-08-07T04:17:27.000Z' },
    { userId: 'u1', signedInAt: '2026-08-09T10:00:00.000Z' },
    { userId: 'u2', signedInAt: '2026-08-01T00:00:00.000Z' },
  ]);

  it('prefers the latest row of the app log', () => {
    expect(lastSignIn('u1', LOG, '2026-08-08T00:00:00.000Z')).toEqual({
      at: '2026-08-09T10:00:00.000Z',
      source: 'log',
    });
  });

  it('falls back to GoTrue when the log has no row for the person', () => {
    expect(lastSignIn('u3', LOG, '2026-08-05T14:03:07.000Z')).toEqual({
      at: '2026-08-05T14:03:07.000Z',
      source: 'auth',
    });
  });

  it('falls back to GoTrue when the log could not be read', () => {
    const absent = readAbsence('listSignInLog', { code: '42P01' });
    expect(lastSignIn('u1', absent, '2026-08-05T14:03:07.000Z').source).toBe('auth');
  });

  it('says never when neither side has anything', () => {
    expect(lastSignIn('u3', LOG, null)).toEqual({ at: null, source: 'none' });
  });
});

describe('describeCapability', () => {
  it('names the three states in words', () => {
    expect(describeCapability('none')).toBe('tidak ada akses');
    expect(describeCapability('read')).toBe('baca');
    expect(describeCapability('write')).toBe('baca + tulis');
  });
});
