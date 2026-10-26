// The tracker write-back's courier (D-31). The os_tracker_writeback trigger
// queues one POST here (pg_net, x-sync-token from Vault) when the owner ticks
// or unticks a completable tracker task. This function sends it to the SAMB
// Project Board's personal-feed as the board's centang (or its Batal), with
// the feed token, and records the board's answer on the task. No passphrase
// and no browser: verify_jwt is off, the Vault token is the credential.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ ok: false, reason: 'method-not-allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const feedUrl = Deno.env.get('TRACKER_FEED_URL');
  const feedToken = Deno.env.get('TRACKER_FEED_TOKEN');
  if (!url || !serviceRole) return json({ ok: false, reason: 'not-configured' }, 500);
  const rpc = (fn: string, args: unknown) =>
    fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: serviceRole, Authorization: `Bearer ${serviceRole}` },
      body: JSON.stringify(args),
    });

  const token = request.headers.get('x-sync-token') ?? '';
  const ok = /^[0-9a-f]{64}$/.test(token)
    ? await rpc('os_tracker_sync_token_ok', { p_token: token }).then((r) => (r.ok ? r.json() : false)).catch(() => false)
    : false;
  if (ok !== true) return json({ ok: false, reason: 'Unauthorized' }, 401);

  const body = (await request.json().catch(() => null)) as { entry?: unknown; action?: unknown } | null;
  const entry = body?.entry;
  const action = body?.action;
  if (typeof entry !== 'string' || !UUID.test(entry) || (action !== 'complete' && action !== 'undo')) {
    return json({ ok: false, reason: 'bad-request' }, 422);
  }

  const record = (writeback: Record<string, unknown>) => rpc('os_tracker_writeback_result', { p_id: entry, p_writeback: writeback });

  // The entry as it is now: only a pending write-back of this same action is sent.
  const tracker = (await rpc('os_tracker_writeback_entry', { p_id: entry }).then((r) => (r.ok ? r.json() : null)).catch(() => null)) as
    | { taskId?: string; writeback?: { state?: string; action?: string; result?: unknown } }
    | null;
  const wb = tracker?.writeback;
  if (!tracker?.taskId || wb?.state !== 'pending' || wb.action !== action) return json({ ok: true, skipped: true });

  if (!feedUrl || !feedToken) {
    await record({ state: 'failed', action, error: 'not configured' });
    return json({ ok: false, reason: 'not-configured' }, 500);
  }

  let answer: { result?: unknown; error?: string } | null = null;
  let status = 0;
  try {
    const response = await fetch(feedUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-feed-token': feedToken },
      body: JSON.stringify({ action, task: tracker.taskId, ...(action === 'undo' && wb.result ? { undo: wb.result } : {}) }),
      signal: AbortSignal.timeout(15_000),
    });
    status = response.status;
    answer = await response.json().catch(() => null);
  } catch (e) {
    await record({ state: 'failed', action, error: `board unreachable: ${(e as Error).message.slice(0, 160)}` });
    return json({ ok: false, reason: 'tracker-unreachable' }, 502);
  }

  if (status === 200) {
    await record({ state: 'done', action, ...(action === 'complete' ? { result: answer?.result ?? null } : {}) });
    return json({ ok: true });
  }
  await record({ state: 'failed', action, status, error: String(answer?.error ?? `HTTP ${status}`).slice(0, 300) });
  return json({ ok: false, reason: 'tracker-refused', status }, 502);
});
