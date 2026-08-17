// Runs the epistemic-layer agents and performs their SCOPED writes.
//
// THE DIVISION OF LABOUR, absolute: the model transcribes, drafts and
// proposes; THIS CODE decides. Every gate outcome here is deterministic —
// JSON validation, id-existence checks, the components-sum reconciliation,
// the number scan — and the database triggers (20260817000077) re-check the
// write scopes underneath, because this function runs as the service role
// and the rails bind it: datapoints land at IND only, references at
// abstract_only only, conflicts unresolved, contradictions open, outputs as
// drafts citing approved claims. A bug here cannot verify, approve, resolve
// or finalize anything.
//
// WRITE SCOPE OF THIS FUNCTION: os_lab_runs (audit), os_lab_tasks
// (coordinator), os_lab_datapoints (extract), os_lab_references
// (literature), os_lab_datapoint_conflicts + os_lab_claim_contradictions
// (review), os_lab_outputs + os_lab_output_claims (draft). Nothing else.
// Keep this paragraph greppable and true.
//
// Every action is owner-initiated (checkAppKey before anything billable);
// what the passphrase gates is the SPEND, not the writes — the writes stay
// keyless service-role and therefore stay inside the agent rails.
//
// Non-streaming, one action per call, the council's shape: these are
// structured extraction jobs whose value is the rows, and the run log
// carries the full text either way.

import { checkAppKey } from '../_shared/appKeyAuth.ts';
import { numberAppearsIn } from '../_shared/numberEcho.ts';
import { scanNumbers, type ScanViolation } from '../_shared/numberScan.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MAX_TOKENS = Number(Deno.env.get('LAB_MODEL_MAX_TOKENS') ?? '8000');
const MAX_INPUT_CHARS = 200_000;
/**
 * The WIP cap (review 1.9): extraction refuses while this many datapoints
 * sit unverified at IND. Extraction is the faucet; the owner's source-match
 * rate is the system's clock speed, and this is the single control that
 * prevents batch rubber-stamping. A feature, not friction.
 */
const IND_WIP_CAP = 25;
/** The review's context window (1.12) — and it must SAY when it truncates. */
const REVIEW_WINDOW = 200;

/** Same key resolution as run-lab-agent, so the two cannot drift. */
function keyFor(providerName: string): string {
  const dedicated = Deno.env.get(`LAB_${providerName.toUpperCase()}_API_KEY`) ?? '';
  if (dedicated) return dedicated;
  if (providerName === 'kimi') return Deno.env.get('RESEARCH_MODEL_API_KEY') ?? '';
  return '';
}

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

// --- service-role PostgREST helpers (same shapes as run-lab-agent) ---------

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

/** Exact row count without fetching rows — for caps and scope reporting. */
async function restCount(table: string, query: string): Promise<number> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id&${query}`, {
    method: 'HEAD',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      Prefer: 'count=exact',
    },
  });
  if (!response.ok) throw new Error(`count ${table} failed (${response.status})`);
  const total = Number((response.headers.get('content-range') ?? '').split('/')[1]);
  return Number.isFinite(total) ? total : 0;
}

interface ProviderRow {
  id: string;
  name: string;
  adapter: 'anthropic' | 'openai';
  base_url: string;
  model: string;
  cost_in_per_mtok: number | string;
  cost_out_per_mtok: number | string;
  is_active: boolean;
}

interface AgentRow {
  id: string;
  slug: string;
  system_prompt: string;
  data_class: 'internal' | 'public';
  default_provider_id: string | null;
  is_active: boolean;
}

function costUsd(provider: ProviderRow, tokensIn: number | null, tokensOut: number | null): number | null {
  if (tokensIn === null && tokensOut === null) return null;
  const input = ((tokensIn ?? 0) * Number(provider.cost_in_per_mtok)) / 1_000_000;
  const output = ((tokensOut ?? 0) * Number(provider.cost_out_per_mtok)) / 1_000_000;
  return Math.round((input + output) * 1_000_000) / 1_000_000;
}

// --- one model call, non-streaming, both adapters ---------------------------

interface Completion {
  text: string;
  tokensIn: number | null;
  tokensOut: number | null;
}

async function complete(
  provider: ProviderRow,
  apiKey: string,
  system: string,
  input: string,
): Promise<Completion> {
  if (provider.adapter === 'anthropic') {
    const response = await fetch(`${provider.base_url}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: MAX_TOKENS,
        system,
        messages: [{ role: 'user', content: input }],
      }),
    });
    if (!response.ok) {
      // Never echo the provider's body verbatim: it can contain the key.
      await response.body?.cancel();
      throw new Error(`Model call failed (${response.status}).`);
    }
    const payload = await response.json();
    const text = Array.isArray(payload?.content)
      ? payload.content
          .map((block: { type?: string; text?: string }) =>
            block?.type === 'text' ? (block.text ?? '') : '',
          )
          .join('')
      : '';
    return {
      text,
      tokensIn: payload?.usage?.input_tokens ?? null,
      tokensOut: payload?.usage?.output_tokens ?? null,
    };
  }
  const response = await fetch(`${provider.base_url}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: input },
      ],
    }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Model call failed (${response.status}).`);
  }
  const payload = await response.json();
  return {
    text: payload?.choices?.[0]?.message?.content ?? '',
    tokensIn: payload?.usage?.prompt_tokens ?? null,
    tokensOut: payload?.usage?.completion_tokens ?? null,
  };
}

