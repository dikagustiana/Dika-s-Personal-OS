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

  it('projects: zero grants read zero — entity membership alone opens nothing (slice 1)', async () => {
    // The engagement predicate is gone (20260804000045): this viewer holds
    // ASI and no project grant, so the correct project count is zero — under
    // the old policy it was every SAMB WORK project. Membership fails closed.
    expect(await repo.listProjects()).toEqual([]);

    // One grant, exactly that one project — no domain or engagement filter.
    repo.setViewer({ kind: 'owner' });
    const granted = (await repo.listProjects('work'))[0];
    await repo.grantProjectMembership(CONTRIBUTOR.userId, granted.id);
    repo.setViewer(CONTRIBUTOR);
    expect((await repo.listProjects()).map((project) => project.id)).toEqual([granted.id]);
    expect(await repo.listProjects('growth')).toEqual([]);
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
    // Grant one project so there is a VISIBLE row to fail against: a member
    // update on a granted project still matches zero rows (read ≠ write).
    repo.setViewer({ kind: 'owner' });
    const someProject = (await repo.listProjects('work'))[0];
    await repo.grantProjectMembership(CONTRIBUTOR.userId, someProject.id);
    repo.setViewer(CONTRIBUTOR);
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

describe('history note capture — from/to contents on every row (migration G mirror)', () => {
  let repo: MockRepository;

  beforeEach(() => {
    repo = new MockRepository();
    seedCells(repo, [
      cell('c-note', 'ASI', 'input'),
      { ...cell('c-with-note', 'ASI', 'input'), note: 'catatan awal' },
    ]);
  });

  it('a note edit records both sides, empty as the empty string', async () => {
    await repo.setFinishLineCellNote('c-note', 'catatan baru');
    const [row] = repo.readCellHistory();
    expect(row).toMatchObject({
      cellId: 'c-note',
      fromState: 'input',
      toState: 'input',
      noteChanged: true,
      fromNote: '',
      toNote: 'catatan baru',
    });
  });

  it('a state-only change carries the unchanged note on both sides', async () => {
    await repo.setFinishLineCellState('c-with-note', 'figure', 'human');
    const [row] = repo.readCellHistory();
    expect(row).toMatchObject({
      fromState: 'input',
      toState: 'figure',
      noteChanged: false,
      fromNote: 'catatan awal',
      toNote: 'catatan awal',
    });
  });

  it('a simultaneous state + note change captures all four values', async () => {
    // The Repository interface has no combined call; production reaches this
    // through a single PATCH hitting the trigger. Exercise the mock's
    // trigger-mirror directly, the same way the SQL validation exercised the
    // trigger.
    const internals = repo as unknown as {
      finishLineCells: Map<string, FinishLineCell>;
      applyCellWrite: (current: FinishLineCell, next: FinishLineCell) => FinishLineCell;
    };
    const current = internals.finishLineCells.get('c-with-note') as FinishLineCell;
    internals.applyCellWrite(current, { ...current, state: 'figure', note: 'sekaligus' });
    const [row] = repo.readCellHistory();
    expect(row).toMatchObject({
      fromState: 'input',
      toState: 'figure',
      noteChanged: true,
      fromNote: 'catatan awal',
      toNote: 'sekaligus',
    });
  });

  it('no newly written row ever has a null note column, and the chain holds', async () => {
    await repo.setFinishLineCellState('c-note', 'figure', 'human');
    await repo.setFinishLineCellNote('c-note', 'a');
    await repo.setFinishLineCellNote('c-note', undefined);
    await repo.setFinishLineCellState('c-note', 'input', 'human');
    const rows = repo.readCellHistory().filter((row) => row.cellId === 'c-note');
    expect(rows.length).toBe(4);
    for (const row of rows) {
      expect(typeof row.fromNote).toBe('string');
      expect(typeof row.toNote).toBe('string');
    }
    // to_note of row N equals from_note of row N+1; final to_note = live note.
    for (let i = 0; i < rows.length - 1; i++) {
      expect(rows[i].toNote).toBe(rows[i + 1].fromNote);
    }
    const cells = await repo.listFinishLineCells();
    const live = cells.ok ? cells.rows.find((c) => c.id === 'c-note') : undefined;
    expect(rows[rows.length - 1].toNote).toBe(live?.note ?? '');
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

describe('project membership + tasks — the slice-1 trigger and policies, mirrored', () => {
  let repo: MockRepository;
  let granted: string;
  let other: string;

  const FOIL = {
    kind: 'contributor' as const,
    userId: 'a11ce000-5afe-4000-8000-c0113b000003',
    entityCodes: [],
  };

  beforeEach(async () => {
    repo = new MockRepository();
    seedCells(repo, [cell('asi-input', 'ASI', 'input')]);
    granted = (await repo.listProjects('work'))[0].id;
    // engagement 'internal' ON PURPOSE: visibility is the grant and nothing
    // else since 20260804000045 — an internal project granted to the foil is
    // exactly as reachable as a samb one.
    other = (
      await repo.createProject({
        domain: 'work',
        engagement: 'internal',
        title: 'Second WORK project (fixture)',
        type: 'other',
        status: 'active',
        milestones: [],
        order: 99,
      })
    ).id;
    await repo.grantProjectMembership(CONTRIBUTOR.userId, granted);
    await repo.grantProjectMembership(FOIL.userId, other);
  });

  it('a task in a non-granted project exists and is invisible', async () => {
    repo.setViewer(FOIL);
    await repo.createProjectTask({ projectId: other, title: 'foil task' });
    repo.setViewer(CONTRIBUTOR);
    const tasks = await repo.listProjectTasks();
    expect(tasks.ok && tasks.rows).toEqual([]);
  });

  it('membership self-select: exactly the own grant rows', async () => {
    repo.setViewer(CONTRIBUTOR);
    const members = await repo.listProjectMembers();
    expect(members.ok && members.rows).toEqual([
      expect.objectContaining({ userId: CONTRIBUTOR.userId, projectId: granted }),
    ]);
  });

  it('INSERT in the granted project is stamped contributor with five birth rows from empty', async () => {
    repo.setViewer(CONTRIBUTOR);
    const task = await repo.createProjectTask({
      projectId: granted,
      title: 'tugas pertama',
      detail: 'd1',
    });
    expect(task.createdByKind).toBe('contributor');
    expect(task.createdBy).toBe(CONTRIBUTOR.userId);
    expect(task.actorKind).toBe('contributor');
    expect(task.actor).toBe(CONTRIBUTOR.userId);
    expect(task.changedAt).toBeTruthy();
    const birth = repo.readTaskHistory().filter((row) => row.taskId === task.id);
    expect(birth).toHaveLength(5);
    for (const row of birth) expect(row.fromValue).toBe('');
    expect(birth.find((row) => row.field === 'title')?.toValue).toBe('tugas pertama');
    expect(birth.find((row) => row.field === 'due_date')?.toValue).toBe('');
  });

  it('INSERT into a non-granted project is rejected with the trigger message', async () => {
    repo.setViewer(CONTRIBUTOR);
    await expect(
      repo.createProjectTask({ projectId: other, title: 'nope' }),
    ).rejects.toThrow(/not one of your projects/);
  });

  it('a member may not move a task between projects — even two granted ones', async () => {
    repo.setViewer(CONTRIBUTOR);
    const task = await repo.createProjectTask({ projectId: granted, title: 't' });
    repo.setViewer({ kind: 'owner' });
    await repo.grantProjectMembership(CONTRIBUTOR.userId, other);
    repo.setViewer(CONTRIBUTOR);
    const internals = repo as unknown as {
      applyTaskWrite: (current: unknown, next: unknown) => unknown;
    };
    const moved = { ...task, projectId: other };
    // The Repository interface cannot even express a move (ProjectTaskWrite
    // has no projectId), so exercise the trigger-mirror directly — the same
    // path a spoofed PATCH would hit live.
    expect(() => internals.applyTaskWrite(task, moved)).toThrow(
      /may not move a task between projects/,
    );
  });

  it('a changed assignee must belong to the project; a member assignee lands in history', async () => {
    repo.setViewer(CONTRIBUTOR);
    const task = await repo.createProjectTask({ projectId: granted, title: 't' });
    await expect(
      repo.updateProjectTask(task.id, { assignee: FOIL.userId }),
    ).rejects.toThrow(/assignee must be a member/);
    const updated = await repo.updateProjectTask(task.id, { assignee: CONTRIBUTOR.userId });
    expect(updated.assignee).toBe(CONTRIBUTOR.userId);
    const row = repo
      .readTaskHistory()
      .find((entry) => entry.taskId === task.id && entry.field === 'assignee' && entry.toValue !== '');
    expect(row).toMatchObject({ fromValue: '', toValue: CONTRIBUTOR.userId });
  });

  it('content changes write per-field history with full values; sort_order writes none', async () => {
    repo.setViewer(CONTRIBUTOR);
    const task = await repo.createProjectTask({ projectId: granted, title: 'v1' });
    const before = repo.readTaskHistory().length;
    await repo.updateProjectTask(task.id, { title: 'v2', status: 'in_progress' });
    await repo.updateProjectTask(task.id, { sortOrder: 9 });
    const rows = repo.readTaskHistory().slice(before);
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual(
      expect.objectContaining({ field: 'title', fromValue: 'v1', toValue: 'v2' }),
    );
    expect(rows).toContainEqual(
      expect.objectContaining({ field: 'status', fromValue: 'open', toValue: 'in_progress' }),
    );
  });

  it('revocation zeroes projects and tasks immediately; the entity axis stays alive', async () => {
    repo.setViewer(CONTRIBUTOR);
    const task = await repo.createProjectTask({ projectId: granted, title: 't' });
    repo.setViewer({ kind: 'owner' });
    await repo.revokeProjectMembership(CONTRIBUTOR.userId, granted);
    repo.setViewer(CONTRIBUTOR);
    expect(await repo.listProjects()).toEqual([]);
    const tasks = await repo.listProjectTasks();
    expect(tasks.ok && tasks.rows).toEqual([]);
    await expect(repo.updateProjectTask(task.id, { title: 'x' })).rejects.toThrow(
      /Task not found/,
    );
    // Positive control: the OTHER axis still writes, so the zeroes above are
    // revocation, not a dead viewer.
    const written = await repo.setFinishLineCellNote('asi-input', 'masih bisa');
    expect(written.note).toBe('masih bisa');
  });

  it('an owner write resets attribution, and owner assignee is unrestricted', async () => {
    repo.setViewer(CONTRIBUTOR);
    const task = await repo.createProjectTask({ projectId: granted, title: 't' });
    repo.setViewer({ kind: 'owner' });
    const done = await repo.updateProjectTask(task.id, { status: 'done', assignee: FOIL.userId });
    expect(done.actorKind).toBe('owner');
    expect(done.actor).toBeUndefined();
    expect(done.createdByKind).toBe('contributor'); // creation is history, not state
    expect(done.assignee).toBe(FOIL.userId); // owner branch: no membership check
  });

  it('cancelled is a terminal status, not a delete — and no delete method exists', async () => {
    repo.setViewer(CONTRIBUTOR);
    const task = await repo.createProjectTask({ projectId: granted, title: 't' });
    const cancelled = await repo.updateProjectTask(task.id, { status: 'cancelled' });
    expect(cancelled.status).toBe('cancelled');
    // The interface not having deleteProjectTask IS the client half of the
    // rule; this line fails to compile if someone adds it back casually.
    type HasDelete = 'deleteProjectTask' extends keyof MockRepository ? true : false;
    const hasDelete: HasDelete = false;
    expect(hasDelete).toBe(false);
  });

  it('grant and revoke are owner-only writes', async () => {
    repo.setViewer(CONTRIBUTOR);
    await expect(repo.grantProjectMembership(CONTRIBUTOR.userId, other)).rejects.toThrow(
      /owner only/,
    );
    await expect(repo.revokeProjectMembership(CONTRIBUTOR.userId, granted)).rejects.toThrow(
      /owner only/,
    );
  });

  it('deleting a project cascades its tasks and grants; task history survives', async () => {
    repo.setViewer(CONTRIBUTOR);
    const task = await repo.createProjectTask({ projectId: granted, title: 't' });
    repo.setViewer({ kind: 'owner' });
    await repo.deleteProject(granted);
    const tasks = await repo.listProjectTasks();
    expect(tasks.ok && tasks.rows).toEqual([]);
    const members = await repo.listProjectMembers();
    // Only the deleted project's grants cascade; the foil's grant on the
    // OTHER project survives untouched.
    expect(
      members.ok && members.rows.filter((row) => row.projectId === granted),
    ).toEqual([]);
    expect(members.ok && members.rows).toContainEqual(
      expect.objectContaining({ userId: FOIL.userId, projectId: other }),
    );
    // History outlives the row — the tombstone property the chain check
    // depends on.
    expect(repo.readTaskHistory().some((row) => row.taskId === task.id)).toBe(true);
  });

  it('the task chain invariant holds in the mock: tip equals the live row', async () => {
    repo.setViewer(CONTRIBUTOR);
    const task = await repo.createProjectTask({ projectId: granted, title: 'v1', detail: 'a' });
    await repo.updateProjectTask(task.id, { title: 'v2' });
    await repo.updateProjectTask(task.id, { title: 'v3', detail: '' });
    const live = await repo.listProjectTasks();
    const row = live.ok ? live.rows.find((candidate) => candidate.id === task.id) : undefined;
    const history = repo.readTaskHistory().filter((entry) => entry.taskId === task.id);
    for (const field of ['title', 'detail', 'status', 'due_date', 'assignee'] as const) {
      const chain = history.filter((entry) => entry.field === field);
      expect(chain[0]?.fromValue).toBe('');
      for (let i = 0; i < chain.length - 1; i++) {
        expect(chain[i].toValue).toBe(chain[i + 1].fromValue);
      }
      const liveValue =
        field === 'title'
          ? row?.title
          : field === 'detail'
            ? row?.detail
            : field === 'status'
              ? row?.status
              : field === 'due_date'
                ? (row?.dueDate ?? '')
                : (row?.assignee ?? '');
      expect(chain[chain.length - 1]?.toValue).toBe(liveValue);
    }
  });
});
