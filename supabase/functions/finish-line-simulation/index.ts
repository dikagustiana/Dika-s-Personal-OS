// The Finish line simulation: one private HTML build, stored and served for
// the owner and nobody else.
//
// WHY A FUNCTION AND NOT A STORAGE POLICY. The owner has no auth.uid() — the
// passphrase path is anon + x-app-key (20260724000002) — and every policy
// Storage can evaluate is keyed on a JWT subject, so a policy on this bucket
// could only ever serve somebody who is not the owner. The bucket therefore
// carries NO policy at all (deny-by-default, the lab-artifacts posture from
// 20260817000073), and this function is the only door. Nothing that touches
// the request body or Storage runs before checkAppKey — the same bcrypt,
// escalating delay and lockout as the passphrase gate — and a failed check
// ends the request with that check's own status. There is no contributor
// path: a collaborator's JWT is not an app key.
//
// Only the CORS preflight and the method check answer before the gate, as in
// provision-collaborator: a browser's preflight cannot carry x-app-key, and a
// 405 reads and reveals nothing.
//
// LAYOUT (see _shared/simulationStore.ts). An upload writes
// versions/<stamp>_<sha8>.html FIRST and moves current.json only after that
// write succeeded, so a failed upload leaves the previous version current.
// The app never overwrites a version and never deletes anything; there is no
// list, delete or rollback action here, by design of this task.
//
// WHY THE HTML COMES BACK INSIDE JSON. On the default domain Supabase
// rewrites a text/html response to text/plain; a POST answering
// application/json is unaffected, and the tab needs the meta beside the bytes
// anyway.
//
// READS HAVE THREE OUTCOMES, NEVER TWO. "Never uploaded" (value: null) and
// "the pointer names an object that is not there" are different facts; only
// the first may read as empty — readResult.ts's rule, enforced server side so
// a broken pointer cannot reach the tab as an empty state.

import { checkAppKey } from '../_shared/appKeyAuth.ts';
import { checkSimulationUpload } from '../_shared/simulationUpload.ts';
import {
  SIMULATION_BUCKET,
  SIMULATION_POINTER,
  isStorageConflict,
  parsePointer,
  storageAbsence,
  versionPath,
  type SimulationPointer,
} from '../_shared/simulationStore.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-app-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

type FailureReason =
  | 'bucket-missing'
  | 'pointer-dangling'
  | 'pointer-malformed'
  | 'pointer-mismatch'
  | 'storage-error'
  | 'version-exists'
  | 'pointer-write-failed';

function failure(reason: FailureReason, message: string, status = 500, extra: Record<string, unknown> = {}) {
  return json({ ok: false, reason, message, ...extra }, status);
}

