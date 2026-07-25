import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

// White card on a grey canvas is only 1.09:1 apart, so the edge is carried by
// the border and one navy-tinted shadow rather than by a lightness gap.
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <section
      className={cn('rounded-lg border border-border bg-card shadow-card', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-start justify-between gap-4 p-5', className)} {...props} />;
}

// Card headings are sentence-case Playfair — the eyebrow treatment lives in
// `.surface-label` and appears at most once per card.
export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn('font-display text-card-heading font-semibold text-foreground', className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pb-5', className)} {...props} />;
}
