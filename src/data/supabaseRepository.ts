import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Repository } from './repository';
import type {
  DailyLog,
  DateConfidence,
  Domain,
  Entry,
  EntryType,
  IeltsResult,
  LinkedProject,
  Project,
  ProjectDocument,
  WeeklyPlan,
  WebsiteCategory,
} from './types';

// Env-gated configuration. Both values ship in the client bundle by design;
// access control lives server-side (RLS checks the x-app-key header — see
// supabase/migrations/20260724000002_security.sql and REVIEW.md).
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

function requireConfig(): { url: string; anonKey: string } {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).');
  }
  return { url: supabaseUrl, anonKey: supabaseAnonKey };
}

/**
 * Asks the database whether a candidate passphrase matches the stored hash.
 * Used by the unlock gate before any repository is constructed: RLS makes
 * SELECTs return empty rather than erroring, so the gate needs an explicit
 * yes/no.
 */
export interface VerifyResult {
  valid: boolean;
  /** Set while the caller is in a temporary lockout. */
  lockedOut?: boolean;
  /** Seconds until the lockout lifts. */
  retryAfter?: number;
  attemptsRemaining?: number;
}

/**
 * Verification goes through the `verify-passphrase` Edge Function, which rate
 * limits it. The database RPC is no longer callable with the anon key — see
 * supabase/migrations/20260724000011_auth_rate_limit.sql.
 */
export async function verifyAppKey(candidate: string): Promise<VerifyResult> {
  const { url, anonKey } = requireConfig();
  const response = await fetch(`${url}/functions/v1/verify-passphrase`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ candidate }),
  });
  if (response.status === 429) {
    const body = (await response.json()) as VerifyResult;
    return { valid: false, lockedOut: true, retryAfter: body.retryAfter };
  }
  if (!response.ok) throw new Error(`Passphrase check failed (${response.status}).`);
  return (await response.json()) as VerifyResult;
}

export function createSupabaseRepository(appKey: string): Repository {
  const { url, anonKey } = requireConfig();
  const client = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { 'x-app-key': appKey } },
  });
  return new SupabaseRepository(client);
}

// --- row shapes -------------------------------------------------------------

interface EntryRow {
  id: string;
  type: EntryType;
  domain: Domain;
  created_at: string;
  updated_at: string;
  tags: string[];
  entry_date: string | null;
  payload: Record<string, unknown>;
}

interface DailyLogRow {
  date: string;
  domain: Domain;
  habits: Record<string, boolean>;
  score: number;
}

interface WeeklyPlanRow {
  week: string;
  domain: Domain;
  theme: string | null;
  goals: WeeklyPlan['goals'];
  reviewed_at: string | null;
}

interface ProjectRow {
  id: string;
  domain: Domain;
  title: string;
  type: Project['type'];
  status: Project['status'];
  start_date: string | null;
  deadline: string | null;
  target_metric: string | null;
  milestones: Project['milestones'];
  sort_order: number;
  recurring: 'monthly' | null;
  period: string | null;
  working_title: string | null;
  category: WebsiteCategory | null;
  date_confidence: DateConfidence | null;
  // Added by migration 20260724000013. Typed as possibly-absent, not just
  // possibly-null: `select *` against a database where that migration has not
  // been applied yet simply omits these keys, and the reader must survive it.
  parent_id?: string | null;
  linked_projects?: LinkedProject[] | null;
  entity_tag?: string | null;
  documents?: ProjectDocument[] | null;
  // Added by migration 20260724000014, same possibly-absent treatment: the
  // app must still render against a database that has not run it yet.
  dashboard_pinned?: boolean | null;
}

interface IeltsResultRow {
  id: string;
  date: string;
  listening: number;
  reading: number;
  writing: number;
  speaking: number;
}

// --- mapping ----------------------------------------------------------------

// Postgres returns timestamptz as `2026-07-24 15:04:05.123+00:00`-style
// strings; the domain uses Date.toISOString() format everywhere (the mock
// generates them that way), so normalize on read.
function toIso(value: string): string {
  return new Date(value).toISOString();
}

function rowToEntry(row: EntryRow): Entry {
  return {
    ...row.payload,
    id: row.id,
    type: row.type,
    domain: row.domain,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    tags: row.tags,
  } as Entry;
}

// The column listEntries date filters run against. Mirrors the mock exactly:
// task -> dueDate, timeblock -> date, braindump -> UTC date of createdAt,
// habit -> null (habits always pass a date filter; see listEntries).
function entryDateFor(entry: Entry): string | null {
  switch (entry.type) {
    case 'task':
      return entry.dueDate ?? null;
    case 'timeblock':
      return entry.date;
    case 'braindump':
      return entry.createdAt.slice(0, 10);
    case 'habit':
      return null;
  }
}

