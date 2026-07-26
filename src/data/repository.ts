import type { ResearchRepository } from './researchRepository';
import type { CellWriteOrigin } from './finishLineGuards';
import type { ReadResult } from './readResult';
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
   * EVERY READ HERE RETURNS `ReadResult`, NOT AN ARRAY.
   *
   * These reads all feed cards that COUNT PROBLEMS, and an empty array cannot
   * tell such a card whether it found nothing or failed to look. That is not
   * hypothetical: the live build rendered `0 milestones make no pack line
   * trustworthy — None` while the truth was 458, because the read degraded to
   * `[]` and the copy turned the failure into good news.
   *
   * A missing relation is still not a crash — the frontend ships before a
   * migration is applied — but it now arrives as `{ok: false, reason:
   * 'missing-relation'}` so the card can say COULD NOT CHECK and, critically,
   * show no number at all. See readResult.ts.
   *
   * The structure is seeded by migration 20260726000023. There is no create or
   * delete for line items — a row in the app but not in the pack is a row
   * nobody can explain.
   */
  listFinishLineItems(): Promise<ReadResult<FinishLineItem>>;
  listFinishLineEntities(): Promise<ReadResult<FinishLineEntity>>;
  listFinishLineCells(): Promise<ReadResult<FinishLineCell>>;
  listFinishLineDeps(): Promise<ReadResult<FinishLineDep>>;
  listFinishLineEdges(): Promise<ReadResult<FinishLineEdge>>;
  listDanglingLinks(): Promise<ReadResult<DanglingLink>>;
  listOrphanMilestones(): Promise<ReadResult<OrphanMilestone>>;

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
