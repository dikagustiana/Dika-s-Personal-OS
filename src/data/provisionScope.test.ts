/**
 * The scope actions of provision-collaborator — grant-scope / revoke-scope —
 * pinned two ways, because the Edge Function itself cannot run under vitest:
 *
 *   1. The pure input rules (supabase/functions/_shared/scopeInput.ts) are
 *      EXECUTED here, the way numberScan.ts and modelEval.ts are: no Deno API,
 *      no jsr import, one copy of the rules shared with the function.
 *   2. The function source is READ, and the invariants the prompt names are
 *      asserted against its executable lines: the role is never an input, the
 *      scope actions are audited, an audit failure fails the action, and no
 *      email is sent — the same technique collabLinkStore.test.ts uses.
 *
 * The SQL half — the rows a grant-scope actually writes as service_role, the
 * audit row it leaves, and the audit refusing an entry that cannot say what
 * it granted — lives in supabase/tests/collab_rls.sql (cases S1-S4) and runs
 * through scripts/grant-scope-tests.sh.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseGrantScope,
  parseRevokeScope,
  sortScopeGrants,
  type ScopeCapability as FunctionCapability,
} from '../../supabase/functions/_shared/scopeInput';
import type { ScopeCapability as AppCapability } from './types';

const SECTION_A = 'f1a70000-0000-4000-8000-000000000a01';
const SECTION_B = 'f1a70000-0000-4000-8000-000000000a02';

const read = (relative: string) =>
  readFileSync(join(__dirname, '../..', relative), 'utf8');

/** Executable lines only — the comments name every forbidden thing on purpose. */
const codeOf = (source: string) =>
  source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
    .join('\n');