/**
 * The model's answer must be one JSON object. Markdown fences and stray
 * prose around it are tolerated (the first '{' to the last '}'); anything
 * unparsable is an error carried in the run row, never a guessed write.
 */
function parseJsonObject(text: string): Record<string, unknown> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('The agent returned no JSON object.');
  return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
}

/**
 * Runs one evidence agent end to end: resolve, boundary-check, audit row,
 * model call, terminal update. Returns the parsed JSON plus the run id.
 * The boundary here is layer 2 again — layer 1 (the runs trigger) would
 * refuse the audit row itself if this check ever regressed.
 */
async function runAgent(slug: string, input: string): Promise<{ runId: string; parsed: Record<string, unknown> }> {
  const agent = (
    await restSelect<AgentRow>('os_lab_agents', `slug=eq.${encodeURIComponent(slug)}&limit=1`)
  )[0];
  if (!agent) throw new Error(`No agent with slug ${slug} — was 20260817000078 applied?`);
  if (!agent.is_active) throw new Error(`Agent ${slug} is inactive.`);
  if (!agent.default_provider_id) throw new Error(`Agent ${slug} has no default provider.`);
  const provider = (
    await restSelect<ProviderRow>('os_lab_providers', `id=eq.${agent.default_provider_id}&limit=1`)
  )[0];
  if (!provider || !provider.is_active) throw new Error(`Agent ${slug}'s provider is missing or inactive.`);
  if (agent.data_class === 'internal' && provider.name !== 'anthropic') {
    throw new Error(
      `lab boundary: agent ${slug} is internal and ${provider.name} is not Anthropic. Internal SAMB data is processed by Anthropic models only — no fallback, no override.`,
    );
  }
  const apiKey = keyFor(provider.name);
  if (!apiKey) {
    throw new Error(
      `No API key is configured for ${provider.name}. Set LAB_${provider.name.toUpperCase()}_API_KEY as a function secret.`,
    );
  }

  const started = Date.now();
  const run = await restInsert<{ id: string }>('os_lab_runs', {
    agent_id: agent.id,
    provider_id: provider.id,
    input,
    status: 'running',
    // 1.14: the RESOLVED model string, recorded at dispatch — provider
    // drift becomes visible retrospectively in the run log.
    model: provider.model,
  });

  try {
    const completion = await complete(provider, apiKey, agent.system_prompt, input);
    await restUpdate('os_lab_runs', run.id, {
      status: 'ok',
      output: completion.text,
      tokens_in: completion.tokensIn,
      tokens_out: completion.tokensOut,
      cost_usd: costUsd(provider, completion.tokensIn, completion.tokensOut),
      duration_ms: Date.now() - started,
    });
    const parsed = parseJsonObject(completion.text);
    return { runId: run.id, parsed };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Evidence agent failed.';
    await restUpdate('os_lab_runs', run.id, {
      status: 'error',
      error: message,
      duration_ms: Date.now() - started,
    }).catch(() => {
      // The running row stays inspectable if even this write fails.
    });
    throw error;
  }
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

// ---------------------------------------------------------------------------
// actions
// ---------------------------------------------------------------------------

/** COORDINATE: decompose a request into task records — its only write. */
async function handleCoordinate(body: { request: string; projectId?: string }): Promise<Response> {
  const KNOWN = new Set([
    'evidence-locator',
    'evidence-extractor',
    'evidence-literature',
    'evidence-reviewer',
    'evidence-drafter',
  ]);
  const { runId, parsed } = await runAgent('evidence-coordinator', body.request);
  const rawTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  const created: Array<{ id: string; title: string; agentSlug: string }> = [];
  const skipped: string[] = [];
  for (const raw of rawTasks) {
    const title = str((raw as { title?: unknown }).title).trim();
    const agentSlug = str((raw as { agentSlug?: unknown }).agentSlug).trim();
    const input = str((raw as { input?: unknown }).input);
    if (!title || !KNOWN.has(agentSlug)) {
      skipped.push(`"${title || '(untitled)'}" → ${agentSlug || '(no agent)'} — not a known evidence agent`);
      continue;
    }
    const task = await restInsert<{ id: string }>('os_lab_tasks', {
      project_id: body.projectId ?? null,
      title,
      agent_slug: agentSlug,
      input,
      run_id: runId,
    });
    created.push({ id: task.id, title, agentSlug });
  }
  return json({ runId, plan: str(parsed.plan), tasks: created, skipped });
}

/** LOCATE: stage 1 — locators only, recorded in the run log, no table writes. */
async function handleLocate(body: { quantity: string; documentText: string }): Promise<Response> {
  const { runId, parsed } = await runAgent(
    'evidence-locator',
    `QUANTITY SOUGHT:\n${body.quantity}\n\nDOCUMENT:\n${body.documentText}`,
  );
  const locators = (Array.isArray(parsed.locators) ? parsed.locators : [])
    .map((raw) => ({
      locator: str((raw as { locator?: unknown }).locator),
      quantity: str((raw as { quantity?: unknown }).quantity),
      note: str((raw as { note?: unknown }).note),
    }))
    .filter((entry) => entry.locator);
  return json({ runId, locators });
}

/** EXTRACT: stage 2 — datapoints at IND, stage 3 reconciliation in code. */
async function handleExtract(body: {
  sourceDocumentId: string;
  selectedText: string;
  quantity: string;
}): Promise<Response> {
  const source = (
    await restSelect<{ id: string }>('os_lab_source_documents', `id=eq.${body.sourceDocumentId}&limit=1`)
  )[0];
  if (!source) return json({ error: 'No such source document — ingest it (with its snapshot) first.' }, 404);

  // 1.9: the WIP cap, BEFORE anything is billed. Extraction refuses while
  // the unverified backlog is at the cap — the owner's source-match rate is
  // the clock speed, and a growing IND pile is the batch-rubber-stamp setup.
  const openInd = await restCount('os_lab_datapoints', 'status=eq.IND');
  if (openInd >= IND_WIP_CAP) {
    return json(
      {
        error: `WIP cap: ${openInd} datapoints are already open at IND (cap ${IND_WIP_CAP}). Extraction is refused until some are source-matched or marked NA — verification is the way forward, not more extraction.`,
      },
      409,
    );
  }

  const { runId, parsed } = await runAgent(
    'evidence-extractor',
    `QUANTITY SOUGHT:\n${body.quantity}\n\nSELECTED TEXT (extract from this and nothing else):\n${body.selectedText}`,
  );
  const created: string[] = [];
  const skipped: string[] = [];
  for (const raw of Array.isArray(parsed.datapoints) ? parsed.datapoints : []) {
    const entry = raw as Record<string, unknown>;
    const value = num(entry.value);
    const definitionScope = str(entry.definitionScope).trim();
    const locator = str(entry.locator).trim();
    const volatility = str(entry.volatilityClass);
    if (value === null || definitionScope.length < 20 || !locator || !['static', 'slow', 'volatile'].includes(volatility)) {
      skipped.push(`value=${String(entry.value)} — missing or malformed field (G-EXTRACT refuses placeholders)`);
      continue;
    }
    // 1.1 THE ECHO CHECK: the extracted literal must APPEAR in the text it
    // was supposedly extracted from, under some legitimate locale reading.
    // Without this, the function wrote whatever value the model returned,
    // and a fabricated-but-plausible figure acquired a source citation.
    // A false rejection costs this skipped line; a false acceptance costs
    // the whole extraction guarantee.
    if (!numberAppearsIn(value, body.selectedText)) {
      skipped.push(
        `value=${value} — echo check: this number does not appear in the selected text under any locale reading (en/id/space grouping, %, sign). A figure the text does not contain cannot be extracted from it.`,
      );
      continue;
    }
    // STAGE 3, deterministic: when the region showed components and a stated
    // total, THE CODE checks the arithmetic — the model only transcribed it.
    // 1.2: the OPERANDS are model-supplied too, so each component and the
    // stated total must themselves pass the echo check. If any fails, the
    // check is NULL (unknown) — never true (a fabricated-but-consistent
    // triple would mint its own V credential) and never false (we did not
    // learn the document contradicts itself; we learned nothing).
    let internalCheck: boolean | null = null;
    const components = Array.isArray(entry.components)
      ? entry.components.filter((component): component is number => typeof component === 'number')
      : [];
    const statedTotal = num(entry.statedTotal);
    if (components.length > 0 && statedTotal !== null) {
      const operandsEcho =
        numberAppearsIn(statedTotal, body.selectedText) &&
        components.every((component) => numberAppearsIn(component, body.selectedText));
      if (operandsEcho) {
        const sum = components.reduce((total, component) => total + component, 0);
        internalCheck = Math.abs(sum - statedTotal) <= Math.max(0.51, Math.abs(statedTotal) * 0.001);
      }
    }
    try {
      const datapoint = await restInsert<{ id: string }>('os_lab_datapoints', {
        value,
        unit: str(entry.unit),
        year: num(entry.year),
        geography: str(entry.geography),
        definition_scope: definitionScope,
        source_document_id: body.sourceDocumentId,
        locator,
        volatility_class: volatility,
        extraction_method: 'agent_from_selected_text',
        internal_check_passed: internalCheck,
      });
      created.push(datapoint.id);
    } catch (error) {
      skipped.push(`value=${value} — ${error instanceof Error ? error.message : 'refused'}`);
    }
  }
  return json({ runId, created, skipped });
}

/** LITERATURE: structure pasted results into abstract_only records. */
async function handleLiterature(body: { pastedResults: string }): Promise<Response> {
  const { runId, parsed } = await runAgent('evidence-literature', body.pastedResults);
  const created: string[] = [];
  const skipped: string[] = [];
  for (const raw of Array.isArray(parsed.references) ? parsed.references : []) {
    const entry = raw as Record<string, unknown>;
    const title = str(entry.title).trim();
    if (!title) {
      skipped.push('(untitled) — no title, not a locatable paper');
      continue;
    }
    try {
      const reference = await restInsert<{ id: string }>('os_lab_references', {
        title,
        authors: str(entry.authors),
        container: str(entry.container),
        publication_year: num(entry.publicationYear),
        doi: str(entry.doi),
        url: str(entry.url),
        // abstract_only by omission: the rail refuses anything else from us.
      });
      created.push(reference.id);
    } catch (error) {
      skipped.push(`"${title}" — ${error instanceof Error ? error.message : 'refused'}`);
    }
  }
  return json({ runId, created, skipped });
}

/** REVIEW: surface conflicts/contradictions/gate failures; never resolve. */
async function handleReview(body: { projectId: string }): Promise<Response> {
  // Cross-project on purpose: datapoints are shared, and the higher-value
  // catch is a new finding colliding with a commitment made elsewhere.
  //
  // 1.12: the recency window must not truncate SILENTLY, and it must never
  // drop the commitments. Every layer-A claim rides along regardless of
  // age (they are the commitments, and they are few — precisely the rows a
  // recency-ordered window drops first), the response reports the scope
  // actually loaded, and when the totals exceed the window the report says
  // so. A review that admits what it did not look at is worth more than
  // one that implies it looked at everything.
  const totalDatapoints = await restCount('os_lab_datapoints', 'status=neq.__none__');
  const totalClaims = await restCount('os_lab_claims', 'status=neq.__none__');
  const datapoints = await restSelect<Record<string, unknown>>(
    'os_lab_datapoints',
    `select=id,value,unit,year,definition_scope,status&order=retrieved_at.desc&limit=${REVIEW_WINDOW}`,
  );
  const recentClaims = await restSelect<Record<string, unknown>>(
    'os_lab_claims',
    `select=id,project_id,statement,layer,status&order=created_at.desc&limit=${REVIEW_WINDOW}`,
  );
  const layerAClaims = await restSelect<Record<string, unknown>>(
    'os_lab_claims',
    'select=id,project_id,statement,layer,status&layer=eq.A',
  );
  const claimsById = new Map<string, Record<string, unknown>>();
  for (const claim of [...layerAClaims, ...recentClaims]) claimsById.set(String(claim.id), claim);
  const claims = [...claimsById.values()];

  const truncated = totalDatapoints > datapoints.length || totalClaims > claims.length;
  const scopeNote = truncated
    ? `[SCOPE: this review saw ${datapoints.length} of ${totalDatapoints} datapoints and ${claims.length} of ${totalClaims} claims (every layer-A claim included). Rows beyond the window were NOT reviewed.] `
    : '';

  const context = JSON.stringify({ projectId: body.projectId, datapoints, claims });
  if (context.length > MAX_INPUT_CHARS) {
    return json({ error: 'The evidence base exceeds the review window — narrow it first.' }, 400);
  }

  const { runId, parsed } = await runAgent('evidence-reviewer', context);
  const datapointIds = new Set(datapoints.map((row) => String(row.id)));
  const claimIds = new Set(claims.map((row) => String(row.id)));
  const created = { conflicts: 0, contradictions: 0 };
  const skipped: string[] = [];

  for (const raw of Array.isArray(parsed.conflicts) ? parsed.conflicts : []) {
    const entry = raw as Record<string, unknown>;
    const a = str(entry.datapointAId);
    const b = str(entry.datapointBId);
    const type = str(entry.conflictType);
    if (!datapointIds.has(a) || !datapointIds.has(b) || a === b) {
      skipped.push(`conflict ${a}↔${b} — an invented or self-referential id is discarded by code`);
      continue;
    }
    try {
      await restInsert('os_lab_datapoint_conflicts', {
        datapoint_a_id: a,
        datapoint_b_id: b,
        conflict_type: ['value_mismatch', 'definition_mismatch', 'vintage_mismatch'].includes(type)
          ? type
          : 'definition_mismatch',
      });
      created.conflicts += 1;
    } catch {
      skipped.push(`conflict ${a}↔${b} — already recorded`);
    }
  }
  for (const raw of Array.isArray(parsed.contradictions) ? parsed.contradictions : []) {
    const entry = raw as Record<string, unknown>;
    const a = str(entry.claimAId);
    const b = str(entry.claimBId);
    const severity = str(entry.severity);
    if (!claimIds.has(a) || !claimIds.has(b) || a === b) {
      skipped.push(`contradiction ${a}↔${b} — an invented or self-referential id is discarded by code`);
      continue;
    }
    try {
      await restInsert('os_lab_claim_contradictions', {
        claim_a_id: a,
        claim_b_id: b,
        severity: ['direct', 'tension', 'scope_difference'].includes(severity) ? severity : 'tension',
      });
      created.contradictions += 1;
    } catch {
      skipped.push(`contradiction ${a}↔${b} — could not be recorded`);
    }
  }
  return json({
    runId,
    report: scopeNote + str(parsed.report),
    created,
    skipped,
    datapointsInScope: datapoints.length,
    claimsInScope: claims.length,
    layerACount: layerAClaims.length,
    totalDatapoints,
    totalClaims,
  });
}

/** DRAFT: from approved claims only; the number scan gates the write. */
async function handleDraft(body: {
  projectId: string;
  outputType: string;
  instruction: string;
}): Promise<Response> {
  const OUTPUT_TYPES = [
    'paper_section',
    'essay_section',
    'literature_note',
    'data_comparison',
    'briefing',
    'annotated_bibliography',
  ];
  if (!OUTPUT_TYPES.includes(body.outputType)) {
    return json({ error: `Unknown output type ${body.outputType}` }, 400);
  }
  const approved = await restSelect<{ id: string; statement: string; layer: string }>(
    'os_lab_claims',
    `select=id,statement,layer&project_id=eq.${body.projectId}&status=eq.approved`,
  );
  if (approved.length === 0) {
    return json({ error: 'No approved claims in this project — the drafter cites approved claims only.' }, 409);
  }
  const links = await restSelect<{ claim_id: string; datapoint_id: string }>(
    'os_lab_claim_datapoints',
    `select=claim_id,datapoint_id&claim_id=in.(${approved.map((claim) => claim.id).join(',')})`,
  );
  const datapointIds = [...new Set(links.map((link) => link.datapoint_id))];
  const datapoints =
    datapointIds.length > 0
      ? await restSelect<{ id: string; value: number | string; unit: string; year: number | null; definition_scope: string }>(
          'os_lab_datapoints',
          `select=id,value,unit,year,definition_scope&id=in.(${datapointIds.join(',')})&status=eq.V`,
        )
      : [];

  const { runId, parsed } = await runAgent(
    'evidence-drafter',
    JSON.stringify({
      instruction: body.instruction,
      outputType: body.outputType,
      approvedClaims: approved,
      verifiedDatapoints: datapoints,
    }),
  );

  const content = str(parsed.content);
  if (!content.trim()) return json({ error: 'The drafter returned no content.', runId }, 502);

  // G-NUMBER, where the write happens. A blocked draft creates NO output
  // row; the text survives in the run log for the owner to repair.
  const allowed = new Set<number>();
  for (const datapoint of datapoints) {
    allowed.add(Number(datapoint.value));
    if (datapoint.year !== null) allowed.add(datapoint.year);
  }
  // 1.3: the drafter may not mint its own escape hatch. Tags ([C]/[sim])
  // and quotation marks exempt nothing on THIS path — an agent emitting any
  // figure followed by [C], or wrapped in quotes, would otherwise ship it.
  // The exemptions are the owner's to grant, in the editor, by hand.
  const violations: ScanViolation[] = scanNumbers(content, allowed, {
    allowTags: false,
    allowQuotes: false,
  });
  if (violations.length > 0) {
    return json(
      {
        runId,
        blocked: violations,
        error:
          "G-NUMBER: the draft carries figures no datapoint stands behind — it was not saved. Tags and quotation marks are the owner's to grant, never the drafter's: the routes forward are a verified datapoint cited through an approved claim, or the owner tagging the figure by hand in the editor. The full text is in the run log.",
      },
      409,
    );
  }

  const approvedIds = new Set(approved.map((claim) => claim.id));
  const citedIds = (Array.isArray(parsed.citedClaimIds) ? parsed.citedClaimIds : [])
    .map((value) => str(value))
    .filter((id) => approvedIds.has(id));

  const output = await restInsert<{ id: string }>('os_lab_outputs', {
    project_id: body.projectId,
    output_type: body.outputType,
    content,
    generated_by_run_id: runId,
  });
  const linked: string[] = [];
  for (const claimId of citedIds) {
    try {
      await restInsert('os_lab_output_claims', { output_id: output.id, claim_id: claimId });
      linked.push(claimId);
    } catch {
      // The rail said no (e.g. an open contradiction) — the draft stands,
      // the citation does not, and the reviewer surface will say why.
    }
  }
  return json({ runId, outputId: output.id, citedClaimIds: linked });
}

// ---------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method === 'GET') {
    // Key presence only — the same probe shape as run-lab-agent.
    return json({
      configured: Boolean(keyFor('anthropic') || keyFor('deepseek') || keyFor('kimi')),
      providers: {
        anthropic: Boolean(keyFor('anthropic')),
        deepseek: Boolean(keyFor('deepseek')),
        kimi: Boolean(keyFor('kimi')),
      },
    });
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

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
  const action = typeof body.action === 'string' ? body.action : '';
  const oversize = Object.values(body).some(
    (value) => typeof value === 'string' && value.length > MAX_INPUT_CHARS,
  );
  if (oversize) return json({ error: `A field exceeds ${MAX_INPUT_CHARS} chars` }, 400);

  try {
    if (action === 'coordinate') {
      const requestText = str(body.request);
      if (!requestText) return json({ error: 'No request supplied' }, 400);
      return await handleCoordinate({ request: requestText, projectId: str(body.projectId) || undefined });
    }
    if (action === 'locate') {
      const quantity = str(body.quantity);
      const documentText = str(body.documentText);
      if (!quantity || !documentText) return json({ error: 'quantity and documentText are required' }, 400);
      return await handleLocate({ quantity, documentText });
    }
    if (action === 'extract') {
      const sourceDocumentId = str(body.sourceDocumentId);
      const selectedText = str(body.selectedText);
      if (!sourceDocumentId || !selectedText) {
        return json({ error: 'sourceDocumentId and selectedText are required' }, 400);
      }
      return await handleExtract({ sourceDocumentId, selectedText, quantity: str(body.quantity) });
    }
    if (action === 'literature') {
      const pastedResults = str(body.pastedResults);
      if (!pastedResults) return json({ error: 'No pastedResults supplied' }, 400);
      return await handleLiterature({ pastedResults });
    }
    if (action === 'review') {
      const projectId = str(body.projectId);
      if (!projectId) return json({ error: 'No projectId supplied' }, 400);
      return await handleReview({ projectId });
    }
    if (action === 'draft') {
      const projectId = str(body.projectId);
      const instruction = str(body.instruction);
      if (!projectId || !instruction) return json({ error: 'projectId and instruction are required' }, 400);
      return await handleDraft({ projectId, outputType: str(body.outputType), instruction });
    }
    return json({ error: `Unknown action ${action}` }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Evidence agent failed.' }, 500);
  }
});
