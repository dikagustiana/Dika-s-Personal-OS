import type { FinishLineItem, FinishLineStatus, Milestone, Project } from '../data/types';

/**
 * Derivations for the Finish line view.
 *
 * The view answers three questions in one row: what must be true (TARGET),
 * what it currently is (NOW), and which project closes the difference
 * (GAP → PROJECT). The unit is the gap item, not the project — one gap can
 * hold up several parts of the pack and one project can close several gaps —
 * so everything here is keyed by item and resolves projects into it, never
 * the other way round.
 *
 * Nothing here is stored. There is deliberately no priority column and no
 * rank column in the schema: order falls out of status, links and `blocks`,
 * the same way project progress and the daily score fall out of their inputs.
 */

export interface FinishLineGapRow {
  item: FinishLineItem;
  /** Linked projects, resolved. Ids that no longer resolve are dropped. */
  projects: Project[];
  /**
   * No project closes this. The loudest state in the view when the item is
   * still open — something known to be broken that nobody owns. Callers
   * combine it with `item.status !== 'trusted'` before marking it: a closed
   * item needs no owner.
   */
  unowned: boolean;
  /**
   * A proxy is standing in. Everything the item names downstream is therefore
   * provisional, and must not be rendered as a settled value.
   */
  provisional: boolean;
  /**
   * Blocked, unescalated milestones across the linked projects.
   *
   * THE SILENT-BLOCKER SIGNAL, RELOCATED. It used to sit on the project list
   * as a count of blocked milestones with no `escalateTo`. On a gap item it
   * says something sharper: this gap is stuck AND nobody outside has been
   * told. The live data is 29 blocked milestones and zero escalation targets,
   * so the mechanism is load-bearing, not theoretical.
   */
  silentBlockers: number;
  /** Milestones on the linked projects still open and blocked. */
  blockedMilestones: number;
  /** Completed / total milestones across the linked projects. */
  done: number;
  total: number;
}

export interface FinishLineArea {
  area: string;
  /** Blocked and in-progress items, ordered by blast radius. */
  open: FinishLineGapRow[];
  /** Trusted items, ordered the same way. Collapsed by default. */
  closed: FinishLineGapRow[];
  blockedCount: number;
  /** Open items with no project on them. */
  unownedCount: number;
  /**
   * Areas holding a blocked item arrive expanded; everything else arrives
   * collapsed. An area of nothing but closed items is evidence of progress,
   * not something to read today.
   */
  defaultOpen: boolean;
}

export interface FinishLineSummary {
  /** Blocked + in-progress. */
  open: number;
  blocked: number;
  /** Open items nobody owns. */
  unowned: number;
  /** Open items resting on a proxy. */
  provisional: number;
  /** Open items whose linked projects are stuck with nobody told. */
  silent: number;
  trusted: number;
}

/**
 * Blocked milestones that were never escalated to anyone.
 *
 * `done` milestones are excluded: a blocker that was overcome without ever
 * being escalated is history, not a live silence. Absent `escalateTo` means
 * 'none', matching how the field is read everywhere else.
 */
export function silentBlockers(project: Project): Milestone[] {
  return project.milestones.filter(
    (milestone) =>
      !milestone.done &&
      milestone.status === 'blocked' &&
      (milestone.escalateTo ?? 'none') === 'none',
  );
}

const STATUS_RANK: Record<FinishLineStatus, number> = {
  blocked: 0,
  'in-progress': 1,
  trusted: 2,
};

/**
 * Order by blast radius — how much of the target an item holds up — not
 * alphabetically and not by area.
 *
 *  1. blocked with NO project. Broken and unowned outranks everything.
 *  2. blocked with projects, most projects first: a gap needing three
 *     projects is structurally harder than one needing one.
 *  3. in-progress.
 *  4. trusted.
 *
 * Within a tie, an item that names its downstream consequence outranks one
 * that does not — `blocks` being filled in is the difference between a known
 * radius and an unmeasured one. `sort_order` then the item text break the
 * rest, only so the order is stable between renders.
 */
export function compareGapRows(a: FinishLineGapRow, b: FinishLineGapRow): number {
  const status = STATUS_RANK[a.item.status] - STATUS_RANK[b.item.status];
  if (status !== 0) return status;
  if (a.unowned !== b.unowned) return a.unowned ? -1 : 1;
  const links = b.projects.length - a.projects.length;
  if (links !== 0) return links;
  const named = Number(Boolean(b.item.blocks)) - Number(Boolean(a.item.blocks));
  if (named !== 0) return named;
  return a.item.order - b.item.order || a.item.item.localeCompare(b.item.item);
}

/** Resolves one item against the project list. Unknown ids are dropped. */
export function buildGapRow(item: FinishLineItem, projects: Project[]): FinishLineGapRow {
  const byId = new Map(projects.map((project) => [project.id, project]));
  const linked = item.projectIds
    .map((id) => byId.get(id))
    .filter((project): project is Project => project !== undefined);
  const milestones = linked.flatMap((project) => project.milestones);
  return {
    item,
    projects: linked,
    unowned: linked.length === 0,
    provisional: Boolean(item.interim),
    silentBlockers: linked.reduce((sum, project) => sum + silentBlockers(project).length, 0),
    blockedMilestones: milestones.filter(
      (milestone) => !milestone.done && milestone.status === 'blocked',
    ).length,
    done: milestones.filter((milestone) => milestone.done).length,
    total: milestones.length,
  };
}

/**
 * Groups by area, splits open from closed, and orders both.
 *
 * Areas themselves are ordered by their most severe row, so the area holding
 * an unowned blocker leads regardless of its name. An area whose rows are all
 * closed sinks to the bottom and arrives collapsed.
 */
export function buildFinishLine(
  items: FinishLineItem[],
  projects: Project[],
): FinishLineArea[] {
  const rows = items.map((item) => buildGapRow(item, projects));
  const byArea = new Map<string, FinishLineGapRow[]>();
  for (const row of rows) {
    const existing = byArea.get(row.item.area);
    if (existing) existing.push(row);
    else byArea.set(row.item.area, [row]);
  }

  const areas: FinishLineArea[] = [...byArea.entries()].map(([area, areaRows]) => {
    const ordered = [...areaRows].sort(compareGapRows);
    const open = ordered.filter((row) => row.item.status !== 'trusted');
    return {
      area,
      open,
      closed: ordered.filter((row) => row.item.status === 'trusted'),
      blockedCount: open.filter((row) => row.item.status === 'blocked').length,
      unownedCount: open.filter((row) => row.unowned).length,
      defaultOpen: open.some((row) => row.item.status === 'blocked'),
    };
  });

  return areas.sort((a, b) => {
    const leadA = a.open[0] ?? a.closed[0];
    const leadB = b.open[0] ?? b.closed[0];
    if (!leadA || !leadB) return leadA ? -1 : leadB ? 1 : 0;
    return compareGapRows(leadA, leadB) || a.area.localeCompare(b.area);
  });
}

export function summarize(areas: FinishLineArea[]): FinishLineSummary {
  const open = areas.flatMap((area) => area.open);
  return {
    open: open.length,
    blocked: open.filter((row) => row.item.status === 'blocked').length,
    unowned: open.filter((row) => row.unowned).length,
    provisional: open.filter((row) => row.provisional).length,
    silent: open.filter((row) => row.silentBlockers > 0).length,
    trusted: areas.reduce((sum, area) => sum + area.closed.length, 0),
  };
}
