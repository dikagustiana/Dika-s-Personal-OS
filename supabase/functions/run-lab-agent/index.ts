// Runs one lab agent against its provider and streams the completion.
//
// THE ONE FUNCTION THAT WRITES LAB ROWS — a deliberate, stated departure from
// the research functions' "writes NOTHING" rule, and the whole reason Lab
// exists: the run log is the observability deliverable, and a log written by
// the browser dies with the tab. This function writes to EXACTLY TWO TABLES,
// os_lab_runs and os_lab_artifacts, under the service role, and touches
// nothing else — no research table, no finish-line table, no agent row. Keep
// this paragraph greppable and true; the stale write-scope comment on
// run-research-council is the cautionary tale.
//
// THE DATA BOUNDARY, LAYER 2 OF 3. Internal agents' input is internal SAMB
// data and may only ever reach Anthropic models. The database triggers
// (20260817000074) are layer 1 and bind even this function's service role;
// this function re-validates before dispatch and REFUSES — it never falls
// back to a permitted provider, because a silent downgrade hides the bug.
// The refusal is itself written to the run log (status='error'), recorded
// against the agent's Anthropic default since a row naming the refused
// provider cannot exist by construction. The UI's disabled selector is
// layer 3. No flag, env var, or mode relaxes any layer.
//
// TWO ADAPTERS, ONE INTERFACE. `anthropic` speaks /v1/messages, `openai`
// speaks /chat/completions; DeepSeek and Kimi are both the second kind —
// same code, different base_url and model, both read from os_lab_providers.
// Both adapters stream and normalise to { text, tokensIn, tokensOut }.
//
// COST IS COMPUTED HERE, AT RUN TIME, from the provider row's rate columns.
// No price exists anywhere in code; a rate change is a row edit.
//
// STREAMING vs PERSISTENCE — the part that is easy to get subtly wrong. The
// run row is the source of truth and the SSE stream is only transport. The
// row is written BEFORE dispatch (status='running'), so a crashed process
// leaves an inspectable running row rather than nothing; the terminal write
// (ok/error, tokens, cost, duration) happens exactly once, guarded by a
// flag, whether the stream ends, the provider fails mid-flight, or the
// client disconnects. On disconnect the runtime would normally reclaim the
// worker before the PATCH lands — EdgeRuntime.waitUntil is what holds it
// open. An aborted run is status='error' with the partial output preserved,
// because "the tab closed" and "the model finished" must never be the same
// row.

import { checkAppKey } from '../_shared/appKeyAuth.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

/**
 * Per-provider API keys, by provider NAME (the constrained column). Kimi
 * falls back to RESEARCH_MODEL_API_KEY: it is the same Moonshot account the
 * research console already uses, and requiring a duplicate secret for the
 * same credential is how two copies drift.
 */
function keyFor(providerName: string): string {
  const dedicated = Deno.env.get(`LAB_${providerName.toUpperCase()}_API_KEY`) ?? '';
  if (dedicated) return dedicated;
  if (providerName === 'kimi') return Deno.env.get('RESEARCH_MODEL_API_KEY') ?? '';
  return '';
}

/** Hard ceiling per call. An env var, not a constant: a property of the account. */
const MAX_TOKENS = Number(Deno.env.get('LAB_MODEL_MAX_TOKENS') ?? '8000');
/** Input caps, per the council's precedent — reject before anything is billed. */
const MAX_INPUT_CHARS = 200_000;
const MAX_SYSTEM_CHARS = 100_000;
const MAX_ARTIFACT_BYTES = 2_000_000;
const BUCKET = 'lab-artifacts';

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

// ---------------------------------------------------------------------------
// service-role PostgREST access — the only write path in the lab subsystem
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
    // The boundary trigger's message is the useful part of a refused insert;
    // PostgREST carries it in `message`. Everything else is kept terse.
    throw new Error(payload?.message ?? `insert into ${table} failed (${response.status})`);
  }
  return (Array.isArray(payload) ? payload[0] : payload) as T;
}

async function restUpdate(table: string, id: string, patch: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(patch),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message ?? `update ${table} failed (${response.status})`);
  }
}

