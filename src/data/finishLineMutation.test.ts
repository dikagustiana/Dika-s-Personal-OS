import { beforeEach, describe, expect, it } from 'vitest';
import { FinishLineGuardError } from './finishLineGuards';
import { MockRepository } from './mockRepository';
import type { CellState, FinishLineCell } from './types';

/**
 * THE RULES AS THE REPOSITORY ENFORCES THEM, not as the pure functions state
 * them.
 *
 * A guard that is only ever called by a test of itself proves nothing about
 * the write path. These go through the repository, because the failure being
 * guarded against is a caller that reaches the table without asking — and that
 * caller would still pass a unit test of the predicate.
 *
 * The mock is the same object the app runs against with no database, and it
 * carries the same two rules as the Supabase implementation.
 */

/** Reaches the private seed the mock starts empty with. */
function seedCells(repo: MockRepository, cells: FinishLineCell[]): void {
  const store = (repo as unknown as { finishLineCells: Map<string, FinishLineCell> })
    .finishLineCells;
  for (const cell of cells) store.set(cell.id, { ...cell });
}

function cell(id: string, state: CellState): FinishLineCell {
  return { id, itemId: 'row', entityCode: 'E1', state };
}

describe('§9.4 a cell state is unwritable except by an explicit human edit', () => {
  let repo: MockRepository;

  beforeEach(() => {
    repo = new MockRepository();
    seedCells(repo, [cell('c-figure', 'figure'), cell('c-input', 'input')]);
  });

  it('rejects a rollup writing a state THROUGH THE REPOSITORY', async () => {
    await expect(repo.setFinishLineCellState('c-input', 'figure', 'rollup')).rejects.toThrow(
      FinishLineGuardError,
    );
  });

  it('rejects a model writing a state through the repository', async () => {
    await expect(repo.setFinishLineCellState('c-input', 'figure', 'model')).rejects.toThrow(
      FinishLineGuardError,
    );
  });

  it('leaves the cell untouched after a rejected write', async () => {
    await expect(
      repo.setFinishLineCellState('c-input', 'figure', 'rollup'),
    ).rejects.toThrow();
    const after = await repo.listFinishLineCells();
    expect(after.ok && after.rows.find((c) => c.id === 'c-input')?.state).toBe('input');
  });

  it('accepts a human edit', async () => {
    const updated = await repo.setFinishLineCellState('c-input', 'figure', 'human');
    expect(updated.state).toBe('figure');
  });

  it('rejects a state outside the five even from a human', async () => {
    await expect(
      repo.setFinishLineCellState('c-input', 'unreliable' as CellState, 'human'),
    ).rejects.toThrow(FinishLineGuardError);
  });

  it('completing every linked milestone does NOT flip the cell state', async () => {
    // The contradiction case: work says done, the pack says the number still
    // does not exist. The rollup raises it for a person and stops there.
    await repo.setMilestoneEdges('p-none', 'm1', ['c-input']);
    const after = await repo.listFinishLineCells();
    expect(after.ok && after.rows.find((c) => c.id === 'c-input')?.state).toBe('input');
  });
});

