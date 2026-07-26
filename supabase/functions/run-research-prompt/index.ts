// Sends one research prompt to an external model and returns the completion.
//
// DEGRADES GRACEFULLY, AND THAT IS THE POINT. When RESEARCH_MODEL_API_KEY is
// absent this function reports itself unconfigured with HTTP 200 and
// `configured: false`, so the client renders every prompt card exactly as it
// does today — copy-paste, no error, no disabled button, no empty panel. The
// API is an accelerant; the console worked without it and must keep working
// without it.
//
// NOTHING ABOUT THE PROVIDER IS HARDCODED beyond the single CONFIG block below.
// The owner is evaluating Moonshot/Kimi, and welding the function to one vendor
// would mean rewriting it to change that decision. Any OpenAI-compatible
// /chat/completions endpoint works by changing two environment variables.
//
// WHAT THIS FUNCTION MAY NOT DO: it returns text to the browser and writes
// NOTHING. It cannot verify an item, tick a gate, create a claim, or append a
// cycle or log entry — those go through the register's own guarded mutation
// path, by hand. See src/data/researchGuards.ts for why that is absolute.

import { checkAppKey } from '../_shared/appKeyAuth.ts';

const CONFIG = {
  /** OpenAI-compatible chat-completions endpoint. */
  baseUrl: Deno.env.get('RESEARCH_MODEL_BASE_URL') ?? 'https://api.moonshot.ai/v1',
  apiKey: Deno.env.get('RESEARCH_MODEL_API_KEY') ?? '',
  defaultModel: Deno.env.get('RESEARCH_MODEL_DEFAULT') ?? 'kimi-k2-0905-preview',
  /**
   * Whether the configured model has a WORKING web-search tool.
   *
   * Explicit configuration, never inferred. A model without web access asked to
   * "re-open the source and check it as it stands today" will fabricate
   * confirmations, which is strictly worse than not running the review — a
   * fabricated all-clear retires a check that was never performed. Detecting
   * this by inspecting a response is exactly the guess that produces that
   * failure, so the answer has to be declared.
   */
  browsing: (Deno.env.get('RESEARCH_MODEL_BROWSING') ?? '').toLowerCase() === 'true',
  /** Hard ceiling per call; browsing completions are expensive. */
  maxTokens: Number(Deno.env.get('RESEARCH_MODEL_MAX_TOKENS') ?? '8000'),
};

/**
 * Prompts that instruct the model to re-open sources as they stand today, or to
 * return real locatable literature. Without browsing these are copy-paste only
 * and the client is told so per prompt.
 */
const REQUIRES_BROWSING = ['prData', 'prCite', 'prLit', 'prContra', 'prScope'];

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

/** What the client needs to decide what each prompt card may offer. */
function capabilities() {
  return {
    configured: Boolean(CONFIG.apiKey),
    browsing: CONFIG.browsing,
    model: CONFIG.defaultModel,
    requiresBrowsing: REQUIRES_BROWSING,
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // GET is the capability probe the prompt cards read on mount.
  if (request.method === 'GET') return json(capabilities());
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // Before anything billable, through the SAME rate limiter as the passphrase
  // gate — see _shared/appKeyAuth.ts for why the bare os_verify_key call was
  // not enough. The GET probe stays open: it discloses only whether a key is
  // configured, which the client needs to render the cards.
  const auth = await checkAppKey(request);
  if (!auth.ok) {
    return json(
      { error: auth.reason, ...(auth.retryAfter ? { retryAfter: auth.retryAfter } : {}) },
      auth.status,
    );
  }

  let prompt = '';
  let kind = '';
  let model = CONFIG.defaultModel;
  let confirmed = false;
  try {
    const body = await request.json();
    prompt = typeof body?.prompt === 'string' ? body.prompt : '';
    kind = typeof body?.kind === 'string' ? body.kind : '';
    if (typeof body?.model === 'string' && body.model) model = body.model;
    confirmed = body?.confirmed === true;
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }

  if (!prompt) return json({ error: 'No prompt supplied' }, 400);

  // Unconfigured is a normal, expected state — not an error. The client falls
  // back to copy-paste on this response.
  if (!CONFIG.apiKey) {
    return json({
      ...capabilities(),
      sent: false,
      reason: 'Direct sending is not configured. Copy the prompt instead.',
    });
  }

  // Browsing-dependent prompts are refused rather than answered badly.
  if (REQUIRES_BROWSING.includes(kind) && !CONFIG.browsing) {
    return json({
      ...capabilities(),
      sent: false,
      reason:
        'This prompt asks the model to open sources as they stand today. The configured model has no confirmed web access, so it would fabricate confirmations. Copy it into a browsing session instead.',
    });
  }

  // Every call is user-initiated and explicitly confirmed. There is no cron and
  // no scheduler anywhere in this subsystem: loop due-dates are a trigger for
  // the owner, not for a job.
  if (!confirmed) {
    return json(
      {
        ...capabilities(),
        sent: false,
        reason: 'Confirmation required before sending. Show the owner what is being sent.',
      },
      409,
    );
  }

  try {
    const response = await fetch(`${CONFIG.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CONFIG.apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: CONFIG.maxTokens,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      // Never echo the provider's body verbatim: it can contain the key.
      return json(
        { ...capabilities(), sent: false, reason: `Model call failed (${response.status}).` },
        502,
      );
    }

    const payload = await response.json();
    const completion: string = payload?.choices?.[0]?.message?.content ?? '';
    return json({
      ...capabilities(),
      sent: true,
      model,
      completion,
      usage: payload?.usage ?? null,
    });
  } catch {
    return json(
      { ...capabilities(), sent: false, reason: 'Could not reach the model provider.' },
      502,
    );
  }
});
