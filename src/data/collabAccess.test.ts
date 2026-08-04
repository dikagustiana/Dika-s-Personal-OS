import { beforeEach, describe, expect, it } from 'vitest';
import { FinishLineGuardError, guardCellTransition } from './finishLineGuards';
import { MockRepository } from './mockRepository';
import type { CellState, FinishLineCell } from './types';

/**
 * THE SUBMITTER/APPROVER SPLIT, ASSERTED AGAINST THE MOCK — the same object
 * the app runs with no database, carrying the same rules as the SQL trigger
 * and member policies (invariant 6). The database side of every case here is
 * proven live by supabase/tests/collab_rls.sql; this file proves the mock
 * does not permit what production forbids, so the suite never asserts
 * against fiction.
 */

const STATES: CellState[] = ['figure', 'zero', 'undefined', 'input', 'locked'];

const CONTRIBUTOR = {
  kind: 'contributor' as const,
  userId: 'a11ce000-5afe-4000-8000-c0113b000001',
  entityCodes: ['ASI'],
};

/** Reaches the private seed the mock starts empty with. */
function seedCells(repo: MockRepository, cells: FinishLineCell[]): void {
  const store = (repo as unknown as { finishLineCells: Map<string, FinishLineCell> })
    .finishLineCells;
  for (const cell of cells) store.set(cell.id, { ...cell });
}

function cell(id: string, entityCode: string, state: CellState): FinishLineCell {
  return { id, itemId: 'row', entityCode, state, actorKind: 'owner' };
}

describe('guardCellTransition — the full matrix', () => {
  it('lets the owner move any state to any state, all 25 pairs', () => {
    for (const from of STATES) {
      for (const to of STATES) {
        expect(guardCellTransition(from, to, 'human')).toBe(to);
      }
    }
  });

  it('lets a contributor move input → figure and nothing else across states', () => {
    expect(guardCellTransition('input', 'figure', 'contributor')).toBe('figure');
    for (const from of STATES) {
      for (const to of STATES) {
        if (from === to || (from === 'input' && to === 'figure')) continue;
        expect(() => guardCellTransition(from, to, 'contributor')).toThrow(
          FinishLineGuardError,
        );
      }
    }
  });

  it('lets a contributor make a same-state write (a note-only edit rides one)', () => {
    for (const state of STATES) {
      expect(guardCellTransition(state, state, 'contributor')).toBe(state);
    }
  });

  it('still rejects rollup and model, for every pair', () => {
    expect(() => guardCellTransition('input', 'figure', 'rollup')).toThrow(
      FinishLineGuardError,
    );
    expect(() => guardCellTransition('input', 'figure', 'model')).toThrow(
      FinishLineGuardError,
    );
  });

  it('rejects unknown states on either side', () => {
    expect(() =>
      guardCellTransition('sixth' as CellState, 'figure', 'human'),
    ).toThrow(FinishLineGuardError);
    expect(() =>
      guardCellTransition('input', 'sixth' as CellState, 'human'),
    ).toThrow(FinishLineGuardError);
  });
});

describe('contributor viewer — reads are entity-scoped (the §6 policies, mirrored)', () => {
  let repo: MockRepository;

  beforeEach(() => {
    repo = new MockRepository();
    seedCells(repo, [
      cell('asi-input', 'ASI', 'input'),
      cell('asi-figure', 'ASI', 'figure'),
      cell('kni-input', 'KNI', 'input'),
    ]);
    repo.setViewer(CONTRIBUTOR);
  });

  it('cells: own entity only', async () => {
    const cells = await repo.listFinishLineCells();
    expect(cells.ok && cells.rows.map((row) => row.id).sort()).toEqual([
      'asi-figure',
      'asi-input',
    ]);
  });

  it('projects: work + samb only — GROWTH and internal are absent', async () => {
    const projects = await repo.listProjects();
    expect(projects.length).toBeGreaterThan(0);
    for (const project of projects) {
      expect(project.domain).toBe('work');
      expect(project.engagement).toBe('samb');
    }
    const growth = await repo.listProjects('growth');
    expect(growth).toEqual([]);
  });

  it('accounts: a clean empty ok, never a failure — the UI renders an empty state', async () => {
    const accounts = await repo.listFinishLineAccounts();
    expect(accounts.ok).toBe(true);
    expect(accounts.ok && accounts.rows).toEqual([]);
  });

  it('entries, daily logs, weekly plans, IELTS: nothing', async () => {
    expect(await repo.listEntries()).toEqual([]);
    expect(await repo.getDailyLog('2026-08-04', 'work')).toBeNull();
    expect(await repo.getWeeklyPlan('2026-W32', 'work')).toBeNull();
    expect(await repo.listIeltsResults()).toEqual([]);
    expect(await repo.listIeltsErrors()).toEqual([]);
    expect(await repo.listIeltsSessions()).toEqual([]);
  });

  it('share links: none', async () => {
    const links = await repo.listShareLinks();
    expect(links.ok && links.rows).toEqual([]);
  });
});

