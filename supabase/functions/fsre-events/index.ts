// The FSRE building's live feed: pipeline events as metadata, for the owner only.
//
// WHAT IT READS. One view in the site project's database, fsre_status.events,
// through one login role, fsre_status_reader, that can read that view and
// nothing else (fsre-skills db/postgres/0004a_live_roles.sql, 0004_live.sql).
// The view holds company, stage, statuses, gate figures, escalation and
// proposal titles and times; never a holdout value or model contents, because
// the events never carry them. The connection string lives in this function's
// secret FSRE_STATUS_DB_URL, set by the owner; no caller-supplied host, URL or
// SQL ever reaches the database (SSRF: the only network target is that secret).
//
// WHO MAY CALL. The owner: checkAppKey (the passphrase gate's own rate limit
// and lockout) runs before anything else, after the CORS preflight and the
// method check, which read nothing. A collaborator's JWT is not an app key.
// verify_jwt stays on for this function as for every other.
//
// THE CONTRACT. POST {wave?: string, afterSeq?: number}. Without a wave: the
// waves the view knows, newest first, with their last event time. With a wave:
// its events with seq > afterSeq, in order, at most MAX_EVENTS per call, and
// `more: true` when the building should ask again at once. The building polls
// every 5 to 10 seconds and keeps the last seq it has seen.

import postgres from 'npm:postgres@3.4.9';
import { checkAppKey } from '../_shared/appKeyAuth.ts';
import { MAX_EVENTS, parseEventsRequest } from '../_shared/fsreInput.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-app-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

let sql: ReturnType<typeof postgres> | null = null;
function db() {
  const url = Deno.env.get('FSRE_STATUS_DB_URL');
  if (!url) return null;
  // One connection per instance; the pooler is in session mode, so no prepared statements.
  sql ??= postgres(url, { max: 1, prepare: false, idle_timeout: 20, connect_timeout: 10 });
  return sql;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ ok: false, reason: 'method-not-allowed' }, 405);

  const auth = await checkAppKey(request);
  if (!auth.ok) return json({ ok: false, reason: auth.reason }, auth.status);

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const input = parseEventsRequest(body);
  if (!input.ok) return json({ ok: false, reason: input.reason }, 400);
  const { wave, afterSeq } = input;

  const conn = db();
  if (!conn) return json({ ok: false, reason: 'not-configured' }, 500);
  try {
    if (!wave) {
      const waves = await conn`
        select wave_id, max(at) as last_at, count(*)::int as events
        from fsre_status.events group by wave_id order by max(at) desc limit 50`;
      return json({ ok: true, waves });
    }
    const rows = await conn`
      select seq, wave_id, company_id, kind, stage, stage_status, from_stage, from_status,
             review_cycle, actor, ref, at, payload
      from fsre_status.events
      where wave_id = ${wave} and seq > ${afterSeq}
      order by seq limit ${MAX_EVENTS + 1}`;
    return json({ ok: true, wave, events: rows.slice(0, MAX_EVENTS), more: rows.length > MAX_EVENTS });
  } catch (e) {
    // The message names the failure (permission, connection) without echoing the secret.
    return json({ ok: false, reason: 'read-failed', message: (e as Error).message.slice(0, 200) }, 502);
  }
});
