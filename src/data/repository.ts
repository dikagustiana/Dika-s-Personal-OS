import type { ResearchRepository } from './researchRepository';
import type {
  DailyLog,
  Domain,
  Entry,
  EntryType,
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
}
