import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * A designed empty moment instead of floating text: one Playfair line at
 * card-heading size, one secondary line saying what to do next, and an
 * optional inline action.
 */
export function EmptyState({
  title,
  hint,
  action,
  className,
}: {
  title: string;
  hint: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('py-8 text-center', className)}>
      <p className="font-display text-card-heading font-semibold text-foreground">{title}</p>
      <p className="mx-auto mt-1.5 max-w-xs text-sm text-foreground-secondary">{hint}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