// Everything that is not a shared column lives in payload, domain-shaped.
// JSON serialization drops undefined-valued keys, which reproduces the
// mock's spread-merge semantics where `{ completedAt: undefined }` clears
// the field.
function entryToRow(entry: Entry): EntryRow {
  const { id, type, domain, createdAt, updatedAt, tags, ...payload } = entry;
  return {
    id,
    type,
    domain,
    created_at: createdAt,
    updated_at: updatedAt,
    tags,
    entry_date: entryDateFor(entry),
    payload,
  };
}

function rowToDailyLog(row: DailyLogRow): DailyLog {
  return { date: row.date, domain: row.domain, habits: row.habits, score: row.score };
}

function rowToWeeklyPlan(row: WeeklyPlanRow): WeeklyPlan {
  const plan: WeeklyPlan = { week: row.week, domain: row.domain, goals: row.goals };
  if (row.theme !== null) plan.theme = row.theme;
  if (row.reviewed_at !== null) plan.reviewedAt = toIso(row.reviewed_at);
  return plan;
}

function rowToProject(row: ProjectRow): Project {
  const project: Project = {
    id: row.id,
    domain: row.domain,
    title: row.title,
    type: row.type,
    status: row.status,
    milestones: row.milestones,
    order: row.sort_order,
  };
  if (row.start_date !== null) project.startDate = row.start_date;
  if (row.deadline !== null) project.deadline = row.deadline;
  if (row.target_metric !== null) project.targetMetric = row.target_metric;
  if (row.recurring !== null) project.recurring = row.recurring;
  if (row.period !== null) project.period = row.period;
  if (row.working_title !== null) project.workingTitle = row.working_title;
  if (row.category !== null) project.category = row.category;
  if (row.date_confidence !== null) project.dateConfidence = row.date_confidence;
  // Empty arrays are dropped rather than carried, matching how every other
  // absent value is handled here: the domain shape stays free of noise and
  // readers coalesce with `?? []`.
  if (row.parent_id) project.parentId = row.parent_id;
  if (Array.isArray(row.linked_projects) && row.linked_projects.length > 0) {
    project.linkedProjects = row.linked_projects;
  }
  if (row.entity_tag) project.entityTag = row.entity_tag;
  if (Array.isArray(row.documents) && row.documents.length > 0) {
    project.documents = row.documents;
  }
  // Absent (migration not applied) and false both mean "not pinned", so the
  // dashboard renders an empty pinned set instead of erroring.
  if (row.dashboard_pinned) project.dashboardPinned = true;
  return project;
}

function rowToIeltsResult(row: IeltsResultRow): IeltsResult {
  return {
    id: row.id,
    date: row.date,
    listening: row.listening,
    reading: row.reading,
    writing: row.writing,
    speaking: row.speaking,
  };
}

function projectPatchToRow(patch: Partial<Project>): Partial<ProjectRow> {
  const row: Partial<ProjectRow> = {};
  if ('domain' in patch && patch.domain !== undefined) row.domain = patch.domain;
  if ('title' in patch && patch.title !== undefined) row.title = patch.title;
  if ('type' in patch && patch.type !== undefined) row.type = patch.type;
  if ('status' in patch && patch.status !== undefined) row.status = patch.status;
  if ('milestones' in patch && patch.milestones !== undefined) row.milestones = patch.milestones;
  if ('order' in patch && patch.order !== undefined) row.sort_order = patch.order;
  if ('startDate' in patch) row.start_date = patch.startDate ?? null;
  if ('deadline' in patch) row.deadline = patch.deadline ?? null;
  if ('targetMetric' in patch) row.target_metric = patch.targetMetric ?? null;
  if ('recurring' in patch) row.recurring = patch.recurring ?? null;
  if ('period' in patch) row.period = patch.period ?? null;
  if ('workingTitle' in patch) row.working_title = patch.workingTitle ?? null;
  if ('category' in patch) row.category = patch.category ?? null;
  if ('dateConfidence' in patch) row.date_confidence = patch.dateConfidence ?? null;
  if ('parentId' in patch) row.parent_id = patch.parentId ?? null;
  if ('linkedProjects' in patch) row.linked_projects = patch.linkedProjects ?? [];
  if ('entityTag' in patch) row.entity_tag = patch.entityTag ?? null;
  if ('documents' in patch) row.documents = patch.documents ?? [];
  if ('dashboardPinned' in patch) row.dashboard_pinned = patch.dashboardPinned ?? false;
  return row;
}

// --- repository -------------------------------------------------------------

class SupabaseRepository implements Repository {
  constructor(private readonly client: SupabaseClient) {}

