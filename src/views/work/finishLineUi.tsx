import {
  CircleCheck,
  CircleHelp,
  CircleSlash,
  Clock,
  Lock,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { CellState } from '../../data/types';
import type { Resolution } from '../../logic/finishLine';

/**
 * Shared presentation for the Finish line's two levels — the group matrix and
 * the per-entity views. One copy on purpose: a resolution that rendered one
 * tone at group level and another at entity level would be two claims about
 * one fact.
 *
 * No colour literals. Amber (`escalate`) is the gap tone throughout; red
 * (`destructive`) is reserved for data that is WRONG rather than missing.
 * Filled vs outlined follows the app's existing convention — blocked is
 * outlined, and `stuck` is the blocked case.
 */
export const RESOLUTION_STYLE: Record<Resolution, string> = {
  cycle: 'bg-destructive text-destructive-foreground',
  // No road exists: you must create a milestone. Filled.
  unplanned: 'bg-escalate/20 text-escalate',
  // A road exists and is blocked: you must unblock one. Outlined.
  stuck: 'border border-escalate text-escalate',
  'in-progress': 'bg-escalate/10 text-escalate',
  contradiction: 'border border-destructive text-destructive',
  pending: 'bg-escalate/10 text-foreground-muted',
  // Finished. Deliberately unmarked — the absence of amber IS the signal.
  backed: 'text-foreground-secondary',
  undefined: 'bg-surface-3 text-foreground-muted',
  zero: 'text-foreground-muted',
};

/**
 * Tooltips explain the RESOLUTION. English, as every other tooltip in the app
 * is; the legend owns the glyph gloss in Indonesian.
 */
export const RESOLUTION_LABEL: Record<Resolution, string> = {
  cycle: 'Dependency cycle — the seed is wrong',
  unplanned: 'Unplanned — nothing stands behind this yet',
  stuck: 'Stuck — every linked milestone is blocked',
  'in-progress': 'In progress — work is under way',
  contradiction:
    'Contradiction — every linked milestone is done, yet the number still does not exist',
  pending: 'Waiting, with no inputs recorded',
  backed: 'Backed — every linked milestone is done',
  undefined: 'Undefined — zero divisor, not work outstanding',
  zero: 'Nil, and deferred — nil is not treated as a gap yet',
};

/**
 * ===========================================================================
 * ONE HUE PER STATE, USED IN BOTH PLACES A STATE IS SHOWN.
 * ===========================================================================
 * `line` tints the explanation inside the panel. `cell` marks the OPEN cell in
 * the matrix — a row carries five of them, so "which one is this panel about"
 * has to be answerable without counting columns. Both draw the same hue, so
 * the tint under the glyph and the tint on the sentence read as one fact.
 *
 * No colour literals: every tone is a semantic token. `zero` and `undefined`
 * are deliberately NOT interchangeable — a solid quiet border for the nil that
 * is finished, a dashed one for the cell nobody has decided about yet, because
 * they mean opposite things and a matrix already renders them nearly alike.
 */
export const STATE_TONE: Record<CellState, { line: string; cell: string; icon: LucideIcon }> = {
  figure: {
    line: 'border-success/40 bg-success/10 text-success',
    cell: 'bg-success/15 border-[1.5px] border-success',
    icon: CircleCheck,
  },
  input: {
    line: 'border-escalate/40 bg-escalate/10 text-escalate',
    cell: 'bg-escalate/15 border-[1.5px] border-escalate',
    icon: Clock,
  },
  zero: {
    line: 'border-border bg-surface-2 text-foreground-secondary',
    cell: 'bg-surface-3 border-[1.5px] border-border',
    icon: CircleSlash,
  },
  undefined: {
    line: 'border-dashed border-border bg-surface-3 text-foreground-muted',
    cell: 'bg-surface-3 border-[1.5px] border-dashed border-border',
    icon: CircleHelp,
  },
  locked: {
    line: 'border-primary/30 bg-primary/10 text-primary',
    cell: 'bg-primary/15 border-[1.5px] border-primary',
    icon: Lock,
  },
};

export const ROW_STYLE: Record<string, string> = {
  det: 'pl-7 text-foreground-muted',
  sub: 'pl-4 font-semibold text-foreground-secondary',
  tot: 'pl-4 font-semibold text-foreground border-y border-border',
  lock: 'pl-4 text-foreground-muted',
  plain: 'pl-4 text-foreground-secondary',
};

/**
 * The state between "not asked yet" and an answer. Its whole job is to not be
 * either of the other two: a card that counts problems has no honest zero to
 * show before its read returns, and no clean bill to give.
 */
export function Checking({ label }: { label: string }) {
  return (
    <div className="mb-3 rounded-lg border border-border-subtle bg-card px-4">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-1">
        <span className="surface-label">{label}</span>
        <span className="text-xs text-foreground-muted">Checking…</span>
      </div>
    </div>
  );
}

/**
 * ===========================================================================
 * THIS RENDERS NO NUMBER. NOT EVEN ZERO.
 * ===========================================================================
 * An empty state is safe for a card that displays data and a LIE for a card
 * that counts problems. `0 milestones make no pack line trustworthy — None`
 * shipped while the truth was 458. The wording is also deliberately unlike
 * the confirmed-zero wording: "could not check" and "none" must never be
 * mistakable for one another at a glance.
 */
export function CouldNotCheck({
  label,
  failure,
}: {
  label: string;
  failure: { reason: 'missing-relation' | 'failed'; detail: string };
}) {
  return (
    <div>
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="surface-label">{label}</span>
        <span
          className={cn(
            'flex items-center gap-2 text-xs font-semibold',
            failure.reason === 'failed' ? 'text-destructive' : 'text-escalate',
          )}
        >
          <TriangleAlert className="size-3.5" />
          Could not check
        </span>
      </div>
      <p className="mt-1 text-xs leading-5 text-foreground-muted">
        {failure.reason === 'missing-relation'
          ? 'This relation is not in the database yet, so there is no count to report — not a zero, and not a clean bill.'
          : 'The read did not complete, so there is no count to report — not a zero, and not a clean bill.'}
      </p>
      <p className="mt-1 text-[11px] leading-5 text-foreground-muted">{failure.detail}</p>
    </div>
  );
}