async function restSelect<T>(table: string, query: string): Promise<T[]> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  if (!response.ok) throw new Error(`read ${table} failed (${response.status})`);
  return (await response.json()) as T[];
}

interface ProviderRow {
  id: string;
  name: string;
  adapter: 'anthropic' | 'openai';
  base_url: string;
  model: string;
  cost_in_per_mtok: number;
  cost_out_per_mtok: number;
  is_active: boolean;
}

interface AgentRow {
  id: string;
  slug: string;
  name: string;
  system_prompt: string;
  data_class: 'internal' | 'public';
  default_provider_id: string | null;
  is_active: boolean;
}

// ---------------------------------------------------------------------------
// the boundary, layer 2
// ---------------------------------------------------------------------------

/**
 * Typed so the run handler can tell a boundary refusal from an ordinary
 * failure: a refusal is logged as an error run and answered 403; it is
 * NEVER retried on another provider.
 */
class LabBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LabBoundaryError';
  }
}

function assertBoundary(agent: AgentRow, provider: ProviderRow): void {
  if (agent.data_class === 'internal' && provider.name !== 'anthropic') {
    throw new LabBoundaryError(
      `lab boundary: agent ${agent.slug} is internal and ${provider.name} is not Anthropic. ` +
        'Internal SAMB data is processed by Anthropic models only — no fallback, no override.',
    );
  }
}

// ---------------------------------------------------------------------------
// adapters: two wire formats, one result shape
// ---------------------------------------------------------------------------

interface AdapterResult {
  text: string;
  tokensIn: number | null;
  tokensOut: number | null;
}

interface AdapterInput {
  provider: ProviderRow;
  apiKey: string;
  system: string;
  input: string;
  signal: AbortSignal;
  onDelta: (delta: string) => void;
}

/**
 * Reads a provider SSE body and hands each `data:` payload to the caller.
 * Both wire formats are SSE with JSON data lines; only the payloads differ.
 */
async function readSse(
  body: ReadableStream<Uint8Array>,
  onData: (payload: unknown) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        onData(JSON.parse(data));
      } catch {
        // A malformed frame is dropped rather than aborting the run: the
        // terminal usage frame is what accounting needs, and both providers
        // send it last and well-formed or fail the whole request.
      }
    }
  }
}

/** Anthropic /v1/messages, streaming. */
async function anthropicAdapter(args: AdapterInput): Promise<AdapterResult> {
  const response = await fetch(`${args.provider.base_url}/v1/messages`, {
    method: 'POST',
    signal: args.signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': args.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: args.provider.model,
      max_tokens: MAX_TOKENS,
      system: args.system,
      messages: [{ role: 'user', content: args.input }],
      stream: true,
    }),
  });
  if (!response.ok || !response.body) {
    // Never echo the provider's body verbatim: it can contain the key.
    await response.body?.cancel();
    throw new Error(`Model call failed (${response.status}).`);
  }
  let text = '';
  let tokensIn: number | null = null;
  let tokensOut: number | null = null;
  await readSse(response.body, (payload) => {
    const frame = payload as {
      type?: string;
      message?: { usage?: { input_tokens?: number } };
      delta?: { text?: string };
      usage?: { output_tokens?: number };
    };
    if (frame.type === 'message_start') {
      tokensIn = frame.message?.usage?.input_tokens ?? null;
    } else if (frame.type === 'content_block_delta' && typeof frame.delta?.text === 'string') {
      text += frame.delta.text;
      args.onDelta(frame.delta.text);
    } else if (frame.type === 'message_delta') {
      tokensOut = frame.usage?.output_tokens ?? tokensOut;
    }
  });
  return { text, tokensIn, tokensOut };
}

