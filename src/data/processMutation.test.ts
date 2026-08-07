/**
 * requested_on — the process feature's first write, and still the only one
 * reachable without opening a panel — tested through the repository, plus the
 * shape guarantee that every process read is a ReadResult so a missing
 * relation can never silently become [].
 *
 * The text writes added alongside it live in views/work/processTextEditing.
 * test.tsx and logic/processTextEdit.test.ts; the owner-only rule asserted
 * below covers them too, since they go through the same assertOwnerWrite.
 */
import { describe, expect, it } from 'vitest';
import { MockRepository } from './mockRepository';
import type { ProcessNeed } from './types';

function seedNeeds(repo: MockRepository, needs: ProcessNeed[]): void {
  const store = (repo as unknown as { processNeeds: Map<string, ProcessNeed> }).processNeeds;
  for (const need of needs) store.set(need.id, { ...need });
}

const need = (id: string, over: Partial<ProcessNeed> = {}): ProcessNeed => ({
  id,
  stepId: 'step-1',
  item: 'Contoh kebutuhan data',
  kind: 'TRANSAKSI',
  status: 'BELUM',
  ...over,
});

const CONTRIBUTOR = {
  kind: 'contributor' as const,
  userId: 'user-1',
  entityCodes: ['SAMB'],
};

describe('requested_on writes, and only for the owner', () => {
  it('sets and clears the date through the repository', async () => {
    const repo = new MockRepository();
    seedNeeds(repo, [need('n1')]);
    const set = await repo.setProcessNeedRequestedOn('n1', '2026-08-06');
    expect(set.requestedOn).toBe('2026-08-06');
    const cleared = await repo.setProcessNeedRequestedOn('n1', null);
    expect(cleared.requestedOn).toBeUndefined();
  });

  it('leaves every other field untouched by the write', async () => {
    const repo = new MockRepository();
    seedNeeds(repo, [need('n1', { owner: 'PF', src: 'WMS' })]);
    const after = await repo.setProcessNeedRequestedOn('n1', '2026-08-06');
    expect(after).toMatchObject({
      stepId: 'step-1',
      status: 'BELUM',
      owner: 'PF',
      src: 'WMS',
    });
  });

  it('rejects a contributor the way RLS does — loudly, not as a no-op', async () => {
    const repo = new MockRepository();
    seedNeeds(repo, [need('n1')]);
    repo.setViewer(CONTRIBUTOR);
    await expect(repo.setProcessNeedRequestedOn('n1', '2026-08-06')).rejects.toThrow(
      /row-level security/,
    );
  });

  it('fails loudly for an unknown need', async () => {
    const repo = new MockRepository();
    await expect(repo.setProcessNeedRequestedOn('ghost', '2026-08-06')).rejects.toThrow(
      'Need not found: ghost',
    );
  });
});

describe('the text writes carry the same owner-only rule', () => {
  const patch = {
    item: 'Diubah',
    kind: 'TRANSAKSI',
    src: null,
    owner: null,
    status: 'BELUM',
    requestedOn: null,
  };

  it('rejects a contributor loudly, exactly as requested_on does', async () => {
    const repo = new MockRepository();
    seedNeeds(repo, [need('n1')]);
    repo.setViewer(CONTRIBUTOR);
    await expect(repo.updateProcessNeedText('n1', patch)).rejects.toThrow(/row-level security/);
  });

  it('leaves the row untouched when the write is rejected', async () => {
    const repo = new MockRepository();
    seedNeeds(repo, [need('n1', { item: 'Asli' })]);
    repo.setViewer(CONTRIBUTOR);
    await expect(repo.updateProcessNeedText('n1', patch)).rejects.toThrow();
    repo.setViewer({ kind: 'owner' });
    const rows = await repo.listProcessNeeds();
    expect(rows.ok && rows.rows[0].item).toBe('Asli');
  });

  it('fails loudly for an unknown row rather than writing nothing quietly', async () => {
    const repo = new MockRepository();
    await expect(repo.updateProcessNeedText('ghost', patch)).rejects.toThrow(
      'Need not found: ghost',
    );
  });

  /**
   * The history table ships AFTER the frontend, so a missing log must cost the
   * audit line and nothing else — never the edit. `false` rather than a throw
   * is what lets the caller tell those two apart.
   */
  it('reports a missing history relation as false, not as a failure', async () => {
    const repo = new MockRepository();
    const rows = [
      { tableName: 'os_process_needs', rowId: 'n1', field: 'item', oldValue: 'a', newValue: 'b' },
    ];
    expect(await repo.appendProcessTextHistory(rows)).toBe(true);
    (repo as unknown as { processHistoryTableExists: boolean }).processHistoryTableExists = false;
    expect(await repo.appendProcessTextHistory(rows)).toBe(false);
  });
});

describe('every process read is a ReadResult, never a bare array', () => {
  it('returns {ok} shapes from all six reads', async () => {
    const repo = new MockRepository();
    const results = await Promise.all([
      repo.listProcessLanes(),
      repo.listProcessPhases(),
      repo.listProcessSteps(),
      repo.listProcessGates(),
      repo.listProcessNeeds(),
      repo.listProcessStepItems(),
    ]);
    for (const result of results) {
      expect(Array.isArray(result)).toBe(false);
      expect(result).toHaveProperty('ok');
    }
  });
});
