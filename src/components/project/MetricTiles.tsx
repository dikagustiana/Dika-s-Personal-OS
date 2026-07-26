import { CalendarClock, ListChecks, Target } from 'lucide-react';
import type { DateConfidence, Project } from '../../data/types';
import { cn } from '../../lib/utils';
import type { MilestoneRollup } from '../../logic/hierarchy';
import { daysLeft, daysLeftLabelFor, formatDateFor, resolveConfidence } from '../../logic/deadlines';
import { TbcChip } from '../ui/TbcChip';

function Tile({
  icon,
  label,
  value,
  sub,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub: React.ReactNode;
  /** When present the tile becomes a button; otherwise it stays a plain div. */
  onClick?: () => void;
}) {
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'block w-full border border-border-subtle bg-surface-2 p-3 text-left',
        onClick &&
          'transition-colors duration-150 hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
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
    </Wrapper>
  );
}

function deadlineText(deadline?: string, confidence?: DateConfidence): string {
  if (!deadline) return 'No deadline';
  return daysLeftLabelFor(daysLeft(deadline, new Date()), confidence);
}

/**
 * The permanent three-tile strip: deadline, pack lines, milestones.
 *
 * The middle tile used to count linked TASKS. There are zero tasks in the
 * database and none are being created, so it rendered an em dash permanently —
 * a tile that never says anything. It now carries the project -> pack
 * direction instead: how many matrix CELLS this project's milestones close.
 * Repurposed rather than joined by a fourth tile, which would have made the
 * strip longer to say the same amount.
 *
 * Always visible — it is the project's dashboard, not a detail behind a
 * disclosure. Only the milestone *list* collapses.
 */
export function MetricTiles({
  project,
  packCells,
  hasPackData,
  onOpenPack,
  rollup,
}: {
  project: Project;
  /** Matrix cells this project's milestones close. */
  packCells: number;
  /** False when the caller did not load the edges — then the tile says nothing. */
  hasPackData: boolean;
  /** Opens the matrix. Absent in read-only contexts. */
  onOpenPack?: () => void;
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
        icon={<Target className="size-3.5 text-foreground-muted" />}
        label="Pack lines"
        onClick={onOpenPack}
        // The em dash means the edges were not loaded — genuinely nothing to
        // say. A loaded ZERO is printed plainly: a project that makes no pack
        // line trustworthy is a fact worth seeing, not one to hide behind a
        // dash.
        value={hasPackData ? String(packCells) : '—'}
        sub={
          hasPackData
            ? packCells === 1
              ? 'cell it closes'
              : 'cells it closes'
            : 'Not loaded'
        }
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