async function sha256Hex(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function errorBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Storage over REST with the service role, the way run-lab-agent and
 * run-evidence-agent already reach lab-artifacts. Raw fetch rather than the
 * storage client so every status and error body is in hand: the absence rules
 * in simulationStore.ts are what turn them into meaning.
 */
function storage(url: string, serviceRole: string) {
  const headers = (extra: Record<string, string> = {}) => ({
    apikey: serviceRole,
    Authorization: `Bearer ${serviceRole}`,
    ...extra,
  });
  const objectUrl = (path: string) => `${url}/storage/v1/object/${SIMULATION_BUCKET}/${path}`;
  return {
    bucket: () => fetch(`${url}/storage/v1/bucket/${SIMULATION_BUCKET}`, { headers: headers() }),
    get: (path: string) => fetch(objectUrl(path), { headers: headers() }),
    put: (path: string, body: BodyInit, contentType: string, upsert: boolean, cacheControl: string) =>
      fetch(objectUrl(path), {
        method: 'POST',
        headers: headers({
          'Content-Type': contentType,
          'x-upsert': upsert ? 'true' : 'false',
          'cache-control': cacheControl,
        }),
        body,
      }),
  };
}

type Store = ReturnType<typeof storage>;

/** null when the bucket exists; otherwise the Response that says why not. */
async function requireBucket(store: Store): Promise<Response | null> {
  const response = await store.bucket();
  if (response.ok) return null;
  const body = await errorBody(response);
  if (storageAbsence(response.status, body)) {
    return failure(
      'bucket-missing',
      `Bucket ${SIMULATION_BUCKET} does not exist — migration 20260928000108 has not been applied.`,
    );
  }
  return failure('storage-error', `Could not check the bucket (Storage ${response.status}).`);
}

async function handleRead(store: Store): Promise<Response> {
  const missingBucket = await requireBucket(store);
  if (missingBucket) return missingBucket;

  const pointerResponse = await store.get(SIMULATION_POINTER);
  if (!pointerResponse.ok) {
    const body = await errorBody(pointerResponse);
    const absent = storageAbsence(pointerResponse.status, body);
    // The ONLY path to value: null. Anything that is not a clean "no such
    // object" is a failure to look, and says so.
    if (absent === 'object') return json({ ok: true, value: null });
    if (absent === 'bucket') {
      return failure('bucket-missing', `Bucket ${SIMULATION_BUCKET} disappeared during the read.`);
    }
    return failure('storage-error', `Could not read ${SIMULATION_POINTER} (Storage ${pointerResponse.status}).`);
  }

  let rawPointer: unknown;
  try {
    rawPointer = await pointerResponse.json();
  } catch {
    return failure('pointer-malformed', `${SIMULATION_POINTER} is not valid JSON.`);
  }
  const parsed = parsePointer(rawPointer);
  if (!parsed.ok) return failure('pointer-malformed', parsed.problem);
  const pointer: SimulationPointer = parsed.pointer;

  const versionResponse = await store.get(pointer.path);
  if (!versionResponse.ok) {
    const body = await errorBody(versionResponse);
    if (storageAbsence(versionResponse.status, body) === 'object') {
      return failure(
        'pointer-dangling',
        `${SIMULATION_POINTER} points to ${pointer.path}, which does not exist.`,
      );
    }
    return failure('storage-error', `Could not read ${pointer.path} (Storage ${versionResponse.status}).`);
  }

  // The pointer carries the digest the upload computed; a stored object that
  // no longer matches it (replaced from the dashboard, truncated in transit)
  // is the pointer lying about what it points to, not a version to show.
  const bytes = new Uint8Array(await versionResponse.arrayBuffer());
  const digest = await sha256Hex(bytes);
  if (bytes.byteLength !== pointer.bytes || digest !== pointer.sha256) {
    return failure(
      'pointer-mismatch',
      `${pointer.path} does not match ${SIMULATION_POINTER} (expected ${pointer.bytes} bytes / ${pointer.sha256.slice(0, 8)}, found ${bytes.byteLength} bytes / ${digest.slice(0, 8)}).`,
    );
  }

  const html = new TextDecoder('utf-8').decode(bytes);
  return json({ ok: true, value: { html, meta: pointer } });
}

async function handleUpload(store: Store, html: string): Promise<Response> {
  const check = checkSimulationUpload(html);
  if (!check.ok) {
    return json(
      {
        ok: false,
        codes: check.failures.map((f) => f.code),
        messages: check.failures.map((f) => f.message),
      },
      422,
    );
  }

  const missingBucket = await requireBucket(store);
  if (missingBucket) return missingBucket;

  const bytes = new TextEncoder().encode(html);
  const sha256 = await sha256Hex(bytes);
  const uploadedAt = new Date();
  const path = versionPath(uploadedAt, sha256);

  // 1. The version, never with upsert: a path that already exists is refused
  //    by Storage rather than overwritten. current.json is not touched yet, so
  //    every failure from here leaves the previous version current.
  const versionWrite = await store.put(path, bytes, 'text/html', false, 'max-age=3600');
  if (!versionWrite.ok) {
    const body = await errorBody(versionWrite);
    if (isStorageConflict(versionWrite.status, body)) {
      return failure('version-exists', `${path} already exists; versions are never overwritten.`, 409);
    }
    if (storageAbsence(versionWrite.status, body) === 'bucket') {
      return failure('bucket-missing', `Bucket ${SIMULATION_BUCKET} disappeared during the upload.`);
    }
    return failure('storage-error', `Could not store ${path} (Storage ${versionWrite.status}); nothing changed.`);
  }

  // 2. Only now the pointer. max-age=0 so a read straight after this upload is
  //    not served a cached copy of the previous pointer.
  const meta: SimulationPointer = {
    path,
    sha256,
    bytes: bytes.byteLength,
    uploadedAt: uploadedAt.toISOString(),
  };
  const pointerWrite = await store.put(
    SIMULATION_POINTER,
    new TextEncoder().encode(JSON.stringify(meta)),
    'application/json',
    true,
    'max-age=0',
  );
  if (!pointerWrite.ok) {
    return failure(
      'pointer-write-failed',
      `${path} was stored but ${SIMULATION_POINTER} could not be updated (Storage ${pointerWrite.status}); the previous version is still current.`,
      500,
      { orphan: path },
    );
  }

  return json({ ok: true, value: { meta } });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  const gate = await checkAppKey(request);
  if (!gate.ok) return json({ ok: false, error: gate.reason, retryAfter: gate.retryAfter }, gate.status);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRole) return json({ ok: false, error: 'Function is not configured' }, 500);

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: 'Expected a JSON body' }, 400);
  }

  const store = storage(url, serviceRole);
  try {
    if (body.action === 'read') return await handleRead(store);
    if (body.action === 'upload') {
      if (typeof body.html !== 'string') return json({ ok: false, error: 'Expected { html: string }' }, 400);
      return await handleUpload(store, body.html);
    }
    return json({ ok: false, error: 'Unknown action' }, 400);
  } catch (error) {
    // Network failure between the function and Storage. Status only — an
    // error message could carry a URL, and nothing here needs to echo one.
    console.error(`finish-line-simulation: ${error instanceof Error ? error.name : 'error'}`);
    return failure('storage-error', 'Storage could not be reached.');
  }
});
