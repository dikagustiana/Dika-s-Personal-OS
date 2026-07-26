import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import type { Milestone, Project, TaskEntry, WeeklyGoal } from '../data/types';
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
 * from `milestoneEnd`, close series from `seriesOf`, project progress from
 * `rollupMilestones` in the card itself. A second derivation is a second thing
 * that can disagree with the project card.
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

export interface NeedsActionBreakdown {
  overdue: number;
  today: number;
  blocked: number;
}

const STATE_ORDER: Record<NeedsActionState, number> = { overdue: 0, today: 1, blocked: 2 };

/**
 * Row order for the needs-action list.
 *
 * Load-bearing rather than cosmetic. Blocked milestones usually carry no date
 * at all, so they qualify on status alone and there are far more of them than
 * of everything else combined; in source order they fill every visible slot
 * and push a genuinely overdue milestone behind the collapse control — the one
 * row the section exists to surface. So: all overdue first, most overdue at
 * the top, then due today, then blocked. Project title breaks what is left,
 * only so the order is stable between renders.
 */
export function compareNeedsAction(a: NeedsActionRow, b: NeedsActionRow): number {
  return (
    STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
    b.daysOverdue - a.daysOverdue ||
    a.project.title.localeCompare(b.project.title)
  );
}

/** `compareNeedsAction` over a copy, so a caller's own array is left alone. */
export function sortNeedsAction(rows: NeedsActionRow[]): NeedsActionRow[] {
  return [...rows].sort(compareNeedsAction);
}

/**
 * Counts for the composition line the section shows above the list.
 *
 * Keyed on `state` — the lead badge — so the three numbers add up to
 * `rows.length`: a row that is overdue AND blocked is counted once, as
 * overdue, exactly as it renders.
 */
export function needsActionBreakdown(rows: NeedsActionRow[]): NeedsActionBreakdown {
  const breakdown: NeedsActionBreakdown = { overdue: 0, today: 0, blocked: 0 };
  for (const row of rows) breakdown[row.state] += 1;
  return breakdown;
}

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

  // Sorted here rather than at the call site so no consumer can render the
  // unsorted list by forgetting to.
  return sortNeedsAction(rows);
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
  deadline?: string;
}

function cycleFor(projects: Project[], period: string): Project[] {
  return projects.filter(
    (project) => project.recurring === 'monthly' && project.period === period,
  );
}

/**
 * The close cycle for the period the calendar is on, or null when that period
 * has no cycle at all.
 *
 * Deliberately NOT gated on the checklist. A fully-ticked cycle is still the
 * cycle in flight: what ends a period is answering the card's question, which
 * sets the six projects' status — so hiding an all-done cycle here would take
 * the question away with it and strand the period at 0 closed entities with
 * nothing left that could ever close it.
 *
 * The period is `targetPeriod`, the same one `closeEntityCount` reads, so the
 * card and the tile cannot end up describing different months.
 */
export function summarizeCloseCycle(
  projects: Project[],
  today: Date,
): CloseCycleSummary | null {
  const period = targetPeriod(today);
  const cycle = cycleFor(projects, period);
  if (cycle.length === 0) return null;

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
  };
  if (deadlines.length > 0) summary.deadline = deadlines.sort().at(-1);
  return summary;
}

/**
 * Entity counts for the tile, independent of whether the card is showing.
 *
 * Done is the project's own `status`, not its checklist. Closing out a period
 * marks the six projects done and deliberately leaves their milestones
 * unticked — nobody ticks 40-odd boxes to record a fact they already know — so
 * a milestone-derived count would read "0 of 6" on the same screen where the
 * card has just been dismissed as complete. The tile has to answer the same
 * question the card does.
 */
export function closeEntityCount(
  projects: Project[],
  today: Date,
): { done: number; total: number; label: string } {
  const period = targetPeriod(today);
  const cycle = cycleFor(projects, period);
  return {
    done: cycle.filter((project) => project.status === 'done').length,
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

/**
 * Close cycles are never pinnable — Section 2 owns them completely.
 *
 * The pinned set itself is not summarised here: the dashboard renders the real
 * project card, so the counts come from `rollupMilestones` at the one place
 * every other view already reads them.
 */
export function isPinnable(project: Project): boolean {
  return project.recurring !== 'monthly';
}
