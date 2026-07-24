import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Repository } from './repository';
import type {
  DailyLog,
  Entry,
  EntryType,
  Project,
  WeeklyPlan,
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
export async function verifyAppKey(candidate: string): Promise<boolean> {
  const { url, anonKey } = requireConfig();
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await client.rpc('os_verify_key', { candidate });
  if (error) throw new Error(`Passphrase check failed: ${error.message}`);
  return data === true;
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
  created_at: string;
  updated_at: string;
  tags: string[];
  entry_date: string | null;
  payload: Record<string, unknown>;
}

interface DailyLogRow {
  date: string;
  habits: Record<string, boolean>;
  score: number;
}

interface WeeklyPlanRow {
  week: string;
  theme: string | null;
  goals: WeeklyPlan['goals'];
  reviewed_at: string | null;
}

interface ProjectRow {
  id: string;
  title: string;
  type: Project['type'];
  status: Project['status'];
  deadline: string | null;
  target_metric: string | null;
  milestones: Project['milestones'];
  sort_order: number;
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
  const { id, type, createdAt, updatedAt, tags, ...payload } = entry;
  return {
    id,
    type,
    created_at: createdAt,
    updated_at: updatedAt,
    tags,
    entry_date: entryDateFor(entry),
    payload,
  };
}

function rowToDailyLog(row: DailyLogRow): DailyLog {
  return { date: row.date, habits: row.habits, score: row.score };
}

function rowToWeeklyPlan(row: WeeklyPlanRow): WeeklyPlan {
  const plan: WeeklyPlan = { week: row.week, goals: row.goals };
  if (row.theme !== null) plan.theme = row.theme;
  if (row.reviewed_at !== null) plan.reviewedAt = toIso(row.reviewed_at);
  return plan;
}

function rowToProject(row: ProjectRow): Project {
  const project: Project = {
    id: row.id,
    title: row.title,
    type: row.type,
    status: row.status,
    milestones: row.milestones,
    order: row.sort_order,
  };
  if (row.deadline !== null) project.deadline = row.deadline;
  if (row.target_metric !== null) project.targetMetric = row.target_metric;
  return project;
}

function projectPatchToRow(patch: Partial<Project>): Partial<ProjectRow> {
  const row: Partial<ProjectRow> = {};
  if ('title' in patch && patch.title !== undefined) row.title = patch.title;
  if ('type' in patch && patch.type !== undefined) row.type = patch.type;
  if ('status' in patch && patch.status !== undefined) row.status = patch.status;
  if ('milestones' in patch && patch.milestones !== undefined) row.milestones = patch.milestones;
  if ('order' in patch && patch.order !== undefined) row.sort_order = patch.order;
  if ('deadline' in patch) row.deadline = patch.deadline ?? null;
  if ('targetMetric' in patch) row.target_metric = patch.targetMetric ?? null;
  return row;
}

// --- repository -------------------------------------------------------------

class SupabaseRepository implements Repository {
  constructor(private readonly client: SupabaseClient) {}

  async listEntries(filter?: { type?: EntryType; date?: string }): Promise<Entry[]> {
    let query = this.client.from('os_entries').select('*');
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

  async getDailyLog(date: string): Promise<DailyLog | null> {
    const { data, error } = await this.client
      .from('os_daily_logs')
      .select('date, habits, score')
      .eq('date', date)
      .maybeSingle();
    if (error) throw new Error(`getDailyLog failed: ${error.message}`);
    return data ? rowToDailyLog(data as DailyLogRow) : null;
  }

  async upsertDailyLog(log: DailyLog): Promise<DailyLog> {
    const { data, error } = await this.client
      .from('os_daily_logs')
      .upsert(
        { date: log.date, habits: log.habits, score: log.score },
        { onConflict: 'date' },
      )
      .select('date, habits, score')
      .single();
    if (error) throw new Error(`upsertDailyLog failed: ${error.message}`);
    return rowToDailyLog(data as DailyLogRow);
  }

  async listDailyLogs(range: { from: string; to: string }): Promise<DailyLog[]> {
    const { data, error } = await this.client
      .from('os_daily_logs')
      .select('date, habits, score')
      .gte('date', range.from)
      .lte('date', range.to)
      .order('date', { ascending: true });
    if (error) throw new Error(`listDailyLogs failed: ${error.message}`);
    return (data as DailyLogRow[]).map(rowToDailyLog);
  }

  async getWeeklyPlan(week: string): Promise<WeeklyPlan | null> {
    const { data, error } = await this.client
      .from('os_weekly_plans')
      .select('week, theme, goals, reviewed_at')
      .eq('week', week)
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
          theme: plan.theme ?? null,
          goals: plan.goals,
          reviewed_at: plan.reviewedAt ?? null,
        },
        { onConflict: 'week' },
      )
      .select('week, theme, goals, reviewed_at')
      .single();
    if (error) throw new Error(`upsertWeeklyPlan failed: ${error.message}`);
    return rowToWeeklyPlan(data as WeeklyPlanRow);
  }

  async listProjects(): Promise<Project[]> {
    const { data, error } = await this.client
      .from('os_projects')
      .select('*')
      .order('sort_order', { ascending: true });
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
        title: input.title,
        type: input.type,
        status: input.status,
        deadline: input.deadline ?? null,
        target_metric: input.targetMetric ?? null,
        milestones: input.milestones,
        sort_order: input.order,
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
}
