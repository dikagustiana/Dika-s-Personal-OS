/**
 * The process feature's ONE write, tested through the repository — and the
 * shape guarantee that every process read is a ReadResult, so a missing
 * relation can never silently become [].
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

describe('requested_on is the only writable field, and only for the owner', () => {
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
