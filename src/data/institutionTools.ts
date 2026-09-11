/**
 * The browser side of the institution's tool layer — the only code that
 * talks to the institution-tools Edge Function.
 *
 * The function holds the secrets and does the reaching out; this file
 * carries the app key and reads the answer. Refusals come back as
 * `{ ok: false, code, error }` with a sentence written for a person, and
 * they are values, not exceptions: a blocked egress attempt (B-4) is a
 * normal outcome the department has to handle, not a crash.
 *
 * The GET probe is open and discloses only what is configured, exactly as
 * the Lab's probe does. `?selftest=1` runs the deployed guards against
 * synthetic input and is what the director's room shows to answer "is the
 * thing that refuses actually running".
 */
import { edgeFunctionCall, isSupabaseConfigured } from './supabaseRepository';
import { readStoredKey } from '../components/PassphraseGate';

const FUNCTION = 'institution-tools';

export type ToolName =
  | 'web_search' | 'web_fetch' | 'public_data' | 'methodology_research'
  | 'execute' | 'synthesize' | 'corpus_get' | 'corpus_search';

export interface ToolCapabilities {
  configured: boolean;
  toolLayer: string;
  tools: ToolName[];
  search: { configured: boolean; keyed: boolean; endpoint: string };
  sandbox: { version: string; network: boolean; functions: string[] };
}

export const TOOLS_UNCONFIGURED: ToolCapabilities = {
  configured: false,
  toolLayer: 'unknown',
  tools: [],
  search: { configured: false, keyed: false, endpoint: '' },
  sandbox: { version: 'unknown', network: false, functions: [] },
};

export interface SelfTestCase {
  name: string;
  expected: string;
  passed: boolean;
  detail: string;
}

export interface SelfTestResult {
  ok: boolean;
  passed: number;
  failed: number;
  cases: SelfTestCase[];
}

export async function probeTools(): Promise<ToolCapabilities> {
  if (!isSupabaseConfigured) return TOOLS_UNCONFIGURED;
  try {
    const data = await edgeFunctionCall<ToolCapabilities>(FUNCTION, { method: 'GET' });
    if (!data || typeof data.configured !== 'boolean') return TOOLS_UNCONFIGURED;
    return data;
  } catch {
    return TOOLS_UNCONFIGURED;
  }
}

export async function runSelfTest(): Promise<SelfTestResult | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const data = await edgeFunctionCall<ToolCapabilities & { selfTest?: SelfTestResult }>(
      `${FUNCTION}?selftest=1`,
      { method: 'GET' },
    );
    return data?.selfTest ?? null;
  } catch {
    return null;
  }
}

export interface ToolContextRef {
  agentSlug: string;
  briefId?: string;
  assignmentId?: string;
  runId?: string;
  /** Extra internal text to scan outbound calls against (B-4). */
  internalContext?: string[];
}

export type ToolCallResult<T> =
  | { ok: true; tool: ToolName; data: T }
  | { ok: false; tool: ToolName; code: string; error: string; detail?: unknown };

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchData {
  corpusId: string;
  query: string;
  shape: 'json' | 'html' | 'none';
  hits: SearchHit[];
  citation: string;
}

export interface FetchData {
  corpusId: string;
  url: string;
  status: number;
  contentKind: string;
  title: string | null;
  truncated: boolean;
  text: string;
  citation: string;
}

export interface ExecuteData {
  corpusId: string;
  value: unknown;
  logs: string[];
  runtimeMs: number;
  steps: number;
  seed: number;
  stdlibVersion: string;
  citation: string;
}

export interface SynthesizeData {
  corpusId?: string;
  dryRun?: boolean;
  citedIds: string[];
  assumptions: number[];
  citation?: string;
}

export interface ArchivedRecordData {
  corpusId: string;
  citation: string;
}

async function call<T>(tool: ToolName, context: ToolContextRef, args: Record<string, unknown>): Promise<ToolCallResult<T>> {
  if (!isSupabaseConfigured) {
    return { ok: false, tool, code: 'not_configured', error: 'Supabase is not configured in this build, so the tool layer is unreachable.' };
  }
  const appKey = readStoredKey();
  if (!appKey) {
    return { ok: false, tool, code: 'not_configured', error: 'No app key in this session. The tool layer spends money and writes the archive; it is behind the passphrase like every other billable call.' };
  }
  try {
    const body = {
      tool,
      agentSlug: context.agentSlug,
      briefId: context.briefId,
      assignmentId: context.assignmentId,
      runId: context.runId,
      internalContext: context.internalContext,
      args,
    };
    const data = await edgeFunctionCall<ToolCallResult<T> | { error?: string; retryAfter?: number }>(
      FUNCTION,
      { method: 'POST', body, appKey },
    );
    if (!data) return { ok: false, tool, code: 'fetch_failed', error: 'The tool layer returned nothing.' };
    // A guard refusal answers { error } with a status; a tool refusal answers
    // { ok: false, code, error }. Both are read, neither is thrown.
    if ('ok' in data) return data;
    return { ok: false, tool, code: 'not_configured', error: data.error ?? 'The tool layer refused the call.' };
  } catch (error) {
    return { ok: false, tool, code: 'fetch_failed', error: error instanceof Error ? error.message : 'The tool layer is unreachable.' };
  }
}

export const institutionTools = {
  search: (context: ToolContextRef, query: string, limit = 5) =>
    call<SearchData>('web_search', context, { query, limit }),

  fetch: (context: ToolContextRef, url: string, query?: string) =>
    call<FetchData>('web_fetch', context, { url, query }),

  publicData: (context: ToolContextRef, url: string, query?: string) =>
    call<FetchData>('public_data', context, { url, query }),

  methodology: (context: ToolContextRef, problem: string, note: string, sources: string[] = []) =>
    call<ArchivedRecordData>('methodology_research', context, { problem, note, sources }),

  execute: (context: ToolContextRef, input: { script: string; inputs?: Record<string, string>; seed?: number; title?: string }) =>
    call<ExecuteData>('execute', context, { ...input }),

  synthesize: (context: ToolContextRef, input: { draft: string; title?: string; records?: string[]; dryRun?: boolean }) =>
    call<SynthesizeData>('synthesize', context, { ...input }),

  corpusGet: (context: ToolContextRef, recordId: string) =>
    call<Record<string, unknown>>('corpus_get', context, { id: recordId }),

  corpusSearch: (context: ToolContextRef, args: { q?: string; kind?: string; limit?: number; allBriefs?: boolean } = {}) =>
    call<{ records: Array<{ id: string; kind: string; title: string; dataClass: string; url: string | null }> }>('corpus_search', context, args),
};

export type InstitutionTools = typeof institutionTools;
