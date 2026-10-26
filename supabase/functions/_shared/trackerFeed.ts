// Read the SAMB Project Board's feed and merge it into WORK tasks (D-30).
// Shared by tracker-feed (Today's card: read, then sync) and tracker-sync
// (pg_cron every 15 minutes) so both take the same path.

export type FeedRead =
  | { ok: true; feed: unknown; sync: unknown }
  | { ok: false; reason: string; status?: number; message?: string };

export async function readAndSync(): Promise<FeedRead> {
  const feedUrl = Deno.env.get('TRACKER_FEED_URL');
  const token = Deno.env.get('TRACKER_FEED_TOKEN');
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!feedUrl || !token || !url || !serviceRole) return { ok: false, reason: 'not-configured' };

  let feed: unknown;
  try {
    const response = await fetch(feedUrl, {
      method: 'GET',
      headers: { 'x-feed-token': token },
      signal: AbortSignal.timeout(15_000),
    });
    feed = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, reason: 'tracker-refused', status: response.status };
  } catch (e) {
    return { ok: false, reason: 'tracker-unreachable', message: (e as Error).message.slice(0, 200) };
  }

  // The merge lives in the database (os_tracker_sync), in one transaction.
  // A failed merge does not hide the feed: the card still shows it.
  const merge = await fetch(`${url}/rest/v1/rpc/os_tracker_sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: serviceRole, Authorization: `Bearer ${serviceRole}` },
    body: JSON.stringify({ p_feed: feed }),
  }).catch(() => null);
  const sync = merge?.ok ? await merge.json() : { error: `sync failed (${merge?.status ?? 'unreachable'})` };
  return { ok: true, feed, sync };
}
