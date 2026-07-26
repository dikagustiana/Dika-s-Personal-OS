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
