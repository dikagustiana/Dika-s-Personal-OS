// The partner room's approve button: Dika approves a model package for publication.
//
// WHAT IT CALLS. Two functions in the site project's database, through one
// login role, fsre_approver, that may execute them and nothing else
// (fsre-skills db/postgres/0004_live.sql): fsre.can_approve(company, version)
// says whether approval is possible and, if not, every reason; and
// fsre.approve_package(company, version, approver) re-checks the same
// conditions inside its own transaction, then publishes the release, passes
// partner review and records an `approved` event. Every rule lives in the
// database; this function only carries the owner's request to it.
//
// WHO MAY CALL. The owner only: checkAppKey first (the passphrase gate's rate
// limit and lockout). The approver recorded is the owner, by name; the caller
// cannot choose it. No caller-supplied host or SQL reaches the database: the
// connection string is the secret FSRE_APPROVER_DB_URL, and company and
// version are bound parameters checked against their shapes first
// (_shared/fsreInput.ts).
//
// THE CONTRACT. POST {action: 'check' | 'approve', company, version}.
// 'check' -> {ok, reasons[]} (the button stays disabled and shows the reasons
// unless ok); 'approve' -> the function's answer, ok:false with reasons when
// a condition no longer holds.

import postgres from 'npm:postgres@3.4.9';
import { checkAppKey } from '../_shared/appKeyAuth.ts';
import { parseApprovalRequest } from '../_shared/fsreInput.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-app-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const APPROVER = 'Dika (owner, Personal OS partner room)';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

let sql: ReturnType<typeof postgres> | null = null;
function db() {
  const url = Deno.env.get('FSRE_APPROVER_DB_URL');
  if (!url) return null;
  sql ??= postgres(url, { max: 1, prepare: false, idle_timeout: 20, connect_timeout: 10 });
  return sql;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ ok: false, reason: 'method-not-allowed' }, 405);

  const auth = await checkAppKey(request);
  if (!auth.ok) return json({ ok: false, reason: auth.reason }, auth.status);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, reason: 'bad-request' }, 400);
  }
  const input = parseApprovalRequest(body);
  if (!input.ok) return json({ ok: false, reason: input.reason }, 400);
  const { action, company, version } = input;

  const conn = db();
  if (!conn) return json({ ok: false, reason: 'not-configured' }, 500);
  try {
    const [row] = action === 'check'
      ? await conn`select fsre.can_approve(${company}, ${version}) as result`
      : await conn`select fsre.approve_package(${company}, ${version}, ${APPROVER}) as result`;
    return json(row.result);
  } catch (e) {
    return json({ ok: false, reason: 'call-failed', message: (e as Error).message.slice(0, 200) }, 502);
  }
});
