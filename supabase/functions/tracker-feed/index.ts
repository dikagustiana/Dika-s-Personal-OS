// The SAMB Project Board, read-only, inside WORK › Today (D-29).
//
// The board (a separate Supabase project) serves one person's feed —
// prepare / review / monitor — from its own personal-feed function, to a
// caller holding a feed token that names that person. The token lives here,
// as the secret TRACKER_FEED_TOKEN, and never in the browser bundle: the SPA
// calls this function with the passphrase key, and this function adds the
// token. The board's answer is passed through as it came; the SPA checks its
// shape (src/data/trackerFeed.ts).
//
// Nothing here writes, on either side. Acting on an item happens in the board,
// through the item's link, where the board's gates and validators apply.

import { checkAppKey } from '../_shared/appKeyAuth.ts';

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

  const url = Deno.env.get('TRACKER_FEED_URL');
  const token = Deno.env.get('TRACKER_FEED_TOKEN');
  if (!url || !token) return json({ ok: false, reason: 'not-configured' }, 500);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'x-feed-token': token },
      signal: AbortSignal.timeout(15_000),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) return json({ ok: false, reason: 'tracker-refused', status: response.status }, 502);
    return json({ ok: true, feed: body });
  } catch (e) {
    return json({ ok: false, reason: 'tracker-unreachable', message: (e as Error).message.slice(0, 200) }, 502);
  }
});
