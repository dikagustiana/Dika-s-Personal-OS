// =============================================================================
// THE INSTITUTION'S SHARED TOOL LAYER (Part 2)
// =============================================================================
//
// One function, one tool set, for every specialist, every lead, the program
// office and the committee. Built once here rather than per agent, because
// eight copies of an egress check is eight chances to omit one.
//
// Tools: web_search, web_fetch, public_data, methodology_research, execute,
// synthesize, corpus_get, corpus_search.
//
// THE RULES THIS FILE ENFORCES, and where each actually lives:
//
//   B-4  every outbound call by an internal-lane agent is scanned against
//        the internal content in that run's context; a match BLOCKS the call
//        and writes os_inst_egress_blocks + an egress.blocked event. The
//        matcher is _shared/institution/egress.ts, under vitest.
//   B-6  every retrieval is archived into os_inst_corpus BEFORE the agent
//        sees it: URL, HTTP status, timestamp, sha256 of the extracted text,
//        and the extracted text itself. Citations point at the record.
//        A failed retrieval is archived too — with its status — so "we
//        looked and got a 403" is a fact in the corpus, not a memory.
//   B-7  execution is the sandbox in _shared/institution/sandbox/, which has
//        no host bindings at all. Inputs are corpus records addressed by id
//        and verified by hash before the script runs. The result record
//        carries script, input hashes, stdlib version, runtime and seed.
//   B-8  synthesize refuses a draft with an unattributed factual claim, a
//        dangling citation, or a figure no cited record contains (G-NUMBER,
//        with the agent's own [C] tags switched off per B-7).
//
// IDENTITY. The director's x-app-key, through the same rate limiter as the
// passphrase gate (_shared/appKeyAuth.ts) — the institution's stepper calls
// this function with the key it already holds, and nothing here is callable
// without it. Writes go through PostgREST as the service role, which is
// os_key_valid() = false, so every institution guard applies to this
// function exactly as it applies to an agent.
//
// WHAT IS NOT HERE. No model call: this layer retrieves, archives, computes
// and checks. Drafting is run-lab-agent's job; Phase 3's department
// machinery composes the two.

import { checkAppKey } from '../_shared/appKeyAuth.ts';
import { checkEgress, indexInternal } from '../_shared/institution/egress.ts';
import { capText, contentKindFor, extractHtml, normaliseJsonText } from '../_shared/institution/extract.ts';
import { sha256Hex } from '../_shared/institution/hash.ts';
import { buildContext, ContextError, policyFor } from '../_shared/institution/policy.ts';
import { checkEnvelope, checkSynthesis, deriveDataClass } from '../_shared/institution/provenance.ts';
import { hostOf, planFetch } from '../_shared/institution/rateLimit.ts';
import { isAllowed, parseRobots } from '../_shared/institution/robots.ts';
import { parseSearch, searchUrlFor } from '../_shared/institution/searchParse.ts';
import { runSandbox, STDLIB_NAMES, STDLIB_VERSION } from '../_shared/institution/sandbox/run.ts';
import type {
  CorpusKind,
  CorpusRecord,
  DataClass,
  ToolContext,
  ToolErrorCode,
  ToolName,
} from '../_shared/institution/types.ts';
import { TOOL_LAYER_VERSION, USER_AGENT } from '../_shared/institution/types.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

/**
 * The search backend. A secret, not a constant: which search endpoint this
 * institution is entitled to use is a property of the director's accounts.
 * The default is DuckDuckGo's keyless HTML endpoint, which works without a
 * contract and may be rate-limited or blocked at any time — when it is, the
 * tool says so with the status it got rather than returning an empty result
 * set that reads like "nothing exists".
 */
const SEARCH_URL = Deno.env.get('INSTITUTION_SEARCH_URL') ?? 'https://html.duckduckgo.com/html/?q={query}';
const SEARCH_API_KEY = Deno.env.get('INSTITUTION_SEARCH_API_KEY') ?? '';
const SEARCH_AUTH_HEADER = Deno.env.get('INSTITUTION_SEARCH_AUTH_HEADER') ?? 'Authorization';
const SEARCH_AUTH_PREFIX = Deno.env.get('INSTITUTION_SEARCH_AUTH_PREFIX') ?? 'Bearer ';

const FETCH_TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 4_000_000;
const MAX_RESULTS = 10;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-app-key',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/** Every refusal has a code the caller can branch on and a sentence a person can act on. */
function failDetail(tool: ToolName, code: ToolErrorCode, error: string, detail?: unknown) {
  return { ok: false as const, tool, code, error, ...(detail === undefined ? {} : { detail }) };
}

// ---------------------------------------------------------------------------
// PostgREST, as the service role — the same shape run-lab-agent uses
// ---------------------------------------------------------------------------

