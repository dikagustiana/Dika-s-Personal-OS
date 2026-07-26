/**
 * The research subsystem's data seam.
 *
 * Deliberately a separate interface hanging off Repository rather than thirty
 * more methods on it: research is one bounded subsystem, and keeping it apart
 * means the main seam stays readable.
 *
 * TWO INVARIANTS LIVE HERE, NOT IN THE UI:
 *
 *  1. APPEND-ONLY. There is no updateCycle, deleteCycle, updateLogEntry or
 *     deleteLogEntry — not unimplemented, ABSENT. A review cycle is a judgement
 *     about a moment and the decision log is the substitute for having no
 *     comparison analysts; both stop being evidence the moment they can be
 *     rewritten. Adding those methods later re-opens a hole this file exists to
 *     close.
 *
 *  2. EVERY WRITE DECLARES ITS ORIGIN. Item and claim writes take a
 *     WriteOrigin, and 'model' writes are narrowed by researchGuards before
 *     they reach the database. See that file for why.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  guardHumanOnly,
  guardItemPatch,
  guardNewClaim,
  guardNewItem,
  type WriteOrigin,
} from './researchGuards';
import type {
  FactLibraryEntry,
  ResearchClaim,
  ResearchCycle,
  ResearchItem,
  ResearchLogEntry,
  ResearchMeta,
} from './types';

export interface ResearchRepository {
  getMeta(projectId: string): Promise<ResearchMeta | null>;
  upsertMeta(meta: ResearchMeta): Promise<ResearchMeta>;
  /** Gates are human-only: origin is required so the rule cannot be forgotten. */
  setGates(projectId: string, gates: boolean[][], origin: WriteOrigin): Promise<ResearchMeta>;

  listItems(projectId: string): Promise<ResearchItem[]>;
  /** Every project's items at once, for the cross-project portfolio views. */
  listAllItems(): Promise<ResearchItem[]>;
  createItem(input: Omit<ResearchItem, 'id'>, origin: WriteOrigin): Promise<ResearchItem>;
  updateItem(id: string, patch: Partial<ResearchItem>, origin: WriteOrigin): Promise<ResearchItem>;
  deleteItem(id: string): Promise<void>;

  listClaims(projectId: string): Promise<ResearchClaim[]>;
  createClaim(input: Omit<ResearchClaim, 'id'>, origin: WriteOrigin): Promise<ResearchClaim>;
  updateClaim(id: string, patch: Partial<ResearchClaim>, origin: WriteOrigin): Promise<ResearchClaim>;
  deleteClaim(id: string): Promise<void>;

  // Append-only from here down. No update, no delete, by design.
  listCycles(projectId: string): Promise<ResearchCycle[]>;
  appendCycle(input: Omit<ResearchCycle, 'id'>, origin: WriteOrigin): Promise<ResearchCycle>;

  listLog(projectId: string): Promise<ResearchLogEntry[]>;
  appendLog(input: Omit<ResearchLogEntry, 'id'>, origin: WriteOrigin): Promise<ResearchLogEntry>;

  listLibrary(): Promise<FactLibraryEntry[]>;
  createLibraryEntry(input: Omit<FactLibraryEntry, 'id'>): Promise<FactLibraryEntry>;
  deleteLibraryEntry(id: string): Promise<void>;

  /**
   * Council transcripts. APPEND AND LIST ONLY — third member of the same
   * family as cycles and log, and absent for the same reason: there is no
   * updateCouncilSession and no deleteCouncilSession, not unimplemented but
   * ABSENT. A transcript is evidence of what was said, when, and against what
   * input; an editable one is not evidence.
   *
   * Note what is NOT here either: nothing that lets a verdict write a cycle,
   * tick a gate, set an item to V, or create a claim. A verdict reaches those
   * only by the author retyping it through the guarded paths above, which is
   * the entire point. See src/data/researchCouncil.ts.
   */
  listCouncilSessions(filter: {
    projectId?: string;
    mode?: string;
  }): Promise<CouncilSessionRow[]>;
  appendCouncilSession(input: Omit<CouncilSessionRow, 'id' | 'createdAt'>): Promise<CouncilSessionRow>;
}

