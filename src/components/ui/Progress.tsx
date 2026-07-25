import { cn } from '../../lib/utils';

export function Progress({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  // The bar measures completion, not an action — it fills with `success`.
  // The track steps DOWN into surface-3: on white, surface-2 is too close to
  // the card to read as a groove.
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-sm bg-surface-3', className)}>
      <div
        className="h-full bg-success transition-[width]"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}
