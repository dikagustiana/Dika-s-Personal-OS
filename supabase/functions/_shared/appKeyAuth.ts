// The app-key check for Edge Functions that spend money, with the SAME
// rate limiting as the passphrase gate — not just the same bcrypt compare.
//
// The first version of this check called os_verify_key directly. That RPC
// only compares hashes; the escalating delay and lockout live in the
// verify-passphrase function AROUND its call, in os_auth_state and
// os_auth_record. So the model endpoints were an unlimited 401-vs-non-401
// oracle for guessing the passphrase, each guess burning a bcrypt compare of
// database CPU, while the front door was locked. This module runs the full
// sequence — state check, escalating delay, compare, record — against the
// SAME private.os_auth_attempts counter, so an attacker hammering a model
// endpoint walks into the identical lockout as one hammering the gate, and
// a lockout earned here also protects the gate (same caller, same counter).
//
// Shared between run-research-prompt and run-research-council so the two
// checks cannot drift apart again.

// Kept numerically identical to verify-passphrase — one policy, two doors.
const FREE_ATTEMPTS = 3;
const MAX_DELAY_MS = 8_000;
const LOCKOUT_AFTER = 10;
const LOCKOUT_MINUTES = 15;
const WINDOW_MINUTES = 60;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Same salted, non-reversible caller key as verify-passphrase. */
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

async function rpc(
  url: string,
  serviceRole: string,
  fn: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
    },
    body: JSON.stringify(args),
  });
  if (!response.ok) throw new Error(`${fn} failed (${response.status})`);
  return response.json();
}

export type AppKeyResult =
  | { ok: true }
  | { ok: false; status: number; reason: string; retryAfter?: number };

/**
 * Full rate-limited verification of the x-app-key header.
 *
 * Fails CLOSED: any bookkeeping error refuses the request rather than handing
 * out a free billable call — same posture as verify-passphrase's "a
 * bookkeeping failure must not hand out a free unlock".
 */
export async function checkAppKey(request: Request): Promise<AppKeyResult> {
  const candidate = request.headers.get('x-app-key');
  if (!candidate) return { ok: false, status: 401, reason: 'Unauthorized' };

  const url = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRole) {
    return { ok: false, status: 500, reason: 'Function is not configured' };
  }

  try {
    const key = await clientKey(request, serviceRole);
    const now = new Date();

    const stateRows = (await rpc(url, serviceRole, 'os_auth_state', {
      p_client_key: key,
      p_window_minutes: WINDOW_MINUTES,
    })) as Array<{ failures: number; locked_until: string | null }>;
    const state = stateRows?.[0] ?? { failures: 0, locked_until: null };

    if (state.locked_until && new Date(state.locked_until) > now) {
      const retryAfter = Math.ceil(
        (new Date(state.locked_until).getTime() - now.getTime()) / 1000,
      );
      return { ok: false, status: 429, reason: 'Locked out', retryAfter };
    }

    const failures = state.failures ?? 0;
    if (failures >= FREE_ATTEMPTS) {
      await sleep(Math.min(2 ** (failures - FREE_ATTEMPTS) * 1_000, MAX_DELAY_MS));
    }

    const valid = (await rpc(url, serviceRole, 'os_verify_key', { candidate })) === true;

    await rpc(url, serviceRole, 'os_auth_record', {
      p_client_key: key,
      p_success: valid,
      p_lockout_after: LOCKOUT_AFTER,
      p_lockout_minutes: LOCKOUT_MINUTES,
      p_window_minutes: WINDOW_MINUTES,
    });

    if (!valid) return { ok: false, status: 401, reason: 'Unauthorized' };
    return { ok: true };
  } catch {
    return { ok: false, status: 500, reason: 'Verification unavailable' };
  }
}
