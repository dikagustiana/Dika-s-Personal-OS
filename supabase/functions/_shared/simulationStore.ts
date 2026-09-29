// The Finish line simulation's storage vocabulary, kept PURE for the same
// reason as simulationUpload.ts: the Edge Function cannot run under vitest
// and CI has no Deno, so the parts of finish-line-simulation that decide what
// a Storage answer MEANS live here, where src/data/simulationStore.test.ts
// executes them.
//
// Layout of the bucket (20260928000108):
//   versions/<YYYYMMDDTHHMMSSZ>_<sha256 first 8>.html
//       one object per upload; never overwritten, never deleted by the app
//   current.json
//       { path, sha256, bytes, uploadedAt } — the pointer, and the only
//       object that ever changes

export const SIMULATION_BUCKET = 'finish-line-simulation';
export const SIMULATION_POINTER = 'current.json';

export interface SimulationPointer {
  path: string;
  sha256: string;
  bytes: number;
  uploadedAt: string;
}

/**
 * Exactly the shape versionPath() writes. Anchored, so a tampered pointer
 * cannot name `../elsewhere` or an object outside versions/ — the read only
 * ever follows a path this function could have produced.
 */
const VERSION_PATH_RE = /^versions\/\d{8}T\d{6}Z_[0-9a-f]{8}\.html$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

/** versions/<YYYYMMDDTHHMMSSZ>_<sha8>.html — UTC, second resolution. */
export function versionPath(at: Date, sha256: string): string {
  const stamp = at.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
  return `versions/${stamp}_${sha256.slice(0, 8)}.html`;
}

export type PointerParse =
  | { ok: true; pointer: SimulationPointer }
  | { ok: false; problem: string };

/**
 * current.json as the read must see it before trusting it. Strict on purpose:
 * a pointer that cannot say exactly which version, of what size and digest,
 * uploaded when, is a broken pointer — reported as one, never read as "no
 * version yet", which is a different fact.
 */
export function parsePointer(raw: unknown): PointerParse {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, problem: 'current.json is not a JSON object' };
  }
  const { path, sha256, bytes, uploadedAt } = raw as Record<string, unknown>;
  if (typeof path !== 'string' || !VERSION_PATH_RE.test(path)) {
    return { ok: false, problem: 'current.json has no valid versions/… path' };
  }
  if (typeof sha256 !== 'string' || !SHA256_RE.test(sha256)) {
    return { ok: false, problem: 'current.json has no valid sha256' };
  }
  if (!path.endsWith(`_${sha256.slice(0, 8)}.html`)) {
    return { ok: false, problem: 'current.json path and sha256 disagree' };
  }
  if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes <= 0) {
    return { ok: false, problem: 'current.json has no valid byte count' };
  }
  if (
    typeof uploadedAt !== 'string' ||
    Number.isNaN(Date.parse(uploadedAt)) ||
    new Date(uploadedAt).toISOString() !== uploadedAt
  ) {
    return { ok: false, problem: 'current.json has no valid uploadedAt' };
  }
  return { ok: true, pointer: { path, sha256, bytes, uploadedAt } };
}

function errorText(body: unknown): { statusCode: string; text: string } {
  if (!body || typeof body !== 'object') return { statusCode: '', text: '' };
  const fields = body as Record<string, unknown>;
  const statusCode = fields.statusCode === undefined ? '' : String(fields.statusCode);
  const text = [fields.error, fields.message]
    .filter((part): part is string => typeof part === 'string')
    .join(' ');
  return { statusCode, text };
}

/**
 * WHAT IS MISSING, if anything. Storage has answered "not found" in more than
 * one shape across versions — an HTTP 404, or an HTTP 400 carrying the real
 * status in the body's statusCode — and it answers a missing BUCKET with the
 * same status as a missing object. Both shapes are recognised and the two
 * absences are told apart by the body, because they mean different things to
 * the tab: a missing object is "no version yet", a missing bucket is a
 * migration that has not been applied.
 *
 * NOTHING ELSE is an absence. A 401, 403 or 5xx is a failure to look, and
 * reading one as "never uploaded" would render an empty state for a read that
 * did not happen.
 */
export function storageAbsence(status: number, body: unknown): 'bucket' | 'object' | null {
  const { statusCode, text } = errorText(body);
  const notFound =
    status === 404 || (status === 400 && (statusCode === '404' || /not[\s_-]?found/i.test(text)));
  if (!notFound) return null;
  return /bucket/i.test(text) ? 'bucket' : 'object';
}

/** A write that met an existing object: 409, or 400 carrying 409 / "Duplicate". */
export function isStorageConflict(status: number, body: unknown): boolean {
  if (status === 409) return true;
  if (status !== 400) return false;
  const { statusCode, text } = errorText(body);
  return statusCode === '409' || /duplicate|already exists/i.test(text);
}
