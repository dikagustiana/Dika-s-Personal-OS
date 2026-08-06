/**
 * The one place that decides "this relation does not exist yet".
 *
 * The frontend can reach production before a migration has been applied. That
 * has already shipped a view against a non-existent schema twice in this
 * project, so every read of a new table or view routes through here and treats
 * a missing relation as the NORMAL EMPTY STATE — not an unhandled rejection,
 * not a crash, not a red error card.
 *
 * ONE SHARED HELPER, deliberately, rather than a try/catch at each call site:
 * a per-call-site check is a rule that decays the first time someone adds a
 * read and forgets, and the failure it guards against is invisible until it
 * reaches production.
 *
 * The codes:
 *   42P01  undefined_table — the table or view is not there.
 *   42703  undefined_column — the table exists but predates the new columns,
 *          which is what a partially-applied migration looks like.
 *   PGRST2xx  PostgREST cannot find the relation in its schema cache, which is
 *          how Supabase reports the same situation over HTTP.
 *
 * A missing relation is NOT the same as a failed read. Anything else still
 * throws: a permission error, a network failure or a malformed query must stay
 * loud, because rendering "empty" for those would say the pack is empty when
 * nobody actually knows.
 *
 * ===========================================================================
 * THIS PREDICATE CLASSIFIES. IT DOES NOT DECIDE WHAT THE CALLER RETURNS.
 * ===========================================================================
 * It used to, in effect: every finish-line read did
 *
 *     if (isMissingRelation(error)) return [];
 *
 * which handed a failed read and an empty table to the caller as the SAME
 * VALUE. That is how the live build came to render `0 milestones make no pack
 * line trustworthy — None` while the truth was 458. The card could not have
 * been written to catch it — by the time the array arrived, the distinction
 * was gone.
 *
 * Reads now return `ReadResult<T>` (see readResult.ts) and this stays what it
 * always was: the one place that recognises the codes. Do not reintroduce a
 * `return []` at a call site.
 */
export interface RelationError {
  code?: string;
  message?: string;
}

export function isMissingRelation(error: RelationError | null | undefined): boolean {
  if (!error) return false;
  const code = error.code ?? '';
  if (code === '42P01' || code === '42703') return true;
  if (code.startsWith('PGRST2')) return true;
  const message = (error.message ?? '').toLowerCase();
  return (
    message.includes('does not exist') ||
    message.includes('could not find the table') ||
    message.includes('schema cache')
  );
}

/**
 * ===========================================================================
 * THE NARROW PREDICATE: "THE TABLE IS NOT THERE", AND NOTHING ELSE.
 * ===========================================================================
 * `isMissingRelation` above is deliberately generous, because the reads it
 * guards were written when a whole feature could arrive before its migration
 * and ANY shape of not-yet was the expected state. That generosity has a cost
 * this project has now paid twice over, and the second time was worse than the
 * first: a read whose relation EXISTS but whose query is wrong — a column that
 * was renamed (42703), an embed whose relationship PostgREST cannot resolve
 * (PGRST200), an ambiguous one (PGRST201) — is classified as "not deployed
 * yet" and rendered as an ordinary empty state. No error, no warning, no
 * console line. A wrong query and an unapplied migration become the same
 * pixel.
 *
 * That is the identical failure `readResult.ts` was written to end, one level
 * up: there it was `[]` standing in for a failed read, here it is
 * `missing-relation` standing in for a broken query. Both erase a distinction
 * before anything downstream can see it.
 *
 * So the process reads classify through THIS predicate instead, and it
 * recognises exactly one fact:
 *
 *   42P01     undefined_table — Postgres itself says the relation is absent.
 *   PGRST205  PostgREST cannot find the TABLE in its schema cache. This is
 *             the same fact over HTTP and it is what production actually
 *             returned (404) before migration 20260806000050 was applied, so
 *             leaving it out would turn the pre-deploy state into a red card.
 *
 * Everything else — 42703, PGRST200, PGRST201, permission, network, malformed
 * query — is a FAILURE and must reach the surface. No message-substring
 * matching either: 'does not exist' appears in the text of errors that have
 * nothing to do with a missing table (a missing function, a bad cast, a
 * column reference), and matching on prose is how a guard silently widens.
 *
 * Do NOT relax this back toward `isMissingRelation`. If a new not-yet-deployed
 * shape needs to be tolerated, add its exact code here with the reason.
 */
export function isAbsentRelation(error: RelationError | null | undefined): boolean {
  if (!error) return false;
  const code = error.code ?? '';
  return code === '42P01' || code === 'PGRST205';
}
