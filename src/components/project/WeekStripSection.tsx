import { format, isSameDay } from 'date-fns';
import type { Milestone } from '../../data/types';
import { cn } from '../../lib/utils';
import { WEEK_STRIP_COLUMNS, buildWeekStrip, weekStripLabel } from '../../logic/weekStrip';

const DAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/**
 * One project's milestones across the current week.
 *
 * Read-only and fixed to this week on purpose. It exists to answer "what is
 * targeted to finish this week, on this project" and nothing else — there is
 * no week navigation, no other project's bars, and no dependency lines here,
 * and adding any of them would turn a narrow lens into the Gantt that WORK
 * deliberately does not have.
 */
export function WeekStripSection({
  milestones,
  today,
  className,
}: {
  milestones: Milestone[];
  today: Date;
  className?: string;
}) {
  const strip = buildWeekStrip(milestones, today);
  // Nothing this week means no section at all — an empty seven-day grid reads
  // as a broken component, not as "nothing due".
  if (strip.bars.length === 0) return null;

  return (
    <section className={className} aria-label="Milestones this week">
      <div className="flex items-baseline gap-2">
        <p className="surface-label">This week</p>
        <p className="text-[11px] tabular-nums text-foreground-muted">
          {weekStripLabel(strip)}
        </p>
      </div>

      <div
        className="mt-2 grid gap-x-px"
        style={{ gridTemplateColumns: `repeat(${WEEK_STRIP_COLUMNS}, minmax(0, 1fr))` }}
      >
        {strip.days.map((day, index) => {
          const isToday = isSameDay(day, today);
          return (
            <div
              key={day.toISOString()}
              className={cn(
                'border-b py-1 text-center',
                isToday ? 'border-b-primary' : 'border-b-border-subtle',
              )}
              style={{ gridColumn: `${index + 1} / span 1`, gridRow: 1 }}
            >
              <span
                className={cn(
                  'block text-[10px] font-semibold uppercase',
                  isToday ? 'text-primary' : 'text-foreground-muted',
                )}
              >
                {DAY_INITIALS[index]}
              </span>
              <span
                className={cn(
                  'block text-[10px] tabular-nums',
                  isToday ? 'text-primary' : 'text-foreground-muted',
                )}
              >
                {format(day, 'd')}
              </span>
            </div>
          );
        })}

        {strip.bars.map((bar, index) => {
          const { milestone } = bar;
          return (
            <div
              key={milestone.id}
              className={cn(
                'mt-1 flex min-w-0 items-center gap-1.5 border px-2 py-1',
                // Rounding is the clipping signal: a flush edge means the bar
                // continues outside the visible week.
                bar.clippedStart ? 'rounded-l-none' : 'rounded-l-sm',
                bar.clippedEnd ? 'rounded-r-none' : 'rounded-r-sm',
                milestone.status === 'done' && 'border-success/40 bg-success/15',
                milestone.status === 'blocked' && 'border-destructive/40 bg-destructive/15',
                milestone.status === 'in-progress' && 'border-primary/30 bg-surface-3',
                milestone.status === 'not-started' && 'border-border-subtle bg-surface-2',
              )}
              style={{
                gridColumn: `${bar.startIndex + 1} / span ${bar.span}`,
                gridRow: index + 2,
              }}
              title={milestone.text}
            >
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-[11px]',
                  milestone.done
                    ? 'text-foreground-muted line-through'
                    : 'text-foreground-secondary',
                )}
              >
                {milestone.text}
              </span>
              {milestone.pic && (
                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
                  {milestone.pic}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