/** OpenAI-compatible /chat/completions, streaming. DeepSeek and Kimi both. */
async function openaiAdapter(args: AdapterInput): Promise<AdapterResult> {
  const response = await fetch(`${args.provider.base_url}/chat/completions`, {
    method: 'POST',
    signal: args.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify({
      model: args.provider.model,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: args.system },
        { role: 'user', content: args.input },
      ],
      stream: true,
      // Without this both providers omit usage from the stream and the run
      // log would show blank tokens — accounting is the log's whole job.
      stream_options: { include_usage: true },
    }),
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`Model call failed (${response.status}).`);
  }
  let text = '';
  let tokensIn: number | null = null;
  let tokensOut: number | null = null;
  await readSse(response.body, (payload) => {
    const frame = payload as {
      choices?: Array<{ delta?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
    };
    const delta = frame.choices?.[0]?.delta?.content;
    if (typeof delta === 'string' && delta) {
      text += delta;
      args.onDelta(delta);
    }
    if (frame.usage) {
      tokensIn = frame.usage.prompt_tokens ?? tokensIn;
      tokensOut = frame.usage.completion_tokens ?? tokensOut;
    }
  });
  return { text, tokensIn, tokensOut };
}

const ADAPTERS: Record<ProviderRow['adapter'], (args: AdapterInput) => Promise<AdapterResult>> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
};

/** USD, from the row's rates. numeric comes back from PostgREST as a JSON number. */
function costUsd(provider: ProviderRow, tokensIn: number | null, tokensOut: number | null): number | null {
  if (tokensIn === null && tokensOut === null) return null;
  const input = ((tokensIn ?? 0) * Number(provider.cost_in_per_mtok)) / 1_000_000;
  const output = ((tokensOut ?? 0) * Number(provider.cost_out_per_mtok)) / 1_000_000;
  return Math.round((input + output) * 1_000_000) / 1_000_000;
}

// ---------------------------------------------------------------------------
// the run action
// ---------------------------------------------------------------------------

interface RunBody {
  agentSlug: string;
  input: string;
  /** Provider NAME override; absent means the agent's default. */
  provider?: string;
  chainId?: string;
  stepIndex?: number;
  parentRunId?: string;
  confirmed: boolean;
}