  async listEntries(filter?: {
    type?: EntryType;
    date?: string;
    domain?: Domain;
  }): Promise<Entry[]> {
    let query = this.client.from('os_entries').select('*');
    if (filter?.domain) query = query.eq('domain', filter.domain);
    if (filter?.type) {
      query = query.eq('type', filter.type);
      // Habits ignore date filters (mock semantics); everything else
      // matches on its promoted entry_date.
      if (filter.date && filter.type !== 'habit') {
        query = query.eq('entry_date', filter.date);
      }
    } else if (filter?.date) {
      query = query.or(`type.eq.habit,entry_date.eq.${filter.date}`);
    }
    const { data, error } = await query.order('created_at', { ascending: true });
    if (error) throw new Error(`listEntries failed: ${error.message}`);
    return (data as EntryRow[]).map(rowToEntry);
  }

  async getEntry(id: string): Promise<Entry | null> {
    const { data, error } = await this.client
      .from('os_entries')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`getEntry failed: ${error.message}`);
    return data ? rowToEntry(data as EntryRow) : null;
  }

  async createEntry(input: Omit<Entry, 'id' | 'createdAt' | 'updatedAt'>): Promise<Entry> {
    const now = new Date().toISOString();
    const entry = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    } as Entry;
    const { data, error } = await this.client
      .from('os_entries')
      .insert(entryToRow(entry))
      .select()
      .single();
    if (error) throw new Error(`createEntry failed: ${error.message}`);
    return rowToEntry(data as EntryRow);
  }

  async updateEntry(id: string, patch: Partial<Entry>): Promise<Entry> {
    const current = await this.getEntry(id);
    if (!current) throw new Error(`Entry not found: ${id}`);
    const merged = {
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    } as Entry;
    const row = entryToRow(merged);
    const { data, error } = await this.client
      .from('os_entries')
      .update({
        type: row.type,
        domain: row.domain,
        tags: row.tags,
        entry_date: row.entry_date,
        payload: row.payload,
        updated_at: row.updated_at,
      })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(`updateEntry failed: ${error.message}`);
    return rowToEntry(data as EntryRow);
  }

  async deleteEntry(id: string): Promise<void> {
    const { error } = await this.client.from('os_entries').delete().eq('id', id);
    if (error) throw new Error(`deleteEntry failed: ${error.message}`);
  }

  async getDailyLog(date: string, domain: Domain): Promise<DailyLog | null> {
    const { data, error } = await this.client
      .from('os_daily_logs')
      .select('date, domain, habits, score')
      .eq('date', date)
      .eq('domain', domain)
      .maybeSingle();
    if (error) throw new Error(`getDailyLog failed: ${error.message}`);
    return data ? rowToDailyLog(data as DailyLogRow) : null;
  }

  async upsertDailyLog(log: DailyLog): Promise<DailyLog> {
    const { data, error } = await this.client
      .from('os_daily_logs')
      .upsert(
        { date: log.date, domain: log.domain, habits: log.habits, score: log.score },
        { onConflict: 'date,domain' },
      )
      .select('date, domain, habits, score')
      .single();
    if (error) throw new Error(`upsertDailyLog failed: ${error.message}`);
    return rowToDailyLog(data as DailyLogRow);
  }

  async listDailyLogs(range: {
    from: string;
    to: string;
    domain: Domain;
  }): Promise<DailyLog[]> {
    const { data, error } = await this.client
      .from('os_daily_logs')
      .select('date, domain, habits, score')
      .eq('domain', range.domain)
      .gte('date', range.from)
      .lte('date', range.to)
      .order('date', { ascending: true });
    if (error) throw new Error(`listDailyLogs failed: ${error.message}`);
    return (data as DailyLogRow[]).map(rowToDailyLog);
  }

  async getWeeklyPlan(week: string, domain: Domain): Promise<WeeklyPlan | null> {
    const { data, error } = await this.client
      .from('os_weekly_plans')
      .select('week, domain, theme, goals, reviewed_at')
      .eq('week', week)
      .eq('domain', domain)
      .maybeSingle();
    if (error) throw new Error(`getWeeklyPlan failed: ${error.message}`);
    return data ? rowToWeeklyPlan(data as WeeklyPlanRow) : null;
  }

  async upsertWeeklyPlan(plan: WeeklyPlan): Promise<WeeklyPlan> {
    const { data, error } = await this.client
      .from('os_weekly_plans')
      .upsert(
        {
          week: plan.week,
          domain: plan.domain,
          theme: plan.theme ?? null,
          goals: plan.goals,
          reviewed_at: plan.reviewedAt ?? null,
        },
        { onConflict: 'week,domain' },
      )
      .select('week, domain, theme, goals, reviewed_at')
      .single();
    if (error) throw new Error(`upsertWeeklyPlan failed: ${error.message}`);
    return rowToWeeklyPlan(data as WeeklyPlanRow);
  }

  async listProjects(domain?: Domain): Promise<Project[]> {
    let query = this.client.from('os_projects').select('*');
    if (domain) query = query.eq('domain', domain);
    const { data, error } = await query.order('sort_order', { ascending: true });
    if (error) throw new Error(`listProjects failed: ${error.message}`);
    return (data as ProjectRow[]).map(rowToProject);
  }

  async getProject(id: string): Promise<Project | null> {
    const { data, error } = await this.client
      .from('os_projects')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`getProject failed: ${error.message}`);
    return data ? rowToProject(data as ProjectRow) : null;
  }

  async createProject(input: Omit<Project, 'id'>): Promise<Project> {
    const { data, error } = await this.client
      .from('os_projects')
      .insert({
        domain: input.domain,
        title: input.title,
        type: input.type,
        status: input.status,
        start_date: input.startDate ?? null,
        deadline: input.deadline ?? null,
        target_metric: input.targetMetric ?? null,
        milestones: input.milestones,
        sort_order: input.order,
        recurring: input.recurring ?? null,
        period: input.period ?? null,
        working_title: input.workingTitle ?? null,
        category: input.category ?? null,
        // The hierarchy columns are named only when the caller supplied a
        // value. Naming them unconditionally would make every project
        // creation fail against a database that has not yet run migration
        // 20260724000013 — the columns simply would not exist.
        ...(input.parentId ? { parent_id: input.parentId } : {}),
        ...(input.entityTag ? { entity_tag: input.entityTag } : {}),
        ...(input.linkedProjects?.length ? { linked_projects: input.linkedProjects } : {}),
        ...(input.documents?.length ? { documents: input.documents } : {}),
        ...(input.dashboardPinned ? { dashboard_pinned: true } : {}),
      })
      .select()
      .single();
    if (error) throw new Error(`createProject failed: ${error.message}`);
    return rowToProject(data as ProjectRow);
  }

  async updateProject(id: string, patch: Partial<Project>): Promise<Project> {
    const row = projectPatchToRow(patch);
    if (Object.keys(row).length === 0) {
      const current = await this.getProject(id);
      if (!current) throw new Error(`Project not found: ${id}`);
      return current;
    }
    const { data, error } = await this.client
      .from('os_projects')
      .update(row)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw new Error(`updateProject failed: ${error.message}`);
    if (!data) throw new Error(`Project not found: ${id}`);
    return rowToProject(data as ProjectRow);
  }

  async deleteProject(id: string): Promise<void> {
    const { error } = await this.client.from('os_projects').delete().eq('id', id);
    if (error) throw new Error(`deleteProject failed: ${error.message}`);
  }

  async listIeltsResults(): Promise<IeltsResult[]> {
    const { data, error } = await this.client
      .from('os_ielts_results')
      .select('id, date, listening, reading, writing, speaking')
      .order('date', { ascending: true });
    if (error) throw new Error(`listIeltsResults failed: ${error.message}`);
    return (data as IeltsResultRow[]).map(rowToIeltsResult);
  }

  async createIeltsResult(input: Omit<IeltsResult, 'id'>): Promise<IeltsResult> {
    const { data, error } = await this.client
      .from('os_ielts_results')
      .insert({
        date: input.date,
        listening: input.listening,
        reading: input.reading,
        writing: input.writing,
        speaking: input.speaking,
      })
      .select('id, date, listening, reading, writing, speaking')
      .single();
    if (error) throw new Error(`createIeltsResult failed: ${error.message}`);
    return rowToIeltsResult(data as IeltsResultRow);
  }

  async updateIeltsResult(id: string, patch: Partial<IeltsResult>): Promise<IeltsResult> {
    const row: Partial<IeltsResultRow> = {};
    if (patch.date !== undefined) row.date = patch.date;
    if (patch.listening !== undefined) row.listening = patch.listening;
    if (patch.reading !== undefined) row.reading = patch.reading;
    if (patch.writing !== undefined) row.writing = patch.writing;
    if (patch.speaking !== undefined) row.speaking = patch.speaking;
    const { data, error } = await this.client
      .from('os_ielts_results')
      .update(row)
      .eq('id', id)
      .select('id, date, listening, reading, writing, speaking')
      .maybeSingle();
    if (error) throw new Error(`updateIeltsResult failed: ${error.message}`);
    if (!data) throw new Error(`IELTS result not found: ${id}`);
    return rowToIeltsResult(data as IeltsResultRow);
  }

  async deleteIeltsResult(id: string): Promise<void> {
    const { error } = await this.client.from('os_ielts_results').delete().eq('id', id);
    if (error) throw new Error(`deleteIeltsResult failed: ${error.message}`);
  }
}
