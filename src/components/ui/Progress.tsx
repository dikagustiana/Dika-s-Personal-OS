import { cn } from '../../lib/utils';

export function Progress({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-sm bg-gray-800', className)}>
      <div
        className="h-full bg-primary transition-[width]"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}
