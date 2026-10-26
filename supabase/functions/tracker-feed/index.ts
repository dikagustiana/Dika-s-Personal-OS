// The SAMB Project Board inside WORK › Today (D-29, D-30).
//
// The board (a separate Supabase project) serves one person's feed —
// prepare / review / monitor — from its own personal-feed function, to a
// caller holding a feed token that names that person. The token lives here,
// as the secret TRACKER_FEED_TOKEN, and never in the browser bundle: the SPA
// calls this function with the passphrase key, and this function adds the
// token. Each call also merges the feed into WORK tasks (os_tracker_sync), so
// opening Today brings the island's to-do up to date at once. The board's
// answer is passed through as it came; the SPA checks its shape
// (src/data/trackerFeed.ts).
//
// Nothing here writes to the board. Acting on an item happens there, through
// the item's link, where the board's gates and validators apply.

import { checkAppKey } from '../_shared/appKeyAuth.ts';
import { readAndSync } from '../_shared/trackerFeed.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-app-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ ok: false, reason: 'method-not-allowed' }, 405);

  const auth = await checkAppKey(request);
  if (!auth.ok) return json({ ok: false, reason: auth.reason }, auth.status);

  const read = await readAndSync();
  if (!read.ok) return json(read, read.reason === 'not-configured' ? 500 : 502);
  return json(read);
});
