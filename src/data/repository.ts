import type { ResearchRepository } from './researchRepository';
import type {
  DailyLog,
  Domain,
  Entry,
  EntryType,
  FinishLineItem,
  FinishLineLinkInput,
  IeltsError,
  IeltsResult,
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
   * Finish line pack rows (WORK) — blocks, sections and lines alike. `links`
   * is written through these methods as a set: the join rows for an item are
   * replaced wholesale whenever the input names it, so callers never touch
   * the link table. Ordering is the document's own `order`; nothing here
   * re-ranks. Duplicate (project, milestone) pairs are deduped before write —
   * the database's unique index would reject them anyway.
   */
  listFinishLineItems(): Promise<FinishLineItem[]>;
  createFinishLineItem(
    input: Omit<FinishLineItem, 'id' | 'links'> & { links: FinishLineLinkInput[] },
  ): Promise<FinishLineItem>;
  updateFinishLineItem(
    id: string,
    patch: Partial<Omit<FinishLineItem, 'id' | 'links'>> & { links?: FinishLineLinkInput[] },
  ): Promise<FinishLineItem>;
  deleteFinishLineItem(id: string): Promise<void>;
}