describe('parseGrantScope', () => {
  it('accepts one entity, several sections and an explicit capability', () => {
    const outcome = parseGrantScope(' ARBI ', [SECTION_A, SECTION_B], 'read');
    expect(outcome).toEqual({
      ok: true,
      value: { entityCode: 'ARBI', sectionIds: [SECTION_A, SECTION_B], capability: 'read' },
    });
  });

  it('de-duplicates and lower-cases section ids, keeping request order', () => {
    const outcome = parseGrantScope('SAMB', [SECTION_B.toUpperCase(), SECTION_A, SECTION_B], 'write');
    expect(outcome.ok && outcome.value.sectionIds).toEqual([SECTION_B, SECTION_A]);
  });

  it('refuses a missing capability — a default here would be a permission decision', () => {
    expect(parseGrantScope('SAMB', [SECTION_A], undefined)).toMatchObject({ ok: false });
    expect(parseGrantScope('SAMB', [SECTION_A], null)).toMatchObject({ ok: false });
    expect(parseGrantScope('SAMB', [SECTION_A], '')).toMatchObject({ ok: false });
  });

  it('refuses every capability spelling but the two literals', () => {
    for (const bad of ['Write', 'READ', 'rw', 'admin', 'owner', 'contributor', 1, true, {}]) {
      expect(parseGrantScope('SAMB', [SECTION_A], bad).ok).toBe(false);
    }
  });

  it('refuses an empty, non-array or non-uuid section list', () => {
    expect(parseGrantScope('SAMB', [], 'read').ok).toBe(false);
    expect(parseGrantScope('SAMB', SECTION_A, 'read').ok).toBe(false);
    expect(parseGrantScope('SAMB', ['not-a-uuid'], 'read').ok).toBe(false);
    expect(parseGrantScope('SAMB', [SECTION_A, 42], 'read').ok).toBe(false);
    expect(parseGrantScope('SAMB', [SECTION_A, "'; drop table x; --"], 'read').ok).toBe(false);
  });

  it('refuses an absurd number of sections as a client bug, not a grant', () => {
    const many = Array.from({ length: 201 }, (_, i) =>
      `f1a70000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    expect(parseGrantScope('SAMB', many, 'read').ok).toBe(false);
  });

  it('refuses an entity code that is not a short token', () => {
    expect(parseGrantScope('', [SECTION_A], 'read').ok).toBe(false);
    expect(parseGrantScope('SAMB ARBI', [SECTION_A], 'read').ok).toBe(false);
    expect(parseGrantScope('x'.repeat(33), [SECTION_A], 'read').ok).toBe(false);
    expect(parseGrantScope(['SAMB'], [SECTION_A], 'read').ok).toBe(false);
  });
});

describe('parseRevokeScope', () => {
  it('accepts one entity and one section', () => {
    expect(parseRevokeScope('KGR', SECTION_A.toUpperCase())).toEqual({
      ok: true,
      value: { entityCode: 'KGR', sectionId: SECTION_A },
    });
  });

  it('refuses a list, a blank, or a non-uuid section', () => {
    expect(parseRevokeScope('KGR', [SECTION_A]).ok).toBe(false);
    expect(parseRevokeScope('KGR', '').ok).toBe(false);
    expect(parseRevokeScope('KGR', 'metric-1').ok).toBe(false);
    expect(parseRevokeScope(undefined, SECTION_A).ok).toBe(false);
  });
});

describe('sortScopeGrants', () => {
  it('orders by entity then section, without mutating its input', () => {
    const input = [
      { entityCode: 'SAMB', sectionId: SECTION_B, capability: 'write' as const },
      { entityCode: 'ARBI', sectionId: SECTION_B, capability: 'read' as const },
      { entityCode: 'SAMB', sectionId: SECTION_A, capability: 'read' as const },
    ];
    const copy = [...input];
    expect(sortScopeGrants(input).map((g) => `${g.entityCode}:${g.sectionId}`)).toEqual([
      `ARBI:${SECTION_B}`,
      `SAMB:${SECTION_A}`,
      `SAMB:${SECTION_B}`,
    ]);
    expect(input).toEqual(copy);
  });
});

describe('the two capability vocabularies are one vocabulary', () => {
  it('the app type and the function type accept the same two literals', () => {
    // A compile-time assertion: each side is assignable to the other. If one
    // grows a third literal, this file stops type-checking.
    const toFunction = (c: AppCapability): FunctionCapability => c;
    const toApp = (c: FunctionCapability): AppCapability => c;
    expect(toFunction('read')).toBe('read');
    expect(toApp('write')).toBe('write');
  });
});

describe('the Edge Function source keeps the invariants the prompt names', () => {
  const provision = read('supabase/functions/_shared/provision.ts');
  const door = read('supabase/functions/provision-collaborator/index.ts');
  const provisionCode = codeOf(provision);
  const doorCode = codeOf(door);

  it('never reads a role from the request; every enrolment hardcodes contributor', () => {
    expect(doorCode).not.toMatch(/body\?\.role|rawRole|\.role\b/);
    expect(provisionCode).not.toMatch(/rawRole|role\s*:\s*[a-z]/);
    const hardcoded = provisionCode.match(/role: 'contributor'/g) ?? [];
    // create, and the enrolment grant-scope performs on the way in.
    expect(hardcoded.length).toBeGreaterThanOrEqual(2);
  });

  it('routes both scope actions through the shared module and audits each', () => {
    expect(doorCode).toContain("action === 'grant-scope'");
    expect(doorCode).toContain("action === 'revoke-scope'");
    expect(provisionCode).toContain("await audit(admin, 'grant-scope', email, [entityCode]");
    expect(provisionCode).toContain("await audit(admin, 'revoke-scope', email, [entityCode]");
  });

  it('fails the action when the audit write fails', () => {
    expect(provisionCode).toContain("if (error) throw new Error(`audit write failed: ${error.message}`)");
    // The wrapper turns a thrown audit into a 500, not a 200 with a quiet log.
    expect(doorCode).toMatch(/catch \(error\) \{[\s\S]*?return json\(\{ error: 'Provisioning failed' \}, 500\)/);
  });

  it('sends the scope audit columns only for scope entries, so older actions survive a deploy ahead of 096', () => {
    expect(provisionCode).toMatch(/if \(scope\) \{\s*args\.p_section_ids = scope\.sectionIds;\s*args\.p_capability = scope\.capability;/);
  });

  it('validates inputs through the pure module, not ad hoc', () => {
    expect(provisionCode).toContain('parseGrantScope(rawEntityCode, rawSectionIds, rawCapability)');
    expect(provisionCode).toContain('parseRevokeScope(rawEntityCode, rawSectionId)');
  });

  it('checks that every requested id is a section before writing, with the trigger as the boundary', () => {
    expect(provisionCode).toMatch(/kindOf\.get\(id\) !== 'section'/);
  });

  it('upserts a grant on its key so re-granting changes capability rather than duplicating', () => {
    expect(provisionCode).toContain("onConflict: 'user_id,entity_code,section_id' }");
  });

  it('omits grants from list rather than emptying them when the table is missing', () => {
    expect(provisionCode).toMatch(/if \(error\.code === '42P01' \|\| error\.code === 'PGRST205'\) return null/);
    expect(provisionCode).toContain('...(scopeByUser ? { grants: scopeByUser.get(user.id) ?? [] } : {})');
  });

  it('still sends no email and still mints no link on a scope change', () => {
    expect(provision).not.toMatch(/sendMail|inviteUserByEmail|resend|smtp/i);
    const grantScope = provisionCode.slice(
      provisionCode.indexOf('export async function provisionGrantScope'),
      provisionCode.indexOf('export async function provisionRevokeScope'),
    );
    expect(grantScope).not.toContain('generateAppLink');
    expect(grantScope).not.toContain('generateLink');
  });

  it('keeps share-view free of any write', () => {
    const shareView = read('supabase/functions/share-view/index.ts');
    expect(shareView).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
  });

  it('ships the audit migration with the service_role-only grant and the refusal', () => {
    const sql = read('supabase/migrations/20260904000096_provision_scope_audit.sql');
    expect(sql).toContain("'grant-scope', 'revoke-scope'");
    expect(sql).toMatch(/p_action = 'grant-scope'[\s\S]*?raise exception/);
    expect(sql).toMatch(/p_action = 'revoke-scope'[\s\S]*?raise exception/);
    expect(sql).toMatch(/revoke all on function public\.os_provision_record\(text, text, text\[\], uuid\[\], uuid\[\], text\)\s+from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.os_provision_record\(text, text, text\[\], uuid\[\], uuid\[\], text\)\s+to service_role/);
  });
});