async function restInsert<T>(table: string, row: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  });
  const payload = await response.json();
  if (!response.ok) {
    // A guard's message is the useful part of a refused insert — the
    // institution's triggers are written to be read by whoever tripped them.
    throw new Error(payload?.message ?? `insert into ${table} failed (${response.status})`);
  }
  return (Array.isArray(payload) ? payload[0] : payload) as T;
}

async function restSelect<T>(table: string, query: string): Promise<T[]> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message ?? `read ${table} failed (${response.status})`);
  }
  return (await response.json()) as T[];
}

interface CorpusRow {
  id: string;
  kind: CorpusKind;
  title: string;
  data_class: DataClass;
  content: string;
  content_hash: string;
  url: string | null;
  http_status: number | null;
  fetched_at: string | null;
  query: string | null;
  provenance: Record<string, unknown>;
  derived_from: string[];
  brief_id: string | null;
  assignment_id: string | null;
  created_by_agent_id: string | null;
  created_by_run_id: string | null;
  review_status: CorpusRecord['reviewStatus'];
  created_at: string;
}

const toRecord = (row: CorpusRow): CorpusRecord => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  dataClass: row.data_class,
  content: row.content,
  contentHash: row.content_hash,
  url: row.url,
  httpStatus: row.http_status,
  fetchedAt: row.fetched_at,
  query: row.query,
  provenance: row.provenance ?? {},
  derivedFrom: row.derived_from ?? [],
  briefId: row.brief_id,
  assignmentId: row.assignment_id,
  createdByAgentId: row.created_by_agent_id,
  createdByRunId: row.created_by_run_id,
  reviewStatus: row.review_status,
  createdAt: row.created_at,
});

async function logEvent(row: {
  briefId: string | null;
  kind: string;
  agentSlug?: string | null;
  departmentSlug?: string | null;
  payload: Record<string, unknown>;
}): Promise<void> {
  try {
    await restInsert('os_inst_events', {
      brief_id: row.briefId,
      kind: row.kind,
      agent_slug: row.agentSlug ?? null,
      department_slug: row.departmentSlug ?? null,
      payload: row.payload,
    });
  } catch {
    // An event is a record of what happened, not a precondition for it. A
    // failed event write must not turn a successful archive into an error.
  }
}

// ---------------------------------------------------------------------------
// the archive (B-6) — nothing reaches an agent before it is a record
// ---------------------------------------------------------------------------

interface ArchiveInput {
  kind: CorpusKind;
  title: string;
  content: string;
  url?: string | null;
  httpStatus?: number | null;
  fetchedAt?: string | null;
  query?: string | null;
  provenance: Record<string, unknown>;
  derivedFrom?: string[];
  sourceClasses?: DataClass[];
}

async function archive(context: ToolContext, input: ArchiveInput): Promise<CorpusRecord> {
  const dataClass = deriveDataClass({
    agentDataClass: context.agent.dataClass,
    briefDataClass: context.brief?.dataClass ?? null,
    sourceClasses: input.sourceClasses ?? [],
  });
  const problems = checkEnvelope(input.kind, {
    title: input.title,
    content: input.content,
    url: input.url ?? null,
    httpStatus: input.httpStatus ?? null,
    fetchedAt: input.fetchedAt ?? null,
    query: input.query ?? null,
    provenance: input.provenance,
    derivedFrom: input.derivedFrom ?? [],
  });
  if (problems.length > 0) {
    throw new Error(
      `provenance: this ${input.kind} record is missing ${problems.map((problem) => problem.field).join(', ')}. ${problems[0].message}.`,
    );
  }
  const row = await restInsert<CorpusRow>('os_inst_corpus', {
    kind: input.kind,
    title: input.title.slice(0, 300),
    data_class: dataClass,
    content: input.content,
    content_hash: await sha256Hex(input.content),
    url: input.url ?? null,
    http_status: input.httpStatus ?? null,
    fetched_at: input.fetchedAt ?? null,
    query: input.query ?? null,
    provenance: { ...input.provenance, toolLayer: TOOL_LAYER_VERSION },
    derived_from: input.derivedFrom ?? [],
    brief_id: context.brief?.id ?? null,
    assignment_id: context.assignmentId,
    created_by_agent_id: context.agent.id,
    created_by_run_id: context.runId,
  });
  return toRecord(row);
}

// ---------------------------------------------------------------------------
// B-4 — the gate every outbound string passes
// ---------------------------------------------------------------------------

interface Outbound {
  field: 'query' | 'url' | 'body' | 'script';
  text: string;
}