async function handleRun(body: RunBody): Promise<Response> {
  const agents = await restSelect<AgentRow>(
    'os_lab_agents',
    `slug=eq.${encodeURIComponent(body.agentSlug)}&limit=1`,
  );
  const agent = agents[0];
  if (!agent) return json({ error: `No agent with slug ${body.agentSlug}` }, 404);
  if (!agent.is_active) return json({ error: `Agent ${agent.slug} is inactive` }, 409);

  // Resolve the provider: an explicit name, else the agent's default. No
  // resolution means nothing to dispatch to — a 409 the client can explain.
  let provider: ProviderRow | undefined;
  if (body.provider) {
    provider = (
      await restSelect<ProviderRow>(
        'os_lab_providers',
        `name=eq.${encodeURIComponent(body.provider)}&limit=1`,
      )
    )[0];
    if (!provider) return json({ error: `No provider named ${body.provider}` }, 404);
  } else if (agent.default_provider_id) {
    provider = (
      await restSelect<ProviderRow>('os_lab_providers', `id=eq.${agent.default_provider_id}&limit=1`)
    )[0];
  }
  if (!provider) {
    return json({ error: `Agent ${agent.slug} has no default provider — pick one.` }, 409);
  }
  if (!provider.is_active) return json({ error: `Provider ${provider.name} is inactive` }, 409);

  // LAYER 2. A violation is refused AND logged — recorded against the
  // agent's Anthropic default, because a runs row naming the refused
  // provider cannot exist (layer 1 refuses the insert), and a refusal that
  // leaves no trace in the log is how the next person re-attempts it.
  try {
    assertBoundary(agent, provider);
  } catch (error) {
    if (error instanceof LabBoundaryError) {
      let refusalRunId: string | null = null;
      if (agent.default_provider_id) {
        try {
          const refusal = await restInsert<{ id: string }>('os_lab_runs', {
            agent_id: agent.id,
            provider_id: agent.default_provider_id,
            parent_run_id: body.parentRunId ?? null,
            chain_id: body.chainId ?? null,
            step_index: body.stepIndex ?? null,
            input: body.input,
            status: 'error',
            error: error.message,
          });
          refusalRunId = refusal.id;
        } catch {
          // The refusal still refuses; it is merely unlogged. Never let a
          // logging failure turn into a dispatch.
        }
      }
      return json({ error: error.message, runId: refusalRunId }, 403);
    }
    throw error;
  }

  const apiKey = keyFor(provider.name);
  if (!apiKey) {
    // Unconfigured is a normal state, not an error — same posture as the
    // research functions. Nothing is billed and nothing is logged.
    return json({
      configured: false,
      sent: false,
      reason: `No API key is configured for ${provider.name}. Set LAB_${provider.name.toUpperCase()}_API_KEY as a function secret.`,
    });
  }

  // The row goes in BEFORE dispatch. If this insert fails nothing has been
  // billed and the client gets a plain error; if the process dies after it,
  // the running row is the inspectable trace of the attempt.
  const started = Date.now();
  const run = await restInsert<{ id: string }>('os_lab_runs', {
    agent_id: agent.id,
    provider_id: provider.id,
    parent_run_id: body.parentRunId ?? null,
    chain_id: body.chainId ?? null,
    step_index: body.stepIndex ?? null,
    input: body.input,
    status: 'running',
  });

  const adapter = ADAPTERS[provider.adapter];
  const providerAbort = new AbortController();
  const encoder = new TextEncoder();
  let partial = '';
  let finalized = false;

  /**
   * Exactly one terminal write per run, whatever order the failure paths
   * fire in. Everything funnels through here; the flag is what makes an
   * abort that races completion harmless.
   */
  const finalize = async (patch: {
    status: 'ok' | 'error';
    output: string;
    error?: string;
    tokensIn?: number | null;
    tokensOut?: number | null;
  }): Promise<void> => {
    if (finalized) return;
    finalized = true;
    await restUpdate('os_lab_runs', run.id, {
      status: patch.status,
      output: patch.output,
      error: patch.error ?? null,
      tokens_in: patch.tokensIn ?? null,
      tokens_out: patch.tokensOut ?? null,
      cost_usd: costUsd(provider, patch.tokensIn ?? null, patch.tokensOut ?? null),
      duration_ms: Date.now() - started,
    }).catch(() => {
      // A failed terminal write leaves the running row — still inspectable,
      // and strictly better than throwing inside a cancelled stream.
    });
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      // First frame: the run's identity, so the client can link to the log
      // before a single token arrives.
      send('run', { runId: run.id, provider: provider.name, model: provider.model });

      const pump = (async () => {
        try {
          const result = await adapter({
            provider,
            apiKey,
            system: agent.system_prompt,
            input: body.input,
            signal: providerAbort.signal,
            onDelta: (delta) => {
              partial += delta;
              send('delta', { text: delta });
            },
          });
          await finalize({
            status: 'ok',
            output: result.text,
            tokensIn: result.tokensIn,
            tokensOut: result.tokensOut,
          });
          send('done', {
            runId: run.id,
            status: 'ok',
            tokensIn: result.tokensIn,
            tokensOut: result.tokensOut,
            costUsd: costUsd(provider, result.tokensIn, result.tokensOut),
            durationMs: Date.now() - started,
          });
          controller.close();
        } catch (error) {
          const aborted = providerAbort.signal.aborted;
          const message = aborted
            ? 'Aborted by the client mid-stream. Partial output preserved.'
            : error instanceof Error
              ? error.message
              : 'Model call failed.';
          await finalize({ status: 'error', output: partial, error: message });
          if (!aborted) {
            // The client is only still listening in the non-abort case.
            try {
              send('error', { runId: run.id, message });
              controller.close();
            } catch {
              // Controller already unusable — the row above is the record.
            }
          }
        }
      })();
      // Hold the worker open past a disconnect so the terminal write lands.
      // Without this, cancel() returns, the runtime reclaims the worker, and
      // the PATCH never fires — leaving 'running' forever on every abort.
      (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
        .EdgeRuntime?.waitUntil?.(pump);
    },
    cancel() {
      // Client went away: stop paying for tokens, then let the pump's catch
      // branch write the terminal row.
      providerAbort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      ...CORS,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  });
}

// ---------------------------------------------------------------------------
// chain abort: mark the steps that never ran
// ---------------------------------------------------------------------------

