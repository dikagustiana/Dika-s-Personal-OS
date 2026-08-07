// @vitest-environment jsdom
/**
 * The vault exists because a lost link is not a cosmetic loss: minting a
 * replacement invalidates the token already handed over (UNIQUE index on
 * auth.one_time_tokens (user_id, token_type)). So the interesting assertions
 * here are the ones about NOT losing things, and about not keeping them a
 * moment longer than they are valid.
 *
 * Every test drives the clock explicitly. A vault whose behaviour depends on
 * the wall clock would pass or fail by the minute it ran in.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clockTime,
  collabLinkStatus,
  describeCollabLink,
  forgetCollabLink,
  LINK_TTL_MS,
  maskCollabLink,
  normalizeVaultEmail,
  recallAllCollabLinks,
  recallCollabLink,
  rememberCollabLink,
  clearCollabLinks,
  type StoredCollabLink,
} from './collabLinkVault';

const T0 = 1_770_000_000_000;
const URL_A = 'https://os.example.app/#collab_token=TOKEN_AAA';
const URL_B = 'https://os.example.app/#collab_token=TOKEN_BBB';

beforeEach(() => {
  window.sessionStorage.clear();
});

describe('the vault round trip', () => {
  it('remembers a link and hands it back', () => {
    rememberCollabLink({ email: 'a@example.com', url: URL_A }, T0);
    const held = recallCollabLink('a@example.com', T0 + 1000);
    expect(held?.url).toBe(URL_A);
    expect(held?.mintedAt).toBe(T0);
  });

  it('survives a fresh read of storage — this is the whole point', () => {
    rememberCollabLink({ email: 'a@example.com', url: URL_A }, T0);
    // A remount reads storage from scratch; nothing is carried in memory.
    const reread = recallAllCollabLinks(T0 + 60_000);
    expect(reread['a@example.com'].url).toBe(URL_A);
  });

  it('normalises the address, so casing cannot hide a link from its own row', () => {
    rememberCollabLink({ email: '  Dika.G.Irawan@Gmail.com ', url: URL_A }, T0);
    expect(recallCollabLink('dika.g.irawan@gmail.com', T0)?.url).toBe(URL_A);
    expect(normalizeVaultEmail(' A@B.COM ')).toBe('a@b.com');
  });

  it('replaces rather than accumulates — the server only holds one token', () => {
    rememberCollabLink({ email: 'a@example.com', url: URL_A }, T0);
    rememberCollabLink({ email: 'a@example.com', url: URL_B }, T0 + 5000);
    const all = recallAllCollabLinks(T0 + 6000);
    expect(Object.keys(all)).toHaveLength(1);
    expect(all['a@example.com'].url).toBe(URL_B);
  });

  it('keeps separate addresses apart', () => {
    rememberCollabLink({ email: 'a@example.com', url: URL_A }, T0);
    rememberCollabLink({ email: 'b@example.com', url: URL_B }, T0);
    expect(Object.keys(recallAllCollabLinks(T0)).sort()).toEqual([
      'a@example.com',
      'b@example.com',
    ]);
  });
});

describe('expiry', () => {
  it('defaults to the one-hour OTP window when the server says nothing', () => {
    const stored = rememberCollabLink({ email: 'a@example.com', url: URL_A }, T0);
    expect(stored.expiresAt).toBe(T0 + LINK_TTL_MS);
  });

  it("takes the server's deadline when it sends one", () => {
    const stored = rememberCollabLink(
      { email: 'a@example.com', url: URL_A, expiresAt: T0 + 900_000 },
      T0,
    );
    expect(stored.expiresAt).toBe(T0 + 900_000);
  });

  it('stops handing back a link the moment it dies', () => {
    rememberCollabLink({ email: 'a@example.com', url: URL_A }, T0);
    expect(recallCollabLink('a@example.com', T0 + LINK_TTL_MS - 1)).not.toBeNull();
    expect(recallCollabLink('a@example.com', T0 + LINK_TTL_MS)).toBeNull();
  });

  it('prunes the dead one out of storage rather than leaving it sitting there', () => {
    rememberCollabLink({ email: 'a@example.com', url: URL_A }, T0);
    recallAllCollabLinks(T0 + LINK_TTL_MS + 1);
    expect(window.sessionStorage.getItem('personal-os-collab-links')).toBeNull();
  });

  it('prunes only what is dead', () => {
    rememberCollabLink({ email: 'old@example.com', url: URL_A }, T0);
    rememberCollabLink({ email: 'new@example.com', url: URL_B }, T0 + LINK_TTL_MS - 1000);
    const live = recallAllCollabLinks(T0 + LINK_TTL_MS + 1);
    expect(Object.keys(live)).toEqual(['new@example.com']);
  });
});

describe('forgetting', () => {
  it('drops one address and leaves the rest', () => {
    rememberCollabLink({ email: 'a@example.com', url: URL_A }, T0);
    rememberCollabLink({ email: 'b@example.com', url: URL_B }, T0);
    forgetCollabLink('A@Example.com', T0);
    expect(Object.keys(recallAllCollabLinks(T0))).toEqual(['b@example.com']);
  });

  it('clears everything on demand', () => {
    rememberCollabLink({ email: 'a@example.com', url: URL_A }, T0);
    clearCollabLinks();
    expect(recallAllCollabLinks(T0)).toEqual({});
  });
});

describe('a hostile or broken store never throws', () => {
  it('treats unparseable storage as empty', () => {
    window.sessionStorage.setItem('personal-os-collab-links', '{not json');
    expect(() => recallAllCollabLinks(T0)).not.toThrow();
    expect(recallAllCollabLinks(T0)).toEqual({});
  });

  it('drops entries of the wrong shape instead of handing them to the UI', () => {
    window.sessionStorage.setItem(
      'personal-os-collab-links',
      JSON.stringify({
        good: { email: 'good@example.com', url: URL_A, mintedAt: T0, expiresAt: T0 + 1000 },
        bad: { email: 'bad@example.com', url: URL_B },
        worse: 'not even an object',
      }),
    );
    expect(Object.keys(recallAllCollabLinks(T0))).toEqual(['good']);
  });

  it('ignores an array at the top level', () => {
    window.sessionStorage.setItem('personal-os-collab-links', '[1,2,3]');
    expect(recallAllCollabLinks(T0)).toEqual({});
  });
});

describe('what a row should say', () => {
  const held = (over: Partial<StoredCollabLink> = {}): StoredCollabLink => ({
    email: 'a@example.com',
    url: URL_A,
    mintedAt: T0,
    expiresAt: T0 + LINK_TTL_MS,
    ...over,
  });

  it('says nothing when no link is held', () => {
    expect(collabLinkStatus(null, null, T0)).toEqual({ kind: 'none' });
    expect(describeCollabLink({ kind: 'none' })).toBe('');
  });

  it('counts down while the link is alive', () => {
    const status = collabLinkStatus(held(), null, T0 + 10 * 60_000);
    expect(status).toMatchObject({ kind: 'live', minutesLeft: 50 });
  });

  it('reports expiry once the window closes', () => {
    expect(collabLinkStatus(held(), null, T0 + LINK_TTL_MS).kind).toBe('expired');
  });

  it('reads a sign-in AFTER the mint as this link being spent', () => {
    const usedAt = new Date(T0 + 60_000).toISOString();
    expect(collabLinkStatus(held(), usedAt, T0 + 120_000)).toEqual({
      kind: 'used',
      usedAt,
    });
  });

  it('does NOT mistake an older sign-in for this link — the reason mintedAt is stored', () => {
    // They signed in yesterday on a previous link. Today's link is untouched,
    // and calling it "used" would send the owner to re-mint for nothing —
    // cutting off the link they just handed over.
    const older = new Date(T0 - 86_400_000).toISOString();
    expect(collabLinkStatus(held(), older, T0 + 60_000).kind).toBe('live');
  });

  it('survives an unparseable sign-in timestamp', () => {
    expect(collabLinkStatus(held(), 'not a date', T0 + 60_000).kind).toBe('live');
  });

  it('used beats expired — a spent link is spent whatever the clock says', () => {
    const usedAt = new Date(T0 + 60_000).toISOString();
    expect(collabLinkStatus(held(), usedAt, T0 + LINK_TTL_MS + 5000).kind).toBe('used');
  });

  it('phrases every state in words, never colour alone', () => {
    expect(describeCollabLink({ kind: 'used', usedAt: 'x' })).toBe('tautan sudah dipakai');
    expect(describeCollabLink({ kind: 'expired', expiresAt: T0 })).toContain('kedaluwarsa');
    expect(
      describeCollabLink({ kind: 'live', expiresAt: T0 + 600_000, minutesLeft: 10 }),
    ).toContain('10 menit lagi');
    expect(
      describeCollabLink({ kind: 'live', expiresAt: T0 + 30_000, minutesLeft: 1 }),
    ).toContain('< 1 menit');
  });

  it('renders a wall-clock time', () => {
    expect(clockTime(T0)).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe('the mask', () => {
  it('covers the secret and keeps the destination readable', () => {
    const masked = maskCollabLink(URL_A);
    expect(masked).not.toContain('TOKEN_AAA');
    expect(masked).toContain('https://os.example.app/#collab_token=');
    expect(masked).toContain('•');
  });

  it('falls back to a full mask when the shape is unfamiliar', () => {
    expect(maskCollabLink('https://elsewhere.example/whatever')).toBe('•'.repeat(32));
  });
});