/** Returns a refusal when the call must be blocked, or null when it may go. */
async function egressGate(
  context: ToolContext,
  tool: ToolName,
  outbound: Outbound[],
): Promise<ReturnType<typeof failDetail> | null> {
  const policy = policyFor(context, tool);
  if (!policy.scanRequired) return null;
  const verdict = checkEgress(outbound.map((entry) => entry.text), indexInternal(context.internalContext));
  if (!verdict.blocked) return null;

  const joined = outbound.map((entry) => entry.text).join(' ');
  const queryHash = await sha256Hex(joined);
  try {
    await restInsert('os_inst_egress_blocks', {
      brief_id: context.brief?.id ?? null,
      assignment_id: context.assignmentId,
      agent_id: context.agent.id,
      run_id: context.runId,
      tool,
      // Never the whole query: the log must not itself become the leak.
      matched_excerpt: verdict.matches.map((match) => `${match.kind}:${match.excerpt}`).join(' | ').slice(0, 500),
      query_hash: queryHash,
    });
  } catch {
    // Logging failed; the BLOCK still stands. A gate that opens when its
    // audit trail is unavailable is not a gate.
  }
  await logEvent({
    briefId: context.brief?.id ?? null,
    kind: 'egress.blocked',
    agentSlug: context.agent.slug,
    payload: { tool, matches: verdict.matches.length, kinds: verdict.matches.map((match) => match.kind) },
  });
  return failDetail(
    tool,
    'egress_blocked',
    `B-4: this call would place internal content in front of a third party, so it was blocked and logged. ${verdict.matches.length} match(es): ${verdict.matches.map((match) => match.kind).join(', ')}. Retrieve public material with a query written from public knowledge, or ask the program office to route this work differently.`,
    { matches: verdict.matches },
  );
}

// ---------------------------------------------------------------------------
// HTTP, with a timeout and a size cap
// ---------------------------------------------------------------------------

interface FetchOutcome {
  status: number;
  contentType: string | null;
  body: string;
  finalUrl: string;
  error?: string;
}

