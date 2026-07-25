import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import type { Milestone, Project, TaskEntry, WeeklyGoal } from '../data/types';
import { buildProjectTree, findNode, rollupMilestones } from './hierarchy';
import { milestoneEnd } from './milestones';
import {
  CLOSE_SERIES,
  periodLabel,
  seriesOf,
  targetPeriod,
  type CloseSeries,
} from './monthlyClose';

/**
 * Derivations for the WORK dashboard.
 *
 * Nothing here recomputes something that already exists: milestone dates come
 * from `milestoneEnd`, project progress from `rollupMilestones`, close series
 * from `seriesOf`. A second derivation is a second thing that can disagree
 * with the project card.
 */

// ---------------------------------------------------------------------------
// Section 1 — needs action today
// ---------------------------------------------------------------------------

export type NeedsActionState = 'overdue' | 'today' | 'blocked';

export interface NeedsActionRow {
  milestone: Milestone;
  project: Project;
  state: NeedsActionState;
  /** Positive only when `state` is 'overdue'. */
  daysOverdue: number;
  /**
   * True when a row that leads with 'overdue' or 'today' is ALSO blocked.
   * Both badges render: knowing a late thing is stuck on someone else is the
   * difference between chasing it and doing it.
   */
  alsoBlocked: boolean;
}

const STATE_ORDER: Record<NeedsActionState, number> = { overdue: 0, today: 1, blocked: 2 };

/**
 * Milestones that need a decision today, across every WORK project including
 * close cycles.
 *
 * Exactly three conditions qualify: past its end date, due today, or blocked.
 * "Due within a week" is deliberately absent — during a close cycle
 * practically everything is due within a week, which is what made the old
 * cards unreadable for most of the month.
 */
export function collectNeedsAction(projects: Project[], today: Date): NeedsActionRow[] {
  const todayKey = format(today, 'yyyy-MM-dd');
  const rows: NeedsActionRow[] = [];

  for (const project of projects) {
    if (project.status === 'done') continue;
    for (const milestone of project.milestones) {
      if (milestone.done) continue;
      const end = milestoneEnd(milestone);
      const blocked = milestone.status === 'blocked';
      const overdue = Boolean(end && end < todayKey);
      const dueToday = Boolean(end && end === todayKey);
      if (!overdue && !dueToday && !blocked) continue;

      // Time-critical framing wins the lead badge; `alsoBlocked` keeps the
      // second fact rather than dropping it.
      const state: NeedsActionState = overdue ? 'overdue' : dueToday ? 'today' : 'blocked';
      rows.push({
        milestone,
        project,
        state,
        daysOverdue: overdue && end ? differenceInCalendarDays(today, parseISO(end)) : 0,
        alsoBlocked: blocked && state !== 'blocked',
      });
    }
  }

  return rows.sort(
    (a, b) =>
      STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
      b.daysOverdue - a.daysOverdue ||
      a.project.title.localeCompare(b.project.title),
  );
}

/** `Morgan` -> `MO`, `Alex Kim` -> `AK`. Two letters, upper case, or null. */
export function picInitials(pic: string | undefined): string | null {
  const trimmed = pic?.trim();
  if (!trimmed) return null;
  const words = trimmed.split(/\s+/);
  const letters =
    words.length > 1 ? words[0][0] + words[1][0] : trimmed.slice(0, 2);
  return letters.toUpperCase();
}

// ---------------------------------------------------------------------------
// Section 2 — close cycle
// ---------------------------------------------------------------------------

export interface CloseSeriesProgress {
  series: CloseSeries;
  done: number;
  total: number;
}

export interface CloseCycleSummary {
  period: string;
  label: string;
  series: CloseSeriesProgress[];
  /** Milestone counts across the whole cycle — not entity counts. */
  done: number;
  total: number;
  /** Entities with every milestone finished, out of those present. */
  entitiesDone: number;
  entitiesTotal: number;
  deadline?: string;
}

function periodOffset(period: string, months: number): string {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  return format(new Date(year, month - 1 + months, 1), 'yyyy-MM');
}

function cycleFor(projects: Project[], period: string): Project[] {
  return projects.filter(
    (project) => project.recurring === 'monthly' && project.period === period,
  );
}

function hasUnfinished(cycle: Project[]): boolean {
  return cycle.some((project) => project.milestones.some((milestone) => !milestone.done));
}

/**
 * The close cycle to show, or null when there is nothing left to close.
 *
 * Gated on unfinished work rather than on a date window. The cycle runs from
 * the 22nd to roughly the 12th — about 70% of every month — so a date
 * condition would barely be a condition. When the current and previous
 * periods are both fully closed this returns null and the card disappears,
 * making the page shorter.
 */
