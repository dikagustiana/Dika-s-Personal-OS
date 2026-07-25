/**
 * Invariants the research repository enforces on every write, in the mutation
 * path rather than in the UI.
 *
 * ===========================================================================
 * MODEL OUTPUT CAN NEVER VERIFY ANYTHING.
 * ===========================================================================
 * A model may fill `value`, `source`, `asof` and `note`, and may create claims
 * at layer (c). It may NEVER:
 *   - set an item's status to 'V'
 *   - create a claim at layer (a) or (b)
 *   - tick a gate
 *   - write a review cycle or a decision-log entry
 *
 * Verification is the owner's judgement, applied by hand in the register, and
 * the entire apparatus is worthless the moment that stops being true — a
 * pipeline whose gates can be passed by the thing being checked is theatre.
 *
 * So `origin` is a required argument, not an optional hint: every write says
 * where it came from, and 'model' writes are narrowed here. A UI-only guard
 * would be bypassed by the first caller that forgot.
 * ===========================================================================
 */
import type { ResearchClaim, ResearchItem } from './types';

/** Who is asking for the write. */
export type WriteOrigin = 'human' | 'model';

export class ResearchGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResearchGuardError';
  }
}

/** The item fields a model is permitted to touch. */
const MODEL_WRITABLE_ITEM_FIELDS: ReadonlySet<keyof ResearchItem> = new Set([
  'value',
  'source',
  'asof',
  'note',
]);

/**
 * Narrows an item patch to what `origin` is allowed to write. A model patch
 * that tries to set status (to anything, not only 'V') or flip `crit` is
 * rejected rather than silently trimmed: silently dropping a field would leave
 * the caller believing the write succeeded.
 */
export function guardItemPatch(
  patch: Partial<ResearchItem>,
  origin: WriteOrigin,
): Partial<ResearchItem> {
  if (origin === 'human') return patch;
  const offending = (Object.keys(patch) as Array<keyof ResearchItem>).filter(
    (key) => !MODEL_WRITABLE_ITEM_FIELDS.has(key),
  );
  if (offending.length > 0) {
    throw new ResearchGuardError(
      `Model writes may only touch ${[...MODEL_WRITABLE_ITEM_FIELDS].join(', ')} — refused: ${offending.join(', ')}. Verification is a human judgement made in the register.`,
    );
  }
  return patch;
}

/** A model-created item always arrives indeterminate, whatever it asked for. */
export function guardNewItem(
  input: Omit<ResearchItem, 'id'>,
  origin: WriteOrigin,
): Omit<ResearchItem, 'id'> {
  if (origin === 'human') return input;
  if (input.crit) {
    throw new ResearchGuardError(
      'Model writes cannot mark an item critical — that is a judgement about what blocks the pipeline.',
    );
  }
  return { ...input, status: 'IND' };
}

/** A model may only ever create a layer (c) claim. */
export function guardNewClaim(
  input: Omit<ResearchClaim, 'id'>,
  origin: WriteOrigin,
): Omit<ResearchClaim, 'id'> {
  if (origin === 'human') return input;
  if (input.layer !== 'c') {
    throw new ResearchGuardError(
      `Model writes may only create layer (c) claims — refused layer (${input.layer}). A verified finding requires a source the owner opened.`,
    );
  }
  return input;
}

/**
 * Gates, cycles and the decision log are human-only in full. Kept as a single
 * explicit check so the reason lives in one place.
 */
export function guardHumanOnly(origin: WriteOrigin, what: string): void {
  if (origin !== 'human') {
    throw new ResearchGuardError(
      `${what} is recorded by the owner alone — model output cannot reach it.`,
    );
  }
}