async function httpGet(url: string, headers: Record<string, string> = {}): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*', ...headers },
      redirect: 'follow',
      signal: controller.signal,
    });
    const reader = response.body?.getReader();
    let received = 0;
    const chunks: Uint8Array[] = [];
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > MAX_BODY_BYTES) {
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }
    const merged = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {
      status: response.status,
      contentType: response.headers.get('content-type'),
      body: new TextDecoder('utf-8', { fatal: false }).decode(merged),
      finalUrl: response.url || url,
    };
  } catch (error) {
    return {
      status: 0,
      contentType: null,
      body: '',
      finalUrl: url,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** The archive is the memory: when did we last ask this host anything? */
async function pace(host: string): Promise<{ waited: number } | { refused: number }> {
  const rows = await restSelect<{ fetched_at: string }>(
    'os_inst_corpus',
    `select=fetched_at&kind=eq.retrieval&url=like.*${encodeURIComponent(host)}*&order=fetched_at.desc&limit=5`,
  ).catch(() => [] as Array<{ fetched_at: string }>);
  const plan = planFetch(rows.map((row) => row.fetched_at).filter(Boolean), new Date());
  if (plan.action === 'go') return { waited: 0 };
  if (plan.action === 'wait') {
    await new Promise((resolve) => setTimeout(resolve, plan.ms));
    return { waited: plan.ms };
  }
  return { refused: plan.retryAfterMs };
}

// ---------------------------------------------------------------------------
// the tools
// ---------------------------------------------------------------------------

async function toolWebSearch(context: ToolContext, args: Record<string, unknown>) {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) return failDetail('web_search', 'bad_input', 'web_search needs a query.');
  const limit = Math.min(Number(args.limit ?? 5) || 5, MAX_RESULTS);

  const url = searchUrlFor(SEARCH_URL, query);
  const blocked = await egressGate(context, 'web_search', [
    { field: 'query', text: query },
    { field: 'url', text: url },
  ]);
  if (blocked) return blocked;

  const headers: Record<string, string> = {};
  if (SEARCH_API_KEY) headers[SEARCH_AUTH_HEADER] = `${SEARCH_AUTH_PREFIX}${SEARCH_API_KEY}`;
  const fetchedAt = new Date().toISOString();
  const outcome = await httpGet(url, headers);

  // The raw body is archived whatever happened — including a 403, which is
  // a fact about this source worth citing later.
  const parsed = outcome.status >= 200 && outcome.status < 300
    ? parseSearch(outcome.contentType, outcome.body, limit)
    : { shape: 'none' as const, hits: [] };
  const summary = parsed.hits.length > 0
    ? parsed.hits.map((hit, index) => `${index + 1}. ${hit.title}\n   ${hit.url}\n   ${hit.snippet}`).join('\n')
    : `No results parsed. HTTP ${outcome.status}${outcome.error ? ` (${outcome.error})` : ''}.`;

  const record = await archive(context, {
    kind: 'retrieval',
    title: `Search: ${query}`,
    content: `QUERY: ${query}\nENDPOINT: ${url}\nHTTP: ${outcome.status}\nSHAPE: ${parsed.shape}\n\nRESULTS\n${summary}\n\nRAW\n${capText(outcome.body, 100_000).text}`,
    url,
    httpStatus: outcome.status,
    fetchedAt,
    query,
    provenance: {
      tool: 'web_search',
      endpointTemplate: SEARCH_URL,
      keyed: Boolean(SEARCH_API_KEY),
      parsedShape: parsed.shape,
      resultCount: parsed.hits.length,
      ...(outcome.error ? { transportError: outcome.error } : {}),
    },
  });

  if (outcome.status === 0 || outcome.status >= 400) {
    return failDetail(
      'web_search',
      outcome.status === 429 ? 'rate_limited' : 'fetch_failed',
      `The search endpoint answered ${outcome.status || 'nothing'}${outcome.error ? ` (${outcome.error})` : ''}. The attempt is archived as ${record.id}; it is evidence that this source did not answer, not evidence that nothing exists.`,
      { corpusId: record.id, status: outcome.status },
    );
  }
  return {
    ok: true as const,
    tool: 'web_search' as const,
    data: { corpusId: record.id, query, shape: parsed.shape, hits: parsed.hits, citation: `[corpus:${record.id}]` },
  };
}

async function toolWebFetch(context: ToolContext, args: Record<string, unknown>, tool: ToolName = 'web_fetch') {
  const target = typeof args.url === 'string' ? args.url.trim() : '';
  if (!/^https?:\/\//i.test(target)) return failDetail(tool, 'bad_input', `${tool} needs an http(s) URL.`);
  const host = hostOf(target);
  if (!host) return failDetail(tool, 'bad_input', 'That URL does not parse.');

  const blocked = await egressGate(context, tool, [
    { field: 'url', text: target },
    ...(typeof args.query === 'string' ? [{ field: 'query' as const, text: args.query }] : []),
  ]);
  if (blocked) return blocked;

  // robots.txt first, every time. A cached "allowed" is a guess about a file
  // that may have changed; the request is cheap next to being blocked.
  const robots = await httpGet(`https://${host}/robots.txt`);
  if (robots.status === 0) {
    return failDetail(tool, 'fetch_failed', `Could not reach ${host} to read robots.txt (${robots.error ?? 'no response'}). An unreachable robots.txt is not permission.`);
  }
  if (robots.status >= 200 && robots.status < 300) {
    const path = new URL(target).pathname + new URL(target).search;
    const verdict = isAllowed(parseRobots(robots.body), USER_AGENT, path);
    if (!verdict.allowed) {
      await logEvent({
        briefId: context.brief?.id ?? null,
        kind: 'fetch.robots_disallowed',
        agentSlug: context.agent.slug,
        payload: { url: target, rule: verdict.matchedRule },
      });
      return failDetail(tool, 'robots_disallowed', `${host} disallows this path for us (${verdict.matchedRule}). Find the same material at a source that permits retrieval.`);
    }
  }

  const paced = await pace(host);
  if ('refused' in paced) {
    return failDetail(tool, 'rate_limited', `We fetched ${host} moments ago; wait ${Math.ceil(paced.refused / 1000)}s. An institution that gets itself blocked stops being able to work.`);
  }

  const fetchedAt = new Date().toISOString();
  const outcome = await httpGet(target);
  const kind = contentKindFor(outcome.contentType);
  const extracted = kind === 'html'
    ? extractHtml(outcome.body)
    : kind === 'json'
      ? capText(normaliseJsonText(outcome.body), 200_000)
      : capText(outcome.body, 200_000);

  const record = await archive(context, {
    kind: 'retrieval',
    title: extracted.title ?? `${tool === 'public_data' ? 'Data' : 'Page'}: ${target.slice(0, 200)}`,
    content: extracted.text.length > 0
      ? extracted.text
      : `[no extractable text] HTTP ${outcome.status} ${outcome.contentType ?? 'unknown content type'}${outcome.error ? ` — ${outcome.error}` : ''}`,
    url: outcome.finalUrl,
    httpStatus: outcome.status,
    fetchedAt,
    query: typeof args.query === 'string' ? args.query : null,
    provenance: {
      tool,
      requestedUrl: target,
      contentType: outcome.contentType,
      contentKind: kind,
      truncated: extracted.truncated,
      pacedMs: 'waited' in paced ? paced.waited : 0,
      ...(outcome.error ? { transportError: outcome.error } : {}),
    },
  });

  if (outcome.status === 0 || outcome.status >= 400) {
    return failDetail(tool, 'fetch_failed', `${target} answered ${outcome.status || 'nothing'}${outcome.error ? ` (${outcome.error})` : ''}. Archived as ${record.id} with its status — report the failure, do not substitute another source silently.`, { corpusId: record.id, status: outcome.status });
  }
  return {
    ok: true as const,
    tool,
    data: {
      corpusId: record.id,
      url: outcome.finalUrl,
      status: outcome.status,
      contentKind: kind,
      title: extracted.title,
      truncated: extracted.truncated,
      text: extracted.text.slice(0, 40_000),
      citation: `[corpus:${record.id}]`,
    },
  };
}

async function toolMethodology(context: ToolContext, args: Record<string, unknown>) {
  const problem = typeof args.problem === 'string' ? args.problem.trim() : '';
  const note = typeof args.note === 'string' ? args.note : '';
  const sources = Array.isArray(args.sources) ? args.sources.filter((id): id is string => typeof id === 'string') : [];
  if (!problem) return failDetail('methodology_research', 'bad_input', 'methodology_research needs the problem the method is for.');
  if (note.trim().length < 200) {
    return failDetail('methodology_research', 'provenance', 'A methodology note states the standard approach, its assumptions, the known critiques and the failure modes. Under 200 characters it states none of them — this is the capability that separates a think tank from a search wrapper.');
  }
  const blocked = await egressGate(context, 'methodology_research', [
    { field: 'query', text: problem },
    { field: 'body', text: note },
  ]);
  if (blocked) return blocked;

  const cited = sources.length > 0
    ? await restSelect<CorpusRow>('os_inst_corpus', `select=*&id=in.(${sources.join(',')})`)
    : [];
  if (cited.length !== sources.length) {
    return failDetail('methodology_research', 'not_found', 'A methodology note cites archived records; at least one id does not resolve.');
  }
  const record = await archive(context, {
    kind: 'methodology',
    title: `Method: ${problem.slice(0, 200)}`,
    content: note,
    query: problem,
    provenance: { tool: 'methodology_research', problem },
    derivedFrom: sources,
    sourceClasses: cited.map((row) => row.data_class),
  });
  return { ok: true as const, tool: 'methodology_research' as const, data: { corpusId: record.id, citation: `[corpus:${record.id}]` } };
}

async function toolExecute(context: ToolContext, args: Record<string, unknown>) {
  const script = typeof args.script === 'string' ? args.script : '';
  if (!script.trim()) return failDetail('execute', 'bad_input', 'execute needs a script.');
  const seed = Number.isFinite(Number(args.seed)) ? Number(args.seed) : 1;
  const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : 'Execution';

  // Inputs are corpus-addressed (B-7): { name: corpusId }. Each record is
  // read, its hash RE-VERIFIED against its content, and only then parsed.
  const inputSpec = (args.inputs ?? {}) as Record<string, unknown>;
  const names = Object.keys(inputSpec);
  const ids = names.map((name) => inputSpec[name]).filter((id): id is string => typeof id === 'string');
  if (ids.length !== names.length) {
    return failDetail('execute', 'bad_input', 'Every input is a corpus record id — B-7: a dataset is a record with a hash, not an inline paste.');
  }
  const rows = ids.length > 0
    ? await restSelect<CorpusRow>('os_inst_corpus', `select=*&id=in.(${ids.join(',')})`)
    : [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const inputs: Record<string, unknown> = {};
  const inputHashes: Record<string, string> = {};
  for (const name of names) {
    const id = inputSpec[name] as string;
    const row = byId.get(id);
    if (!row) return failDetail('execute', 'not_found', `Input ${name} names corpus record ${id}, which does not exist.`);
    const actual = await sha256Hex(row.content);
    if (actual !== row.content_hash) {
      return failDetail('execute', 'hash_mismatch', `Corpus record ${id} does not match its stored hash. It is not usable as an input; report it rather than working around it.`);
    }
    inputHashes[name] = row.content_hash;
    inputs[name] = parseInput(row.content);
  }

  const outcome = runSandbox({ script, inputs: inputs as never, seed });
  if (!outcome.ok) {
    return failDetail('execute', outcome.kind === 'limit' ? 'timeout' : 'script_error', outcome.error, {
      kind: outcome.kind,
      logs: outcome.logs,
      steps: outcome.steps,
    });
  }

  const sourceClasses = rows.map((row) => row.data_class);
  const record = await archive(context, {
    kind: 'execution',
    title,
    content: [
      `RESULT\n${JSON.stringify(outcome.value, null, 2)}`,
      outcome.logs.length > 0 ? `\nNOTES\n${outcome.logs.join('\n')}` : '',
      `\nSCRIPT\n${script}`,
      `\nINPUTS\n${names.map((name) => `${name} = ${inputSpec[name]} (sha256 ${inputHashes[name]})`).join('\n') || '(none)'}`,
    ].join('\n'),
    provenance: {
      tool: 'execute',
      script,
      inputHashes,
      inputIds: inputSpec,
      stdlibVersion: STDLIB_VERSION,
      runtimeMs: outcome.runtimeMs,
      steps: outcome.steps,
      seed: outcome.seed,
      sandbox: 'institution-sandbox (no network, no filesystem, no host bindings)',
    },
    derivedFrom: ids,
    sourceClasses,
  });
  return {
    ok: true as const,
    tool: 'execute' as const,
    data: {
      corpusId: record.id,
      value: outcome.value,
      logs: outcome.logs,
      runtimeMs: outcome.runtimeMs,
      steps: outcome.steps,
      seed: outcome.seed,
      stdlibVersion: outcome.stdlibVersion,
      citation: `[corpus:${record.id}]`,
    },
  };
}

/** CSV and JSON records become data; everything else reaches the script as text. */
function parseInput(content: string): unknown {
  const trimmed = content.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through to CSV / text
    }
  }
  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length > 1 && lines[0].includes(',')) {
    const header = splitCsv(lines[0]);
    const rows = lines.slice(1).map((line) => {
      const cells = splitCsv(line);
      const row: Record<string, unknown> = {};
      header.forEach((name, index) => {
        const cell = cells[index] ?? '';
        const asNumber = Number(cell.replace(/[  ]/g, ''));
        row[name] = cell !== '' && Number.isFinite(asNumber) ? asNumber : cell;
      });
      return row;
    });
    return rows;
  }
  return content;
}