interface AbortChainBody {
  chainId: string;
  failedStepIndex: number;
  failedAgentSlug: string;
  failedRunId?: string;
  /** The steps that never dispatched, in order. */
  remaining: Array<{ agentSlug: string; stepIndex: number }>;
}

/**
 * The client sequences chain steps (one stage per call, the council's
 * precedent), so when a step fails the steps after it have no rows yet.
 * This writes their error rows — v1 surfaces failures, it never retries —
 * each naming the step that sank the chain. Rows are recorded against the
 * agent's default provider (or Anthropic when it has none): nothing was
 * dispatched, the row exists so the chain's lineage is complete in the log.
 */
async function handleAbortChain(body: AbortChainBody): Promise<Response> {
  const marked: string[] = [];
  const anthropic = (
    await restSelect<ProviderRow>('os_lab_providers', 'name=eq.anthropic&limit=1')
  )[0];
  let parent = body.failedRunId ?? null;
  for (const step of body.remaining) {
    const agent = (
      await restSelect<AgentRow>(
        'os_lab_agents',
        `slug=eq.${encodeURIComponent(step.agentSlug)}&limit=1`,
      )
    )[0];
    if (!agent) continue;
    const providerId = agent.default_provider_id ?? anthropic?.id;
    if (!providerId) continue;
    try {
      const row = await restInsert<{ id: string }>('os_lab_runs', {
        agent_id: agent.id,
        provider_id: providerId,
        parent_run_id: parent,
        chain_id: body.chainId,
        step_index: step.stepIndex,
        input: '',
        status: 'error',
        error: `Never ran: chain aborted after step ${body.failedStepIndex + 1} (${body.failedAgentSlug}) failed.`,
      });
      marked.push(row.id);
      parent = row.id;
    } catch {
      // A step that cannot be marked is skipped; the response says how many
      // were. The chain's failure is already visible on the failed step.
    }
  }
  return json({ marked: marked.length, runIds: marked });
}

// ---------------------------------------------------------------------------
// artifacts
// ---------------------------------------------------------------------------

interface SaveArtifactBody {
  runId: string;
  filename: string;
  mime: string;
  /** Text content; the run screen saves output text. */
  content: string;
}

async function handleSaveArtifact(body: SaveArtifactBody): Promise<Response> {
  const runs = await restSelect<{ id: string }>('os_lab_runs', `id=eq.${body.runId}&limit=1`);
  if (!runs[0]) return json({ error: 'No such run' }, 404);

  const bytes = new TextEncoder().encode(body.content);
  if (bytes.byteLength > MAX_ARTIFACT_BYTES) {
    return json({ error: `Artifact too large (${bytes.byteLength} bytes, max ${MAX_ARTIFACT_BYTES})` }, 400);
  }
  // The run id namespaces the path; the timestamp keeps re-saves distinct.
  const safeName = body.filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'artifact.txt';
  const storagePath = `${body.runId}/${Date.now()}-${safeName}`;

  const upload = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': body.mime || 'text/plain',
      },
      body: bytes,
    },
  );
  if (!upload.ok) {
    return json({ error: `Storage upload failed (${upload.status})` }, 502);
  }

  const artifact = await restInsert<{ id: string }>('os_lab_artifacts', {
    run_id: body.runId,
    filename: safeName,
    mime: body.mime || 'text/plain',
    storage_path: storagePath,
    size_bytes: bytes.byteLength,
  });
  return json({ id: artifact.id, storagePath, sizeBytes: bytes.byteLength });
}