/** One stored council run. `projectId` is null for scope sessions. */
export interface CouncilSessionRow {
  id: string;
  projectId: string | null;
  mode: string;
  inputSnapshot: string;
  advisorsConfig: unknown;
  advisorResponses: unknown;
  peerReviews: unknown;
  /** Null when the chairman stage failed after the others succeeded. */
  verdict: unknown;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

interface MetaRow {
  project_id: string;
  template: string;
  question: string;
  output: string;
  audience: string;
  gates: boolean[][];
}

interface ItemRow {
  id: string;
  project_id: string;
  name: string;
  unit: string;
  type: ResearchItem['type'];
  crit: boolean;
  status: ResearchItem['status'];
  value: string;
  source: string;
  asof: string;
  note: string;
  sort_order: number;
}

interface ClaimRow {
  id: string;
  project_id: string;
  text: string;
  layer: ResearchClaim['layer'];
  ev: string;
  sort_order: number;
}

interface CycleRow {
  id: string;
  project_id: string;
  loop: string;
  n: number;
  date: string;
  verdict: ResearchCycle['verdict'];
  findings: string;
  item_count: number;
  cite_count: number;
  invalidated: number;
  back_label: string;
}

interface LogRow {
  id: string;
  project_id: string;
  date: string;
  text: string;
}

interface LibraryRow {
  id: string;
  name: string;
  unit: string;
  value: string;
  source: string;
  asof: string;
  from_project: string;
}

const rowToMeta = (row: MetaRow): ResearchMeta => ({
  projectId: row.project_id,
  template: row.template,
  question: row.question ?? '',
  output: row.output ?? '',
  audience: row.audience ?? '',
  gates: Array.isArray(row.gates) ? row.gates : [],
});

const rowToItem = (row: ItemRow): ResearchItem => ({
  id: row.id,
  projectId: row.project_id,
  name: row.name,
  unit: row.unit ?? '',
  type: row.type,
  crit: Boolean(row.crit),
  status: row.status,
  value: row.value ?? '',
  source: row.source ?? '',
  asof: row.asof ?? '',
  note: row.note ?? '',
  order: row.sort_order ?? 0,
});

const itemToRow = (item: Partial<ResearchItem>): Partial<ItemRow> => {
  const row: Partial<ItemRow> = {};
  if (item.projectId !== undefined) row.project_id = item.projectId;
  if (item.name !== undefined) row.name = item.name;
  if (item.unit !== undefined) row.unit = item.unit;
  if (item.type !== undefined) row.type = item.type;
  if (item.crit !== undefined) row.crit = item.crit;
  if (item.status !== undefined) row.status = item.status;
  if (item.value !== undefined) row.value = item.value;
  if (item.source !== undefined) row.source = item.source;
  if (item.asof !== undefined) row.asof = item.asof;
  if (item.note !== undefined) row.note = item.note;
  if (item.order !== undefined) row.sort_order = item.order;
  return row;
};

const rowToClaim = (row: ClaimRow): ResearchClaim => ({
  id: row.id,
  projectId: row.project_id,
  text: row.text,
  layer: row.layer,
  ev: row.ev ?? '',
  order: row.sort_order ?? 0,
});

const claimToRow = (claim: Partial<ResearchClaim>): Partial<ClaimRow> => {
  const row: Partial<ClaimRow> = {};
  if (claim.projectId !== undefined) row.project_id = claim.projectId;
  if (claim.text !== undefined) row.text = claim.text;
  if (claim.layer !== undefined) row.layer = claim.layer;
  if (claim.ev !== undefined) row.ev = claim.ev;
  if (claim.order !== undefined) row.sort_order = claim.order;
  return row;
};

const rowToCycle = (row: CycleRow): ResearchCycle => ({
  id: row.id,
  projectId: row.project_id,
  loop: row.loop,
  n: row.n,
  date: row.date,
  verdict: row.verdict,
  findings: row.findings ?? '',
  itemCount: row.item_count ?? 0,
  citeCount: row.cite_count ?? 0,
  invalidated: row.invalidated ?? 0,
  backLabel: row.back_label ?? '',
});

const rowToLog = (row: LogRow): ResearchLogEntry => ({
  id: row.id,
  projectId: row.project_id,
  date: row.date,
  text: row.text,
});

const rowToLibrary = (row: LibraryRow): FactLibraryEntry => ({
  id: row.id,
  name: row.name,
  unit: row.unit ?? '',
  value: row.value ?? '',
  source: row.source ?? '',
  asof: row.asof ?? '',
  fromProject: row.from_project ?? '',
});

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) throw new Error('Supabase returned no row.');
  return result.data;
}

