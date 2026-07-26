import { MockResearchRepository } from './researchRepository';
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
  FinishLineItem,
  FinishLineLink,
  FinishLineLinkInput,
  IeltsError,
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

  // --- finish line ----------------------------------------------------------

  /**
   * STARTS EMPTY, AND STAYS THAT WAY. Every other collection here is seeded;
   * this one is not, and the omission is the point. The real pack names
   * entities, internal drivers and open methodology decisions, and this repo
   * is public — so there is no seed, no fixture and no worked example of one
   * anywhere in it. A bare clone renders the empty state, which is correct.
   */
  private readonly finishLineItems = new Map<string, FinishLineItem>();

  async listFinishLineItems(): Promise<FinishLineItem[]> {
    return clone([...this.finishLineItems.values()].sort((a, b) => a.order - b.order));
  }

  async createFinishLineItem(
    input: Omit<FinishLineItem, 'id' | 'links'> & { links: FinishLineLinkInput[] },
  ): Promise<FinishLineItem> {
    const item: FinishLineItem = {
      ...input,
      id: createId(),
      links: dedupeLinks(input.links).map((link) => materializeLink(link)),
    };
    this.finishLineItems.set(item.id, clone(item));
    return clone(item);
  }

  async updateFinishLineItem(
    id: string,
    patch: Partial<Omit<FinishLineItem, 'id' | 'links'>> & { links?: FinishLineLinkInput[] },
  ): Promise<FinishLineItem> {
    const current = this.finishLineItems.get(id);
    if (!current) throw new Error(`Finish line item not found: ${id}`);
    const { links: linkInputs, ...fields } = patch;
    const updated: FinishLineItem = { ...current, ...fields, id: current.id };
    if (linkInputs !== undefined) {
      // Wholesale replace, same contract as the Supabase implementation.
      updated.links = dedupeLinks(linkInputs).map((link) => materializeLink(link));
    }
    this.finishLineItems.set(id, clone(updated));
    return clone(updated);
  }

  async deleteFinishLineItem(id: string): Promise<void> {
    // Mirrors parent_id `on delete cascade`: deleting a block takes its
    // sections and lines. Depth-first over direct children — the tree is
    // small and the recursion mirrors what Postgres does in one statement.
    for (const [childId, item] of [...this.finishLineItems]) {
      if (item.parentId === id) await this.deleteFinishLineItem(childId);
    }
    this.finishLineItems.delete(id);
  }

  /**
   * Mirrors the database's `on delete cascade` on the join table: deleting a
   * project clears its links and LEAVES THE LINE STANDING, now unowned.
   * Without this the mock would disagree with production about the state the
   * view treats as loudest.
   */
  private cascadeProjectDeletion(projectId: string): void {
    for (const [id, item] of this.finishLineItems) {
      if (!item.links.some((link) => link.projectId === projectId)) continue;
      this.finishLineItems.set(id, {
        ...item,
        links: item.links.filter((link) => link.projectId !== projectId),
      });
    }
  }
}

/** Same (project, milestone) pair once; project-level and milestone-level distinct. */
function dedupeLinks(inputs: FinishLineLinkInput[]): FinishLineLinkInput[] {
  const seen = new Set<string>();
  const result: FinishLineLinkInput[] = [];
  for (const input of inputs) {
    const key = `${input.projectId}:${input.milestoneId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(input);
  }
  return result;
}

function materializeLink(input: FinishLineLinkInput): FinishLineLink {
  const link: FinishLineLink = { id: createId(), projectId: input.projectId };
  if (input.milestoneId) link.milestoneId = input.milestoneId;
  return link;
}

export const mockRepository = new MockRepository();

