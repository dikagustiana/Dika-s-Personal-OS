/**
 * The FSRE building's Edge Functions — fsre-events (the live feed) and
 * fsre-approve (the partner room's approve button) — pinned two ways,
 * because an Edge Function cannot run under vitest:
 *
 *   1. The pure input rules (supabase/functions/_shared/fsreInput.ts) are
 *      EXECUTED here, as scopeInput.ts is in provisionScope.test.ts.
 *   2. The function sources are READ, and the invariants the programme names
 *      are asserted against their lines: the owner check runs before any
 *      database call, each function's only database is its own secret, the
 *      approver is never an input, and the feed reads only the status view.
 *
 * The SQL half — the view holding metadata only, the login roles that can do
 * one thing each, and the approval function refusing while an escalation is
 * open — lives in fsre-skills (db/postgres/0004*_live.sql, tests/test_db_live.py).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_EVENTS, parseApprovalRequest, parseEventsRequest } from '../../supabase/functions/_shared/fsreInput';

const source = (name: string) => readFileSync(join(__dirname, '../../supabase/functions', name, 'index.ts'), 'utf8');
/** Executable lines only: comments may name what the code must never do. */
const code = (text: string) =>
  text
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

describe('fsre-events input', () => {
  it('lists the waves when no wave is named, and starts at 0', () => {
    expect(parseEventsRequest({})).toEqual({ ok: true, wave: null, afterSeq: 0 });
    expect(parseEventsRequest(null)).toEqual({ ok: true, wave: null, afterSeq: 0 });
  });

  it('reads a wave after a cursor', () => {
    expect(parseEventsRequest({ wave: 'wave-2026-02', afterSeq: 37 })).toEqual({ ok: true, wave: 'wave-2026-02', afterSeq: 37 });
  });

  it.each([
    [{ wave: 'wave-2026-02; drop table x' }, 'bad-wave'],
    [{ wave: 'WAVE-1' }, 'bad-wave'],
    [{ wave: 7 }, 'bad-wave'],
    [{ wave: 'wave-2026-02', afterSeq: -1 }, 'bad-after-seq'],
    [{ wave: 'wave-2026-02', afterSeq: 1.5 }, 'bad-after-seq'],
    [{ wave: 'wave-2026-02', afterSeq: '12' }, 'bad-after-seq'],
  ] as const)('refuses %j (%s): a bad cursor is never read as 0', (body, reason) => {
    expect(parseEventsRequest(body)).toEqual({ ok: false, reason });
  });

  it('pages at a fixed size', () => {
    expect(MAX_EVENTS).toBe(500);
  });
});

describe('fsre-approve input', () => {
  it('takes exactly an action, a company and a version', () => {
    expect(parseApprovalRequest({ action: 'check', company: 'INTP', version: 'INTP-FY25-r1' })).toEqual({
      ok: true,
      action: 'check',
      company: 'INTP',
      version: 'INTP-FY25-r1',
    });
    expect(parseApprovalRequest({ action: 'approve', company: 'SYN-M5', version: 'SYN-M5-2026.1' })).toMatchObject({ ok: true, action: 'approve' });
  });

  it.each([
    [{ company: 'INTP', version: 'INTP-FY25-r1' }],
    [{ action: 'publish', company: 'INTP', version: 'INTP-FY25-r1' }],
    [{ action: 'approve', company: 'intp', version: 'INTP-FY25-r1' }],
    [{ action: 'approve', company: 'INTP', version: '' }],
    [{ action: 'approve', company: 'INTP', version: "INTP'; --" }],
    [{ action: 'approve', company: 'INTP' }],
    ['approve INTP'],
  ])('refuses %j: no default action, no free text', (body) => {
    expect(parseApprovalRequest(body)).toEqual({ ok: false, reason: 'bad-request' });
  });

  it('never carries an approver from the request', () => {
    const parsed = parseApprovalRequest({ action: 'approve', company: 'INTP', version: 'INTP-FY25-r1', approver: 'someone else' });
    expect(parsed).toEqual({ ok: true, action: 'approve', company: 'INTP', version: 'INTP-FY25-r1' });
  });
});

describe.each([
  ['fsre-events', 'FSRE_STATUS_DB_URL'],
  ['fsre-approve', 'FSRE_APPROVER_DB_URL'],
])('%s, read', (name, secret) => {
  const text = code(source(name));

  it('checks the owner before it reads the body or touches the database', () => {
    const check = text.indexOf('await checkAppKey(request)');
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(text.indexOf('request.json()'));
    expect(check).toBeLessThan(text.indexOf('const conn = db()'));
    expect(text).toMatch(/if \(!auth\.ok\) return json\(/);
  });

  it(`connects only to its own secret, ${secret}`, () => {
    expect(text).toContain(`Deno.env.get('${secret}')`);
    expect(text.match(/Deno\.env\.get\('([A-Z_]+)'\)/g)).toEqual([`Deno.env.get('${secret}')`]);
    expect(text.match(/postgres\(/g)).toHaveLength(1);
    expect(text).toMatch(/postgres\(url, \{/);
  });

  it('binds every value as a parameter (tagged template), never builds SQL from text', () => {
    expect(text).not.toMatch(/conn\.unsafe|sql\.unsafe|\.unsafe\(/);
    expect(text).not.toMatch(/conn\(\s*['"`]/);
  });
});

describe('fsre-events, read', () => {
  it('reads only the status view', () => {
    const text = code(source('fsre-events'));
    const tables = [...text.matchAll(/from\s+([a-z_]+\.[a-z_]+)/g)].map((m) => m[1]);
    expect(new Set(tables)).toEqual(new Set(['fsre_status.events']));
  });
});

describe('fsre-approve, read', () => {
  it('records the owner by a constant, and calls only the two approval functions', () => {
    const text = code(source('fsre-approve'));
    expect(text).toMatch(/const APPROVER = '[^']+';/);
    expect(text).not.toMatch(/\.approver/);
    const calls = [...text.matchAll(/select (fsre\.[a-z_]+)\(/g)].map((m) => m[1]);
    expect(calls).toEqual(['fsre.can_approve', 'fsre.approve_package']);
  });
});
