import { CalendarClock, ListChecks, Link2 } from 'lucide-react';
import type { DateConfidence, Project } from '../../data/types';
import type { MilestoneRollup } from '../../logic/hierarchy';
import { daysLeft, daysLeftLabelFor, formatDateFor, resolveConfidence } from '../../logic/deadlines';
import { TbcChip } from '../ui/TbcChip';

function Tile({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub: React.ReactNode;
}) {
  return (
    <div className="border border-border-subtle bg-surface-2 p-3">
      <div className="flex items-center gap-1.5">
        {icon}
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-foreground-muted">
          {label}
        </p>
      </div>
      <p className="mt-2 text-sm font-semibold tabular-nums text-foreground">{value}</p>
      <p className="mt-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-foreground-muted">
        {sub}
      </p>
    </div>
  );
}

function deadlineText(deadline?: string, confidence?: DateConfidence): string {
  if (!deadline) return 'No deadline';
  return daysLeftLabelFor(daysLeft(deadline, new Date()), confidence);
}

/**
 * The permanent three-tile strip: deadline, linked activity, milestones.
 *
 * Always visible — it is the project's dashboard, not a detail behind a
 * disclosure. Only the milestone *list* collapses.
 */
export function MetricTiles({
  project,
  linkedTasksDone,
  linkedTasksTotal,
  rollup,
}: {
  project: Project;
  linkedTasksDone: number;
  linkedTasksTotal: number;
  rollup: MilestoneRollup;
}) {
  const percent = rollup.total ? Math.round((100 * rollup.done) / rollup.total) : 0;
  const isUmbrella = rollup.ownTotal === 0 && rollup.childCount > 0;

  // A parent with no milestones of its own still reports a real rollup number
  // rather than a zero; the em dash is reserved for a project where there is
  // genuinely nothing to count, own or inherited.
  let milestoneValue: string;
  let milestoneSub: string;
  if (rollup.total === 0) {
    milestoneValue = '—';
    milestoneSub = isUmbrella ? 'Umbrella' : 'No milestones';
  } else {
    milestoneValue = `${rollup.done}/${rollup.total}`;
    if (isUmbrella) milestoneSub = `Umbrella · ${percent}%`;
    else if (rollup.childCount > 0) milestoneSub = `${percent}% incl. sub-projects`;
    else milestoneSub = `${percent}% complete`;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Tile
        icon={<CalendarClock className="size-3.5 text-foreground-muted" />}
        label="Deadline"
        value={deadlineText(project.deadline, project.dateConfidence)}
        sub={
          <>
            {project.deadline
              ? formatDateFor(project.deadline, project.dateConfidence)
              : 'Open horizon'}
            {project.deadline && resolveConfidence(project.dateConfidence) !== 'confirmed' && (
              <TbcChip />
            )}
          </>
        }
      />
      <Tile
        icon={<Link2 className="size-3.5 text-foreground-muted" />}
        label="Linked"
        // Same contract as the Milestones tile above: the em dash means
        // nothing to count, so 37 cards stop printing a 0/0 the eye must
        // dismiss on every pass.
        value={linkedTasksTotal === 0 ? '—' : `${linkedTasksDone}/${linkedTasksTotal} tasks`}
        sub={linkedTasksTotal === 0 ? 'No linked tasks' : 'This week'}
      />
      <Tile
        icon={<ListChecks className="size-3.5 text-foreground-muted" />}
        label="Milestones"
        value={milestoneValue}
        sub={milestoneSub}
      />
    </div>
  );
}
