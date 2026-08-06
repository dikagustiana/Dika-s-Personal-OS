/**
 * REFERENCES: a reading list beside the process map, not annotation on it.
 *
 * The chain says WHAT happens; the writing on dikagustiana.com says why it is
 * shaped that way. This block is the door between them and nothing more — no
 * prose is stored here, no reference points at a step, and there is no bridge
 * table anywhere. Group-level: it does not follow the entity picker, because
 * the methodology is the same methodology whichever chain is in view.
 *
 * ===========================================================================
 * COLLAPSED, IT COSTS ZERO VERTICAL SPACE — THAT IS THE WHOLE LAYOUT RULE.
 * ===========================================================================
 * The process map is the point of these tabs, and a reading list must never
 * push it down to announce itself. So the trigger is NOT its own row: it
 * rides in the scope row that already exists, as its lightest element, and
 * only the OPEN panel occupies space of its own — below the scope row, above
 * the toolbar. That is why this file exports two pieces instead of one
 * component: they live in different places in the DOM, and a single component
 * would have had to wrap both and reintroduce the row it is avoiding.
 *
 * WHEN IT RENDERS NOTHING AT ALL: the table is absent (pre-migration 42P01)
 * or holds no rows. Not an empty state, not a message — an empty reading list
 * is not news. A read that failed for a REAL reason still says so, quietly
 * and inline, because this project does not let failures wear the costume of
 * emptiness (see readResult.ts) — but it says it in the trigger's own space,
 * so even that case adds no height.
 */
import { ChevronRight } from 'lucide-react';
import type { ProcessReference } from '../../data/types';
import { cn } from '../../lib/utils';

/** What the two pieces agree about, derived once by the view. */
export type ReferencesState =
  | { kind: 'hidden' }
  | { kind: 'ready'; rows: ProcessReference[] }
  | { kind: 'failed' };

/**
 * Absent relation or zero rows → hidden. A genuine failure stays visible, at
 * the smallest size that is still honest.
 */
export function referencesState(read: {
  ok: boolean;
  reason?: 'missing-relation' | 'failed';
  rows?: ProcessReference[];
}): ReferencesState {
  if (!read.ok) return read.reason === 'failed' ? { kind: 'failed' } : { kind: 'hidden' };
  const rows = read.rows ?? [];
  return rows.length === 0 ? { kind: 'hidden' } : { kind: 'ready', rows };
}

/**
 * The trigger. Belongs INSIDE the scope row — deliberately quieter than the
 * entity buttons beside it: borderless where they are bordered, muted where
 * they are foreground. It names a place to read, not a control over the view,
 * and the hierarchy has to say so.
 */
export function ReferencesToggle({
  state,
  open,
  onToggle,
}: {
  state: ReferencesState;
  open: boolean;
  onToggle: () => void;
}) {
  if (state.kind === 'hidden') return null;
  if (state.kind === 'failed') {
    return (
      <span className="text-[11px] leading-5 text-escalate">
        Referensi tidak bisa dimuat
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls="process-references-panel"
      className={cn(
        'inline-flex min-h-8 items-center gap-1 rounded-sm px-1 text-[11px] font-semibold',
        'text-foreground-muted hover:text-foreground-secondary',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <ChevronRight
        aria-hidden="true"
        // The one transition in this block: a transform, interruptible, and
        // cheap. The panel itself does not animate — an open/close height
        // animation would need measurement, and the honest version of that is
        // not worth what it buys on a list of links.
        className={cn('size-3 transition-transform duration-150', open && 'rotate-90')}
      />
      Referensi
      <span className="tabular-nums">{state.rows.length}</span>
    </button>
  );
}

/**
 * The panel. Renders only when open, so the closed state contributes no box
 * to the document flow at all — not a zero-height one, none.
 */
export function ReferencesPanel({
  state,
  open,
}: {
  state: ReferencesState;
  open: boolean;
}) {
  if (!open || state.kind !== 'ready') return null;
  return (
    <div
      id="process-references-panel"
      className="mb-6 rounded-lg border border-border-subtle bg-surface-2 px-4 py-3"
    >
      <ul className="space-y-2">
        {state.rows.map((reference) => (
          <li key={reference.id}>
            <a
              href={reference.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-sm text-xs font-semibold leading-5 text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {reference.title}
            </a>
            {reference.note && (
              <p className="text-[11px] leading-4 text-foreground-muted">{reference.note}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
