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
  // scaleX on a full-width fill, not transition-[width]: width is a layout
  // property, and this component renders per weekly goal, per close series,
  // per project card and per child row — a single milestone tick was running
  // layout and paint on every bar on screen instead of a composite.
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-sm bg-surface-3', className)}>
      <div
        className="h-full w-full origin-left bg-success transition-transform duration-150"
        style={{ transform: `scaleX(${Math.min(100, Math.max(0, value)) / 100})` }}
      />
    </div>
  );
}