describe('contributor viewer — the write surface (§9 cases 6–14, mirrored)', () => {
  let repo: MockRepository;

  beforeEach(() => {
    repo = new MockRepository();
    seedCells(repo, [
      cell('asi-input', 'ASI', 'input'),
      cell('asi-figure', 'ASI', 'figure'),
      cell('kni-input', 'KNI', 'input'),
    ]);
    repo.setViewer(CONTRIBUTOR);
  });

  it('input → figure succeeds, stamps the contributor, and writes history', async () => {
    const updated = await repo.setFinishLineCellState('asi-input', 'figure', 'contributor');
    expect(updated.state).toBe('figure');
    expect(updated.actorKind).toBe('contributor');
    expect(updated.actor).toBe(CONTRIBUTOR.userId);
    expect(updated.changedAt).toBeTruthy();
    const history = repo.readCellHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      cellId: 'asi-input',
      fromState: 'input',
      toState: 'figure',
      noteChanged: false,
      actorKind: 'contributor',
      actor: CONTRIBUTOR.userId,
    });
  });

  it('every other transition is rejected and the cell is untouched', async () => {
    for (const target of ['zero', 'undefined', 'locked'] as CellState[]) {
      await expect(
        repo.setFinishLineCellState('asi-input', target, 'contributor'),
      ).rejects.toThrow(FinishLineGuardError);
    }
    await expect(
      repo.setFinishLineCellState('asi-figure', 'input', 'contributor'),
    ).rejects.toThrow(FinishLineGuardError);
    const cells = await repo.listFinishLineCells();
    expect(cells.ok && cells.rows.find((row) => row.id === 'asi-input')?.state).toBe('input');
    expect(repo.readCellHistory()).toHaveLength(0);
  });

  it('a contributor claiming origin "human" is still held to input → figure — the trigger does not trust the client', async () => {
    await expect(
      repo.setFinishLineCellState('asi-input', 'locked', 'human'),
    ).rejects.toThrow(/only move a cell forward from input to figure/);
  });

  it('a cross-entity cell does not resolve: the same "Cell not found" RLS produces', async () => {
    await expect(
      repo.setFinishLineCellState('kni-input', 'figure', 'contributor'),
    ).rejects.toThrow('Cell not found: kni-input');
    await expect(repo.setFinishLineCellNote('kni-input', 'x')).rejects.toThrow(
      'Cell not found: kni-input',
    );
  });

  it('a note edit works on any own-entity cell state and records note_changed', async () => {
    const updated = await repo.setFinishLineCellNote('asi-figure', 'metode belum jelas');
    expect(updated.note).toBe('metode belum jelas');
    expect(updated.actorKind).toBe('contributor');
    const history = repo.readCellHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      cellId: 'asi-figure',
      fromState: 'figure',
      toState: 'figure',
      noteChanged: true,
      actorKind: 'contributor',
    });
  });

  it('matrix structure stays the owner’s: edges, paste, project writes all fail', async () => {
    await expect(repo.setCellEdges('asi-input', [])).rejects.toThrow(/owner only/);
    await expect(repo.setMilestoneEdges('p1', 'm1', [])).rejects.toThrow(/owner only/);
    await expect(
      repo.applyFinishLineAccountPaste({ upserts: [], deleteIds: [] }),
    ).rejects.toThrow(/owner only/);
    await expect(
      repo.createProject({
        domain: 'work',
        engagement: 'samb',
        title: 'x',
        type: 'other',
        status: 'active',
        milestones: [],
        order: 1,
      }),
    ).rejects.toThrow(/owner only/);
    const someProject = (await repo.listProjects())[0];
    await expect(repo.updateProject(someProject.id, { title: 'y' })).rejects.toThrow(
      /not found/,
    );
    // DELETE matches zero rows and reports nothing — exactly what live does.
    await repo.deleteProject(someProject.id);
    expect(await repo.listProjects()).toContainEqual(
      expect.objectContaining({ id: someProject.id }),
    );
  });
});

describe('owner viewer — unchanged, and attribution resets to the owner', () => {
  let repo: MockRepository;

  beforeEach(() => {
    repo = new MockRepository();
    seedCells(repo, [cell('c1', 'ASI', 'input')]);
  });

  it('reaches all five states, in any order', async () => {
    for (const state of ['zero', 'undefined', 'locked', 'figure', 'input'] as CellState[]) {
      const updated = await repo.setFinishLineCellState('c1', state, 'human');
      expect(updated.state).toBe(state);
      expect(updated.actorKind).toBe('owner');
      expect(updated.actor).toBeUndefined();
    }
    expect(repo.readCellHistory()).toHaveLength(5);
  });

  it('an owner write over a contributor submission resets actor_kind', async () => {
    repo.setViewer({ kind: 'contributor', userId: 'u-1', entityCodes: ['ASI'] });
    await repo.setFinishLineCellState('c1', 'figure', 'contributor');
    repo.setViewer({ kind: 'owner' });
    const updated = await repo.setFinishLineCellNote('c1', 'checked the method');
    expect(updated.actorKind).toBe('owner');
    expect(updated.actor).toBeUndefined();
  });

  it('still sees everything a contributor cannot', async () => {
    expect((await repo.listProjects()).length).toBeGreaterThan(1);
    expect((await repo.listEntries()).length).toBeGreaterThan(0);
  });
});
