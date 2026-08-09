import { MockResearchRepository } from './researchRepository';
import { IELTS_TOPICS } from '../logic/ielts/topics';
import { PUBLISHED_BAND_CONVERSION } from '../logic/ielts/bandTable';
import {
  guardCellNote,
  guardCellState,
  guardCellTransition,
  guardEdgeTarget,
  type CellWriteOrigin,
} from './finishLineGuards';
import { guardTimeBlock } from './timeBlockGuards';
import type { ProjectTaskWrite, Repository } from './repository';
import { okRows, readAbsence, type ReadResult } from './readResult';
import {
  seedDailyLogs,
  seedEntries,
  seedIeltsResults,
  seedProjects,
  seedWeeklyPlans,
} from './seed';
import type {
  DailyLog,
  FinishLineAccount,
  FinishLineAccountMapRow,
  FinishLineAccountWrite,
  Domain,
  Entry,
  CellActorKind,
  CellHistoryEntry,
  CollabLink,
  CellState,
  DanglingLink,
  FinishLineCell,
  FinishLineDep,
  FinishLineEdge,
  FinishLineEntity,
  FinishLineItem,
  OrphanMilestone,
  ProcessGate,
  ProcessLane,
  ProcessNeed,
  ProcessPhase,
  ProcessReference,
  ProcessStep,
  ProcessStepItem,
  ProcessTextHistoryEntry,
  ProcessTrackDef,
  IeltsBandConversion,
  IeltsError,
  IeltsPractice,
  IeltsPracticeTopic,
  IeltsPracticeWrite,
  IeltsPrepConfig,
  IeltsTopic,
  IeltsResult,
  IeltsSession,
  Project,
  ProjectMember,
  ProjectTask,
  ShareLink,
  ShareScope,
  ShareView,
  SignInEvent,
  TaskHistoryEntry,
  TaskStatus,
  WeeklyPlan,
} from './types';
import type {
  ProcessGateTextWrite,
  ProcessLaneTextWrite,
  ProcessNeedTextWrite,
  ProcessPhaseTextWrite,
  ProcessStepTextWrite,
  TextHistoryRow,
} from '../logic/processTextEdit';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function createId(): string {
  return crypto.randomUUID();
}

// Daily logs are keyed by (date, domain); weekly plans by (week, domain).
function logKey(date: string, domain: Domain): string {
  return `${domain}:${date}`;
}

function planKey(week: string, domain: Domain): string {
  return `${domain}:${week}`;
}

/**
 * WHO THE MOCK IS PRETENDING TO BE — the same fact production derives from the
 * credential (x-app-key header = owner, JWT + membership = contributor).
 * Default owner, so every existing test and the no-credentials dev experience
 * are untouched. Set to a contributor and the mock reproduces what RLS and the
 * cell trigger do live: entity-scoped reads, input → figure only, actor
 * stamping, history rows. INVARIANT 6: the mock is what the tests reason
 * about, so a guard added to the Supabase path lands here too or the suite
 * asserts against fiction.
 *
 * The viewer carries entityCodes because that axis predates slice 1; the
 * PROJECT axis is deliberately NOT a viewer field. Project grants are DATA —
 * rows in the membership store, written by grant/revokeProjectMembership —
 * exactly as live, so a revocation test exercises the same path production
 * revocation does.
 */
export type MockViewer =
  | { kind: 'owner' }
  | { kind: 'contributor'; userId: string; entityCodes: string[] };

/** One history row, shaped like os_finish_line_cell_history. */
export interface MockCellHistoryEntry {
  cellId: string;
  fromState: CellState;
  toState: CellState;
  noteChanged: boolean;
  /**
   * Note contents, both sides, '' for an empty note — REQUIRED strings, never
   * null: the mock starts empty so it has no pre-migration rows, and
   * production's trigger writes coalesce(note, ''). toNote of row N equals
   * fromNote of row N+1; the final toNote equals the live cell note.
   */
  fromNote: string;
  toNote: string;
  actorKind: CellActorKind;
  actor?: string;
  changedAt: string;
}

/**
 * One row shaped like os_task_history: per-field content, both sides,
 * REQUIRED strings. Tasks are born WITH history (the trigger writes five
 * birth rows from '' on INSERT), so unlike the cell columns there is no
 * pre-migration null case at all — the same invariant the SQL enforces with
 * NOT NULL.
 */
export interface MockTaskHistoryEntry {
  taskId: string;
  field: 'title' | 'detail' | 'status' | 'due_date' | 'assignee';
  fromValue: string;
  toValue: string;
  actorKind: CellActorKind;
  actor?: string;
  changedAt: string;
}

export class MockRepository implements Repository {
  /** Research lives behind its own seam; a bare clone still gets a working one. */
  readonly research = new MockResearchRepository();

  private viewer: MockViewer = { kind: 'owner' };

  /** Mock-only (not on Repository): production sets this via the credential. */
  setViewer(viewer: MockViewer): void {
    this.viewer = viewer;
  }

  private memberEntities(): string[] {
    return this.viewer.kind === 'contributor' ? this.viewer.entityCodes : [];
  }

  private isContributor(): boolean {
    return this.viewer.kind === 'contributor';
  }

  /** Mirrors the member SELECT policy on cells: own entities only. */
  private cellVisible(cell: FinishLineCell): boolean {
    return !this.isContributor() || this.memberEntities().includes(cell.entityCode);
  }

  /**
   * THE SECOND AXIS AS DATA, exactly like production: grants live in a
   * membership table written by the owner (grant/revokeProjectMembership),
   * and the viewer is only the credential. Entity membership deliberately
   * plays no part here — since 20260804000045 project read is per-project
   * grant, nothing else.
   */
  private readonly projectMembers: ProjectMember[] = [];

  /**
   * Layer two of the domain guard (20260804000047), mirrored: the WORK
   * filter lives HERE, exactly as it lives inside os_member_projects(), so
   * every consumer inherits it and a poisoned GROWTH membership row is
   * inert even when planted past layer one.
   */
  private memberProjects(): string[] {
    if (this.viewer.kind !== 'contributor') return [];
    const uid = this.viewer.userId;
    return this.projectMembers
      .filter((member) => member.userId === uid)
      .filter((member) => this.projects.get(member.projectId)?.domain === 'work')
      .map((member) => member.projectId);
  }

  /**
   * Mirrors `member reads granted projects`: WORK and granted, nothing
   * else — no engagement condition; zero grants reads zero projects.
   * `engagement` is a client attribute now, not visibility. The explicit
   * domain check restates layer three's redundant conjunct.
   */
  private projectVisible(project: Project): boolean {
    return (
      !this.isContributor() ||
      (project.domain === 'work' && this.memberProjects().includes(project.id))
    );
  }

  /**
   * Mirrors a table with NO member policy: production answers a contributor
   * INSERT with an RLS violation and an UPDATE with zero matched rows. The
   * mock throws the same class of failure for both, because a silent no-op
   * would let a test pass against behaviour production does not have.
   */
  private assertOwnerWrite(operation: string): void {
    if (this.isContributor()) {
      throw new Error(`${operation} failed: row-level security (owner only)`);
    }
  }

