import { describe, expect, it } from 'vitest';
import { MockRepository } from './mockRepository';
import { TimeBlockGuardError } from './timeBlockGuards';
import type { TimeBlockEntry } from './types';

// Synthetic labels only. Real block labels name entity work and this repo is
// public.
function draft(
  over: Partial<TimeBlockEntry> = {},
): Omit<TimeBlockEntry, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    type: 'timeblock',
    domain: 'work',
    date: '2026-07-28',
    start: '09:00',
    end: '10:00',
    label: 'A block',
    status: 'planned',
    tags: [],
    ...over,
  };
}

/**
 * The rules are asserted through the REPOSITORY, not by calling the guard
 * directly: a guard that is never wired into the write path is decoration, and
 * "enforce it in the mutation path, not only the UI" is the actual
 * requirement. Both repositories share the guard; the mock is what the tests
 * and the browser walk run against.
 */
describe('one attribution, never two — enforced in the mutation path', () => {
  it('accepts a block attributed to a milestone', async () => {
    const repo = new MockRepository();
    const created = (await repo.createEntry(
      draft({ projectId: 'p1', milestoneId: 'm1' }),
    )) as TimeBlockEntry;
    expect(created.milestoneId).toBe('m1');
    expect(created.taskId).toBeUndefined();
  });

  it('accepts a block attributed to a task', async () => {
    const repo = new MockRepository();
    const created = (await repo.createEntry(draft({ taskId: 't1' }))) as TimeBlockEntry;
    expect(created.taskId).toBe('t1');
  });

  it('accepts a block with NO attribution — unattributed time is honest', async () => {
    const repo = new MockRepository();
    const created = (await repo.createEntry(draft())) as TimeBlockEntry;
    expect(created.taskId).toBeUndefined();
    expect(created.milestoneId).toBeUndefined();
  });

  it('REJECTS a create carrying both', async () => {
    const repo = new MockRepository();
    await expect(
      repo.createEntry(draft({ taskId: 't1', projectId: 'p1', milestoneId: 'm1' })),
    ).rejects.toThrow(TimeBlockGuardError);
  });

  it('REJECTS a patch that adds the second attribution to an existing block', async () => {
    // The case a patch-only guard would miss: neither the stored block nor the
    // patch holds both, only the merged result does.
    const repo = new MockRepository();
    const created = (await repo.createEntry(draft({ taskId: 't1' }))) as TimeBlockEntry;
    await expect(
      repo.updateEntry(created.id, { projectId: 'p1', milestoneId: 'm1' }),
    ).rejects.toThrow(TimeBlockGuardError);
  });

  it('allows switching attribution when the other is cleared in the same write', async () => {
    const repo = new MockRepository();
    const created = (await repo.createEntry(draft({ taskId: 't1' }))) as TimeBlockEntry;
    const switched = (await repo.updateEntry(created.id, {
      taskId: undefined,
      projectId: 'p1',
      milestoneId: 'm1',
    })) as TimeBlockEntry;
    expect(switched.taskId).toBeUndefined();
    expect(switched.milestoneId).toBe('m1');
  });

  it('REJECTS a milestone attribution with no project to resolve it against', async () => {
    const repo = new MockRepository();
    await expect(repo.createEntry(draft({ milestoneId: 'm1' }))).rejects.toThrow(
      TimeBlockGuardError,
    );
  });
});

describe('a blocked block must say what it is waiting on', () => {
  it('REJECTS blocked with no reason', async () => {
    const repo = new MockRepository();
    const created = (await repo.createEntry(draft())) as TimeBlockEntry;
    await expect(repo.updateEntry(created.id, { status: 'blocked' })).rejects.toThrow(
      TimeBlockGuardError,
    );
  });

  it('REJECTS blocked with a whitespace-only reason', async () => {
    const repo = new MockRepository();
    const created = (await repo.createEntry(draft())) as TimeBlockEntry;
    await expect(
      repo.updateEntry(created.id, { status: 'blocked', blockedOn: '   ' }),
    ).rejects.toThrow(TimeBlockGuardError);
  });

  it('accepts blocked with a reason', async () => {
    const repo = new MockRepository();
    const created = (await repo.createEntry(draft())) as TimeBlockEntry;
    const blocked = (await repo.updateEntry(created.id, {
      status: 'blocked',
      blockedOn: 'a figure from another team',
    })) as TimeBlockEntry;
    expect(blocked.status).toBe('blocked');
    expect(blocked.blockedOn).toBe('a figure from another team');
  });

  it('leaves carried free of that requirement — a note there is optional', async () => {
    const repo = new MockRepository();
    const created = (await repo.createEntry(draft())) as TimeBlockEntry;
    const carried = (await repo.updateEntry(created.id, { status: 'carried' })) as TimeBlockEntry;
    expect(carried.status).toBe('carried');
  });
});

describe('the 15 existing blocks still work — none carries an attribution', () => {
  it('closes an unattributed block in every status without assuming a link', async () => {
    const repo = new MockRepository();
    const created = (await repo.createEntry(draft())) as TimeBlockEntry;
    for (const status of ['done', 'skipped', 'carried', 'planned'] as const) {
      const updated = (await repo.updateEntry(created.id, { status })) as TimeBlockEntry;
      expect(updated.status).toBe(status);
    }
  });
});