// ---------------------------------------------------------------------------
// Supabase implementation
// ---------------------------------------------------------------------------

export function createSupabaseResearchRepository(
  client: SupabaseClient,
): ResearchRepository {
  return {
    async getMeta(projectId) {
      const { data, error } = await client
        .from('os_research_meta')
        .select('*')
        .eq('project_id', projectId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? rowToMeta(data as MetaRow) : null;
    },

    async upsertMeta(meta) {
      const row = {
        project_id: meta.projectId,
        template: meta.template,
        question: meta.question,
        output: meta.output,
        audience: meta.audience,
        gates: meta.gates,
        updated_at: new Date().toISOString(),
      };
      const result = await client
        .from('os_research_meta')
        .upsert(row, { onConflict: 'project_id' })
        .select()
        .single();
      return rowToMeta(unwrap(result) as MetaRow);
    },

    async setGates(projectId, gates, origin) {
      guardHumanOnly(origin, 'A gate');
      const result = await client
        .from('os_research_meta')
        .update({ gates, updated_at: new Date().toISOString() })
        .eq('project_id', projectId)
        .select()
        .single();
      return rowToMeta(unwrap(result) as MetaRow);
    },

    async listItems(projectId) {
      const { data, error } = await client
        .from('os_research_items')
        .select('*')
        .eq('project_id', projectId)
        .order('sort_order', { ascending: true });
      if (error) throw new Error(error.message);
      return (data as ItemRow[]).map(rowToItem);
    },

    async listAllItems() {
      const { data, error } = await client
        .from('os_research_items')
        .select('*')
        .order('sort_order', { ascending: true });
      if (error) throw new Error(error.message);
      return (data as ItemRow[]).map(rowToItem);
    },

    async createItem(input, origin) {
      const guarded = guardNewItem(input, origin);
      const result = await client
        .from('os_research_items')
        .insert(itemToRow(guarded))
        .select()
        .single();
      return rowToItem(unwrap(result) as ItemRow);
    },

    async updateItem(id, patch, origin) {
      const guarded = guardItemPatch(patch, origin);
      const result = await client
        .from('os_research_items')
        .update({ ...itemToRow(guarded), updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      return rowToItem(unwrap(result) as ItemRow);
    },

    async deleteItem(id) {
      const { error } = await client.from('os_research_items').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },

    async listClaims(projectId) {
      const { data, error } = await client
        .from('os_research_claims')
        .select('*')
        .eq('project_id', projectId)
        .order('sort_order', { ascending: true });
      if (error) throw new Error(error.message);
      return (data as ClaimRow[]).map(rowToClaim);
    },

    async createClaim(input, origin) {
      const guarded = guardNewClaim(input, origin);
      const result = await client
        .from('os_research_claims')
        .insert(claimToRow(guarded))
        .select()
        .single();
      return rowToClaim(unwrap(result) as ClaimRow);
    },

    async updateClaim(id, patch, origin) {
      // A model may not reclassify an existing claim either.
      if (patch.layer !== undefined) guardHumanOnly(origin, 'A claim layer');
      const result = await client
        .from('os_research_claims')
        .update({ ...claimToRow(patch), updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      return rowToClaim(unwrap(result) as ClaimRow);
    },

    async deleteClaim(id) {
      const { error } = await client.from('os_research_claims').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },

    async listCycles(projectId) {
      const { data, error } = await client
        .from('os_research_cycles')
        .select('*')
        .eq('project_id', projectId)
        .order('date', { ascending: true });
      if (error) throw new Error(error.message);
      return (data as CycleRow[]).map(rowToCycle);
    },

    async appendCycle(input, origin) {
      guardHumanOnly(origin, 'A review cycle');
      const result = await client
        .from('os_research_cycles')
        .insert({
          project_id: input.projectId,
          loop: input.loop,
          n: input.n,
          date: input.date,
          verdict: input.verdict,
          findings: input.findings,
          item_count: input.itemCount,
          cite_count: input.citeCount,
          invalidated: input.invalidated,
          back_label: input.backLabel,
        })
        .select()
        .single();
      return rowToCycle(unwrap(result) as CycleRow);
    },

    async listLog(projectId) {
      const { data, error } = await client
        .from('os_research_log')
        .select('*')
        .eq('project_id', projectId)
        .order('date', { ascending: true });
      if (error) throw new Error(error.message);
      return (data as LogRow[]).map(rowToLog);
    },

    async appendLog(input, origin) {
      guardHumanOnly(origin, 'A decision-log entry');
      const result = await client
        .from('os_research_log')
        .insert({ project_id: input.projectId, date: input.date, text: input.text })
        .select()
        .single();
      return rowToLog(unwrap(result) as LogRow);
    },

    async listLibrary() {
      const { data, error } = await client
        .from('os_fact_library')
        .select('*')
        .order('name', { ascending: true });
      if (error) throw new Error(error.message);
      return (data as LibraryRow[]).map(rowToLibrary);
    },

    async createLibraryEntry(input) {
      const result = await client
        .from('os_fact_library')
        .insert({
          name: input.name,
          unit: input.unit,
          value: input.value,
          source: input.source,
          asof: input.asof,
          from_project: input.fromProject,
        })
        .select()
        .single();
      return rowToLibrary(unwrap(result) as LibraryRow);
    },

    async deleteLibraryEntry(id) {
      const { error } = await client.from('os_fact_library').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },

    async listCouncilSessions(filter) {
      let query = client
        .from('os_research_council_sessions')
        .select('*')
        .order('created_at', { ascending: false });
      // A scope session has no project, so scope history is listed by mode.
      if (filter.projectId) query = query.eq('project_id', filter.projectId);
      if (filter.mode) query = query.eq('mode', filter.mode);
      const rows = (unwrap(await query) ?? []) as CouncilRow[];
      return rows.map(rowToCouncil);
    },

    async appendCouncilSession(input) {
      const result = await client
        .from('os_research_council_sessions')
        .insert({
          project_id: input.projectId,
          mode: input.mode,
          input_snapshot: input.inputSnapshot,
          advisors_config: input.advisorsConfig,
          advisor_responses: input.advisorResponses,
          peer_reviews: input.peerReviews,
          verdict: input.verdict,
        })
        .select()
        .single();
      return rowToCouncil(unwrap(result) as CouncilRow);
    },
  };
}

interface CouncilRow {
  id: string;
  project_id: string | null;
  mode: string;
  input_snapshot: string;
  advisors_config: unknown;
  advisor_responses: unknown;
  peer_reviews: unknown;
  verdict: unknown;
  created_at: string;
}

function rowToCouncil(row: CouncilRow): CouncilSessionRow {
  return {
    id: row.id,
    projectId: row.project_id,
    mode: row.mode,
    inputSnapshot: row.input_snapshot,
    advisorsConfig: row.advisors_config,
    advisorResponses: row.advisor_responses,
    peerReviews: row.peer_reviews,
    verdict: row.verdict,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// In-memory implementation, so a bare clone runs
// ---------------------------------------------------------------------------

const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(36).slice(2)}`;

export class MockResearchRepository implements ResearchRepository {
  private meta = new Map<string, ResearchMeta>();
  private items: ResearchItem[] = [];
  private claims: ResearchClaim[] = [];
  private cycles: ResearchCycle[] = [];
  private log: ResearchLogEntry[] = [];
  private library: FactLibraryEntry[] = [];

  async getMeta(projectId: string) {
    return this.meta.get(projectId) ?? null;
  }

  async upsertMeta(meta: ResearchMeta) {
    this.meta.set(meta.projectId, { ...meta });
    return { ...meta };
  }

  async setGates(projectId: string, gates: boolean[][], origin: WriteOrigin) {
    guardHumanOnly(origin, 'A gate');
    const existing = this.meta.get(projectId);
    if (!existing) throw new Error(`No research meta for ${projectId}`);
    const next = { ...existing, gates };
    this.meta.set(projectId, next);
    return { ...next };
  }

  async listItems(projectId: string) {
    return this.items.filter((item) => item.projectId === projectId).map((item) => ({ ...item }));
  }

  async listAllItems() {
    return this.items.map((item) => ({ ...item }));
  }

  async createItem(input: Omit<ResearchItem, 'id'>, origin: WriteOrigin) {
    const created = { ...guardNewItem(input, origin), id: newId() };
    this.items.push(created);
    return { ...created };
  }

  async updateItem(id: string, patch: Partial<ResearchItem>, origin: WriteOrigin) {
    const guarded = guardItemPatch(patch, origin);
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`No research item ${id}`);
    this.items[index] = { ...this.items[index], ...guarded };
    return { ...this.items[index] };
  }

  async deleteItem(id: string) {
    this.items = this.items.filter((item) => item.id !== id);
  }

  async listClaims(projectId: string) {
    return this.claims.filter((claim) => claim.projectId === projectId).map((c) => ({ ...c }));
  }

  async createClaim(input: Omit<ResearchClaim, 'id'>, origin: WriteOrigin) {
    const created = { ...guardNewClaim(input, origin), id: newId() };
    this.claims.push(created);
    return { ...created };
  }

  async updateClaim(id: string, patch: Partial<ResearchClaim>, origin: WriteOrigin) {
    if (patch.layer !== undefined) guardHumanOnly(origin, 'A claim layer');
    const index = this.claims.findIndex((claim) => claim.id === id);
    if (index < 0) throw new Error(`No research claim ${id}`);
    this.claims[index] = { ...this.claims[index], ...patch };
    return { ...this.claims[index] };
  }

  async deleteClaim(id: string) {
    this.claims = this.claims.filter((claim) => claim.id !== id);
  }

  async listCycles(projectId: string) {
    return this.cycles.filter((cycle) => cycle.projectId === projectId).map((c) => ({ ...c }));
  }

  async appendCycle(input: Omit<ResearchCycle, 'id'>, origin: WriteOrigin) {
    guardHumanOnly(origin, 'A review cycle');
    const created = { ...input, id: newId() };
    this.cycles.push(created);
    return { ...created };
  }

  async listLog(projectId: string) {
    return this.log.filter((entry) => entry.projectId === projectId).map((e) => ({ ...e }));
  }

  async appendLog(input: Omit<ResearchLogEntry, 'id'>, origin: WriteOrigin) {
    guardHumanOnly(origin, 'A decision-log entry');
    const created = { ...input, id: newId() };
    this.log.push(created);
    return { ...created };
  }

  async listLibrary() {
    return this.library.map((fact) => ({ ...fact }));
  }

  async createLibraryEntry(input: Omit<FactLibraryEntry, 'id'>) {
    const created = { ...input, id: newId() };
    this.library.push(created);
    return { ...created };
  }

  async deleteLibraryEntry(id: string) {
    this.library = this.library.filter((fact) => fact.id !== id);
  }

  private councilSessions: CouncilSessionRow[] = [];

  async listCouncilSessions(filter: { projectId?: string; mode?: string }) {
    return this.councilSessions
      .filter((row) => !filter.projectId || row.projectId === filter.projectId)
      .filter((row) => !filter.mode || row.mode === filter.mode)
      .map((row) => ({ ...row }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async appendCouncilSession(input: Omit<CouncilSessionRow, 'id' | 'createdAt'>) {
    // Append only. There is deliberately no update and no delete here either —
    // the mock must not offer a door the real repository refuses.
    const created = { ...input, id: newId(), createdAt: new Date().toISOString() };
    this.councilSessions.push(created);
    return { ...created };
  }
}
