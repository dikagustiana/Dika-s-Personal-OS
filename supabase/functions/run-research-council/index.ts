// Runs one research council: advisors → anonymised peer review → chairman.
//
// PROVIDER CONFIG IS PART C's, NOT THE WEBSITE'S. The website hardcodes
// https://ai.gateway.lovable.dev with LOVABLE_API_KEY and google/gemini-2.5-flash.
// None of that is inherited. This reads the SAME environment variables as
// run-research-prompt — RESEARCH_MODEL_API_KEY and friends — so the council and
// the single-pass prompts move providers together, in one place.
//
// WHAT THIS FUNCTION MAY NOT DO: it returns text and writes ONE row to
// os_research_council_sessions. It cannot record a review cycle, tick a gate,
// set an item to V, or create a claim at layer (a) or (b). Those are the
// author's decisions and they go through the register's own guarded mutation
// path, by hand. See src/data/researchGuards.ts.
//
// NO CRON, NO SCHEDULER. Every run is user-initiated and explicitly confirmed.
// loopDue is a trigger for the owner, not for a job.
//
// SEATS GO OUT IN WAVES, NOT ALL AT ONCE. The provider caps concurrent requests
// per organization; firing five advisors together lost two of them to 429 on
// every single run. See CONFIG.maxConcurrency.

import { checkAppKey } from '../_shared/appKeyAuth.ts';

const CONFIG = {
  baseUrl: Deno.env.get('RESEARCH_MODEL_BASE_URL') ?? 'https://api.moonshot.ai/v1',
  apiKey: Deno.env.get('RESEARCH_MODEL_API_KEY') ?? '',
  defaultModel: Deno.env.get('RESEARCH_MODEL_DEFAULT') ?? 'kimi-k2-0905-preview',
  browsing: (Deno.env.get('RESEARCH_MODEL_BROWSING') ?? '').toLowerCase() === 'true',
  maxTokens: Number(Deno.env.get('RESEARCH_MODEL_MAX_TOKENS') ?? '8000'),
  /**
   * How many provider calls may be in flight at once.
   *
   * MEASURED, NOT GUESSED. A five-seat council fired all five advisors in
   * parallel and two came back
   * `429 … request reached max organization concurrency: 3`. Every method
   * council therefore lost the same two seats, silently as far as the spend was
   * concerned — the run "succeeded" with three. One of the dropped seats was the
   * Circularity Auditor, the one personas.ts calls the seat the author cannot
   * supply for himself, so the council was losing precisely the perspective it
   * exists to add.
   *
   * Three is this account's ceiling today. It is an environment variable and not
   * a constant because it is a property of the ACCOUNT, not of the code: a tier
   * change should be a secret edit, not a deploy.
   */
  maxConcurrency: Math.max(
    1,
    Number(Deno.env.get('RESEARCH_MODEL_MAX_CONCURRENCY') ?? '3') || 3,
  ),
};

/** Retries for a 429 only. A rate-limited call is rejected before inference, so
 * retrying it costs nothing; any other failure is returned as-is. */
const MAX_RATE_LIMIT_RETRIES = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Promise.allSettled with a ceiling on how many run at once.
 *
 * Same contract as allSettled — results in input order, one entry per task, no
 * rejection — because the caller's partial-council handling depends on exactly
 * that. Only the arrival rate changes.
 */
async function settledWithLimit<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<Array<PromiseSettledResult<T>>> {
  const results = new Array<PromiseSettledResult<T>>(tasks.length);
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const index = cursor++;
      if (index >= tasks.length) return;
      try {
        results[index] = { status: 'fulfilled', value: await tasks[index]() };
      } catch (reason) {
        results[index] = { status: 'rejected', reason: reason as Error };
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, worker),
  );
  return results;
}

/**
 * The contra council's Counter-Evidence Hunter is told to return real,
 * locatable published work. Without web access it will invent citations, which
 * is strictly worse than not running the council at all — a fabricated
 * reference is far more damaging inside an authoritative-looking verdict than
 * in a single-pass answer. Same line Part C already drew for prContra.
 */