export function summarizeCloseCycle(
  projects: Project[],
  today: Date,
): CloseCycleSummary | null {
  const current = targetPeriod(today);
  const previous = periodOffset(current, -1);

  // Prefer the current period; fall back to the previous one when only that
  // still has work outstanding, so the card never shows an all-done cycle.
  const period = hasUnfinished(cycleFor(projects, current))
    ? current
    : hasUnfinished(cycleFor(projects, previous))
      ? previous
      : null;
  if (!period) return null;

  const cycle = cycleFor(projects, period);
  const bySeries = new Map<CloseSeries, Project[]>();
  for (const project of cycle) {
    const series = seriesOf(project);
    if (!series) continue;
    const bucket = bySeries.get(series);
    if (bucket) bucket.push(project);
    else bySeries.set(series, [project]);
  }

  const series = CLOSE_SERIES.map<CloseSeriesProgress>((name) => {
    const owned = bySeries.get(name) ?? [];
    const milestones = owned.flatMap((project) => project.milestones);
    return {
      series: name,
      done: milestones.filter((milestone) => milestone.done).length,
      total: milestones.length,
    };
  });

  const deadlines = cycle.map((project) => project.deadline).filter(Boolean) as string[];
  const summary: CloseCycleSummary = {
    period,
    label: periodLabel(period),
    series,
    done: series.reduce((sum, item) => sum + item.done, 0),
    total: series.reduce((sum, item) => sum + item.total, 0),
    entitiesDone: cycle.filter(
      (project) =>
        project.milestones.length > 0 &&
        project.milestones.every((milestone) => milestone.done),
    ).length,
    entitiesTotal: cycle.length,
  };
  if (deadlines.length > 0) summary.deadline = deadlines.sort().at(-1);
  return summary;
}

/** Entity counts for the tile, independent of whether the card is showing. */
export function closeEntityCount(
  projects: Project[],
  today: Date,
): { done: number; total: number; label: string } {
  const period = targetPeriod(today);
  const cycle = cycleFor(projects, period);
  return {
    done: cycle.filter(
      (project) =>
        project.milestones.length > 0 &&
        project.milestones.every((milestone) => milestone.done),
    ).length,
    total: cycle.length,
    label: periodLabel(period),
  };
}

// ---------------------------------------------------------------------------
// Section 3 — this week
// ---------------------------------------------------------------------------

export interface GoalProgress {
  goal: WeeklyGoal;
  done: number;
  total: number;
  percent: number;
  /** True when nothing is linked, so the bar is 0/100 from `done` alone. */
  binary: boolean;
}

/**
 * A weekly goal's progress, derived from the tasks linked to it.
 *
 * `WeeklyGoal` carries only `done: boolean` and gains no field here. When
 * tasks point at the goal, progress is done/total of those tasks; when none
 * do, the goal is genuinely binary and reports 0% or 100% rather than an
 * invented figure.
 */
export function goalProgress(goal: WeeklyGoal, tasks: TaskEntry[]): GoalProgress {
  const linked = tasks.filter((task) => task.weeklyGoalId === goal.id);
  if (linked.length === 0) {
    return { goal, done: 0, total: 0, percent: goal.done ? 100 : 0, binary: true };
  }
  const done = linked.filter((task) => task.done).length;
  return {
    goal,
    done,
    total: linked.length,
    percent: Math.round((100 * done) / linked.length),
    binary: false,
  };
}

// ---------------------------------------------------------------------------
// Section 4 — pinned projects
// ---------------------------------------------------------------------------

export interface PinnedProjectRow {
  project: Project;
  done: number;
  total: number;
  /** Earliest end date among unfinished milestones. */
  nextDate?: string;
  blocked: boolean;
  overdue: boolean;
}

/** Close cycles are never pinnable — Section 2 owns them completely. */
export function isPinnable(project: Project): boolean {
  return project.recurring !== 'monthly';
}

/**
 * Summary rows for the pinned set, using the same counts the project card
 * shows: `rollupMilestones` over the same tree, and `milestoneEnd` for dates.
 */
export function pinnedProjectRows(projects: Project[], today: Date): PinnedProjectRow[] {
  const pinnable = projects.filter(isPinnable);
  const tree = buildProjectTree(pinnable);
  const todayKey = format(today, 'yyyy-MM-dd');

  return pinnable
    .filter((project) => project.dashboardPinned)
    .map((project) => {
      const node = findNode(tree, project.id);
      const rollup = node
        ? rollupMilestones(node)
        : { done: 0, total: 0, ownDone: 0, ownTotal: 0, childCount: 0 };
      const open = project.milestones.filter((milestone) => !milestone.done);
      const dates = open
        .map((milestone) => milestoneEnd(milestone))
        .filter((date): date is string => Boolean(date))
        .sort();
      const row: PinnedProjectRow = {
        project,
        done: rollup.done,
        total: rollup.total,
        blocked: open.some((milestone) => milestone.status === 'blocked'),
        overdue: dates.length > 0 && (dates[0] as string) < todayKey,
      };
      if (dates.length > 0) row.nextDate = dates[0];
      return row;
    })
    .sort((a, b) => a.project.order - b.project.order);
}
