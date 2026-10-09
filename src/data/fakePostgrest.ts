/**
 * TEST SUPPORT ONLY — imported by *.test.ts files, never by production code.
 *
 * An in-memory stand-in for the slice of PostgREST that supabaseRepository
 * talks to, served through supabase-js's injectable `global.fetch`. It exists
 * so a test can drive the REAL query builder and the REAL row mappers end to
 * end — which is the only way to catch the class of bug where the mapper
 * forgets a column (C3.PROJECT-MAPPING-DRIFT): a scripted client that returns
 * canned rows cannot notice that a field was never sent.
 *
 * Deliberately strict where PostgREST is strict, because leniency here is how
 * a mapping typo passes a test and fails in production:
 *   - a body naming a column the table does not have is a 400 (PGRST204),
 *     exactly the error a missing migration produces live;
 *   - Accept: vnd.pgrst.object+json (`.single()`) with zero or several rows is
 *     a 406 (PGRST116);
 *   - an INSERT colliding on the primary key is a 409 (23505) unless the
 *     request carried resolution=ignore-duplicates / merge-duplicates.
 *
 * Deliberately simple everywhere else: filters compare as strings, `select`
 * lists are honoured only as flat column lists, and no embedding exists.
 * Columns, defaults and keys below mirror the live catalog (information_schema,
 * read 2026-10-09), not the migration files — landmine 2.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type FakeRow = Record<string, unknown>;

export interface FakeTableSpec {
  /** Every column the table has, with the value an omitted column takes. */
  columns: Record<string, () => unknown>;
  primaryKey: string[];
  /** Runs on every UPDATE, after the patch — a BEFORE UPDATE trigger stand-in. */
  onUpdate?: (row: FakeRow) => void;
}

export interface FakeRequest {
  method: string;
  table: string;
  url: URL;
  body: unknown;
  headers: Headers;
}

/** A canned reply that pre-empts the in-memory table for one request. */
export interface FakeReply {
  status: number;
  body?: unknown;
}

export interface FakePostgrest {
  readonly client: SupabaseClient;
  readonly fetch: typeof fetch;
  readonly requests: FakeRequest[];
  rows(table: string): FakeRow[];
  seed(table: string, rows: FakeRow[]): void;
  /**
   * Intercept requests before the table sees them. Return a reply to answer
   * with it (the table is untouched — a failure that never reached the
   * database); return 'after' to let the table apply the write and THEN fail
   * the response (a lost acknowledgement — committed, but the client never
   * hears it); return undefined to pass through.
   */
  intercept(handler: (request: FakeRequest) => FakeReply | 'after' | undefined): void;
  /** Server-side functions, keyed by name, for `client.rpc(name, args)`. */
  rpc(name: string, handler: (args: Record<string, unknown>, fake: FakePostgrest) => FakeReply): void;
}

const now = () => new Date().toISOString();
const nil = () => null;

/** The live public.os_projects catalog. */
export const OS_PROJECTS: FakeTableSpec = {
  primaryKey: ['id'],
  columns: {
    id: () => crypto.randomUUID(),
    title: nil,
    type: nil,
    status: nil,
    deadline: nil,
    target_metric: nil,
    milestones: () => [],
    sort_order: () => 0,
    updated_at: now,
    domain: () => 'work',
    start_date: nil,
    recurring: nil,
    period: nil,
    working_title: nil,
    category: nil,
    date_confidence: nil,
    parent_id: nil,
    linked_projects: () => [],
    entity_tag: nil,
    documents: () => [],
    dashboard_pinned: () => false,
    priority: nil,
    wip_limit: nil,
    stale_months: nil,
    engagement: nil,
  },
  onUpdate: (row) => {
    row.updated_at = now();
  },
};

/** The live public.os_entries catalog. */
export const OS_ENTRIES: FakeTableSpec = {
  primaryKey: ['id'],
  columns: {
    id: () => crypto.randomUUID(),
    type: nil,
    created_at: now,
    updated_at: now,
    tags: () => [],
    entry_date: nil,
    payload: () => ({}),
    domain: () => 'work',
  },
  onUpdate: (row) => {
    row.updated_at = now();
  },
};

