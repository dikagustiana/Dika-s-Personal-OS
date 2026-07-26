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

const CONFIG = {
  baseUrl: Deno.env.get('RESEARCH_MODEL_BASE_URL') ?? 'https://api.moonshot.ai/v1',
  apiKey: Deno.env.get('RESEARCH_MODEL_API_KEY') ?? '',
  defaultModel: Deno.env.get('RESEARCH_MODEL_DEFAULT') ?? 'kimi-k2-0905-preview',
  browsing: (Deno.env.get('RESEARCH_MODEL_BROWSING') ?? '').toLowerCase() === 'true',
  maxTokens: Number(Deno.env.get('RESEARCH_MODEL_MAX_TOKENS') ?? '8000'),
};

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
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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
  if (!response.ok) {
    // Never echo the provider body: it can contain the key.
    throw new Error(`model call failed (${response.status})`);
  }
  const payload = await response.json();
  return payload?.choices?.[0]?.message?.content ?? '';
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method === 'GET') return json(capabilities());
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

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

  // ONE STAGE PER CALL, by design. Eleven completions take minutes, and a
  // single call would give the client nothing to report but a spinner — §6.3
  // wants counts. Staging also means a chairman failure cannot destroy the ten
  // completions already paid for: they are already back in the client's hands.
  try {
    // ── Stage 1: advisors, in parallel ────────────────────────────────────
    //
    // allSettled, NOT all. The website uses Promise.all here, so one failing
    // seat rejects the whole run and every completion already paid for is
    // discarded. A partial council is still worth reading, and the owner —
    // not this function — decides whether to proceed with four.
    if (stage === 'advisors') {
      if (advisors.length === 0) return json({ error: 'advisors are required' }, 400);

      const settled = await Promise.allSettled(
        advisors.map(async (persona) => {
          const model = persona.model ?? CONFIG.defaultModel;
          const text = await complete(model, [
            { role: 'system', content: persona.systemPrompt },
            { role: 'user', content: framedInput },
          ]);
          return { advisorId: persona.id, advisorName: persona.name, model, text };
        }),
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

    // ── Stage 2: peer review, in parallel over the anonymised set ─────────
    if (stage === 'peers') {
      const peerPrompts = (body.peerPrompts ?? []) as Array<{
        reviewerId: string;
        reviewerName: string;
        system: string;
        user: string;
        model?: string;
      }>;
      if (peerPrompts.length === 0) return json({ error: 'peerPrompts are required' }, 400);

      const settled = await Promise.allSettled(
        peerPrompts.map(async (prompt) => {
          const model = prompt.model ?? CONFIG.defaultModel;
          const raw = await complete(model, [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ]);
          return { reviewerId: prompt.reviewerId, reviewerName: prompt.reviewerName, raw };
        }),
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
