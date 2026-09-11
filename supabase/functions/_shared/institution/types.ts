// The institution's tool layer — shared types. Pure TS: no Deno API, so the
// modules beside this file run under vitest (src/logic/institution/*) the way
// numberScan.ts and scopeInput.ts do. The Edge Function
// (supabase/functions/institution-tools) and the department machinery import
// the same files; there is one copy of every rule.

export type DataClass = 'internal' | 'public';

export interface ToolAgent {
  id: string;
  slug: string;
  dataClass: DataClass;
}

export interface ToolBrief {
  id: string;
  dataClass: DataClass;
}

/**
 * Who is calling, on whose behalf, and what internal content is in scope.
 * `internalContext` is the haystack the B-4 egress check scans outbound text
 * against: every internal corpus record of the brief, the assignment's own
 * input and output, and whatever the runner adds. For a public agent it is
 * empty BY CONSTRUCTION — a public agent with internal context is itself the
 * breach, and buildContext() refuses to build one.
 */
export interface ToolContext {
  agent: ToolAgent;
  brief: ToolBrief | null;
  assignmentId: string | null;
  runId: string | null;
  internalContext: readonly string[];
}

export type CorpusKind =
  | 'retrieval'
  | 'dataset'
  | 'methodology'
  | 'execution'
  | 'assumption'
  | 'output'
  | 'submission';

export type ReviewStatus =
  | 'unreviewed'
  | 'peer_cleared'
  | 'lead_cleared'
  | 'committee_cleared'
  | 'approved'
  | 'rejected'
  | 'superseded';

/** One row of public.os_inst_corpus, camelCase. */
export interface CorpusRecord {
  id: string;
  kind: CorpusKind;
  title: string;
  dataClass: DataClass;
  content: string;
  contentHash: string;
  url: string | null;
  httpStatus: number | null;
  fetchedAt: string | null;
  query: string | null;
  provenance: Record<string, unknown>;
  derivedFrom: string[];
  briefId: string | null;
  assignmentId: string | null;
  createdByAgentId: string | null;
  createdByRunId: string | null;
  reviewStatus: ReviewStatus;
  createdAt: string;
}

export type NewCorpusRecord = Omit<CorpusRecord, 'id' | 'createdAt' | 'reviewStatus'>;

export interface EgressBlockRow {
  briefId: string | null;
  assignmentId: string | null;
  agentId: string;
  runId: string | null;
  tool: string;
  matchedExcerpt: string;
  queryHash: string;
}

export interface EventRow {
  briefId: string | null;
  kind: string;
  agentSlug: string | null;
  departmentSlug: string | null;
  payload: Record<string, unknown>;
}

export type ToolName =
  | 'web_search'
  | 'web_fetch'
  | 'public_data'
  | 'methodology_research'
  | 'execute'
  | 'synthesize'
  | 'corpus_get'
  | 'corpus_search';

export const TOOL_NAMES: readonly ToolName[] = [
  'web_search',
  'web_fetch',
  'public_data',
  'methodology_research',
  'execute',
  'synthesize',
  'corpus_get',
  'corpus_search',
];

export type ToolErrorCode =
  | 'egress_blocked'
  | 'lane'
  | 'robots_disallowed'
  | 'rate_limited'
  | 'fetch_failed'
  | 'bad_input'
  | 'not_found'
  | 'hash_mismatch'
  | 'script_error'
  | 'timeout'
  | 'provenance'
  | 'g_number'
  | 'not_configured'
  | 'too_large';

export type ToolResult<T> =
  | { ok: true; tool: ToolName; data: T }
  | { ok: false; tool: ToolName; code: ToolErrorCode; error: string; detail?: unknown };

export interface ToolCall {
  tool: ToolName;
  args: Record<string, unknown>;
}

/** Stamped into every provenance envelope so a record says which rules made it. */
export const TOOL_LAYER_VERSION = '1.0.0';
export const USER_AGENT = 'PersonalOS-Institution/1.0 (+research; contact via director)';
