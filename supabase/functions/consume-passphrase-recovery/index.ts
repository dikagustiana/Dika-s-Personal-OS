// Redeems a recovery link and installs the new passphrase.
//
// Reached from the emailed link, so verify_jwt is off for the same reason as
// verify-passphrase: it runs in front of the unlock gate, before the caller
// holds anything. The token is the whole credential.
//
// The function itself compares nothing. It hands the token to
// os_recovery_consume, which matches on a digest, claims the row with a locking
// UPDATE (single use, even under concurrency) and writes the new bcrypt hash —
// so neither the token nor the passphrase is ever compared in here, and timing
// leaks nothing about either. Neither is echoed back.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const MIN_LENGTH = 12;
// A length floor alone accepts 'aaaaaaaaaaaa', which is one guess wide.
const MIN_DISTINCT = 4;
// A flat cost on every rejection: automated probing is not free, and a refusal
// does not come back faster than an acceptance.
const FAILURE_DELAY_MS = 500;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Server-side floor, duplicated in the client only for the sake of feedback. */
function tooWeak(passphrase: string): boolean {
  return passphrase.length < MIN_LENGTH || new Set(passphrase).size < MIN_DISTINCT;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRole) return json({ error: 'Function is not configured' }, 500);

  let token = '';
  let passphrase = '';
  try {
    const body = await request.json();
    token = typeof body?.token === 'string' ? body.token : '';
    passphrase = typeof body?.passphrase === 'string' ? body.passphrase : '';
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }

  if (!token) {
    await sleep(FAILURE_DELAY_MS);
    return json({ ok: false, reason: 'invalid' }, 400);
  }
  if (tooWeak(passphrase)) {
    await sleep(FAILURE_DELAY_MS);
    return json({ ok: false, reason: 'weak', minLength: MIN_LENGTH }, 400);
  }

  const admin = createClient(url, serviceRole, { auth: { persistSession: false } });

  const { data: outcome, error } = await admin.rpc('os_recovery_consume', {
    p_token: token,
    p_new_passphrase: passphrase,
    p_min_length: MIN_LENGTH,
  });
  if (error) return json({ error: 'Recovery unavailable' }, 500);

  if (outcome !== 'ok') {
    await sleep(FAILURE_DELAY_MS);
    // 'invalid' covers unknown, already used and expired alike — the caller
    // does not learn which.
    return json({ ok: false, reason: outcome === 'weak' ? 'weak' : 'invalid' }, 400);
  }

  // The lockout was earned by a passphrase that no longer exists. A failure
  // here would leave the owner holding a working passphrase and a locked door,
  // so it is worth reporting rather than swallowing.
  const { error: clearError } = await admin.rpc('os_recovery_clear_attempts');
  if (clearError) return json({ ok: true, lockoutCleared: false });

  return json({ ok: true, lockoutCleared: true });
});
