// The tracker sync's clock (D-30). pg_cron calls this every 15 minutes
// (private.os_tracker_sync_invoke) with the Vault token tracker_sync_token in
// x-sync-token; the database checks it (os_tracker_sync_token_ok), so the
// token lives nowhere else. No passphrase and no browser: verify_jwt is off,
// the token is the credential. Then the same read-and-merge as Today's card.

import { readAndSync } from '../_shared/trackerFeed.ts';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ ok: false, reason: 'method-not-allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRole) return json({ ok: false, reason: 'not-configured' }, 500);

  const token = request.headers.get('x-sync-token') ?? '';
  const check = /^[0-9a-f]{64}$/.test(token)
    ? await fetch(`${url}/rest/v1/rpc/os_tracker_sync_token_ok`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: serviceRole, Authorization: `Bearer ${serviceRole}` },
        body: JSON.stringify({ p_token: token }),
      }).then((r) => (r.ok ? r.json() : false)).catch(() => false)
    : false;
  if (check !== true) return json({ ok: false, reason: 'Unauthorized' }, 401);

  const read = await readAndSync();
  if (!read.ok) return json(read, read.reason === 'not-configured' ? 500 : 502);
  return json({ ok: true, sync: read.sync });
});
