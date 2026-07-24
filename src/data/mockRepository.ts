import type { Repository } from './repository';
import { seedDailyLogs, seedEntries, seedProjects, seedWeeklyPlans } from './seed';
import type { DailyLog, Entry, Project, WeeklyPlan } from './types';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function createId(): string {
  return crypto.randomUUID();
}

export class MockRepository implements Repository {
  private readonly entries = new Map(seedEntries.map((entry) => [entry.id, clone(entry)]));
  private readonly dailyLogs = new Map(
    seedDailyLogs.map((log) => [log.date, clone(log)]),
  );
  private readonly weeklyPlans = new Map(
    seedWeeklyPlans.map((plan) => [plan.week, clone(plan)]),
  );
  private readonly projects = new Map(
    seedProjects.map((project) => [project.id, clone(project)]),
  );

  async listEntries(filter?: {
    type?: Entry['type'];
    date?: string;
  }): Promise<Entry[]> {
    const entries = [...this.entries.values()].filter((entry) => {
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
    this.entries.set(id, clone(updated));
    return clone(updated);
  }

  async deleteEntry(id: string): Promise<void> {
    this.entries.delete(id);
  }

  async getDailyLog(date: string): Promise<DailyLog | null> {
    const log = this.dailyLogs.get(date);
    return log ? clone(log) : null;
  }

  async upsertDailyLog(log: DailyLog): Promise<DailyLog> {
    this.dailyLogs.set(log.date, clone(log));
    return clone(log);
  }

  async listDailyLogs(range: { from: string; to: string }): Promise<DailyLog[]> {
    const logs = [...this.dailyLogs.values()]
      .filter((log) => log.date >= range.from && log.date <= range.to)
      .sort((a, b) => a.date.localeCompare(b.date));
    return clone(logs);
  }

  async getWeeklyPlan(week: string): Promise<WeeklyPlan | null> {
    const plan = this.weeklyPlans.get(week);
    return plan ? clone(plan) : null;
  }

  async upsertWeeklyPlan(plan: WeeklyPlan): Promise<WeeklyPlan> {
    this.weeklyPlans.set(plan.week, clone(plan));
    return clone(plan);
  }

  async listProjects(): Promise<Project[]> {
    return clone([...this.projects.values()].sort((a, b) => a.order - b.order));
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
  }
}

export const mockRepository = new MockRepository();
