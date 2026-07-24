import type {
  DailyLog,
  Entry,
  EntryType,
  Project,
  WeeklyPlan,
} from './types';

export interface Repository {
  listEntries(filter?: { type?: EntryType; date?: string }): Promise<Entry[]>;
  getEntry(id: string): Promise<Entry | null>;
  createEntry(input: Omit<Entry, 'id' | 'createdAt' | 'updatedAt'>): Promise<Entry>;
  updateEntry(id: string, patch: Partial<Entry>): Promise<Entry>;
  deleteEntry(id: string): Promise<void>;

  getDailyLog(date: string): Promise<DailyLog | null>;
  upsertDailyLog(log: DailyLog): Promise<DailyLog>;
  listDailyLogs(range: { from: string; to: string }): Promise<DailyLog[]>;

  getWeeklyPlan(week: string): Promise<WeeklyPlan | null>;
  upsertWeeklyPlan(plan: WeeklyPlan): Promise<WeeklyPlan>;

  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | null>;
  createProject(input: Omit<Project, 'id'>): Promise<Project>;
  updateProject(id: string, patch: Partial<Project>): Promise<Project>;
  deleteProject(id: string): Promise<void>;
}