  // Append-only, trigger-written in production; the trigger-mirror below is
  // the only writer here. Exposed read-only for tests — production scopes
  // SELECT to the owner and the UI reads attribution from the cell row.
  private readonly finishLineCellHistory: MockCellHistoryEntry[] = [];

  readCellHistory(): MockCellHistoryEntry[] {
    return clone(this.finishLineCellHistory);
  }

  // Same arrangement for tasks: written only by the task trigger-mirror,
  // read-only for tests. Rows survive task deletion — history outlives the
  // row, as live (no FK on os_task_history.task_id).
  private readonly taskHistory: MockTaskHistoryEntry[] = [];

  readTaskHistory(): MockTaskHistoryEntry[] {
    return clone(this.taskHistory);
  }

  private readonly entries = new Map(seedEntries.map((entry) => [entry.id, clone(entry)]));
  private readonly dailyLogs = new Map(
    seedDailyLogs.map((log) => [logKey(log.date, log.domain), clone(log)]),
  );
  private readonly weeklyPlans = new Map(
    seedWeeklyPlans.map((plan) => [planKey(plan.week, plan.domain), clone(plan)]),
  );
  private readonly projects = new Map(
    seedProjects.map((project) => [project.id, clone(project)]),
  );
  private readonly ieltsResults = new Map(
    seedIeltsResults.map((result) => [result.id, clone(result)]),
  );

  async listEntries(filter?: {
    type?: Entry['type'];
    date?: string;
    domain?: Domain;
  }): Promise<Entry[]> {
    // No member policy on os_entries: a contributor reads nothing, exactly as
    // production returns an empty set. Same pattern on every table below that
    // §6 gave no member policy.
    if (this.isContributor()) return [];
    const entries = [...this.entries.values()].filter((entry) => {
      if (filter?.domain && entry.domain !== filter.domain) return false;
      if (filter?.type && entry.type !== filter.type) return false;
      if (!filter?.date) return true;
      if (entry.type === 'timeblock') return entry.date === filter.date;
      if (entry.type === 'task') return entry.dueDate === filter.date;
      if (entry.type === 'braindump') return entry.createdAt.slice(0, 10) === filter.date;
      return true;
    });
    return clone(entries);
  }

  async getEntry(id: string): Promise<Entry | null> {
    if (this.isContributor()) return null;
    const entry = this.entries.get(id);
    return entry ? clone(entry) : null;
  }