const MODES_REQUIRING_BROWSING = ['contra'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-app-key',
  // GET is listed for the capability probe. It is a CORS-safelisted method, so
  // browsers pass it through the preflight even when it is absent — verified
  // in a real browser — but listing it removes the ambiguity for the reader.
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

/**
 * Ceiling on seats per request. The real seat lists are four and five, so this
 * is far above any legitimate call and exists purely so that a caller who
 * bypasses the UI cannot open a thousand parallel billable completions with
 * one request. The letter alphabet in the pipeline caps anonymisation at eight
 * anyway, so a larger council could not be assembled even if it were paid for.
 */
const MAX_SEATS = 8;
const MAX_PROMPT_CHARS = 80_000;
/**
 * Aggregate stages carry the framed input PLUS every seat's bounded output
 * (maxTokens ≈ 32k chars each), so their legitimate size is input + seats ×
 * output — an 80k cap rejected long-but-valid runs AFTER the advisor
 * completions were already paid for. 400k bounds abuse while never rejecting
 * a run whose parts each passed their own limits.
 */
const MAX_AGGREGATE_CHARS = 400_000;


function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function capabilities() {
  return {
    configured: Boolean(CONFIG.apiKey),
    browsing: CONFIG.browsing,
    model: CONFIG.defaultModel,
    requiresBrowsing: MODES_REQUIRING_BROWSING,
  };
}

interface ChatMessage {
  role: string;
  content: string;
}

async function complete(model: string, messages: ChatMessage[]): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${CONFIG.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CONFIG.apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: CONFIG.maxTokens,
        temperature: 0.4,
        messages,
      }),
    });

    // A 429 is refused BEFORE inference, so it is not billed and retrying it
    // does not double-spend. Belt and braces alongside maxConcurrency: the
    // ceiling is per organization, so another tab — or the single-prompt
    // endpoint — can be using part of it at the same moment.
    if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      // Honour the provider's own number when it sends one; it said "try again
      // after 1 seconds" here. Bounded, so a hostile header cannot park the
      // function until it times out.
      const header = Number(response.headers.get('retry-after') ?? '');
      const waitSeconds = Number.isFinite(header) && header > 0 ? Math.min(header, 10) : 1;
      // The body is never read on this path; release it rather than leaking it.
      await response.body?.cancel();
      await sleep(waitSeconds * 1000 * (attempt + 1));
      continue;
    }

    if (!response.ok) {
      // Never echo the provider body: it can contain the key.
      throw new Error(`model call failed (${response.status})`);
    }
    const payload = await response.json();
    return payload?.choices?.[0]?.message?.content ?? '';
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method === 'GET') return json(capabilities());
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // Before anything that costs money, through the SAME rate limiter as the
  // passphrase gate — the previous check compared hashes without counting
  // attempts, which made this endpoint an unlimited guessing oracle while
  // the front door was locked. The GET probe above stays open: it reveals
  // only whether a key is configured.
  const auth = await checkAppKey(request);
  if (!auth.ok) {
    return json(
      { error: auth.reason, ...(auth.retryAfter ? { retryAfter: auth.retryAfter } : {}) },
      auth.status,
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }

  const mode = String(body.mode ?? '');
  if (!['method', 'scope', 'contra'].includes(mode)) {
    return json({ error: "mode must be 'method', 'scope' or 'contra'" }, 400);
  }

  // Unconfigured is a normal state, not an error: the client hides the council
  // button entirely and the single-pass prompt still copy-pastes.
  if (!CONFIG.apiKey) {
    return json({
      ...capabilities(),
      ran: false,
      reason: 'The council needs the model API; it is not configured. Use the single-pass prompt.',
    });
  }

  if (MODES_REQUIRING_BROWSING.includes(mode) && !CONFIG.browsing) {
    return json({
      ...capabilities(),
      ran: false,
      reason:
        'The contra council hunts published counter-evidence. The configured model has no confirmed web access, so it would invent citations. Use the single-pass prContra prompt in a browsing session instead.',
    });
  }

  if (body.confirmed !== true) {
    return json(
      {
        ...capabilities(),
        ran: false,
        reason: 'Confirmation required before spending completions.',
      },
      409,
    );
  }

  const framedInput = String(body.framedInput ?? '');
  const stage = String(body.stage ?? 'advisors');
  const advisors = (body.advisors ?? []) as Array<{
    id: string;
    name: string;
    systemPrompt: string;
    model?: string;
  }>;
  if (!framedInput) return json({ error: 'framedInput is required' }, 400);
  if (framedInput.length > MAX_PROMPT_CHARS) {
    return json({ error: 'framedInput exceeds the allowed size' }, 400);
  }

  // ONE STAGE PER CALL, by design. Eleven completions take minutes, and a
  // single call would give the client nothing to report but a spinner — §6.3
  // wants counts. Staging also means a chairman failure cannot destroy the ten
  // completions already paid for: they are already back in the client's hands.
  try {
    // ── Stage 1: advisors, in waves of maxConcurrency ─────────────────────
    //
    // SETTLED, NOT all. The website uses Promise.all here, so one failing
    // seat rejects the whole run and every completion already paid for is
    // discarded. A partial council is still worth reading, and the owner —
    // not this function — decides whether to proceed with four.
    //
    // Waves rather than all at once: the provider's per-organization
    // concurrency ceiling turned "five seats" into "three seats and two 429s"
    // on every run. Losing seats to a rate limit is not the same kind of
    // partial council as losing one to a bad prompt, and it should not be
    // reported as if it were.
    if (stage === 'advisors') {
      if (advisors.length === 0) return json({ error: 'advisors are required' }, 400);
      if (advisors.length > MAX_SEATS) {
        return json({ error: `At most ${MAX_SEATS} seats per council` }, 400);
      }
      if (advisors.some((p) => (p.systemPrompt ?? '').length > MAX_PROMPT_CHARS)) {
        return json({ error: 'A system prompt exceeds the allowed size' }, 400);
      }

      const settled = await settledWithLimit(
        advisors.map((persona) => async () => {
          const model = persona.model ?? CONFIG.defaultModel;
          const text = await complete(model, [
            { role: 'system', content: persona.systemPrompt },
            { role: 'user', content: framedInput },
          ]);
          return { advisorId: persona.id, advisorName: persona.name, model, text };
        }),
        CONFIG.maxConcurrency,
      );

      const advisorResponses: unknown[] = [];
      // Named, so the client says WHICH seat failed, not "a seat failed".
      const failedSeats: Array<{ id: string; name: string }> = [];
      settled.forEach((result, index) => {
        if (result.status === 'fulfilled') advisorResponses.push(result.value);
        else failedSeats.push({ id: advisors[index].id, name: advisors[index].name });
      });

      if (advisorResponses.length < 2) {
        return json(
          {
            ...capabilities(),
            ran: false,
            reason: `Only ${advisorResponses.length} of ${advisors.length} seats answered — a council needs at least two.`,
            failedSeats,
          },
          502,
        );
      }

      return json({ ...capabilities(), ran: true, stage, advisorResponses, failedSeats });
    }

    // ── Stage 2: peer review, in waves, over the anonymised set ──────────
    if (stage === 'peers') {
      const peerPrompts = (body.peerPrompts ?? []) as Array<{
        reviewerId: string;
        reviewerName: string;
        system: string;
        user: string;
        model?: string;
      }>;
      if (peerPrompts.length === 0) return json({ error: 'peerPrompts are required' }, 400);
      if (peerPrompts.length > MAX_SEATS) {
        return json({ error: `At most ${MAX_SEATS} peer reviews per council` }, 400);
      }
      if (peerPrompts.some((p) => (p.user ?? '').length > MAX_AGGREGATE_CHARS)) {
        return json({ error: 'A peer prompt exceeds the allowed size' }, 400);
      }

      const settled = await settledWithLimit(
        peerPrompts.map((prompt) => async () => {
          const model = prompt.model ?? CONFIG.defaultModel;
          const raw = await complete(model, [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ]);
          return { reviewerId: prompt.reviewerId, reviewerName: prompt.reviewerName, raw };
        }),
        CONFIG.maxConcurrency,
      );

      const peerReviews: unknown[] = [];
      const failedSeats: Array<{ id: string; name: string }> = [];
      settled.forEach((result, index) => {
        if (result.status === 'fulfilled') peerReviews.push(result.value);
        else
          failedSeats.push({
            id: peerPrompts[index].reviewerId,
            name: peerPrompts[index].reviewerName,
          });
      });

      return json({ ...capabilities(), ran: true, stage, peerReviews, failedSeats });
    }

    // ── Stage 3: chairman ─────────────────────────────────────────────────
    if (stage === 'chairman') {
      const chairman = body.chairman as
        | { system: string; user: string; model?: string }
        | undefined;
      if (!chairman?.system || !chairman?.user) {
        return json({ error: 'chairman system and user prompts are required' }, 400);
      }
      if (chairman.user.length > MAX_AGGREGATE_CHARS) {
        return json({ error: 'The chairman prompt exceeds the allowed size' }, 400);
      }
      const raw = await complete(chairman.model ?? CONFIG.defaultModel, [
        { role: 'system', content: chairman.system },
        { role: 'user', content: chairman.user },
      ]);
      return json({ ...capabilities(), ran: true, stage, chairmanRaw: raw });
    }

    return json({ error: `Unknown stage '${stage}'` }, 400);
  } catch (error) {
    // The client keeps whatever earlier stages returned; only this stage is
    // lost. Never silently retried here — a retry doubles the spend invisibly,
    // and the decision to spend again is the owner's.
    return json(
      {
        ...capabilities(),
        ran: false,
        stage,
        reason: error instanceof Error ? error.message : 'The model provider could not be reached.',
      },
      502,
    );
  }
});
