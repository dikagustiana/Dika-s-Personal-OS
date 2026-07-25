// Rate-limited passphrase verification.
//
// The browser can no longer call `os_verify_key` directly (EXECUTE is
// withdrawn from anon in migration 20260724000012). This function holds the
// service role, counts failures per caller, and makes guessing expensive:
// a delay that doubles from the 4th failure, then a temporary lockout.
//
// verify_jwt is off by design: this is the unlock endpoint, so it has to be
// reachable before the caller holds anything. Its own rate limiting is the
// protection, and it never returns data — only a yes/no and a lockout state.
//
// It deliberately does not touch the RLS model. Once a passphrase verifies,
// the client keeps sending it as the `x-app-key` header exactly as before —
// this only guards the front door.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const FREE_ATTEMPTS = 3; // no delay for the first few fat-fingered tries
const MAX_DELAY_MS = 8_000;
const LOCKOUT_AFTER = 10;
const LOCKOUT_MINUTES = 15;
// Failures older than this are forgiven, so one bad day does not permanently
// poison a client.
const WINDOW_MINUTES = 60;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, ...extra, 'Content-Type': 'application/json' },
  });
}

/**
 * A stable, non-reversible key for the caller. Salted with the service role
 * key so the table never holds a plain IP address.
 */
async function clientKey(request: Request, salt: string): Promise<string> {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('cf-connecting-ip') ??
    'unknown';
  const bytes = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRole) return json({ error: 'Function is not configured' }, 500);

  let candidate = '';
  try {
    const body = await request.json();
    candidate = typeof body?.candidate === 'string' ? body.candidate : '';
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }
  if (!candidate) return json({ valid: false }, 200);

  const admin = createClient(url, serviceRole, { auth: { persistSession: false } });
  const key = await clientKey(request, serviceRole);
  const now = new Date();

  // The attempts table lives in the `private` schema, which PostgREST does not
  // expose — these SECURITY DEFINER RPCs are the only way in, and they are
  // granted to service_role alone.
  const { data: stateRows, error: stateError } = await admin.rpc('os_auth_state', {
    p_client_key: key,
    p_window_minutes: WINDOW_MINUTES,
  });
  if (stateError) return json({ error: 'Verification unavailable' }, 500);

  const state = stateRows?.[0] ?? { failures: 0, locked_until: null };

  if (state.locked_until && new Date(state.locked_until) > now) {
    const retryAfter = Math.ceil(
      (new Date(state.locked_until).getTime() - now.getTime()) / 1000,
    );
    return json({ valid: false, lockedOut: true, retryAfter }, 429, {
      'Retry-After': String(retryAfter),
    });
  }

  const failures: number = state.failures ?? 0;
  if (failures >= FREE_ATTEMPTS) {
    const delay = Math.min(2 ** (failures - FREE_ATTEMPTS) * 1_000, MAX_DELAY_MS);
    await sleep(delay);
  }

  const { data: valid, error } = await admin.rpc('os_verify_key', { candidate });
  if (error) return json({ error: 'Verification failed' }, 500);

  const { data: recordRows, error: recordError } = await admin.rpc('os_auth_record', {
    p_client_key: key,
    p_success: valid === true,
    p_lockout_after: LOCKOUT_AFTER,
    p_lockout_minutes: LOCKOUT_MINUTES,
    p_window_minutes: WINDOW_MINUTES,
  });
  // A bookkeeping failure must not hand out a free unlock.
  if (recordError) return json({ error: 'Verification unavailable' }, 500);

  if (valid === true) return json({ valid: true });

  const recorded = recordRows?.[0] ?? { failures: failures + 1, locked_until: null };
  return json({
    valid: false,
    lockedOut: Boolean(recorded.locked_until),
    attemptsRemaining: Math.max(0, LOCKOUT_AFTER - recorded.failures),
  });
});