function splitCsv(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i += 1; continue; }
      if (ch === '"') { quoted = false; continue; }
      current += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { cells.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

async function toolSynthesize(context: ToolContext, args: Record<string, unknown>) {
  const draft = typeof args.draft === 'string' ? args.draft : '';
  const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : 'Output';
  const extra = Array.isArray(args.records) ? args.records.filter((id): id is string => typeof id === 'string') : [];
  const dryRun = args.dryRun === true;

  // Everything this brief has archived is in scope for resolving citations;
  // the gate then narrows the allowed figures to the records actually cited.
  const scope = context.brief
    ? await restSelect<CorpusRow>('os_inst_corpus', `select=id,content,data_class&brief_id=eq.${context.brief.id}&limit=500`)
    : [];
  const extras = extra.length > 0
    ? await restSelect<CorpusRow>('os_inst_corpus', `select=id,content,data_class&id=in.(${extra.join(',')})`)
    : [];
  const pool = [...scope, ...extras.filter((row) => !scope.some((existing) => existing.id === row.id))];

  const check = checkSynthesis(draft, pool.map((row) => ({ id: row.id, content: row.content })));
  if (!check.ok) {
    return failDetail(
      'synthesize',
      check.problems.some((problem) => problem.kind === 'number') ? 'g_number' : 'provenance',
      `This draft does not leave the institution: ${check.problems.length} problem(s). ${check.problems.slice(0, 5).map((problem) => `${problem.kind}: ${problem.detail}`).join('; ')}`,
      { problems: check.problems.slice(0, 40) },
    );
  }
  if (dryRun) {
    return { ok: true as const, tool: 'synthesize' as const, data: { dryRun: true, citedIds: check.citedIds, assumptions: check.assumptions } };
  }
  const citedRows = pool.filter((row) => check.citedIds.includes(row.id.toLowerCase()) || check.citedIds.includes(row.id));
  const record = await archive(context, {
    kind: 'output',
    title,
    content: draft,
    provenance: { tool: 'synthesize', citations: check.citedIds, assumptions: check.assumptions },
    derivedFrom: check.citedIds,
    sourceClasses: citedRows.map((row) => row.data_class),
  });
  return {
    ok: true as const,
    tool: 'synthesize' as const,
    data: { corpusId: record.id, citedIds: check.citedIds, assumptions: check.assumptions, citation: `[corpus:${record.id}]` },
  };
}

async function toolCorpusGet(context: ToolContext, args: Record<string, unknown>) {
  const id = typeof args.id === 'string' ? args.id : '';
  if (!id) return failDetail('corpus_get', 'bad_input', 'corpus_get needs a record id.');
  const rows = await restSelect<CorpusRow>('os_inst_corpus', `select=*&id=eq.${id}`);
  if (rows.length === 0) return failDetail('corpus_get', 'not_found', `No corpus record ${id}.`);
  const row = rows[0];
  if (row.data_class === 'internal' && context.agent.dataClass !== 'internal') {
    return failDetail('corpus_get', 'lane', `Record ${id} is internal and ${context.agent.slug} is a public-lane agent.`);
  }
  const verified = (await sha256Hex(row.content)) === row.content_hash;
  return { ok: true as const, tool: 'corpus_get' as const, data: { ...toRecord(row), hashVerified: verified } };
}

async function toolCorpusSearch(context: ToolContext, args: Record<string, unknown>) {
  const term = typeof args.q === 'string' ? args.q.trim() : '';
  const kind = typeof args.kind === 'string' ? args.kind : '';
  const limit = Math.min(Number(args.limit ?? 20) || 20, 100);
  const filters = [
    'select=id,kind,title,data_class,url,fetched_at,review_status,created_at',
    `limit=${limit}`,
    'order=created_at.desc',
  ];
  if (context.brief && args.allBriefs !== true) filters.push(`brief_id=eq.${context.brief.id}`);
  if (kind) filters.push(`kind=eq.${kind}`);
  if (term) filters.push(`or=(title.ilike.*${encodeURIComponent(term)}*,content.ilike.*${encodeURIComponent(term)}*)`);
  if (context.agent.dataClass !== 'internal') filters.push('data_class=eq.public');
  const rows = await restSelect<CorpusRow>('os_inst_corpus', filters.join('&'));
  return { ok: true as const, tool: 'corpus_search' as const, data: { records: rows.map((row) => ({ id: row.id, kind: row.kind, title: row.title, dataClass: row.data_class, url: row.url, fetchedAt: row.fetched_at, reviewStatus: row.review_status })) } };
}

// ---------------------------------------------------------------------------
// context assembly — who is calling and what internal content is in scope
// ---------------------------------------------------------------------------

interface AgentRow {
  id: string;
  slug: string;
  data_class: DataClass;
}
interface BriefRow {
  id: string;
  data_class: DataClass;
}

async function assembleContext(body: Record<string, unknown>): Promise<ToolContext> {
  const agentSlug = typeof body.agentSlug === 'string' ? body.agentSlug : '';
  if (!agentSlug) throw new ContextError('No agentSlug supplied — a tool call is made by a named agent.');
  const agents = await restSelect<AgentRow>('os_lab_agents', `select=id,slug,data_class&slug=eq.${encodeURIComponent(agentSlug)}`);
  if (agents.length === 0) throw new ContextError(`No agent ${agentSlug}.`);
  const agent = agents[0];

  let brief: BriefRow | null = null;
  if (typeof body.briefId === 'string' && body.briefId) {
    const briefs = await restSelect<BriefRow>('os_inst_briefs', `select=id,data_class&id=eq.${body.briefId}`);
    if (briefs.length === 0) throw new ContextError(`No brief ${body.briefId}.`);
    brief = briefs[0];
  }

  // The internal haystack: every internal corpus record of this brief, plus
  // whatever the caller declares. Assembled here rather than trusted from
  // the caller, so a stepper that forgets to pass context does not thereby
  // switch the egress check off.
  const internal: string[] = [];
  if (agent.data_class === 'internal' && brief) {
    const rows = await restSelect<{ content: string }>(
      'os_inst_corpus',
      `select=content&brief_id=eq.${brief.id}&data_class=eq.internal&limit=200`,
    );
    for (const row of rows) internal.push(row.content);
  }
  if (Array.isArray(body.internalContext)) {
    for (const entry of body.internalContext) if (typeof entry === 'string') internal.push(entry);
  }

  return buildContext({
    agent: { id: agent.id, slug: agent.slug, dataClass: agent.data_class },
    brief: brief ? { id: brief.id, dataClass: brief.data_class } : null,
    assignmentId: typeof body.assignmentId === 'string' ? body.assignmentId : null,
    runId: typeof body.runId === 'string' ? body.runId : null,
    internalContext: agent.data_class === 'internal' ? internal : [],
  });
}

// ---------------------------------------------------------------------------
// the self-test — the deployed code refusing things, in production
// ---------------------------------------------------------------------------
//
// WHY IT EXISTS. Every tool call is behind the director's x-app-key, which
// no automated process holds and none should. That would leave the
// DEPLOYED artefact verified only by the test suite that runs against the
// repo copy — the exact gap between "a gate that runs" and "a gate that is
// merely mentioned" that migration 20260827000089 shipped to production.
//
// So the open capability probe answers `?selftest=1` by ATTEMPTING the
// violations against the code that is actually running: a script calling
// fetch, a script reaching for the service-role key, an internal figure in
// an outbound query, an unattributed claim in a draft. Every case is
// synthetic — it reads no row, writes no row, makes no request, and touches
// no secret — so this discloses nothing the GET probe did not already, and
// a deployment whose guards did not load says so out loud.

interface SelfTestCase {
  name: string;
  expected: string;
  passed: boolean;
  detail: string;
}

function selfTest(): { ok: boolean; passed: number; failed: number; cases: SelfTestCase[] } {
  const cases: SelfTestCase[] = [];
  const record = (name: string, expected: string, passed: boolean, detail: string) =>
    cases.push({ name, expected, passed, detail: detail.slice(0, 240) });

  // B-7: the sandbox has no network and no host bindings.
  for (const [name, script] of [
    ['sandbox refuses fetch', 'return fetch("https://example.org")'],
    ['sandbox refuses Deno.env', 'return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")'],
    ['sandbox refuses eval', 'return eval("1+1")'],
    ['sandbox refuses globalThis', 'return globalThis'],
  ] as const) {
    const outcome = runSandbox({ script, inputs: {}, seed: 1 });
    record(name, 'refused: no such function or name', !outcome.ok, outcome.ok ? `PERMITTED, returned ${JSON.stringify(outcome.value)}` : outcome.error);
  }

  // ...and still computes, deterministically.
  const arithmetic = runSandbox({ script: 'return round(cagr(100, 118, 4) * 100, 2)', inputs: {}, seed: 1 });
  record('sandbox computes', '4.22', arithmetic.ok && arithmetic.value === 4.22, arithmetic.ok ? String(arithmetic.value) : arithmetic.error);

  // B-4: an internal figure in an outbound query is blocked. Synthetic
  // figures, invented here; no row is read.
  const index = indexInternal(['Synthetic internal line: the figure is 8.675.309.000 and the yield is 61,45%.']);
  const leak = checkEgress(['market benchmark 8.675.309.000 poultry'], index);
  record('egress blocks an internal figure', 'blocked', leak.blocked, JSON.stringify(leak.matches));
  const leakEncoded = checkEgress(['https://example.org/s?q=8.675.309.000%20benchmark'], index);
  record('egress blocks a percent-encoded figure', 'blocked', leakEncoded.blocked, JSON.stringify(leakEncoded.matches));
  const clean = checkEgress(['indonesia poultry processing capacity 2024'], index);
  record('egress passes a public query', 'not blocked', !clean.blocked, JSON.stringify(clean.matches));

  // B-8 / G-NUMBER: a draft that cites nothing does not leave.
  const record_id = '00000000-0000-4000-8000-000000000001';
  const pool = [{ id: record_id, content: 'The register lists 412 processors in 2023.' }];
  const unattributed = checkSynthesis('Demand grew strongly across the sector last year.', pool);
  record('synthesis refuses an unattributed claim', 'refused', !unattributed.ok, JSON.stringify(unattributed.problems.map((p) => p.kind)));
  const invented = checkSynthesis(`There are 9137 processors [corpus:${record_id}].`, pool);
  record('synthesis refuses a figure no cited record contains', 'refused', !invented.ok, JSON.stringify(invented.problems.map((p) => p.kind)));
  const tagged = checkSynthesis(`There are 9137 processors [C] [corpus:${record_id}].`, pool);
  record('synthesis refuses a self-minted [C] tag', 'refused', !tagged.ok, JSON.stringify(tagged.problems.map((p) => p.kind)));
  const good = checkSynthesis(`There are 412 processors [corpus:${record_id}].`, pool);
  record('synthesis accepts a cited claim', 'accepted', good.ok, JSON.stringify(good.problems));

  // robots.txt is read, not assumed.
  const robots = parseRobots('User-agent: *\nDisallow: /private/');
  record('robots disallows what it disallows', 'not allowed', !isAllowed(robots, USER_AGENT, '/private/x').allowed, JSON.stringify(isAllowed(robots, USER_AGENT, '/private/x')));

  const failed = cases.filter((entry) => !entry.passed).length;
  return { ok: failed === 0, passed: cases.length - failed, failed, cases };
}

function capabilities() {
  return {
    configured: Boolean(SUPABASE_URL && SERVICE_ROLE_KEY),
    toolLayer: TOOL_LAYER_VERSION,
    tools: ['web_search', 'web_fetch', 'public_data', 'methodology_research', 'execute', 'synthesize', 'corpus_get', 'corpus_search'],
    search: { configured: true, keyed: Boolean(SEARCH_API_KEY), endpoint: SEARCH_URL.replace(/\?.*$/, '?…') },
    sandbox: { version: STDLIB_VERSION, network: false, functions: STDLIB_NAMES },
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method === 'GET') {
    // ?selftest=1 attempts the violations against the running code. No row,
    // no request, no secret — see selfTest().
    if (new URL(request.url).searchParams.get('selftest') === '1') {
      const result = selfTest();
      return json({ ...capabilities(), selfTest: result }, result.ok ? 200 : 500);
    }
    return json(capabilities());
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const auth = await checkAppKey(request);
  if (!auth.ok) {
    return json({ error: auth.reason, ...(auth.retryAfter ? { retryAfter: auth.retryAfter } : {}) }, auth.status);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: 'Function is not configured' }, 500);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }

  const tool = typeof body.tool === 'string' ? (body.tool as ToolName) : null;
  if (!tool) return json({ error: 'No tool named. Call GET for the tool list.' }, 400);

  let context: ToolContext;
  try {
    context = await assembleContext(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ ok: false, tool, code: error instanceof ContextError ? 'lane' : 'bad_input', error: message }, 400);
  }

  const args = (body.args ?? {}) as Record<string, unknown>;
  try {
    switch (tool) {
      case 'web_search': return json(await toolWebSearch(context, args));
      case 'web_fetch': return json(await toolWebFetch(context, args));
      case 'public_data': return json(await toolWebFetch(context, args, 'public_data'));
      case 'methodology_research': return json(await toolMethodology(context, args));
      case 'execute': return json(await toolExecute(context, args));
      case 'synthesize': return json(await toolSynthesize(context, args));
      case 'corpus_get': return json(await toolCorpusGet(context, args));
      case 'corpus_search': return json(await toolCorpusSearch(context, args));
      default: return json({ error: `Unknown tool ${tool}` }, 400);
    }
  } catch (error) {
    // Guard messages are the useful part of a refusal; provider bodies and
    // prompts never reach here.
    return json({ ok: false, tool, code: 'bad_input', error: error instanceof Error ? error.message : 'Tool call failed.' }, 500);
  }
});
