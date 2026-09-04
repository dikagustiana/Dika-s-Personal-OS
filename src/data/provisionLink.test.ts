/**
 * The link status a collaborator's row shows on the access dashboard, derived
 * server-side by supabase/functions/_shared/linkStatus.ts from GoTrue's token
 * table, the filed link row and the configured window. Executed here the way
 * scopeInput.ts is — pure module, no Deno — plus the source and the migration
 * read for the invariants: the window comes from the environment and never
 * from a literal, and the reader is service_role only.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  deriveLinkState,
  type CollabLinkState as FunctionState,
} from '../../supabase/functions/_shared/linkStatus';
import type { CollabLinkState as AppState } from './types';

const read = (relative: string) => readFileSync(join(__dirname, '../..', relative), 'utf8');

const MINTED = '2026-09-04T01:00:00.000Z';
const NOW = Date.parse('2026-09-04T02:00:00.000Z'); // one hour after the mint
const HOUR = 3600;
const DAY = 86400;

const filed = (overrides: Partial<{ createdAt: string; expiresAt: string | null; usedAt: string | null }> = {}) => ({
  createdAt: MINTED,
  expiresAt: null,
  usedAt: null,
  ...overrides,
});

describe('GoTrue still holds the token', () => {
  it('is live with a deadline from the configured window', () => {
    const state = deriveLinkState({
      tokenMintedAt: MINTED,
      stored: filed(),
      lastSignInAt: null,
      ttlSeconds: DAY,
      now: NOW,
    });
    expect(state).toEqual({
      status: 'live',
      mintedAt: MINTED,
      expiresAt: '2026-09-05T01:00:00.000Z',
      usedAt: null,
    });
  });

  it('is expired once the window has passed, even though the row is still there', () => {
    const state = deriveLinkState({
      tokenMintedAt: MINTED,
      stored: null,
      lastSignInAt: null,
      ttlSeconds: HOUR / 2,
      now: NOW,
    });
    expect(state.status).toBe('expired');
    expect(state.expiresAt).toBe('2026-09-04T01:30:00.000Z');
  });

  it('reports no deadline when the window is not configured — never invents one', () => {
    const state = deriveLinkState({
      tokenMintedAt: MINTED,
      stored: null,
      lastSignInAt: null,
      ttlSeconds: null,
      now: NOW,
    });
    expect(state).toEqual({ status: 'live', mintedAt: MINTED, expiresAt: null, usedAt: null });
  });

  it('falls back to the filed deadline when the window is not configured now but was at mint', () => {
    const state = deriveLinkState({
      tokenMintedAt: MINTED,
      stored: filed({ expiresAt: '2026-09-04T01:20:00.000Z' }),
      lastSignInAt: null,
      ttlSeconds: null,
      now: NOW,
    });
    expect(state.status).toBe('expired');
  });
});

describe('GoTrue holds no token', () => {
  it('is none when this app never filed a link either', () => {
    expect(
      deriveLinkState({ tokenMintedAt: null, stored: null, lastSignInAt: null, ttlSeconds: DAY, now: NOW }),
    ).toEqual({ status: 'none', mintedAt: null, expiresAt: null, usedAt: null });
  });

  it('is used when the sign-in trigger stamped the filed row', () => {
    const state = deriveLinkState({
      tokenMintedAt: null,
      stored: filed({ usedAt: '2026-09-04T01:10:00.000Z' }),
      lastSignInAt: '2026-09-04T01:10:00.000Z',
      ttlSeconds: DAY,
      now: NOW,
    });
    expect(state.status).toBe('used');
    expect(state.usedAt).toBe('2026-09-04T01:10:00.000Z');
  });

  it('is used when a sign-in landed at or after the mint, with no stamp', () => {
    const state = deriveLinkState({
      tokenMintedAt: null,
      stored: filed(),
      lastSignInAt: '2026-09-04T01:00:00.000Z',
      ttlSeconds: DAY,
      now: NOW,
    });
    expect(state.status).toBe('used');
  });

  it('is expired when the filed deadline has passed and nobody signed in', () => {
    const state = deriveLinkState({
      tokenMintedAt: null,
      stored: filed({ expiresAt: '2026-09-04T01:30:00.000Z' }),
      lastSignInAt: '2026-08-01T00:00:00.000Z',
      ttlSeconds: DAY,
      now: NOW,
    });
    expect(state.status).toBe('expired');
  });

  it('is used when the token vanished before its deadline — GoTrue removes it on consumption', () => {
    const state = deriveLinkState({
      tokenMintedAt: null,
      stored: filed({ expiresAt: '2026-09-05T01:00:00.000Z' }),
      lastSignInAt: null,
      ttlSeconds: DAY,
      now: NOW,
    });
    expect(state.status).toBe('used');
  });
});

describe('the reader was unavailable', () => {
  it('is unknown with nothing filed — not none, which would be a claim', () => {
    expect(
      deriveLinkState({ tokenMintedAt: undefined, stored: null, lastSignInAt: null, ttlSeconds: DAY, now: NOW }).status,
    ).toBe('unknown');
  });

  it('falls back to the filed row alone', () => {
    expect(
      deriveLinkState({
        tokenMintedAt: undefined,
        stored: filed({ expiresAt: '2026-09-05T01:00:00.000Z' }),
        lastSignInAt: null,
        ttlSeconds: DAY,
        now: NOW,
      }).status,
    ).toBe('live');
    expect(
      deriveLinkState({
        tokenMintedAt: undefined,
        stored: filed({ usedAt: '2026-09-04T01:05:00.000Z' }),
        lastSignInAt: null,
        ttlSeconds: DAY,
        now: NOW,
      }).status,
    ).toBe('used');
  });
});

describe('the two state vocabularies are one vocabulary', () => {
  it('the app type and the function type are assignable both ways', () => {
    const toApp = (s: FunctionState): AppState => s;
    const toFunction = (s: AppState): FunctionState => s;
    const sample: FunctionState = { status: 'live', mintedAt: MINTED, expiresAt: null, usedAt: null };
    expect(toFunction(toApp(sample))).toEqual(sample);
  });
});

describe('the function source and the migration keep the invariants', () => {
  const provision = read('supabase/functions/_shared/provision.ts');
  const code = provision
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
    .join('\n');
  const linkStatus = read('supabase/functions/_shared/linkStatus.ts');
  const linkCode = linkStatus
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');

  it('reads the token table through the set-returning definer RPC, never the auth schema', () => {
    expect(code).toContain("admin.rpc('os_collab_link_status', { p_user_ids: userIds })");
    expect(code).not.toContain(".schema('auth')");
  });

  it('keeps the single-user reader as the fallback for a database without 098', () => {
    expect(code).toContain("admin.rpc('os_collab_link_minted_at'");
  });

  it('takes the window from the environment and carries no literal anywhere near the status', () => {
    expect(code).toMatch(/const ttl = linkTtlSeconds\(\);/);
    expect(linkCode).not.toMatch(/3600|86400/);
    expect(linkCode).not.toMatch(/Deno\./);
  });

  it('attaches the derived state to every listed user', () => {
    expect(code).toContain('const link: CollabLinkState = deriveLinkState({');
    expect(code).toMatch(/tokenMintedAt: instants \? \(instants\.get\(user\.id\) \?\? null\) : undefined/);
  });

  it('ships the reader as service_role-only SQL that never names a lifetime', () => {
    const sql = read('supabase/migrations/20260904000098_collab_link_status.sql');
    expect(sql).toContain('returns table (user_id uuid, minted_at timestamptz)');
    expect(sql).toContain('security definer');
    expect(sql).toContain("t.token_type = 'recovery_token'");
    expect(sql).toMatch(/revoke all on function public\.os_collab_link_status\(uuid\[\]\) from anon/);
    expect(sql).toMatch(/revoke all on function public\.os_collab_link_status\(uuid\[\]\) from authenticated/);
    expect(sql).toMatch(/grant execute on function public\.os_collab_link_status\(uuid\[\]\) to service_role/);
    const statements = sql.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');
    expect(statements).not.toMatch(/3600|86400/);
  });
});
