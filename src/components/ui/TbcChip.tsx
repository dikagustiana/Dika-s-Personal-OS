import { cn } from '../../lib/utils';

/**
 * Marks a date the owner has not verified against an official source —
 * outline style in the amber token, never a filled badge. Rendered beside
 * every estimated/unknown date wherever project dates appear.
 */
export function TbcChip({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-sm border border-escalate/60 px-1 py-px text-[9px] font-semibold uppercase tracking-[0.08em] text-escalate',
        className,
      )}
    >
      TBC
    </span>
  );
}
