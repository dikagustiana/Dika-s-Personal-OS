/**
 * THE DURABLE LINK STORE, at the read layer and in the migration.
 *
 * Two things are pinned here that nothing else can pin:
 *
 *   1. 42P01 and 42703 stay APART. The table does not exist until migration
 *      20260809000071 is applied and this bundle ships first, so "not there"
 *      has to fold to an empty panel. A column missing from a table that DOES
 *      exist is a broken query and must surface — collapsing the two would
 *      turn a real fault into a blank section nobody investigates.
 *
 *   2. The lifetime is not a number in this repository. It used to be
 *      `LINK_TTL_SECONDS = 3600` in the Edge Function plus a matching
 *      `LINK_TTL_MS` fallback in the client, and both are gone. At an 86400s
 *      OTP window that constant reports a link dead with twenty-three hours
 *      left, and the owner's remedy for a dead link is a re-mint — which
 *      revokes the token somebody is holding. The whole point of this package
 *      is that nobody loses access, so a confidently wrong clock is the exact
 *      failure to avoid.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { createSupabaseRepositoryForClient } from './supabaseRepository';

const root = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

interface Scripted {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

function scriptedClient(
  handler: (table: string, columns: string) => Scripted,
  log?: Array<{ table: string; columns: string }>,
): SupabaseClient {
  return {
    from: (table: string) => ({
      select: (columns: string) => {
        log?.push({ table, columns });
        const result = handler(table, columns);
        const thenable = {
          order: () => thenable,
          then: (resolve_: (value: Scripted) => unknown) =>
            Promise.resolve(result).then(resolve_),
        };
        return thenable;
      },
    }),
  } as unknown as SupabaseClient;
}

const repositoryFor = (
  handler: (table: string, columns: string) => Scripted,
  log?: Array<{ table: string; columns: string }>,
) => createSupabaseRepositoryForClient(scriptedClient(handler, log));

describe('reading os_collab_links', () => {
  it('folds 42P01 to missing-relation — the state this bundle ships into', async () => {
    const result = await repositoryFor(() => ({
      data: null,
      error: { code: '42P01', message: 'relation "os_collab_links" does not exist' },
    })).listCollabLinks();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('missing-relation');
  });

  it('surfaces 42703 as a FAILURE — a column gone from a table that exists', async () => {
    const result = await repositoryFor(() => ({
      data: null,
      error: { code: '42703', message: 'column os_collab_links.used_at does not exist' },
    })).listCollabLinks();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('failed');
    expect(result.detail).toContain('42703');
  });

  it('surfaces a permission error rather than showing an empty panel', async () => {
    const result = await repositoryFor(() => ({
      data: null,
      error: { code: '42501', message: 'permission denied for table os_collab_links' },
    })).listCollabLinks();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('failed');
  });

  it('maps a row, keeping an unknown deadline and an unspent link null', async () => {
    const columns: Array<{ table: string; columns: string }> = [];
    const result = await repositoryFor(
      () => ({
        data: [
          {
            user_id: 'u-1',
            link: 'https://os.example.app/#collab_token=X',
            created_at: '2026-08-09T10:00:00.000Z',
            expires_at: null,
            used_at: null,
          },
        ],
        error: null,
      }),
      columns,
    ).listCollabLinks();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]).toEqual({
      userId: 'u-1',
      link: 'https://os.example.app/#collab_token=X',
      createdAt: '2026-08-09T10:00:00.000Z',
      expiresAt: null,
      usedAt: null,
    });
    // Five columns, and no ip, user agent, device or location among them.
    expect(columns[0].columns).toBe('user_id, link, created_at, expires_at, used_at');
  });
});

describe('§3.1 the migration stores what was asked for and nothing else', () => {
  const sql = read('supabase/migrations/20260809000071_collab_link_store.sql');
  const table = sql.slice(
    sql.indexOf('create table if not exists public.os_collab_links'),
    sql.indexOf('comment on table'),
  );

  it('holds exactly the five fields, with a nullable deadline', () => {
    expect(table).toMatch(/user_id\s+uuid\s+primary key/);
    expect(table).toMatch(/link\s+text\s+not null/);
    expect(table).toMatch(/created_at timestamptz not null/);
    expect(table).toMatch(/expires_at timestamptz\s*,/);
    expect(table).toMatch(/used_at\s+timestamptz/);
    // Nullable on purpose: null means the window is NOT KNOWN.
    expect(table).not.toMatch(/expires_at timestamptz not null/);
  });

  it('keeps at most one live link per collaborator, structurally', () => {
    // The primary key IS the rule; nothing has to remember to enforce it.
    expect(table).toMatch(/user_id\s+uuid\s+primary key/);
  });

  it('stores no ip, user agent, device or location', () => {
    for (const banned of [
      'ip_address',
      'user_agent',
      'useragent',
      'location',
      'country',
      'city',
      'device',
      'fingerprint',
    ]) {
      expect(table.toLowerCase()).not.toContain(banned);
    }
  });

  it('is owner-only with FOUR policies — the os_process_* shape', () => {
    const policies = [...sql.matchAll(/create policy\s+"([^"]+)"[\s\S]*?for\s+(\w+)/g)].map(
      (match) => match[2],
    );
    expect(policies.sort()).toEqual(['delete', 'insert', 'select', 'update']);
    expect(sql).toContain('enable row level security');
    // Every one gated on the app key, wrapped for the planner.
    expect([...sql.matchAll(/\(select public\.os_key_valid\(\)\)/g)].length).toBeGreaterThanOrEqual(
      5,
    );
  });

  it('grants a collaborator nothing — no member policy anywhere in it', () => {
    expect(sql).not.toMatch(/os_member_entities/);
    expect(sql).not.toMatch(/to authenticated/);
  });
});

describe('§3.2 marking spent is a SECOND trigger, and cannot cost a login', () => {
  const sql = read('supabase/migrations/20260809000071_collab_link_store.sql');

  it('adds its own trigger rather than editing os_record_sign_in', () => {
    expect(sql).toContain('create trigger os_mark_collab_link_used');
    // The existing sign-in log trigger and its function are not touched.
    expect(sql).not.toMatch(/create or replace function public\.os_record_sign_in/);
    expect(sql).not.toMatch(/drop trigger if exists os_record_sign_in/);
  });

  it('keeps both properties that make the first trigger safe', () => {
    const fn = sql.slice(sql.indexOf('create or replace function public.os_mark_collab_link_used'));
    expect(fn).toContain('security definer');
    expect(fn).toMatch(/exception\s+when others then/);
  });

  it('stamps only an UNSPENT row, so a later sign-in cannot rewrite the moment', () => {
    expect(sql).toMatch(/set used_at = new\.last_sign_in_at[\s\S]*?and used_at is null/);
  });

  it('never touches os_auth_users_birth_password_guard — password login stays dead', () => {
    expect(sql).not.toContain('os_auth_users_birth_password_guard');
    expect(sql).not.toContain('encrypted_password');
  });

  it('leaves os_sign_in_log and the history tables alone', () => {
    const statements = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
      .replace(/comment on[\s\S]*?';/g, '');
    expect(statements).not.toMatch(/\b(?:alter|drop|truncate) table[^\n]*os_sign_in_log/);
    expect(statements).not.toMatch(/os_entity_members/);
    expect(statements).not.toMatch(/os_finish_line/);
    expect(statements).not.toMatch(/os_task_history|os_process_text_history/);
  });

  it('ships a down migration that drops the trigger before the table', () => {
    const down = read('supabase/migrations/down/20260809000071_collab_link_store_down.sql');
    expect(down.indexOf('drop trigger')).toBeLessThan(down.indexOf('drop table'));
    // And leaves the OTHER two auth.users triggers untouched.
    expect(down).not.toContain('drop trigger if exists os_record_sign_in');
    expect(down).not.toContain('os_auth_users_birth_password_guard;');
  });
});

describe('§4.8 the lifetime is configuration, never a literal', () => {
  const fn = read('supabase/functions/_shared/provision.ts');
  /**
   * Executable lines only. The header prose names both the constant that was
   * removed and the direct select that was rejected, so a scan of the raw file
   * would fail on the very comments explaining why they are gone.
   */
  const code = fn
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
    .join('\n');

  it('has no hardcoded TTL constant left anywhere in the function', () => {
    expect(code).not.toMatch(/LINK_TTL_SECONDS\s*=\s*\d+/);
    expect(code).not.toMatch(/3600/);
    expect(code).not.toMatch(/86400/);
  });

  it('reads the window from the environment, and treats unset as unknown', () => {
    expect(fn).toContain("Deno.env.get('COLLAB_LINK_TTL_SECONDS')");
    expect(fn).toMatch(/if \(!createdAt \|\| ttl === null\) return null/);
  });

  it('takes the mint instant from GoTrue rather than from its own clock', () => {
    // Through the definer RPC, because PostgREST does not expose the auth
    // schema — a direct select would fail SOFTLY and silently downgrade the
    // timestamp to this process's clock.
    expect(code).toContain("admin.rpc('os_collab_link_minted_at'");
    expect(code).not.toContain(".schema('auth')");
  });

  it('reads the token row that GoTrue actually writes, in SQL', () => {
    const sql = read('supabase/migrations/20260809000072_collab_link_minted_at.sql');
    expect(sql).toContain('from auth.one_time_tokens');
    expect(sql).toContain("t.token_type = 'recovery_token'");
    expect(sql).toContain("at time zone 'utc'");
    expect(sql).toContain('security definer');
  });

  it('grants the mint-time reader to service_role only', () => {
    const sql = read('supabase/migrations/20260809000072_collab_link_minted_at.sql');
    expect(sql).toMatch(/revoke all on function public\.os_collab_link_minted_at\(uuid\) from anon/);
    expect(sql).toMatch(
      /revoke all on function public\.os_collab_link_minted_at\(uuid\) from authenticated/,
    );
    expect(sql).toMatch(/grant execute on function[\s\S]*?to service_role/);
  });

  it('never lets filing the link fail the minting of it', () => {
    const remember = fn.slice(fn.indexOf('async function rememberLink'));
    expect(remember.slice(0, remember.indexOf('async function forgetLink'))).toMatch(
      /try \{[\s\S]*?\} catch \{/,
    );
  });

  it('deletes the stored link on revoke', () => {
    expect(fn).toContain('await forgetLink(admin, user.id)');
  });

  it('still sends no email, and still states no number in the expiry note', () => {
    expect(fn).not.toMatch(/sendMail|inviteUserByEmail|resend|smtp/i);
    expect(fn).not.toMatch(/LINK_EXPIRY_NOTE =[\s\S]{0,200}?1 jam/);
  });
});