/** The live public.os_daily_logs catalog. */
export const OS_DAILY_LOGS: FakeTableSpec = {
  primaryKey: ['date', 'domain'],
  columns: {
    date: nil,
    habits: () => ({}),
    score: () => 0,
    updated_at: now,
    domain: () => 'work',
  },
  onUpdate: (row) => {
    row.updated_at = now();
  },
};

/** The live public.os_weekly_plans catalog. */
export const OS_WEEKLY_PLANS: FakeTableSpec = {
  primaryKey: ['week', 'domain'],
  columns: {
    week: nil,
    theme: nil,
    goals: () => [],
    reviewed_at: nil,
    updated_at: now,
    domain: () => 'work',
  },
  onUpdate: (row) => {
    row.updated_at = now();
  },
};

const RESERVED_PARAMS = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

function json(status: number, body?: unknown): Response {
  // A null body, not '': Response refuses any body at all on a 204.
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function matches(row: FakeRow, column: string, expression: string): boolean {
  const dot = expression.indexOf('.');
  const op = expression.slice(0, dot);
  const raw = expression.slice(dot + 1);
  const value = row[column];
  const text = value === null || value === undefined ? null : String(value);
  switch (op) {
    case 'eq':
      return text === raw;
    case 'neq':
      return text !== raw;
    case 'is':
      return raw === 'null' ? text === null : text === raw;
    case 'in': {
      const list = raw.replace(/^\(|\)$/g, '').split(',').map((v) => v.replace(/^"|"$/g, ''));
      return text !== null && list.includes(text);
    }
    case 'gt':
      return text !== null && text > raw;
    case 'gte':
      return text !== null && text >= raw;
    case 'lt':
      return text !== null && text < raw;
    case 'lte':
      return text !== null && text <= raw;
    default:
      throw new Error(`fakePostgrest: unsupported filter operator ${op}`);
  }
}

function project(row: FakeRow, select: string | null): FakeRow {
  if (!select || select === '*') return structuredClone(row);
  const out: FakeRow = {};
  for (const column of select.split(',').map((c) => c.trim()).filter(Boolean)) {
    out[column] = structuredClone(row[column]);
  }
  return out;
}

export function createFakePostgrest(specs: Record<string, FakeTableSpec>): FakePostgrest {
  const tables = new Map<string, FakeRow[]>();
  for (const name of Object.keys(specs)) tables.set(name, []);
  const requests: FakeRequest[] = [];
  const interceptors: Array<(request: FakeRequest) => FakeReply | 'after' | undefined> = [];
  const rpcs = new Map<string, (args: Record<string, unknown>, fake: FakePostgrest) => FakeReply>();

  const keyOf = (spec: FakeTableSpec, row: FakeRow) =>
    spec.primaryKey.map((column) => String(row[column])).join('\u0000');

  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' && init.body !== '' ? JSON.parse(init.body) : undefined;
    const path = url.pathname.replace(/^\/rest\/v1\//, '');

    if (path.startsWith('rpc/')) {
      const name = path.slice(4);
      const request: FakeRequest = { method, table: path, url, body, headers };
      requests.push(request);
      for (const handler of interceptors) {
        const reply = handler(request);
        if (reply && reply !== 'after') return json(reply.status, reply.body);
      }
      const fn = rpcs.get(name);
      if (!fn) return json(404, { code: 'PGRST202', message: `Could not find the function public.${name}` });
      const reply = fn((body ?? {}) as Record<string, unknown>, fake);
      return json(reply.status, reply.body);
    }

    const table = path;
    const spec = specs[table];
    const request: FakeRequest = { method, table, url, body, headers };
    requests.push(request);
    if (!spec) {
      return json(404, { code: '42P01', message: `relation "public.${table}" does not exist` });
    }

    let failAfter = false;
    for (const handler of interceptors) {
      const reply = handler(request);
      if (reply === 'after') failAfter = true;
      else if (reply) return json(reply.status, reply.body);
    }

    const rows = tables.get(table)!;
    const filters = [...url.searchParams.entries()].filter(([key]) => !RESERVED_PARAMS.has(key));
    const selected = () => rows.filter((row) => filters.every(([column, expr]) => matches(row, column, expr)));
    const prefer = headers.get('Prefer') ?? '';
    const wantsRepresentation = method === 'GET' || prefer.includes('return=representation');
    const unknownColumn = (candidate: FakeRow) =>
      Object.keys(candidate).find((column) => !(column in spec.columns));

    let result: FakeRow[];
    let status = 200;

    if (method === 'GET') {
      result = selected();
      const order = url.searchParams.get('order');
      if (order) {
        const keys = order.split(',').map((part) => {
          const [column, direction] = part.split('.');
          return { column, desc: direction === 'desc' };
        });
        result = [...result].sort((a, b) => {
          for (const { column, desc } of keys) {
            const x = String(a[column] ?? '');
            const y = String(b[column] ?? '');
            if (x !== y) return (x < y ? -1 : 1) * (desc ? -1 : 1);
          }
          return 0;
        });
      }
    } else if (method === 'POST') {
      const incoming = (Array.isArray(body) ? body : [body]) as FakeRow[];
      for (const candidate of incoming) {
        const bad = unknownColumn(candidate);
        if (bad) {
          return json(400, {
            code: 'PGRST204',
            message: `Could not find the '${bad}' column of '${table}' in the schema cache`,
          });
        }
      }
      result = [];
      for (const candidate of incoming) {
        const row: FakeRow = {};
        for (const [column, fallback] of Object.entries(spec.columns)) {
          row[column] = column in candidate ? structuredClone(candidate[column]) : fallback();
        }
        const existing = rows.find((other) => keyOf(spec, other) === keyOf(spec, row));
        if (existing) {
          if (prefer.includes('resolution=ignore-duplicates')) continue;
          if (prefer.includes('resolution=merge-duplicates')) {
            for (const column of Object.keys(candidate)) existing[column] = structuredClone(candidate[column]);
            spec.onUpdate?.(existing);
            result.push(existing);
            continue;
          }
          return json(409, {
            code: '23505',
            message: `duplicate key value violates unique constraint "${table}_pkey"`,
          });
        }
        rows.push(row);
        result.push(row);
      }
      status = 201;
    } else if (method === 'PATCH') {
      const patch = (body ?? {}) as FakeRow;
      const bad = unknownColumn(patch);
      if (bad) {
        return json(400, {
          code: 'PGRST204',
          message: `Could not find the '${bad}' column of '${table}' in the schema cache`,
        });
      }
      result = selected();
      for (const row of result) {
        for (const [column, value] of Object.entries(patch)) row[column] = structuredClone(value);
        spec.onUpdate?.(row);
      }
    } else if (method === 'DELETE') {
      result = selected();
      for (const row of result) rows.splice(rows.indexOf(row), 1);
    } else {
      throw new Error(`fakePostgrest: unsupported method ${method}`);
    }

    if (failAfter) return json(503, { message: 'upstream connection reset' });

    const shaped = result.map((row) => project(row, url.searchParams.get('select')));
    if ((headers.get('Accept') ?? '').includes('application/vnd.pgrst.object+json')) {
      if (shaped.length !== 1) {
        return json(406, {
          code: 'PGRST116',
          message: 'JSON object requested, multiple (or no) rows returned',
          details: `The result contains ${shaped.length} rows`,
        });
      }
      return json(status, shaped[0]);
    }
    return wantsRepresentation ? json(status, shaped) : json(status === 201 ? 201 : 204);
  }) as typeof fetch;

  const client = createClient('http://fake-postgrest.test', 'test-anon-key', {
    auth: { persistSession: false },
    global: { fetch: fakeFetch },
  });

  const fake: FakePostgrest = {
    client,
    fetch: fakeFetch,
    requests,
    rows: (table) => structuredClone(tables.get(table) ?? []),
    seed: (table, seeded) => {
      const spec = specs[table];
      const rows = tables.get(table)!;
      for (const candidate of seeded) {
        const row: FakeRow = {};
        for (const [column, fallback] of Object.entries(spec.columns)) {
          row[column] = column in candidate ? structuredClone(candidate[column]) : fallback();
        }
        rows.push(row);
      }
    },
    intercept: (handler) => {
      interceptors.push(handler);
    },
    rpc: (name, handler) => {
      rpcs.set(name, handler);
    },
  };
  return fake;
}
