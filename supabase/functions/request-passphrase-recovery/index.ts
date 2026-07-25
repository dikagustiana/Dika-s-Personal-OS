// Emails a one-time link for setting a new passphrase.
//
// Called by the unlock gate after the third consecutive failure, which is
// deliberately earlier than the 15-minute lockout — the point is to help the
// owner before they are locked out, not after.
//
// It is a recovery link, not a reminder. The stored secret is a bcrypt hash;
// the passphrase cannot be read back, and nothing here attempts to. Only a
// digest of the token is persisted, by os_recovery_issue, which also enforces
// the one-email-per-hour cap.
//
// verify_jwt is off for the same reason as verify-passphrase: this sits in
// front of the unlock gate, so it has to be reachable before the caller holds
// anything. It returns no data and never reveals whether an email was sent.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const TTL_MINUTES = 30;
// One email per hour. Without it, deliberate typos are a mail-flood button.
const MIN_GAP_MINUTES = 60;
// Documented fallback: the live deployment recorded in deploy/README.md.
const FALLBACK_ORIGIN = 'https://dika-personal-os.vercel.app';
// Resend's sandbox sender, which only delivers to the account owner. A real
// verified sender belongs in RECOVERY_EMAIL_FROM.
const FALLBACK_SENDER = 'onboarding@resend.dev';

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

/** 32 random bytes, URL-safe: far past brute-forcing within the 30-minute TTL. */
function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * The token rides in the URL fragment, not the query string: fragments are not
 * sent to the server, so it stays out of access logs and Referer headers.
 */
function recoveryLink(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/#recover=${token}`;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const recipient = Deno.env.get('RECOVERY_EMAIL_TO');
  if (!url || !serviceRole || !apiKey || !recipient) {
    return json({ error: 'Function is not configured' }, 500);
  }

  const origin = Deno.env.get('RECOVERY_APP_ORIGIN') ?? FALLBACK_ORIGIN;
  const sender = Deno.env.get('RECOVERY_EMAIL_FROM') ?? FALLBACK_SENDER;

  const admin = createClient(url, serviceRole, { auth: { persistSession: false } });
  const token = newToken();

  // The token table lives in the `private` schema, which PostgREST does not
  // expose — this SECURITY DEFINER RPC is the only way in, and it is granted to
  // service_role alone. It stores the digest and answers whether the hourly
  // window is open.
  const { data: issued, error } = await admin.rpc('os_recovery_issue', {
    p_token: token,
    p_ttl_minutes: TTL_MINUTES,
    p_min_gap_minutes: MIN_GAP_MINUTES,
  });
  if (error) return json({ error: 'Recovery unavailable' }, 500);

  // Deliberate silent success: over the limit, the answer is identical to a
  // real send. Telling whoever is guessing that a limit exists tells them how
  // to work around it, and telling them an email went out confirms the mailbox.
  if (issued !== true) return json({ ok: true });

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: sender,
      to: [recipient],
      subject: 'Recovery link',
      // The link and nothing else. No hint, no passphrase, no clue about what
      // sits behind it — an inbox is not a place to describe the target.
      text: [
        recoveryLink(origin, token),
        '',
        `This link works once and expires in ${TTL_MINUTES} minutes.`,
        'If you did not request it, ignore this message.',
      ].join('\n'),
    }),
  });

  // Logged, not returned: the caller gets the same answer either way. Status
  // only — the body could echo the recipient, and the token must never appear
  // anywhere but the email itself.
  if (!response.ok) console.error(`Recovery email rejected (${response.status})`);

  return json({ ok: true });
});