  async createEntry(
    input: Omit<Entry, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Entry> {
    this.assertOwnerWrite('createEntry');
    const now = new Date().toISOString();
    const created = {
      ...input,
      id: createId(),
      createdAt: now,
      updatedAt: now,
    } as Entry;
    guardTimeBlock(created);
    this.entries.set(created.id, clone(created));
    return clone(created);
  }

  async updateEntry(id: string, patch: Partial<Entry>): Promise<Entry> {
    const current = this.entries.get(id);
    if (!current || this.isContributor()) throw new Error(`Entry not found: ${id}`);
    const updated = {
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    } as Entry;
    // Guarded on the MERGED entry: a patch adding milestoneId to a block that
    // already carries taskId is only visible against the result.
    guardTimeBlock(updated);
    this.entries.set(id, clone(updated));
    return clone(updated);
  }

  async deleteEntry(id: string): Promise<void> {
    if (this.isContributor()) return; // zero rows matched, no error — as live
    this.entries.delete(id);
  }

  async getDailyLog(date: string, domain: Domain): Promise<DailyLog | null> {
    if (this.isContributor()) return null;
    const log = this.dailyLogs.get(logKey(date, domain));
    return log ? clone(log) : null;
  }

  async upsertDailyLog(log: DailyLog): Promise<DailyLog> {
    this.assertOwnerWrite('upsertDailyLog');
    this.dailyLogs.set(logKey(log.date, log.domain), clone(log));
    return clone(log);
  }

  async listDailyLogs(range: {
    from: string;
    to: string;
    domain: Domain;
  }): Promise<DailyLog[]> {
    if (this.isContributor()) return [];
    const logs = [...this.dailyLogs.values()]
      .filter(
        (log) =>
          log.domain === range.domain &&
          log.date >= range.from &&
          log.date <= range.to,
      )
      .sort((a, b) => a.date.localeCompare(b.date));
    return clone(logs);
  }

  async getWeeklyPlan(week: string, domain: Domain): Promise<WeeklyPlan | null> {
    if (this.isContributor()) return null;
    const plan = this.weeklyPlans.get(planKey(week, domain));
    return plan ? clone(plan) : null;
  }

  async upsertWeeklyPlan(plan: WeeklyPlan): Promise<WeeklyPlan> {
    this.assertOwnerWrite('upsertWeeklyPlan');
    this.weeklyPlans.set(planKey(plan.week, plan.domain), clone(plan));
    return clone(plan);
  }

  async listProjects(domain?: Domain): Promise<Project[]> {
    return clone(
      [...this.projects.values()]
        .filter((project) => this.projectVisible(project))
        .filter((project) => !domain || project.domain === domain)
        .sort((a, b) => a.order - b.order),
    );
  }

  async getProject(id: string): Promise<Project | null> {
    const project = this.projects.get(id);
    if (!project || !this.projectVisible(project)) return null;
    return clone(project);
  }

  async createProject(input: Omit<Project, 'id'>): Promise<Project> {
    this.assertOwnerWrite('createProject');
    const project: Project = { ...input, id: createId() };
    this.projects.set(project.id, clone(project));
    return clone(project);
  }

  async updateProject(id: string, patch: Partial<Project>): Promise<Project> {
    const current = this.projects.get(id);
    // A contributor has no UPDATE policy on projects: production matches zero
    // rows and the repository reports not-found. Visible-but-unwritable
    // collapses to the same outcome, which is exactly what the API shows.
    if (!current || this.isContributor()) throw new Error(`Project not found: ${id}`);
    const updated: Project = { ...current, ...patch, id: current.id };
    this.projects.set(id, clone(updated));
    return clone(updated);
  }

  async deleteProject(id: string): Promise<void> {
    // Production: no member DELETE policy, zero rows matched, no error. The
    // silent no-op IS the parity.
    if (this.isContributor()) return;
    this.projects.delete(id);
    this.cascadeProjectDeletion(id);
  }

  async listIeltsResults(): Promise<IeltsResult[]> {
    if (this.isContributor()) return [];
    return clone(
      [...this.ieltsResults.values()].sort((a, b) => a.date.localeCompare(b.date)),
    );
  }

  async createIeltsResult(input: Omit<IeltsResult, 'id'>): Promise<IeltsResult> {
    this.assertOwnerWrite('createIeltsResult');
    const result: IeltsResult = { ...input, id: createId() };
    this.ieltsResults.set(result.id, clone(result));
    return clone(result);
  }

  async updateIeltsResult(id: string, patch: Partial<IeltsResult>): Promise<IeltsResult> {
    const current = this.ieltsResults.get(id);
    if (!current || this.isContributor()) throw new Error(`IELTS result not found: ${id}`);
    const updated: IeltsResult = { ...current, ...patch, id: current.id };
    this.ieltsResults.set(id, clone(updated));
    return clone(updated);
  }

  async deleteIeltsResult(id: string): Promise<void> {
    if (this.isContributor()) return;
    this.ieltsResults.delete(id);
  }

  /**
   * Starts EMPTY, and stays empty. Every error row carries a verbatim quote
   * from the owner's own unpublished practice writing; the taxonomy is generic
   * methodology and belongs in the repo, the content does not. No seed, no
   * fixture, no example row.
   */
  private readonly ieltsErrors = new Map<string, IeltsError>();

  async listIeltsErrors(): Promise<IeltsError[]> {
    if (this.isContributor()) return [];
    return clone(
      [...this.ieltsErrors.values()].sort(
        (a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt),
      ),
    );
  }

  async createIeltsErrors(
    input: ReadonlyArray<Omit<IeltsError, 'id' | 'createdAt'>>,
  ): Promise<IeltsError[]> {
    this.assertOwnerWrite('createIeltsErrors');
    const created = input.map((row) => ({
      ...row,
      id: createId(),
      createdAt: new Date().toISOString(),
    }));
    for (const row of created) this.ieltsErrors.set(row.id, clone(row));
    return clone(created);
  }

  async deleteIeltsError(id: string): Promise<void> {
    if (this.isContributor()) return;
    this.ieltsErrors.delete(id);
  }

  /**
   * Starts empty for the same reason the errors do: raw_feedback carries the
   * owner's own practice content and the examiner's review of it. No seed, no
   * fixture, no example row.
   */
  private readonly ieltsSessions = new Map<string, IeltsSession>();

  async listIeltsSessions(): Promise<IeltsSession[]> {
    if (this.isContributor()) return [];
    return clone(
      [...this.ieltsSessions.values()].sort(
        (a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt),
      ),
    );
  }

  async createIeltsSessions(
    input: ReadonlyArray<Omit<IeltsSession, 'id' | 'createdAt'>>,
  ): Promise<IeltsSession[]> {
    this.assertOwnerWrite('createIeltsSessions');
    const created = input.map((row) => ({
      ...row,
      id: createId(),
      createdAt: new Date().toISOString(),
    }));
    for (const row of created) this.ieltsSessions.set(row.id, clone(row));
    return clone(created);
  }

  // --- IELTS prep: the per-question-type tracker ------------------------------
  //
  // The TAXONOMY and the CONVERSION TABLE are reference data, not his data, so
  // the mock serves them in full from the same source the seed migration used
  // (logic/ielts/topics.ts and the two published tables). A bare clone with no
  // credentials therefore renders a working Method reader and a working log
  // form — which is the point of the mock repository.
  //
  // The PRACTICE LOG starts empty, like every other personal record here.

  private readonly ieltsPractice = new Map<string, IeltsPractice>();
  private readonly ieltsPracticeTopics: IeltsPracticeTopic[] = [];

  async listIeltsTopics(): Promise<IeltsTopic[]> {
    // Spread rather than cast: IELTS_TOPICS is now a readonly const tuple, and
    // clone() hands its result to callers that treat it as a mutable list.
    return clone<IeltsTopic[]>([...IELTS_TOPICS]);
  }

  async listIeltsPractice(): Promise<IeltsPractice[]> {
    if (this.isContributor()) return [];
    return clone(
      [...this.ieltsPractice.values()].sort(
        (a, b) =>
          b.attemptedOn.localeCompare(a.attemptedOn) || b.createdAt.localeCompare(a.createdAt),
      ),
    );
  }

  async listIeltsPracticeTopics(): Promise<IeltsPracticeTopic[]> {
    if (this.isContributor()) return [];
    return clone(this.ieltsPracticeTopics);
  }

  async listIeltsBandConversion(): Promise<IeltsBandConversion[]> {
    return clone(PUBLISHED_BAND_CONVERSION as IeltsBandConversion[]);
  }

  /**
   * The same target the seed migration wrote. Duplicated here rather than left
   * null because the dashboard's whole shape — days remaining, the binding
   * constraint — depends on having one, and a mock that renders "no target
   * set" demonstrates nothing.
   */
  async getIeltsPrepConfig(): Promise<IeltsPrepConfig | null> {
    return { testDate: '2026-09-20', targetOverall: 7, targetFloor: 6.5 };
  }

  async createIeltsPractice(input: IeltsPracticeWrite): Promise<IeltsPractice> {
    this.assertOwnerWrite('createIeltsPractice');
    const { topics, ...rest } = input;
    const created: IeltsPractice = {
      ...rest,
      id: createId(),
      createdAt: new Date().toISOString(),
    };
    this.ieltsPractice.set(created.id, clone(created));
    // Written together, like the RPC the Supabase repository calls — a
    // practice row with no tags counts as practice and informs no ratio.
    for (const tag of topics) {
      this.ieltsPracticeTopics.push(clone({ ...tag, practiceId: created.id }));
    }
    return clone(created);
  }

  async deleteIeltsPractice(id: string): Promise<void> {
    this.assertOwnerWrite('deleteIeltsPractice');
    this.ieltsPractice.delete(id);
    // The database does this with ON DELETE CASCADE; the mock has to do it by
    // hand, and must, or aggregateWeakness keeps counting a deleted attempt.
    for (let i = this.ieltsPracticeTopics.length - 1; i >= 0; i -= 1) {
      if (this.ieltsPracticeTopics[i].practiceId === id) this.ieltsPracticeTopics.splice(i, 1);
    }
  }

  // --- finish line: the entity matrix ----------------------------------------

  /**
   * STARTS EMPTY, AND STAYS THAT WAY. The matrix names consolidation entities
   * and real pack line items; this repo is public, so it is seeded into the
   * database by migration 20260726000023 and never from here. A bare clone
   * renders the empty state — which is also exactly what a database without
   * the migration renders, so the two agree.
   *
   * NO FIGURES here and none may be added: a cell carries a state, and the
   * numbers live in Excel.
   */
  private readonly finishLineItems: FinishLineItem[] = [];
  private readonly finishLineEntities: FinishLineEntity[] = [];
  private readonly finishLineCells = new Map<string, FinishLineCell>();
  private readonly finishLineDeps: FinishLineDep[] = [];
  private finishLineEdges: FinishLineEdge[] = [];

  async listFinishLineItems(): Promise<ReadResult<FinishLineItem>> {
    // Structure tables read whole for any member of anything, empty for a
    // contributor with no memberships — the §6 predicate, verbatim.
    if (this.isContributor() && this.memberEntities().length === 0) return okRows([]);
    return okRows(clone([...this.finishLineItems].sort((a, b) => a.order - b.order)));
  }

  async listFinishLineEntities(): Promise<ReadResult<FinishLineEntity>> {
    if (this.isContributor() && this.memberEntities().length === 0) return okRows([]);
    return okRows(clone([...this.finishLineEntities].sort((a, b) => a.order - b.order)));
  }

  async listFinishLineCells(): Promise<ReadResult<FinishLineCell>> {
    return okRows(
      clone([...this.finishLineCells.values()].filter((cell) => this.cellVisible(cell))),
    );
  }

  async listFinishLineDeps(): Promise<ReadResult<FinishLineDep>> {
    // Deps carry no entity; visibility joins through the cell, as the policy
    // does. Both ends land in the same entity column by construction, so
    // checking cell_id matches the SQL exactly.
    return okRows(
      clone(
        this.finishLineDeps.filter((dep) => {
          const cell = this.finishLineCells.get(dep.cellId);
          return cell !== undefined && this.cellVisible(cell);
        }),
      ),
    );
  }

  async listFinishLineEdges(): Promise<ReadResult<FinishLineEdge>> {
    // Item-grain edges (no cellId) have no entity and stay owner-only — the
    // policy's exists() finds no cell for them.
    return okRows(
      clone(
        this.finishLineEdges.filter((edge) => {
          if (!this.isContributor()) return true;
          if (!edge.cellId) return false;
          const cell = this.finishLineCells.get(edge.cellId);
          return cell !== undefined && this.cellVisible(cell);
        }),
      ),
    );
  }

  /**
   * Empty for the same reason the matrix is: account names are the owner's
   * chart of accounts and this repo is public. The account level is loaded
   * into the database, never seeded from here.
   *
   * Read-only, like every account path — there is no mock write counterpart
   * because there is no real one.
   */
  /**
   * Empty for the same reason the matrix is: account names are the owner's
   * chart of accounts and this repo is public. The account level is loaded
   * into the database — or pasted through applyFinishLineAccountPaste, the
   * one write path — never seeded from here.
   */
  private readonly finishLineAccounts: FinishLineAccount[] = [];
  private readonly finishLineAccountMap: FinishLineAccountMapRow[] = [];

  async listFinishLineAccounts(): Promise<ReadResult<FinishLineAccount>> {
    // NO member policy, deliberately: the chart of accounts is the most
    // sensitive layer in the matrix. A contributor gets a clean empty ok —
    // not a failure — and the UI renders an empty state, not a spinner.
    if (this.isContributor()) return okRows([]);
    return okRows(clone(this.finishLineAccounts));
  }

  async applyFinishLineAccountPaste(input: {
    upserts: FinishLineAccountWrite[];
    deleteIds: string[];
  }): Promise<void> {
    this.assertOwnerWrite('applyFinishLineAccountPaste');
    const touchedAt = new Date().toISOString();
    for (const id of input.deleteIds) {
      const at = this.finishLineAccounts.findIndex((a) => a.id === id);
      if (at >= 0) this.finishLineAccounts.splice(at, 1);
    }
    for (const row of input.upserts) {
      const next: FinishLineAccount = {
        id: row.id ?? `acc-${Math.random().toString(36).slice(2, 10)}`,
        accountName: row.accountName,
        isDummy: row.isDummy,
        order: row.sortOrder,
        importedAt: touchedAt,
      };
      if (row.cellId) next.cellId = row.cellId;
      if (row.entityCode) next.entityCode = row.entityCode;
      if (row.coaEntity) next.coaEntity = row.coaEntity;
      if (row.coaConsol) next.coaConsol = row.coaConsol;
      if (row.function) next.function = row.function;
      if (row.nature) next.nature = row.nature;
      if (row.business) next.business = row.business;
      if (row.driverType) next.driverType = row.driverType;
      if (row.driverSource) next.driverSource = row.driverSource;
      if (row.dataIdeal) next.dataIdeal = row.dataIdeal;
      if (row.pic) next.pic = row.pic;
      const at = row.id ? this.finishLineAccounts.findIndex((a) => a.id === row.id) : -1;
      if (at >= 0) this.finishLineAccounts[at] = next;
      else this.finishLineAccounts.push(next);
    }
  }

  async listFinishLineAccountMap(): Promise<ReadResult<FinishLineAccountMapRow>> {
    if (this.isContributor() && this.memberEntities().length === 0) return okRows([]);
    return okRows(clone(this.finishLineAccountMap));
  }

  /**
   * Mirrors the view: edges whose milestone no longer exists in the project's
   * jsonb array. There is no foreign key and there cannot be one, so this gap
   * is surfaced rather than solved — and never auto-deleted.
   */
  async listDanglingLinks(): Promise<ReadResult<DanglingLink>> {
    // The production view is security_invoker: a contributor's rows come out
    // filtered through the edge and project policies. Reuse the scoped lists
    // rather than the raw maps so this derives from what the viewer can see.
    const visibleEdges = (await this.listFinishLineEdges());
    const edges = visibleEdges.ok ? visibleEdges.rows : [];
    const visibleProjects = new Map(
      [...this.projects.values()]
        .filter((project) => this.projectVisible(project))
        .map((project) => [project.id, project]),
    );
    const live = new Set<string>();
    for (const project of visibleProjects.values()) {
      for (const milestone of project.milestones) live.add(`${project.id}:${milestone.id}`);
    }
    return okRows(
      edges
        .filter(
          (edge) =>
            edge.milestoneId !== undefined && !live.has(`${edge.projectId}:${edge.milestoneId}`),
        )
        .map((edge) => {
          const link: DanglingLink = {
            id: edge.id,
            projectId: edge.projectId,
            milestoneId: edge.milestoneId as string,
          };
          link.cellId = edge.cellId;
          return link;
        }),
    );
  }

  /**
   * Mirrors the view's SCOPE as well as its predicate: WORK only, monthly
   * close excluded. It previously walked every project in every domain, so the
   * mock's orphan count and production's could never agree — and the mock is
   * what the tests reason about.
   */
  async listOrphanMilestones(): Promise<ReadResult<OrphanMilestone>> {
    const linked = new Set(
      this.finishLineEdges
        .filter((edge) => edge.milestoneId !== undefined)
        .map((edge) => `${edge.projectId}:${edge.milestoneId}`),
    );
    const orphans: OrphanMilestone[] = [];
    for (const project of this.projects.values()) {
      if (!this.projectVisible(project)) continue;
      if (project.domain !== 'work' || project.recurring === 'monthly') continue;
      for (const milestone of project.milestones) {
        if (linked.has(`${project.id}:${milestone.id}`)) continue;
        orphans.push({
          projectId: project.id,
          projectTitle: project.title,
          milestoneId: milestone.id,
          milestoneText: milestone.text,
          status: milestone.status,
        });
      }
    }
    return okRows(orphans);
  }

  /**
   * THE TRIGGER-MIRROR. Production enforces the contributor rules twice: the
   * client guards fail fast on the caller's declared origin, and the database
   * trigger re-decides from the CREDENTIAL — it does not trust the client's
   * claim. The mock does both too: guards first with `origin` (so a rollup is
   * rejected identically), then the viewer plays the trigger. A contributor
   * viewer claiming origin 'human' is therefore still held to input → figure,
   * exactly as a spoofed REST call is live.
   */
  private applyCellWrite(
    current: FinishLineCell,
    next: FinishLineCell,
  ): FinishLineCell {
    if (this.viewer.kind === 'contributor') {
      if (next.state !== current.state && !(current.state === 'input' && next.state === 'figure')) {
        // The SQL trigger's message, so a test asserting on it holds both ways.
        throw new Error(
          `finish line cells: a contributor may only move a cell forward from input to figure (attempted ${current.state} -> ${next.state})`,
        );
      }
      next.actorKind = 'contributor';
      next.actor = this.viewer.userId;
    } else {
      next.actorKind = 'owner';
      delete next.actor;
    }
    next.changedAt = new Date().toISOString();
    if (next.state !== current.state || (next.note ?? undefined) !== (current.note ?? undefined)) {
      const entry: MockCellHistoryEntry = {
        cellId: next.id,
        fromState: current.state,
        toState: next.state,
        noteChanged: (next.note ?? undefined) !== (current.note ?? undefined),
        // coalesce(note, '') — an empty note is '' and never null, exactly as
        // the trigger records it since migration 20260804000043.
        fromNote: current.note ?? '',
        toNote: next.note ?? '',
        actorKind: next.actorKind,
        changedAt: next.changedAt,
      };
      if (next.actor) entry.actor = next.actor;
      this.finishLineCellHistory.push(entry);
    }
    this.finishLineCells.set(next.id, clone(next));
    return clone(next);
  }

  async setFinishLineCellState(
    cellId: string,
    state: CellState,
    origin: CellWriteOrigin,
  ): Promise<FinishLineCell> {
    const current = this.finishLineCells.get(cellId);
    // A cross-entity cell is INVISIBLE to a contributor, so the id does not
    // resolve — the same "Cell not found" production's RLS produces.
    if (!current || !this.cellVisible(current)) throw new Error(`Cell not found: ${cellId}`);
    const checked = guardCellState(state, origin);
    guardCellTransition(current.state, checked, origin);
    return this.applyCellWrite(current, { ...current, state: checked });
  }

  async setFinishLineCellNote(
    cellId: string,
    note: string | undefined,
  ): Promise<FinishLineCell> {
    const current = this.finishLineCells.get(cellId);
    if (!current || !this.cellVisible(current)) throw new Error(`Cell not found: ${cellId}`);
    const cleaned = guardCellNote(note);
    const updated: FinishLineCell = { ...current };
    if (cleaned) updated.note = cleaned;
    else delete updated.note;
    return this.applyCellWrite(current, updated);
  }

  async setCellEdges(
    cellId: string,
    edges: { projectId: string; milestoneId?: string }[],
  ): Promise<void> {
    // Edges stay owner-only in this task — contributors write cells only.
    this.assertOwnerWrite('setCellEdges');
    const target = this.finishLineCells.get(cellId);
    if (!target) throw new Error(`Cell not found: ${cellId}`);
    // Same two rules as production: only an `input` cell can carry an edge,
    // and an unchanged commit is a no-op rather than a churn of rows.
    guardEdgeTarget(target.state);

    const key = (projectId: string, milestoneId?: string) => `${projectId}:${milestoneId ?? ''}`;
    const existing = new Set(
      this.finishLineEdges
        .filter((edge) => edge.cellId === cellId)
        .map((edge) => key(edge.projectId, edge.milestoneId)),
    );
    const wanted = new Set(edges.map((edge) => key(edge.projectId, edge.milestoneId)));
    const unchanged =
      existing.size === wanted.size && [...wanted].every((k) => existing.has(k));
    if (unchanged) return;

    this.finishLineEdges = this.finishLineEdges.filter((edge) => edge.cellId !== cellId);
    for (const edge of edges) {
      const created: FinishLineEdge = { id: createId(), cellId, projectId: edge.projectId };
      if (edge.milestoneId) created.milestoneId = edge.milestoneId;
      this.finishLineEdges.push(created);
    }
  }

  async setMilestoneEdges(
    projectId: string,
    milestoneId: string,
    cellIds: string[],
  ): Promise<void> {
    this.assertOwnerWrite('setMilestoneEdges');
    // Same two rules as production, which this path used to skip entirely.
    for (const cellId of cellIds) {
      const target = this.finishLineCells.get(cellId);
      if (!target) throw new Error(`Cell not found: ${cellId}`);
      guardEdgeTarget(target.state);
    }
    const existing = new Set(
      this.finishLineEdges
        .filter((edge) => edge.projectId === projectId && edge.milestoneId === milestoneId)
        .map((edge) => edge.cellId),
    );
    const wanted = new Set(cellIds);
    const unchanged =
      existing.size === wanted.size && [...wanted].every((id) => existing.has(id));
    if (unchanged) return;

    this.finishLineEdges = this.finishLineEdges.filter(
      (edge) => !(edge.projectId === projectId && edge.milestoneId === milestoneId),
    );
    for (const cellId of cellIds) {
      this.finishLineEdges.push({ id: createId(), cellId, projectId, milestoneId });
    }
  }

  // --- SAMB operational process ---------------------------------------------

  /**
   * STARTS EMPTY, like the finish-line matrix: the process map is seeded into
   * the database by migration 20260806000051 and never from here, so a bare
   * mock renders the same empty state a database without the migration does —
   * the two agree. Tests seed the private stores via a cast.
   */
  private readonly processTracks: ProcessTrackDef[] = [];
  private readonly processLanes: ProcessLane[] = [];
  private readonly processPhases: ProcessPhase[] = [];
  private readonly processSteps: ProcessStep[] = [];
  private readonly processGates: ProcessGate[] = [];
  private readonly processNeeds = new Map<string, ProcessNeed>();
  private readonly processStepItems: ProcessStepItem[] = [];

  /** Starts empty, like the live table before migration 20260806000054. */
  private readonly processReferences: ProcessReference[] = [];

  async listProcessReferences(): Promise<ReadResult<ProcessReference>> {
    return okRows(clone([...this.processReferences].sort((a, b) => a.sortOrder - b.sortOrder)));
  }

  async listProcessTracks(): Promise<ReadResult<ProcessTrackDef>> {
    return okRows(clone([...this.processTracks].sort((a, b) => a.ordinal - b.ordinal)));
  }

  async listProcessLanes(): Promise<ReadResult<ProcessLane>> {
    return okRows(clone([...this.processLanes].sort((a, b) => a.ordinal - b.ordinal)));
  }

  async listProcessPhases(): Promise<ReadResult<ProcessPhase>> {
    return okRows(clone([...this.processPhases].sort((a, b) => a.slotFrom - b.slotFrom)));
  }

  async listProcessSteps(): Promise<ReadResult<ProcessStep>> {
    return okRows(clone([...this.processSteps].sort((a, b) => a.slot - b.slot)));
  }

  async listProcessGates(): Promise<ReadResult<ProcessGate>> {
    return okRows(clone([...this.processGates].sort((a, b) => a.id.localeCompare(b.id))));
  }

  async listProcessNeeds(): Promise<ReadResult<ProcessNeed>> {
    return okRows(clone([...this.processNeeds.values()]));
  }

  async listProcessStepItems(): Promise<ReadResult<ProcessStepItem>> {
    return okRows(clone(this.processStepItems));
  }

  /**
   * requested_on, kept as its own method because the register edits it inline
   * without entering the panel's edit mode. The broader TEXT writes are
   * below; STRUCTURE is still unreachable from here by construction — the
   * patch types cannot name label, slot, lane_key, track or entity_code.
   */
  async setProcessNeedRequestedOn(id: string, requestedOn: string | null): Promise<ProcessNeed> {
    this.assertOwnerWrite('setProcessNeedRequestedOn');
    const current = this.processNeeds.get(id);
    if (!current) throw new Error(`Need not found: ${id}`);
    const next: ProcessNeed = { ...current };
    if (requestedOn) next.requestedOn = requestedOn;
    else delete next.requestedOn;
    this.processNeeds.set(id, clone(next));
    return clone(next);
  }

  // --- process TEXT writes -------------------------------------------------
  //
  // Mirrors the Supabase path: text only, mutating the same private stores the
  // reads serve, so a test can save and read back. Cell state stays
  // unreachable from every one of them.

  /**
   * Stores the STAMPED row, not the row the caller handed over — mirroring
   * migration 20260809000069, where a BEFORE INSERT trigger derives actor_kind
   * and actor server-side and overwrites anything a client sent. The caller's
   * TextHistoryRow has no actor fields at all, which is the point: the write
   * path does not know who is writing, and does not have to.
   */
  private readonly processTextHistory: ProcessTextHistoryEntry[] = [];
  /** Test seam: set false to simulate migration 20260806000055 not applied. */
  private processHistoryTableExists = true;
  /**
   * Test seam for the OTHER not-yet state, kept separate from the one above
   * because 42P01 and 42703 are different conditions: false means the table
   * exists and migration 20260809000069 has not run, so rows read back
   * unattributed rather than not reading at all.
   */
  private processHistoryHasActor = true;

  /** Mock-only: simulate migration 20260809000069 not yet applied. */
  setProcessHistoryHasActor(present: boolean): void {
    this.processHistoryHasActor = present;
  }

  async updateProcessStepText(id: string, patch: ProcessStepTextWrite): Promise<ProcessStep> {
    this.assertOwnerWrite('updateProcessStepText');
    const index = this.processSteps.findIndex((step) => step.id === id);
    if (index < 0) throw new Error(`Step not found: ${id}`);
    const current = this.processSteps[index];
    const next: ProcessStep = {
      ...current,
      name: patch.name,
      docs: patch.docs,
      coa: patch.coa,
      drivers: patch.drivers,
    };
    // Empty means absent, the same rule rowToProcessStep applies on read.
    for (const [key, value] of [
      ['co', patch.co],
      ['risk', patch.risk],
      ['control', patch.control],
      ['note', patch.note],
      ['gateId', patch.gateId],
    ] as const) {
      const bag = next as unknown as Record<string, unknown>;
      if (value) bag[key] = value;
      else delete bag[key];
    }
    this.processSteps[index] = clone(next);
    return clone(next);
  }

  async updateProcessNeedText(id: string, patch: ProcessNeedTextWrite): Promise<ProcessNeed> {
    this.assertOwnerWrite('updateProcessNeedText');
    const current = this.processNeeds.get(id);
    if (!current) throw new Error(`Need not found: ${id}`);
    const next: ProcessNeed = {
      ...current,
      item: patch.item,
      kind: patch.kind as ProcessNeed['kind'],
      status: patch.status as ProcessNeed['status'],
    };
    for (const [key, value] of [
      ['src', patch.src],
      ['owner', patch.owner],
      ['requestedOn', patch.requestedOn],
    ] as const) {
      const bag = next as unknown as Record<string, unknown>;
      if (value) bag[key] = value;
      else delete bag[key];
    }
    this.processNeeds.set(id, clone(next));
    return clone(next);
  }

  async updateProcessGateText(id: string, patch: ProcessGateTextWrite): Promise<ProcessGate> {
    this.assertOwnerWrite('updateProcessGateText');
    const index = this.processGates.findIndex((gate) => gate.id === id);
    if (index < 0) throw new Error(`Gate not found: ${id}`);
    const next: ProcessGate = { ...this.processGates[index], title: patch.title };
    for (const [key, value] of [
      ['sub', patch.sub],
      ['owner', patch.owner],
      ['unblock', patch.unblock],
    ] as const) {
      const bag = next as unknown as Record<string, unknown>;
      if (value) bag[key] = value;
      else delete bag[key];
    }
    this.processGates[index] = clone(next);
    return clone(next);
  }

  async updateProcessLaneText(
    entityCode: string,
    key: string,
    patch: ProcessLaneTextWrite,
  ): Promise<ProcessLane> {
    this.assertOwnerWrite('updateProcessLaneText');
    const index = this.processLanes.findIndex(
      (lane) => lane.entityCode === entityCode && lane.key === key,
    );
    if (index < 0) throw new Error(`Lane not found: ${entityCode}/${key}`);
    const next: ProcessLane = { ...this.processLanes[index], label: patch.label };
    if (patch.description) next.description = patch.description;
    else delete next.description;
    this.processLanes[index] = clone(next);
    return clone(next);
  }

  async updateProcessPhaseText(id: string, patch: ProcessPhaseTextWrite): Promise<ProcessPhase> {
    this.assertOwnerWrite('updateProcessPhaseText');
    const index = this.processPhases.findIndex((phase) => phase.id === id);
    if (index < 0) throw new Error(`Phase not found: ${id}`);
    const next: ProcessPhase = { ...this.processPhases[index], name: patch.name };
    this.processPhases[index] = clone(next);
    return clone(next);
  }

  async appendProcessTextHistory(rows: TextHistoryRow[]): Promise<boolean> {
    if (rows.length === 0) return true;
    // The missing-relation path: the log is skipped, the edit already stood.
    if (!this.processHistoryTableExists) return false;
    // The trigger-mirror. The caller sends five columns and cannot send an
    // actor; both attribution fields are derived here from the credential,
    // exactly as os_process_text_history_stamp_actor derives them from
    // os_key_valid() / auth.uid(). The owner has a kind and no id.
    const stamped = this.isContributor()
      ? {
          actorKind: 'contributor',
          actor: (this.viewer as { userId: string }).userId,
        }
      : { actorKind: 'owner', actor: null };
    let seq = this.processTextHistory.length;
    this.processTextHistory.push(
      ...rows.map((row) => ({
        id: `mock-text-history-${(seq += 1)}`,
        tableName: row.tableName,
        rowId: row.rowId,
        field: row.field,
        actorKind: stamped.actorKind,
        actor: stamped.actor,
        changedAt: new Date().toISOString(),
      })),
    );
    return true;
  }

  // --- tasks + the project-membership axis (slice 1) ------------------------

  /**
   * STARTS EMPTY, exactly like the live table: os_tasks was born with zero
   * rows, so the mock's empty task list is parity, not a placeholder.
   */
  private readonly tasks = new Map<string, ProjectTask>();

  /** Renders a field the way the SQL trigger stores history: '' for empty. */
  private static taskFieldValue(task: ProjectTask, field: MockTaskHistoryEntry['field']): string {
    switch (field) {
      case 'title':
        return task.title;
      case 'detail':
        return task.detail;
      case 'status':
        return task.status;
      case 'due_date':
        return task.dueDate ?? '';
      case 'assignee':
        return task.assignee ?? '';
    }
  }

  private static readonly TASK_HISTORY_FIELDS: MockTaskHistoryEntry['field'][] = [
    'title',
    'detail',
    'status',
    'due_date',
    'assignee',
  ];

  /**
   * THE TASK TRIGGER-MIRROR — the os_tasks write guard, replayed. The owner
   * passes unrestricted and is stamped 'owner'; a contributor must hold the
   * task's project, may not move it (the Repository interface cannot even
   * express a move, but direct callers of this mirror are held to it too),
   * and a CHANGED assignee must belong to the project. History: five birth
   * rows from '' on create, one row per changed content field on update —
   * sort_order deliberately writes none, reordering is presentation.
   */
  private applyTaskWrite(current: ProjectTask | undefined, next: ProjectTask): ProjectTask {
    if (this.viewer.kind === 'contributor') {
      const granted = this.memberProjects();
      const anchor = current ? current.projectId : next.projectId;
      if (!granted.includes(anchor)) {
        // The SQL trigger's message, so a test asserting on it holds both ways.
        throw new Error(`tasks: ${anchor} is not one of your projects`);
      }
      if (current && next.projectId !== current.projectId) {
        throw new Error('tasks: a member may not move a task between projects');
      }
      if (
        next.assignee !== undefined &&
        (current === undefined || next.assignee !== current.assignee) &&
        !this.projectMembers.some(
          (member) => member.userId === next.assignee && member.projectId === next.projectId,
        )
      ) {
        throw new Error("tasks: assignee must be a member of the task's project");
      }
      next.actorKind = 'contributor';
      next.actor = this.viewer.userId;
      if (!current) {
        next.createdByKind = 'contributor';
        next.createdBy = this.viewer.userId;
      }
    } else {
      next.actorKind = 'owner';
      delete next.actor;
      if (!current) {
        next.createdByKind = 'owner';
        delete next.createdBy;
      }
    }
    next.changedAt = new Date().toISOString();

    for (const field of MockRepository.TASK_HISTORY_FIELDS) {
      const fromValue = current ? MockRepository.taskFieldValue(current, field) : '';
      const toValue = MockRepository.taskFieldValue(next, field);
      // Birth rows are written even when ''→'' — every field's chain starts
      // at birth, which is what lets the standing check catch any
      // out-of-band write. Updates write only actual changes.
      if (current && fromValue === toValue) continue;
      const entry: MockTaskHistoryEntry = {
        taskId: next.id,
        field,
        fromValue,
        toValue,
        actorKind: next.actorKind,
        changedAt: next.changedAt,
      };
      if (next.actor) entry.actor = next.actor;
      this.taskHistory.push(entry);
    }

    this.tasks.set(next.id, clone(next));
    return clone(next);
  }

  async listProjectTasks(projectId?: string): Promise<ReadResult<ProjectTask>> {
    return okRows(
      clone(
        [...this.tasks.values()]
          .filter((task) => {
            const project = this.projects.get(task.projectId);
            return project !== undefined && this.projectVisible(project);
          })
          .filter((task) => !projectId || task.projectId === projectId)
          .sort(
            (a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt),
          ),
      ),
    );
  }

  async createProjectTask(input: {
    projectId: string;
    title: string;
    detail?: string;
    status?: TaskStatus;
    dueDate?: string;
    assignee?: string;
    sortOrder?: number;
  }): Promise<ProjectTask> {
    if (!this.projects.has(input.projectId)) {
      throw new Error(`createProjectTask failed: no such project`);
    }
    const task: ProjectTask = {
      id: createId(),
      projectId: input.projectId,
      title: input.title,
      detail: input.detail ?? '',
      status: input.status ?? 'open',
      sortOrder: input.sortOrder ?? 0,
      createdAt: new Date().toISOString(),
      // Overwritten by the trigger-mirror, exactly as supplied values are live.
      createdByKind: 'owner',
      actorKind: 'owner',
    };
    if (input.dueDate) task.dueDate = input.dueDate;
    if (input.assignee) task.assignee = input.assignee;
    return this.applyTaskWrite(undefined, task);
  }

  async updateProjectTask(id: string, patch: ProjectTaskWrite): Promise<ProjectTask> {
    const current = this.tasks.get(id);
    const project = current ? this.projects.get(current.projectId) : undefined;
    // A task in a non-granted project is INVISIBLE, so the id does not
    // resolve — the same "Task not found" production RLS produces.
    if (!current || !project || !this.projectVisible(project)) {
      throw new Error(`Task not found: ${id}`);
    }
    const next: ProjectTask = { ...current };
    if (patch.title !== undefined) next.title = patch.title;
    if (patch.detail !== undefined) next.detail = patch.detail;
    if (patch.status !== undefined) next.status = patch.status;
    if ('dueDate' in patch) {
      if (patch.dueDate) next.dueDate = patch.dueDate;
      else delete next.dueDate;
    }
    if ('assignee' in patch) {
      if (patch.assignee) next.assignee = patch.assignee;
      else delete next.assignee;
    }
    if (patch.sortOrder !== undefined) next.sortOrder = patch.sortOrder;
    return this.applyTaskWrite(current, next);
  }

  async listProjectMembers(): Promise<ReadResult<ProjectMember>> {
    // Owner reads every grant; a member reads exactly their own rows.
    if (this.viewer.kind === 'contributor') {
      const uid = this.viewer.userId;
      return okRows(clone(this.projectMembers.filter((member) => member.userId === uid)));
    }
    return okRows(clone(this.projectMembers));
  }

  async grantProjectMembership(userId: string, projectId: string): Promise<void> {
    this.assertOwnerWrite('grantProjectMembership');
    // Layer one of the domain guard, mirrored with the SQL trigger's own
    // messages — the OWNER path included: GROWTH isolation is not a
    // permission the owner can spend, and the escape hatch is a migration.
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`project membership: ${projectId} does not resolve to a project`);
    }
    if (project.domain !== 'work') {
      throw new Error(
        `project membership: only WORK projects are grantable — ${projectId} is ${project.domain}; sharing a growth project requires a migration, not a grant`,
      );
    }
    // PK (user_id, project_id): a repeated grant is an upsert, not a dup.
    if (
      this.projectMembers.some(
        (member) => member.userId === userId && member.projectId === projectId,
      )
    ) {
      return;
    }
    this.projectMembers.push({
      userId,
      projectId,
      role: 'contributor',
      createdAt: new Date().toISOString(),
      createdBy: 'owner',
    });
  }

  async revokeProjectMembership(userId: string, projectId: string): Promise<void> {
    this.assertOwnerWrite('revokeProjectMembership');
    const at = this.projectMembers.findIndex(
      (member) => member.userId === userId && member.projectId === projectId,
    );
    if (at >= 0) this.projectMembers.splice(at, 1);
  }

  // --- the collaborator trail: four audit reads -----------------------------
  //
  // Owner-only in production by RLS, and mirrored here: a contributor viewer
  // reads zero rows from all four, because none of these tables was given a
  // member policy. That is the mock modelling the boundary, not a UI rule —
  // the UI never filters these by viewer.
  //
  // The sign-in log starts EMPTY and unbuilt: migration 20260809000070 has not
  // been applied when this ships, so the default seam says the table is
  // absent, which is what production actually answers.

  /**
   * The stored sign-in links. Owner-only in production, and written there by
   * the provisioning Edge Function rather than by any client — so there is no
   * repository write here either, only the mock-only seeders below, which
   * stand in for that function.
   */
  private readonly collabLinks: CollabLink[] = [];
  /** Test seam: false simulates migration 20260809000071 not applied (42P01). */
  private collabLinksTableExists = true;

  /** Mock-only: simulate the stored-link table being absent. */
  setCollabLinksTableExists(present: boolean): void {
    this.collabLinksTableExists = present;
  }

  /**
   * Mock-only stand-in for the Edge Function's upsert. Replaces any existing
   * row for the user, mirroring the primary key on user_id — at most one live
   * link per collaborator, ever — and clears `usedAt`, because a freshly
   * minted link is unspent whatever the row it replaced said.
   */
  rememberCollabLink(row: CollabLink): void {
    const at = this.collabLinks.findIndex((held) => held.userId === row.userId);
    const stored = clone({ ...row, usedAt: null });
    if (at >= 0) this.collabLinks[at] = stored;
    else this.collabLinks.push(stored);
  }

  /** Mock-only stand-in for the Edge Function's delete on revoke. */
  forgetCollabLink(userId: string): void {
    const at = this.collabLinks.findIndex((held) => held.userId === userId);
    if (at >= 0) this.collabLinks.splice(at, 1);
  }

  /**
   * The os_mark_collab_link_used trigger, mirrored: a sign-in stamps only an
   * UNSPENT row, so a later sign-in on a refreshed session cannot rewrite the
   * moment the magic link was actually spent.
   */
  markCollabLinkUsed(userId: string, signedInAt: string): void {
    const held = this.collabLinks.find((row) => row.userId === userId);
    if (held && held.usedAt === null) held.usedAt = signedInAt;
  }

  async listCollabLinks(): Promise<ReadResult<CollabLink>> {
    if (!this.collabLinksTableExists) {
      return readAbsence('listCollabLinks', { code: '42P01' });
    }
    // No member policy exists on this table, so a contributor reads nothing.
    if (this.isContributor()) return okRows([]);
    return okRows(clone(this.collabLinks));
  }

  private readonly signInLog: SignInEvent[] = [];
  /** Test seam: false simulates migration 20260809000070 not applied (42P01). */
  private signInLogTableExists = true;

  /** Mock-only: simulate the sign-in log table being absent. */
  setSignInLogTableExists(present: boolean): void {
    this.signInLogTableExists = present;
  }

  /** Mock-only: the trigger has no mirror to fire from, so tests seed directly. */
  recordSignIn(userId: string, signedInAt: string): void {
    if (this.signInLog.some((row) => row.userId === userId && row.signedInAt === signedInAt)) {
      return; // the (user_id, signed_in_at) unique constraint, mirrored.
    }
    this.signInLog.push({ userId, signedInAt });
  }

  async listSignInLog(): Promise<ReadResult<SignInEvent>> {
    if (!this.signInLogTableExists) {
      return readAbsence('listSignInLog', { code: '42P01' });
    }
    if (this.isContributor()) return okRows([]);
    return okRows(
      clone([...this.signInLog].sort((a, b) => b.signedInAt.localeCompare(a.signedInAt))),
    );
  }

  async listCellHistory(): Promise<ReadResult<CellHistoryEntry>> {
    if (this.isContributor()) return okRows([]);
    return okRows(
      clone(
        [...this.finishLineCellHistory]
          .sort((a, b) => b.changedAt.localeCompare(a.changedAt))
          .map((row, index) => ({
            id: `mock-cell-history-${index}`,
            cellId: row.cellId,
            fromState: row.fromState as string | null,
            toState: row.toState as string | null,
            noteChanged: row.noteChanged,
            actorKind: row.actorKind as string,
            actor: row.actor ?? null,
            changedAt: row.changedAt,
          })),
      ),
    );
  }

  async listTaskHistory(): Promise<ReadResult<TaskHistoryEntry>> {
    if (this.isContributor()) return okRows([]);
    return okRows(
      clone(
        [...this.taskHistory]
          .sort((a, b) => b.changedAt.localeCompare(a.changedAt))
          .map((row, index) => ({
            id: `mock-task-history-${index}`,
            taskId: row.taskId,
            field: row.field as string,
            fromValue: row.fromValue,
            toValue: row.toValue,
            actorKind: row.actorKind as string,
            actor: row.actor ?? null,
            changedAt: row.changedAt,
          })),
      ),
    );
  }

  async listProcessTextHistory(): Promise<ReadResult<ProcessTextHistoryEntry>> {
    if (!this.processHistoryTableExists) {
      return readAbsence('listProcessTextHistory', { code: '42P01' });
    }
    if (this.isContributor()) return okRows([]);
    const rows = [...this.processTextHistory].sort((a, b) =>
      b.changedAt.localeCompare(a.changedAt),
    );
    // The pre-69 read: the columns are not selectable, so they arrive null and
    // the row is unattributed. NOT a failure and NOT a missing relation — the
    // edits themselves are still there and must still be listed.
    if (!this.processHistoryHasActor) {
      return okRows(clone(rows.map((row) => ({ ...row, actorKind: null, actor: null }))));
    }
    return okRows(clone(rows));
  }

  // --- share links ---------------------------------------------------------
  //
  // In memory, and holding no token: the mock stores the same digest-shaped
  // absence the database does, so nothing here can hand a link back after the
  // one moment it was shown. Synthetic path only — the real gate on these is
  // the owner key, checked in SQL, which has no meaning without a database.

  private shareLinks: ShareLink[] = [];

  async listShareLinks(): Promise<ReadResult<ShareLink>> {
    if (this.isContributor()) return okRows([]);
    return okRows(
      [...this.shareLinks].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }

  async createShareLink(input: {
    token: string;
    view: ShareView;
    scope: ShareScope;
    label?: string;
    ttlDays: number;
  }): Promise<ShareLink> {
    // The token is accepted and dropped, exactly as the database drops it
    // after digesting: a mock that kept one would make "the token is not
    // stored" true only in production.
    if (input.token.length < 24) throw new Error('A share token must be longer than that');
    const days = Math.min(Math.max(Math.round(input.ttlDays) || 1, 1), 90);
    const link: ShareLink = {
      id: createId(),
      view: input.view,
      scope: input.view === 'finish-line-entity' ? { entity: input.scope.entity } : {},
      expiresAt: new Date(Date.now() + days * 86_400_000).toISOString(),
      createdAt: new Date().toISOString(),
    };
    if (input.label?.trim()) link.label = input.label.trim();
    this.shareLinks.push(link);
    return link;
  }

  async revokeShareLink(id: string): Promise<ShareLink> {
    const link = this.shareLinks.find((candidate) => candidate.id === id);
    if (!link) throw new Error('No such share link');
    link.revokedAt = link.revokedAt ?? new Date().toISOString();
    return link;
  }

  async extendShareLink(id: string, ttlDays: number): Promise<ShareLink> {
    const link = this.shareLinks.find((candidate) => candidate.id === id);
    if (!link || link.revokedAt) throw new Error('No such share link, or it has been revoked');
    const days = Math.min(Math.max(Math.round(ttlDays) || 1, 1), 90);
    link.expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
    return link;
  }

  /**
   * Mirrors the database cascade: deleting a project takes its edges, its
   * tasks and its membership grants (all `on delete cascade`). The CELL
   * stays, now unplanned — which is the row the two lists in §7.5 exist to
   * surface — and TASK HISTORY stays too: it has no FK and outlives the row.
   */
  private cascadeProjectDeletion(projectId: string): void {
    this.finishLineEdges = this.finishLineEdges.filter((edge) => edge.projectId !== projectId);
    for (const [id, task] of [...this.tasks]) {
      if (task.projectId === projectId) this.tasks.delete(id);
    }
    for (let at = this.projectMembers.length - 1; at >= 0; at -= 1) {
      const member = this.projectMembers[at];
      if (member && member.projectId === projectId) this.projectMembers.splice(at, 1);
    }
  }
}

export const mockRepository = new MockRepository();
