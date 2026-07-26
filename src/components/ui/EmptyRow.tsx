import { ArrowRight } from 'lucide-react';

/**
 * An empty section, as one 44px row. Promoted from the WORK dashboard's local
 * EmptyRow, which was the only place the one-row empty-state rule was actually
 * implemented.
 *
 * The rule it enforces: an empty section is never taller than the same section
 * with content in it. Most sections are empty most days — with one daily log
 * and zero time blocks, the empty render IS the live render — so a boxed
 * empty state with a Playfair heading and a hint (~130px against a 44px row)
 * makes the sparse render the longest. EmptyState survives only for a screen
 * that is genuinely blank end to end.
 */
export function EmptyRow({
  label,
  clause,
  action,
  onAction,
}: {
  label: string;
  clause: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-1">
      <span className="surface-label">{label}</span>
      <span className="flex items-center gap-2 text-xs text-foreground-muted">
        {clause}
        {action && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="inline-flex items-center gap-1 rounded-sm text-xs font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {action}
            <ArrowRight className="size-3" />
          </button>
        )}
      </span>
    </div>
  );
}