async function handleArtifactUrl(body: { artifactId: string }): Promise<Response> {
  const rows = await restSelect<{ storage_path: string }>(
    'os_lab_artifacts',
    `id=eq.${body.artifactId}&limit=1`,
  );
  if (!rows[0]) return json({ error: 'No such artifact' }, 404);
  const sign = await fetch(
    `${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${rows[0].storage_path}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ expiresIn: 3600 }),
    },
  );
  const payload = await sign.json().catch(() => null);
  if (!sign.ok || !payload?.signedURL) {
    return json({ error: `Could not sign a download URL (${sign.status})` }, 502);
  }
  return json({ url: `${SUPABASE_URL}/storage/v1${payload.signedURL}` });
}

// ---------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------

/** What the client needs to render provider state: key presence only. */
function capabilities() {
  return {
    configured: Boolean(keyFor('anthropic') || keyFor('deepseek') || keyFor('kimi')),
    providers: {
      anthropic: Boolean(keyFor('anthropic')),
      deepseek: Boolean(keyFor('deepseek')),
      kimi: Boolean(keyFor('kimi')),
    },
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // GET is the capability probe the Lab screens read on mount. It stays
  // open, like the research probes: it discloses only whether keys exist.
  if (request.method === 'GET') return json(capabilities());
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // Before anything billable or any write, through the SAME rate limiter as
  // the passphrase gate — see _shared/appKeyAuth.ts.
  const auth = await checkAppKey(request);
  if (!auth.ok) {
    return json(
      { error: auth.reason, ...(auth.retryAfter ? { retryAfter: auth.retryAfter } : {}) },
      auth.status,
    );
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: 'Function is not configured' }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }

  const action = typeof body.action === 'string' ? body.action : 'run';

  try {
    if (action === 'run') {
      const input = typeof body.input === 'string' ? body.input : '';
      const agentSlug = typeof body.agentSlug === 'string' ? body.agentSlug : '';
      if (!agentSlug) return json({ error: 'No agentSlug supplied' }, 400);
      if (!input) return json({ error: 'No input supplied' }, 400);
      if (input.length > MAX_INPUT_CHARS) {
        return json({ error: `Input too large (${input.length} chars, max ${MAX_INPUT_CHARS})` }, 400);
      }
      // Every run is user-initiated and explicitly confirmed — same rule as
      // every billable send in this codebase.
      if (body.confirmed !== true) {
        return json({ error: 'Confirmation required before running.' }, 409);
      }
      return await handleRun({
        agentSlug,
        input,
        provider: typeof body.provider === 'string' && body.provider ? body.provider : undefined,
        chainId: typeof body.chainId === 'string' && body.chainId ? body.chainId : undefined,
        stepIndex: typeof body.stepIndex === 'number' ? body.stepIndex : undefined,
        parentRunId:
          typeof body.parentRunId === 'string' && body.parentRunId ? body.parentRunId : undefined,
        confirmed: true,
      });
    }
    if (action === 'abortChain') {
      const remaining = Array.isArray(body.remaining) ? body.remaining : [];
      return await handleAbortChain({
        chainId: typeof body.chainId === 'string' ? body.chainId : '',
        failedStepIndex: typeof body.failedStepIndex === 'number' ? body.failedStepIndex : -1,
        failedAgentSlug: typeof body.failedAgentSlug === 'string' ? body.failedAgentSlug : '',
        failedRunId:
          typeof body.failedRunId === 'string' && body.failedRunId ? body.failedRunId : undefined,
        remaining: remaining
          .filter(
            (step): step is { agentSlug: string; stepIndex: number } =>
              typeof (step as { agentSlug?: unknown }).agentSlug === 'string' &&
              typeof (step as { stepIndex?: unknown }).stepIndex === 'number',
          ),
      });
    }
    if (action === 'saveArtifact') {
      const content = typeof body.content === 'string' ? body.content : '';
      if (!content) return json({ error: 'No content supplied' }, 400);
      return await handleSaveArtifact({
        runId: typeof body.runId === 'string' ? body.runId : '',
        filename: typeof body.filename === 'string' ? body.filename : '',
        mime: typeof body.mime === 'string' ? body.mime : 'text/plain',
        content,
      });
    }
    if (action === 'artifactUrl') {
      return await handleArtifactUrl({
        artifactId: typeof body.artifactId === 'string' ? body.artifactId : '',
      });
    }
    return json({ error: `Unknown action ${action}` }, 400);
  } catch (error) {
    // System prompts and inputs can carry sensitive content; error text here
    // is operational (PostgREST/storage messages), never provider bodies.
    return json(
      { error: error instanceof Error ? error.message : 'Lab executor failed.' },
      500,
    );
  }
});
