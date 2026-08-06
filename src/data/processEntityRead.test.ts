/**
 * The §4.6 window, at the read layer: this frontend ships before migration
 * 20260806000052, so the process tables EXIST (SAMB-populated) while
 * entity_code does not. These tests script a PostgREST client and pin the
 * three behaviours that keep that window honest:
 *
 *   1. exactly 42703 on an entity-aware select retries the legacy column
 *      list ONCE and tags every row SAMB — the backfill value 52 will write;
 *   2. every other error surfaces without a retry — the fallback must never
 *      become a general 42703 swallow, which is the bug this feature just
 *      finished removing;
 *   3. the tracks read has NO fallback: its absence (42P01/PGRST205) is
 *      itself the signal the views use, so papering over it would erase the
 *      pre-apply state instead of naming it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { createSupabaseRepositoryForClient } from './supabaseRepository';

interface Scripted {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

/**
 * A client whose every query resolves through `handler`. The builder chain
 * (.select().order()) is a self-returning thenable, which is exactly how the
 * real PostgREST builder behaves for the reads under test.
 */
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
          then: (resolve: (value: Scripted) => unknown) =>
            Promise.resolve(result).then(resolve),
        };
        return thenable;
      },
    }),
  } as unknown as SupabaseClient;
}

const UNDEFINED_COLUMN = {
  code: '42703',
  message: 'column os_process_steps.entity_code does not exist',
};

describe('the pre-52 window: 42703 on entity_code falls back to the legacy select', () => {
  it('retries once without entity_code and tags every row SAMB', async () => {
    const calls: Array<{ table: string; columns: string }> = [];
    const repository = createSupabaseRepositoryForClient(
      scriptedClient((_table, columns) => {
        if (columns.includes('entity_code')) return { data: null, error: UNDEFINED_COLUMN };
        return {
          data: [
            {
              id: 'step-1',
              label: '1',
              slot: 1,
              lane_key: 'SALES',
              co: null,
              track: 'LP',
              name: 'Kontrak layanan LP',
              risk: null,
              control: null,
              note: null,
              gate_id: null,
              docs: [],
              coa: [],
              drivers: [],
            },
          ],
          error: null,
        };
      }, calls),
    );

    const result = await repository.listProcessSteps();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].entityCode).toBe('SAMB');
    // Exactly two selects: the entity-aware attempt, then the legacy list.
    expect(calls).toHaveLength(2);
    expect(calls[0].columns).toContain('entity_code');
    expect(calls[1].columns).not.toContain('entity_code');
  });

  it('reads straight through when entity_code exists — no second query', async () => {
    const calls: Array<{ table: string; columns: string }> = [];
    const repository = createSupabaseRepositoryForClient(
      scriptedClient(
        () => ({
          data: [
            {
              entity_code: 'ARBI',
              key: 'MARKETPLACE',
              label: 'MARKETPLACE',
              description: null,
              ordinal: 1,
              is_external: true,
            },
          ],
          error: null,
        }),
        calls,
      ),
    );
    const result = await repository.listProcessLanes();
    expect(result.ok && result.rows[0].entityCode).toBe('ARBI');
    expect(calls).toHaveLength(1);
  });

  it('surfaces any non-42703 error without retrying — the fallback must not widen', async () => {
    const calls: Array<{ table: string; columns: string }> = [];
    const repository = createSupabaseRepositoryForClient(
      scriptedClient(
        () => ({
          data: null,
          error: { code: '42501', message: 'permission denied for table os_process_steps' },
        }),
        calls,
      ),
    );
    const result = await repository.listProcessSteps();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('failed');
    expect(calls).toHaveLength(1);
  });

  it('surfaces a legacy retry that fails too — a half-applied 52 is a failure, not empty', async () => {
    const repository = createSupabaseRepositoryForClient(
      scriptedClient((_table, columns) =>
        columns.includes('entity_code')
          ? { data: null, error: UNDEFINED_COLUMN }
          : { data: null, error: { code: '42703', message: 'column risk does not exist' } },
      ),
    );
    const result = await repository.listProcessSteps();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('failed');
    expect(result.detail).toContain('risk');
  });
});

describe('the tracks read names absence instead of papering over it', () => {
  it('folds 42P01 and PGRST205 to missing-relation — the pre-52 signal', async () => {
    for (const error of [
      { code: '42P01', message: 'relation "public.os_process_tracks" does not exist' },
      { code: 'PGRST205', message: "Could not find the table 'public.os_process_tracks'" },
    ]) {
      const repository = createSupabaseRepositoryForClient(
        scriptedClient(() => ({ data: null, error })),
      );
      const result = await repository.listProcessTracks();
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toBe('missing-relation');
    }
  });

  it('maps rows camelCase and keeps ordinal order semantics at the caller', async () => {
    const repository = createSupabaseRepositoryForClient(
      scriptedClient(() => ({
        data: [
          { entity_code: 'ARBI', code: 'FORWARD', label: 'FORWARD', ordinal: 1, is_shared: false },
          { entity_code: 'ARBI', code: 'KEDUANYA', label: 'BERSAMA', ordinal: 3, is_shared: true },
        ],
        error: null,
      })),
    );
    const result = await repository.listProcessTracks();
    expect(result.ok && result.rows).toEqual([
      { entityCode: 'ARBI', code: 'FORWARD', label: 'FORWARD', ordinal: 1, isShared: false },
      { entityCode: 'ARBI', code: 'KEDUANYA', label: 'BERSAMA', ordinal: 3, isShared: true },
    ]);
  });
});
