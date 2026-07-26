import type { ResearchRepository } from './researchRepository';
import type { CellWriteOrigin } from './finishLineGuards';
import type {
  CellState,
  DailyLog,
  DanglingLink,
  Domain,
  Entry,
  EntryType,
  FinishLineCell,
  FinishLineDep,
  FinishLineEdge,
  FinishLineEntity,
  FinishLineItem,
  IeltsError,
  IeltsResult,
  OrphanMilestone,
  Project,
  WeeklyPlan,
} from './types';

export interface Repository {
  listEntries(filter?: {
    type?: EntryType;
    date?: string;
    domain?: Domain;
  }): Promise<Entry[]>;
  getEntry(id: string): Promise<Entry | null>;
  createEntry(input: Omit<Entry, 'id' | 'createdAt' | 'updatedAt'>): Promise<Entry>;
  updateEntry(id: string, patch: Partial<Entry>): Promise<Entry>;
  deleteEntry(id: string): Promise<void>;

  // Daily logs are keyed by (date, domain): two independent scores per day.
  getDailyLog(date: string, domain: Domain): Promise<DailyLog | null>;
  upsertDailyLog(log: DailyLog): Promise<DailyLog>;
  listDailyLogs(range: { from: string; to: string; domain: Domain }): Promise<DailyLog[]>;

  // Weekly plans are keyed by (week, domain).
  getWeeklyPlan(week: string, domain: Domain): Promise<WeeklyPlan | null>;
  upsertWeeklyPlan(plan: WeeklyPlan): Promise<WeeklyPlan>;

  listProjects(domain?: Domain): Promise<Project[]>;
  getProject(id: string): Promise<Project | null>;
  createProject(input: Omit<Project, 'id'>): Promise<Project>;
  updateProject(id: string, patch: Partial<Project>): Promise<Project>;
  deleteProject(id: string): Promise<void>;

  /**
   * The research subsystem's own seam. Separate interface rather than thirty
   * more methods here — see researchRepository.ts, which also holds the
   * append-only and write-origin invariants.
   */
  readonly research: ResearchRepository;

  // IELTS practice results (GROWTH). Sorted by date ascending.
  listIeltsResults(): Promise<IeltsResult[]>;
  createIeltsResult(input: Omit<IeltsResult, 'id'>): Promise<IeltsResult>;
  updateIeltsResult(id: string, patch: Partial<IeltsResult>): Promise<IeltsResult>;
  deleteIeltsResult(id: string): Promise<void>;

  // IELTS error occurrences. Patterns are derived on read, never stored.
  listIeltsErrors(): Promise<IeltsError[]>;
  /**
   * BULK, deliberately. The entry path is one paste of a whole marking
   * response producing eight or fourteen rows; a per-row create would turn one
   * action into fourteen round trips and fourteen chances to half-commit.
   */
  createIeltsErrors(
    input: ReadonlyArray<Omit<IeltsError, 'id' | 'createdAt'>>,
  ): Promise<IeltsError[]>;
  deleteIeltsError(id: string): Promise<void>;

  /**
   * Finish line — the entity matrix and the road to it.
   *
   * READS DEGRADE TO EMPTY when the relation does not exist: the frontend
   * ships before the migration is applied, which has already broken production
   * twice in this project. A missing table is an empty matrix, not a crash.
   *
   * The structure is seeded by migration 20260726000023. There is no create or
   * delete for line items — a row in the app but not in the pack is a row
   * nobody can explain.
   */
  listFinishLineItems(): Promise<FinishLineItem[]>;
  listFinishLineEntities(): Promise<FinishLineEntity[]>;
  listFinishLineCells(): Promise<FinishLineCell[]>;
  listFinishLineDeps(): Promise<FinishLineDep[]>;
  listFinishLineEdges(): Promise<FinishLineEdge[]>;
  listDanglingLinks(): Promise<DanglingLink[]>;
  listOrphanMilestones(): Promise<OrphanMilestone[]>;

  /**
   * The state write. `origin` is required and only 'human' is accepted — see
   * finishLineGuards. A rollup that disagrees raises a contradiction for a
   * person; it never writes the state.
   */
  setFinishLineCellState(
    cellId: string,
    state: CellState,
    origin: CellWriteOrigin,
  ): Promise<FinishLineCell>;
  setFinishLineCellNote(cellId: string, note: string | undefined): Promise<FinishLineCell>;

  /** Bulk, deliberately: one edge must never cost a form. Replaces the set. */
  setCellEdges(cellId: string, edges: { projectId: string; milestoneId?: string }[]): Promise<void>;
  /** The same operation inverted, from a milestone. */
  setMilestoneEdges(projectId: string, milestoneId: string, cellIds: string[]): Promise<void>;
}
