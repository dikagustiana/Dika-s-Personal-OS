import type { Repository } from './repository';
import {
  seedDailyLogs,
  seedEntries,
  seedIeltsResults,
  seedProjects,
  seedWeeklyPlans,
} from './seed';
import type {
  DailyLog,
  Domain,
  Entry,
  IeltsResult,
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
}

export const mockRepository = new MockRepository();