describe('§5 edges may point at a figure, and never at a locked or nil cell', () => {
  let repo: MockRepository;

  beforeEach(() => {
    repo = new MockRepository();
    seedCells(repo, [
      cell('c-figure', 'figure'),
      cell('c-input', 'input'),
      cell('c-locked', 'locked'),
      cell('c-zero', 'zero'),
      cell('c-undefined', 'undefined'),
    ]);
  });

  it('accepts a milestone-anchored edge onto a FIGURE — the model change', async () => {
    await repo.setMilestoneEdges('p1', 'm1', ['c-figure']);
    const edges = await repo.listFinishLineEdges();
    expect(edges.ok && edges.rows.map((e) => e.cellId)).toEqual(['c-figure']);
  });

  it('accepts a cell-anchored edge onto a figure too', async () => {
    await repo.setCellEdges('c-figure', [{ projectId: 'p1', milestoneId: 'm1' }]);
    const edges = await repo.listFinishLineEdges();
    expect(edges.ok && edges.rows).toHaveLength(1);
  });

  it('rejects a milestone-anchored edge onto a locked cell', async () => {
    // This path had NO state check at all before: the rule held only for
    // whichever picker happened to be used.
    await expect(repo.setMilestoneEdges('p1', 'm1', ['c-locked'])).rejects.toThrow(
      FinishLineGuardError,
    );
  });

  it('rejects a milestone-anchored edge onto zero and undefined', async () => {
    for (const cellId of ['c-zero', 'c-undefined']) {
      await expect(repo.setMilestoneEdges('p1', 'm1', [cellId])).rejects.toThrow(
        FinishLineGuardError,
      );
    }
  });

  it('writes NOTHING when one cell in a bulk selection is ineligible', async () => {
    await expect(
      repo.setMilestoneEdges('p1', 'm1', ['c-figure', 'c-locked']),
    ).rejects.toThrow(FinishLineGuardError);
    const edges = await repo.listFinishLineEdges();
    expect(edges.ok && edges.rows).toHaveLength(0);
  });
});

describe('§6.4 bulk, and an unchanged commit is a no-op', () => {
  let repo: MockRepository;

  beforeEach(() => {
    repo = new MockRepository();
    seedCells(
      repo,
      ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => cell(id, 'figure')),
    );
  });

  it('attaches one milestone to six cells in ONE operation', async () => {
    // The arithmetic that reversed the anchor: six cells, one write.
    await repo.setMilestoneEdges('p1', 'm1', ['a', 'b', 'c', 'd', 'e', 'f']);
    const edges = await repo.listFinishLineEdges();
    expect(edges.ok && edges.rows).toHaveLength(6);
  });

  it('is a genuine no-op on an unchanged re-commit — not a caught 23505', async () => {
    await repo.setMilestoneEdges('p1', 'm1', ['a', 'b', 'c']);
    const before = await repo.listFinishLineEdges();
    const beforeIds = before.ok ? before.rows.map((e) => e.id).sort() : [];

    await repo.setMilestoneEdges('p1', 'm1', ['c', 'b', 'a']); // same set, reordered
    const after = await repo.listFinishLineEdges();
    const afterIds = after.ok ? after.rows.map((e) => e.id).sort() : [];

    // Identical row IDS, so nothing was deleted and reinserted underneath.
    expect(afterIds).toEqual(beforeIds);
  });

  it('narrowing a selection removes exactly the dropped edges', async () => {
    await repo.setMilestoneEdges('p1', 'm1', ['a', 'b', 'c']);
    await repo.setMilestoneEdges('p1', 'm1', ['a']);
    const edges = await repo.listFinishLineEdges();
    expect(edges.ok && edges.rows.map((e) => e.cellId)).toEqual(['a']);
  });

  it('does not disturb another milestone edges on the same cells', async () => {
    await repo.setMilestoneEdges('p1', 'm1', ['a', 'b']);
    await repo.setMilestoneEdges('p1', 'm2', ['b', 'c']);
    await repo.setMilestoneEdges('p1', 'm1', []);
    const edges = await repo.listFinishLineEdges();
    expect(edges.ok && edges.rows.map((e) => e.cellId).sort()).toEqual(['b', 'c']);
  });
});

describe('reads hand back results, never bare arrays', () => {
  it('every finish-line read is a ReadResult', async () => {
    const repo = new MockRepository();
    const results = await Promise.all([
      repo.listFinishLineItems(),
      repo.listFinishLineEntities(),
      repo.listFinishLineCells(),
      repo.listFinishLineDeps(),
      repo.listFinishLineEdges(),
      repo.listDanglingLinks(),
      repo.listOrphanMilestones(),
    ]);
    for (const result of results) {
      expect(Array.isArray(result)).toBe(false);
      expect(result).toHaveProperty('ok');
    }
  });
});
