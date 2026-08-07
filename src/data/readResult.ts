import { isAbsentRelation, isMissingRelation, type RelationError } from './missingRelation';

/**
 * THREE OUTCOMES FOR A READ, NEVER TWO.
 *
 * ===========================================================================
 * AN EMPTY ARRAY IS A SAFE ANSWER FOR A READ THAT DISPLAYS DATA. IT IS A LIE
 * FOR A READ THAT COUNTS PROBLEMS.
 * ===========================================================================
 *
 * The live build once rendered `0 milestones make no pack line trustworthy —
 * None` at a moment when the truth was 458 and the view did not exist. The
 * read failed, degraded to `[]`, and the copy turned that failure into good
 * news. That is the single most-repeated failure in this project's history and
 * it is invisible by construction: a zero looks exactly like a zero.
 *
 * The root cause was NOT the card. It was that `isMissingRelation` returns a
 * boolean and every call site did `if (isMissingRelation(error)) return []` —
 * so "the table is empty" and "the read did not happen" arrived at the card as
 * the same value, and no card could have told them apart no matter how it was
 * written.
 *
 * So a read hands back a RESULT, not an array. A caller that wants to compute
 * over rows can still degrade with `rowsOf`, but it can never accidentally
 * report a failure as a count: to print a number it has to look at `ok` first,
 * and the type makes it.
 *
 * The two failure reasons are kept apart because they mean different things to
 * whoever is debugging:
 *   missing-relation  the migration has not been applied here. EXPECTED before
 *                     a deploy lands; must not render as a red error.
 *   failed            permission, network, malformed query. Unexpected.
 * Both are "could not check" to the reader, and NEITHER may show a number.
 */

export type ReadFailureReason = 'missing-relation' | 'failed';

export interface ReadFailure {
  ok: false;
  reason: ReadFailureReason;
  /** What to show a person debugging. Never a count. */
  detail: string;
}

export type ReadResult<T> = { ok: true; rows: T[] } | ReadFailure;

export function okRows<T>(rows: T[]): ReadResult<T> {
  return { ok: true, rows };
}

/**
 * ===========================================================================
 * THE CODE IS PART OF THE MESSAGE. IT USED TO BE THROWN AWAY.
 * ===========================================================================
 * `detail` was `error.message ?? error.code`, so whenever PostgREST supplied
 * prose — which is almost always — the SQLSTATE was dropped on the floor. The
 * one failure in this project's history that was diagnosed in seconds rather
 * than minutes was the one where `permission denied for function
 * os_member_entities` reached the screen intact. `42501` beside it is what
 * turns "something went wrong" into a grep.
 *
 * So a detail now reads: operation, code, plain-language condition, message.
 *
 *   listProcessSteps: 42501 — izin ditolak (RLS atau grant), bukan data kosong
 *     — permission denied for function os_member_entities
 *
 * The named conditions are the ones this codebase has actually been bitten
 * by. Each states its OWN condition, which is the point: 42P01 and 42703 are
 * neighbours that mean different things, and a shared sentence for them is
 * what sent someone hunting a frontend bug for a half-applied migration.
 */
const CONDITION: Record<string, string> = {
  '42P01': 'tabel belum ada di database',
  '42703': 'kolom belum ada di tabel — migration setengah jalan, bukan data kosong',
  '42501': 'izin ditolak (RLS atau grant), bukan data kosong',
  PGRST200: 'relasi embed tidak bisa diresolusi',
  PGRST201: 'relasi embed ambigu',
  PGRST205: 'tabel tidak ada di schema cache PostgREST',
};

function detailOf(label: string, error: RelationError): string {
  const code = error.code ?? '';
  const parts = [code, CONDITION[code], error.message].filter(
    (part): part is string => Boolean(part),
  );
  return `${label}: ${parts.length > 0 ? parts.join(' — ') : 'unknown error'}`;
}

/**
 * Classifies a PostgREST error into the two failure reasons.
 *
 * `isMissingRelation` stays the classifier it always was — this is the layer
 * that stops the classification from collapsing into an empty array.
 */
export function readFailure(label: string, error: RelationError): ReadFailure {
  const detail = detailOf(label, error);
  return isMissingRelation(error)
    ? { ok: false, reason: 'missing-relation', detail }
    : { ok: false, reason: 'failed', detail };
}

/**
 * The same classification, through the NARROW predicate: only a genuinely
 * absent relation (42P01 / PGRST205) is 'missing-relation'; a broken query
 * against a relation that exists — a renamed column (42703), an unresolvable
 * embed (PGRST200) — comes back 'failed' and reaches the surface.
 *
 * Used by every os_process_* read. See the header of isAbsentRelation for why
 * the generous predicate is the wrong one there: it turns a wrong query into
 * an empty state, which is indistinguishable from a table that has not shipped
 * yet, and neither says anything to the console.
 */
export function readAbsence(label: string, error: RelationError): ReadFailure {
  const detail = detailOf(label, error);
  return isAbsentRelation(error)
    ? { ok: false, reason: 'missing-relation', detail }
    : { ok: false, reason: 'failed', detail };
}

/** Wraps a thrown read — a caller that catches must not invent a zero either. */
export function readThrew(label: string, error: unknown): ReadFailure {
  const detail = error instanceof Error ? error.message : String(error);
  return { ok: false, reason: 'failed', detail: `${label}: ${detail}` };
}

/**
 * Rows for computation, empty when the read did not happen.
 *
 * Deliberately NOT named `rowsOrEmpty` and deliberately not the default way to
 * consume a result: it is correct for building a matrix (an absent edge list
 * means the matrix renders without edges) and WRONG for anything that prints a
 * count. Anything printing a count reads `ok` first.
 */
export function rowsOf<T>(result: ReadResult<T>): T[] {
  return result.ok ? result.rows : [];
}

/** The first failure among several reads, for a card that depends on more than one. */
export function firstFailure(
  ...results: ReadResult<unknown>[]
): ReadFailure | undefined {
  for (const result of results) if (!result.ok) return result;
  return undefined;
}

/**
 * What a card that COUNTS PROBLEMS renders. Three, never two.
 *
 * `confirmed-zero` and `could-not-check` must never share wording, and only
 * the first two may carry a number — enforced by the shape, since
 * `could-not-check` has no `count` field to render.
 */
export type CardState<T> =
  | { kind: 'has-data'; count: number; rows: T[] }
  | { kind: 'confirmed-zero' }
  | { kind: 'could-not-check'; reason: ReadFailureReason; detail: string };

export function cardState<T>(result: ReadResult<T>): CardState<T> {
  if (!result.ok) {
    return { kind: 'could-not-check', reason: result.reason, detail: result.detail };
  }
  if (result.rows.length === 0) return { kind: 'confirmed-zero' };
  return { kind: 'has-data', count: result.rows.length, rows: result.rows };
}

/**
 * The same three states for a count a card DERIVES rather than reads — the
 * unplanned count comes from resolving the matrix, not from a single query, so
 * it is could-not-check when any read it depends on failed.
 */
export function derivedCardState<T>(
  failure: ReadFailure | undefined,
  rows: T[],
): CardState<T> {
  if (failure) {
    return { kind: 'could-not-check', reason: failure.reason, detail: failure.detail };
  }
  if (rows.length === 0) return { kind: 'confirmed-zero' };
  return { kind: 'has-data', count: rows.length, rows };
}
