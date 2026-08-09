/**
 * THE FOUR AUDIT READS AT THE POSTGREST LAYER, and the one distinction that
 * costs the most if it collapses.
 *
 * This frontend ships before migrations 20260809000069 and 20260809000070, so
 * two DIFFERENT not-yet states are live at once and they must not be handled
 * by the same branch:
 *
 *   42P01 on os_sign_in_log            the table is not there. Fold to
 *                                      missing-relation; the section does not
 *                                      render.
 *   42703 on os_process_text_history   the table IS there and populated, and
 *                                      the actor columns are not. Read the
 *                                      rows WITHOUT the pair — the edits are
 *                                      real and must still be listed.
 *
 * Widening either guard to cover the other is the failure being pinned here:
 * fold 42703 into missing-relation and real edits vanish behind an empty
 * state; fold 42P01 into the retry and a genuinely absent table produces a
 * second confusing error. Everything else — permission, network, a typo'd
 * column — surfaces as a failure from all four reads, because an audit trail
 * that renders "no activity" for a broken read is the most expensive sentence
 * this app can print.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { createSupabaseRepositoryForClient } from './supabaseRepository';

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
          then: (resolve: (value: Scripted) => unknown) =>
            Promise.resolve(result).then(resolve),
        };
        return thenable;
      },
    }),
  } as unknown as SupabaseClient;
}

const ABSENT_TABLE = { code: '42P01', message: 'relation "os_sign_in_log" does not exist' };
const ABSENT_COLUMN = {
  code: '42703',
  message: 'column os_process_text_history.actor_kind does not exist',
};
const DENIED = { code: '42501', message: 'permission denied for table os_sign_in_log' };

const repositoryFor = (handler: (table: string, columns: string) => Scripted, log?: Array<{ table: string; columns: string }>) =>
  createSupabaseRepositoryForClient(scriptedClient(handler, log));

describe('os_sign_in_log before migration 20260809000070', () => {
  it('classifies 42P01 as missing-relation, not as a failure', async () => {
    const result = await repositoryFor(() => ({ data: null, error: ABSENT_TABLE })).listSignInLog();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('missing-relation');
  });

  it('classifies a permission error as a FAILURE — it is not a missing table', async () => {
    const result = await repositoryFor(() => ({ data: null, error: DENIED })).listSignInLog();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('failed');
    // The code reaches the reader; that is what turns this into a grep.
    expect(result.detail).toContain('42501');
  });

  it('maps who and when, and asks for nothing else', async () => {
    const columns: Array<{ table: string; columns: string }> = [];
    const result = await repositoryFor(
      () => ({
        data: [{ user_id: 'u-1', signed_in_at: '2026-08-07T04:17:00.000Z' }],
        error: null,
      }),
      columns,
    ).listSignInLog();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([{ userId: 'u-1', signedInAt: '2026-08-07T04:17:00.000Z' }]);
    // No ip, user agent, location or device is even requested.
    expect(columns[0].columns).toBe('user_id, signed_in_at');
  });
});

describe('os_process_text_history before migration 20260809000069', () => {
  it('retries WITHOUT the actor pair on exactly 42703, and keeps the rows', async () => {
    const calls: Array<{ table: string; columns: string }> = [];
    const result = await repositoryFor((_table, columns) => {
      if (columns.includes('actor_kind')) return { data: null, error: ABSENT_COLUMN };
      return {
        data: [
          {
            id: 'tx-1',
            table_name: 'os_process_steps',
            row_id: 'step-a',
            field: 'name',
            changed_at: '2026-08-07T03:00:00.000Z',
          },
        ],
        error: null,
      };
    }, calls).listProcessTextHistory();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The EDIT survives the missing columns — that is the whole point.
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].rowId).toBe('step-a');
    expect(result.rows[0].actorKind).toBeNull();
    expect(result.rows[0].actor).toBeNull();
    // Exactly one retry, and the second select drops only those two columns.
    expect(calls).toHaveLength(2);
    expect(calls[0].columns).toContain('actor_kind');
    expect(calls[1].columns).not.toContain('actor');
  });

  it('does NOT retry on 42P01 — an absent table is the other condition', async () => {
    const calls: Array<{ table: string; columns: string }> = [];
    const result = await repositoryFor(() => ({ data: null, error: ABSENT_TABLE }), calls)
      .listProcessTextHistory();
    expect(calls).toHaveLength(1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('missing-relation');
  });

  it('does NOT retry on a permission error, and surfaces it', async () => {
    const calls: Array<{ table: string; columns: string }> = [];
    const result = await repositoryFor(() => ({ data: null, error: DENIED }), calls)
      .listProcessTextHistory();
    expect(calls).toHaveLength(1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('failed');
  });

  it('surfaces a SECOND, different missing column instead of retrying forever', async () => {
    const calls: Array<{ table: string; columns: string }> = [];
    const result = await repositoryFor(
      () => ({ data: null, error: { code: '42703', message: 'column row_id does not exist' } }),
      calls,
    ).listProcessTextHistory();
    expect(calls).toHaveLength(2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('failed');
  });

  it('reads the actor pair once the migration is applied', async () => {
    const result = await repositoryFor(() => ({
      data: [
        {
          id: 'tx-1',
          table_name: 'os_process_needs',
          row_id: 'need-a',
          field: 'src',
          changed_at: '2026-08-07T03:00:00.000Z',
          actor_kind: 'contributor',
          actor: 'u-9',
        },
      ],
      error: null,
    })).listProcessTextHistory();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].actorKind).toBe('contributor');
    expect(result.rows[0].actor).toBe('u-9');
  });
});

describe('the two history tables that already carry an actor', () => {
  it('maps a cell history row, keeping a null actor null', async () => {
    const result = await repositoryFor(() => ({
      data: [
        {
          id: 'ch-1',
          cell_id: 'cell-a',
          from_state: 'input',
          to_state: 'figure',
          note_changed: true,
          actor_kind: 'owner',
          actor: null,
          changed_at: '2026-08-07T04:20:00.000Z',
        },
      ],
      error: null,
    })).listCellHistory();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]).toEqual({
      id: 'ch-1',
      cellId: 'cell-a',
      fromState: 'input',
      toState: 'figure',
      noteChanged: true,
      actorKind: 'owner',
      actor: null,
      changedAt: '2026-08-07T04:20:00.000Z',
    });
  });

  it('maps a task history row', async () => {
    const result = await repositoryFor(() => ({
      data: [
        {
          id: 'th-1',
          task_id: 'task-a',
          field: 'status',
          from_value: 'todo',
          to_value: 'doing',
          actor_kind: 'contributor',
          actor: 'u-9',
          changed_at: '2026-08-07T05:00:00.000Z',
        },
      ],
      error: null,
    })).listTaskHistory();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].taskId).toBe('task-a');
    expect(result.rows[0].actor).toBe('u-9');
  });

  it('never folds a broken read into an empty trail', async () => {
    for (const read of ['listCellHistory', 'listTaskHistory'] as const) {
      const result = await repositoryFor(() => ({ data: null, error: DENIED }))[read]();
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('failed');
    }
  });
});
