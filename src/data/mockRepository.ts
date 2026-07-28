import { MockResearchRepository } from './researchRepository';
import {
  guardCellNote,
  guardCellState,
  guardEdgeTarget,
  type CellWriteOrigin,
} from './finishLineGuards';
import { guardTimeBlock } from './timeBlockGuards';
import type { Repository } from './repository';
import { okRows, type ReadResult } from './readResult';
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
  Domain,
  Entry,
  CellState,
  DanglingLink,
  FinishLineCell,
  FinishLineDep,
  FinishLineEdge,
  FinishLineEntity,
  FinishLineItem,
  OrphanMilestone,
  IeltsError,
  IeltsResult,
  IeltsSession,
  Project,
  WeeklyPlan,
} from './types';

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

export class MockRepository implements Repository {
  /** Research lives behind its own seam; a bare clone still gets a working one. */
  readonly research = new MockResearchRepository();

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
    const entry = this.entries.get(id);
    return entry ? clone(entry) : null;
  }

  async createEntry(
    input: Omit<Entry, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Entry> {
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
    if (!current) throw new Error(`Entry not found: ${id}`);
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
    this.entries.delete(id);
  }

  async getDailyLog(date: string, domain: Domain): Promise<DailyLog | null> {
    const log = this.dailyLogs.get(logKey(date, domain));
    return log ? clone(log) : null;
  }

  async upsertDailyLog(log: DailyLog): Promise<DailyLog> {
    this.dailyLogs.set(logKey(log.date, log.domain), clone(log));
    return clone(log);
  }

  async listDailyLogs(range: {
    from: string;
    to: string;
    domain: Domain;
  }): Promise<DailyLog[]> {
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
    const plan = this.weeklyPlans.get(planKey(week, domain));
    return plan ? clone(plan) : null;
  }

  async upsertWeeklyPlan(plan: WeeklyPlan): Promise<WeeklyPlan> {
    this.weeklyPlans.set(planKey(plan.week, plan.domain), clone(plan));
    return clone(plan);
  }

  async listProjects(domain?: Domain): Promise<Project[]> {
    return clone(
      [...this.projects.values()]
        .filter((project) => !domain || project.domain === domain)
        .sort((a, b) => a.order - b.order),
    );
  }

  async getProject(id: string): Promise<Project | null> {
    const project = this.projects.get(id);
    return project ? clone(project) : null;
  }

  async createProject(input: Omit<Project, 'id'>): Promise<Project> {
    const project: Project = { ...input, id: createId() };
    this.projects.set(project.id, clone(project));
    return clone(project);
  }

  async updateProject(id: string, patch: Partial<Project>): Promise<Project> {
    const current = this.projects.get(id);
    if (!current) throw new Error(`Project not found: ${id}`);
    const updated: Project = { ...current, ...patch, id: current.id };
    this.projects.set(id, clone(updated));
    return clone(updated);
  }

  async deleteProject(id: string): Promise<void> {
    this.projects.delete(id);
    this.cascadeProjectDeletion(id);
  }

  async listIeltsResults(): Promise<IeltsResult[]> {
    return clone(
      [...this.ieltsResults.values()].sort((a, b) => a.date.localeCompare(b.date)),
    );
  }

  async createIeltsResult(input: Omit<IeltsResult, 'id'>): Promise<IeltsResult> {
    const result: IeltsResult = { ...input, id: createId() };
    this.ieltsResults.set(result.id, clone(result));
    return clone(result);
  }

  async updateIeltsResult(id: string, patch: Partial<IeltsResult>): Promise<IeltsResult> {
    const current = this.ieltsResults.get(id);
    if (!current) throw new Error(`IELTS result not found: ${id}`);
    const updated: IeltsResult = { ...current, ...patch, id: current.id };
    this.ieltsResults.set(id, clone(updated));
    return clone(updated);
  }

  async deleteIeltsResult(id: string): Promise<void> {
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
    return clone(
      [...this.ieltsErrors.values()].sort(
        (a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt),
      ),
    );
  }

  async createIeltsErrors(
    input: ReadonlyArray<Omit<IeltsError, 'id' | 'createdAt'>>,
  ): Promise<IeltsError[]> {
    const created = input.map((row) => ({
      ...row,
      id: createId(),
      createdAt: new Date().toISOString(),
    }));
    for (const row of created) this.ieltsErrors.set(row.id, clone(row));
    return clone(created);
  }

  async deleteIeltsError(id: string): Promise<void> {
    this.ieltsErrors.delete(id);
  }

  /**
   * Starts empty for the same reason the errors do: raw_feedback carries the
   * owner's own practice content and the examiner's review of it. No seed, no
   * fixture, no example row.
   */
  private readonly ieltsSessions = new Map<string, IeltsSession>();

  async listIeltsSessions(): Promise<IeltsSession[]> {
    return clone(
      [...this.ieltsSessions.values()].sort(
        (a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt),
      ),
    );
  }

  async createIeltsSessions(
    input: ReadonlyArray<Omit<IeltsSession, 'id' | 'createdAt'>>,
  ): Promise<IeltsSession[]> {
    const created = input.map((row) => ({
      ...row,
      id: createId(),
      createdAt: new Date().toISOString(),
    }));
    for (const row of created) this.ieltsSessions.set(row.id, clone(row));
    return clone(created);
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
    return okRows(clone([...this.finishLineItems].sort((a, b) => a.order - b.order)));
  }

  async listFinishLineEntities(): Promise<ReadResult<FinishLineEntity>> {
    return okRows(clone([...this.finishLineEntities].sort((a, b) => a.order - b.order)));
  }

  async listFinishLineCells(): Promise<ReadResult<FinishLineCell>> {
    return okRows(clone([...this.finishLineCells.values()]));
  }

  async listFinishLineDeps(): Promise<ReadResult<FinishLineDep>> {
    return okRows(clone(this.finishLineDeps));
  }

  async listFinishLineEdges(): Promise<ReadResult<FinishLineEdge>> {
    return okRows(clone(this.finishLineEdges));
  }

  /**
   * Empty for the same reason the matrix is: account names are the owner's
   * chart of accounts and this repo is public. The account level is loaded
   * into the database, never seeded from here.
   *
   * Read-only, like every account path — there is no mock write counterpart
   * because there is no real one.
   */
  private readonly finishLineAccounts: FinishLineAccount[] = [];
  private readonly finishLineAccountMap: FinishLineAccountMapRow[] = [];

  async listFinishLineAccounts(): Promise<ReadResult<FinishLineAccount>> {
    return okRows(clone(this.finishLineAccounts));
  }

  async listFinishLineAccountMap(): Promise<ReadResult<FinishLineAccountMapRow>> {
    return okRows(clone(this.finishLineAccountMap));
  }

  /**
   * Mirrors the view: edges whose milestone no longer exists in the project's
   * jsonb array. There is no foreign key and there cannot be one, so this gap
   * is surfaced rather than solved — and never auto-deleted.
   */
  async listDanglingLinks(): Promise<ReadResult<DanglingLink>> {
    const live = new Set<string>();
    for (const project of this.projects.values()) {
      for (const milestone of project.milestones) live.add(`${project.id}:${milestone.id}`);
    }
    return okRows(
      this.finishLineEdges
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

  async setFinishLineCellState(
    cellId: string,
    state: CellState,
    origin: CellWriteOrigin,
  ): Promise<FinishLineCell> {
    const checked = guardCellState(state, origin);
    const current = this.finishLineCells.get(cellId);
    if (!current) throw new Error(`Cell not found: ${cellId}`);
    const updated: FinishLineCell = { ...current, state: checked };
    this.finishLineCells.set(cellId, clone(updated));
    return clone(updated);
  }

  async setFinishLineCellNote(
    cellId: string,
    note: string | undefined,
  ): Promise<FinishLineCell> {
    const current = this.finishLineCells.get(cellId);
    if (!current) throw new Error(`Cell not found: ${cellId}`);
    const cleaned = guardCellNote(note);
    const updated: FinishLineCell = { ...current };
    if (cleaned) updated.note = cleaned;
    else delete updated.note;
    this.finishLineCells.set(cellId, clone(updated));
    return clone(updated);
  }

  async setCellEdges(
    cellId: string,
    edges: { projectId: string; milestoneId?: string }[],
  ): Promise<void> {
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

  /**
   * Mirrors the database cascade: deleting a project takes its edges. The CELL
   * stays, now unplanned — which is the row the two lists in §7.5 exist to
   * surface.
   */
  private cascadeProjectDeletion(projectId: string): void {
    this.finishLineEdges = this.finishLineEdges.filter((edge) => edge.projectId !== projectId);
  }
}

export const mockRepository = new MockRepository();
