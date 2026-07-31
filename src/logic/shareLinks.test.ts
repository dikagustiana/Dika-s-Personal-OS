import { describe, expect, it } from 'vitest';
import type { ShareLink } from '../data/types';
import {
  describeLastSeen,
  describeScope,
  newShareToken,
  refusalCopy,
  shareDate,
  SHARE_TOKEN_PATTERN,
  shareSentence,
  shareStatus,
  shareTerms,
  shareUrl,
} from './shareLinks';

const NOW = new Date('2026-07-31T09:00:00.000Z');

function link(overrides: Partial<ShareLink> = {}): ShareLink {
  return {
    id: 'link-1',
    view: 'finish-line-entity',
    scope: { entity: 'ALPHA' },
    expiresAt: '2026-08-07T09:00:00.000Z',
    createdAt: '2026-07-31T09:00:00.000Z',
    ...overrides,
  };
}

describe('a fresh token', () => {
  it('is long enough for the database to accept and URL-safe', () => {
    const token = newShareToken();
    expect(token).toMatch(SHARE_TOKEN_PATTERN);
    // 32 bytes in base64url, unpadded.
    expect(token).toHaveLength(43);
  });

  it('is different every time', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => newShareToken()));
    expect(tokens.size).toBe(50);
  });

  it('rides in the fragment, which browsers never send to a server', () => {
    expect(shareUrl('https://example.test', 'abc')).toBe('https://example.test/#share=abc');
  });
});

describe('SHARE_TOKEN_PATTERN', () => {
  it('refuses anything too short to be a token', () => {
    expect(SHARE_TOKEN_PATTERN.test('short')).toBe(false);
    expect(SHARE_TOKEN_PATTERN.test('')).toBe(false);
  });

  it('refuses a value carrying anything but base64url characters', () => {
    expect(SHARE_TOKEN_PATTERN.test(`${'a'.repeat(30)}/../etc`)).toBe(false);
    expect(SHARE_TOKEN_PATTERN.test(`${'a'.repeat(30)} or 1=1`)).toBe(false);
  });
});

describe('shareStatus', () => {
  it('is active while it has time left and has not been cut off', () => {
    expect(shareStatus(link(), NOW)).toBe('active');
  });

  it('is expired once the date has passed', () => {
    expect(shareStatus(link({ expiresAt: '2026-07-30T09:00:00.000Z' }), NOW)).toBe('expired');
  });

  /**
   * Revoked beats expired: the owner's deliberate act is the fact worth
   * reporting, and a link that ran out AFTER being cut off was never live in
   * between.
   */
  it('reports revoked even when the expiry has also passed', () => {
    const both = link({
      expiresAt: '2026-07-30T09:00:00.000Z',
      revokedAt: '2026-07-29T09:00:00.000Z',
    });
    expect(shareStatus(both, NOW)).toBe('revoked');
  });
});

describe('the sentence the owner reads before creating a link', () => {
  it('names the entity by its label and the date it stops working', () => {
    const terms = shareTerms({
      view: 'finish-line-entity',
      entityLabel: 'Alpha Co',
      expiresAt: '2026-08-04T09:00:00.000Z',
      now: NOW,
    });
    expect(terms.grants).toBe(
      'Anyone with this link can see every cell and account under Alpha Co until 4 Aug.',
    );
    expect(terms.withholds).toContain('cannot change anything');
    expect(terms.withholds).toContain('any other entity');
  });

  /**
   * The group sentence must NOT claim the recipient is limited to one entity —
   * the whole risk of the wider scope is that it reads like the narrow one.
   */
  it('says "every entity" for a group link and drops the entity limit', () => {
    const terms = shareTerms({
      view: 'finish-line-group',
      expiresAt: '2026-08-04T09:00:00.000Z',
      now: NOW,
    });
    expect(terms.grants).toContain('across every entity');
    expect(terms.withholds).not.toContain('any other entity');
  });

  it('falls back to a neutral noun rather than printing an entity code', () => {
    const terms = shareTerms({
      view: 'finish-line-entity',
      expiresAt: '2026-08-04T09:00:00.000Z',
      now: NOW,
    });
    expect(terms.grants).toContain('that entity');
  });

  it('reads as one sentence pair when joined', () => {
    const input = {
      view: 'finish-line-entity' as const,
      entityLabel: 'Alpha Co',
      expiresAt: '2026-08-04T09:00:00.000Z',
      now: NOW,
    };
    const terms = shareTerms(input);
    expect(shareSentence(input)).toBe(`${terms.grants} ${terms.withholds}`);
  });
});

describe('shareDate', () => {
  it('leaves the year off when it is this one', () => {
    expect(shareDate('2026-08-04T09:00:00.000Z', NOW)).toBe('4 Aug');
  });

  it('shows the year when the expiry is not in the current one', () => {
    expect(shareDate('2027-01-04T09:00:00.000Z', NOW)).toBe('4 Jan 2027');
  });
});

describe('describeLastSeen', () => {
  /**
   * The owner's question before renewing a link is whether anyone is using it.
   * "Never opened" has to be unmistakably different from "opened today" — a
   * blank would read as the second.
   */
  it('says so plainly when a link has never been opened', () => {
    expect(describeLastSeen(undefined, NOW)).toBe('Never opened');
  });

  it('counts whole days', () => {
    expect(describeLastSeen('2026-07-31T08:00:00.000Z', NOW)).toBe('Opened today');
    expect(describeLastSeen('2026-07-30T08:00:00.000Z', NOW)).toBe('Opened yesterday');
    expect(describeLastSeen('2026-07-25T08:00:00.000Z', NOW)).toBe('Opened 6 days ago');
  });
});

describe('describeScope', () => {
  it('shows the entity code for an entity link', () => {
    expect(describeScope('finish-line-entity', { entity: 'ALPHA' })).toBe('ALPHA');
  });

  it('says every entity for a group link, never an empty chip', () => {
    expect(describeScope('finish-line-group', {})).toBe('every entity');
  });

  it('does not claim a scope it was not given', () => {
    expect(describeScope('finish-line-entity', {})).toBe('an entity');
  });
});

describe('refusalCopy', () => {
  it('tells an expired and a revoked link apart', () => {
    expect(refusalCopy('expired')).toContain('expired');
    expect(refusalCopy('revoked')).toContain('turned off');
  });

  /** An unrecognised reason must not render as blank or as success. */
  it('falls back to the unknown wording for anything it does not know', () => {
    expect(refusalCopy(undefined)).toBe(refusalCopy('unknown'));
    expect(refusalCopy('something-new')).toBe(refusalCopy('unknown'));
  });
});
