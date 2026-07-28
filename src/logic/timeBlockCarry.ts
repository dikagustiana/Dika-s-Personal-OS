import type { Project, TimeBlockEntry } from '../data/types';

/**
 * What an unfinished block produces tomorrow morning.
 *
 * A `carried` or `blocked` block that simply ends is a label that dies with
 * the day, and the owner plans from nothing and re-remembers what he was in
 * the middle of. Regaining focus is the expensive thing, so this is the point
 * of the whole feature.
 *
 * LOOKBACK IS THE MOST RECENT DAY WITH ANY BLOCKS, NOT A ROLLING WINDOW.
 * After a week away you should see Friday's unfinished work, not five days of
 * accumulated rows — a carry-over list long enough to scroll is a list that
 * gets ignored, which is the failure mode this feature exists to avoid. The
 * anchor day is chosen from blocks of ANY status, so a day where everything
 * was finished correctly ends the chain rather than being skipped over in
 * search of older unfinished work.
 */

export interface CarryOverRow {
  block: TimeBlockEntry;
  /** Minutes in this block alone, derived from start–end. Never stored. */
  minutes: number;
  /** Minutes across the whole `carriedFrom` chain, including this block. */
  chainMinutes: number;
  /** How many days the chain spans, including this one. */
  chainDays: number;
  /** Resolved attribution, when the block points at a milestone. */
  milestoneText?: string;
  projectTitle?: string;
  /**
   * True when `milestoneId` is set but no longer exists in its project. The
   * row still renders, NAMED as broken — silently blanking it would read as
   * unattributed time, which is worse than an obvious error.
   */
  brokenMilestone: boolean;
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/** Duration is always derived from start and end, never stored. */
export function blockMinutes(block: TimeBlockEntry): number {
  return Math.max(0, toMinutes(block.end) - toMinutes(block.start));
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours && rest) return `${hours}h ${rest}m`;
  if (hours) return `${hours}h`;
  return `${rest}m`;
}

/** The statuses that mean real work happened and it is not finished. */
export function isUnfinished(block: TimeBlockEntry): boolean {
  return block.status === 'carried' || block.status === 'blocked';
}

/**
 * The most recent date strictly before `today` that has any block at all.
 * Returns null when there is none.
 */
export function latestPriorBlockDate(
  blocks: TimeBlockEntry[],
  today: string,
): string | null {
  let latest: string | null = null;
  for (const block of blocks) {
    if (block.date >= today) continue;
    if (latest === null || block.date > latest) latest = block.date;
  }
  return latest;
}

/**
 * Walks `carriedFrom` back through the chain and returns every block in it,
 * most recent first. Guards against a cycle — `carriedFrom` is a plain date
 * string with nothing enforcing it points backwards, and a loop here would
 * hang the dashboard.
 */
export function chainFor(
  block: TimeBlockEntry,
  blocks: TimeBlockEntry[],
): TimeBlockEntry[] {
  const chain: TimeBlockEntry[] = [block];
  const seen = new Set<string>([block.date]);
  let cursor = block;

  while (cursor.carriedFrom && !seen.has(cursor.carriedFrom)) {
    const previousDate = cursor.carriedFrom;
    seen.add(previousDate);
    // The same label on the earlier date is the link: carriedFrom records a
    // date, and a day can hold more than one block.
    const previous = blocks.find(
      (candidate) => candidate.date === previousDate && candidate.label === cursor.label,
    );
    if (!previous) break;
    chain.push(previous);
    cursor = previous;
  }
  return chain;
}

/**
 * The carry-over rows for `today`, drawn only from the most recent prior day
 * that had blocks.
 *
 * Returns [] when that day's work was all finished, which is the common case
 * and must stay quiet.
 */
export function carryOverFor(
  blocks: TimeBlockEntry[],
  projects: Project[],
  today: string,
): CarryOverRow[] {
  const anchor = latestPriorBlockDate(blocks, today);
  if (!anchor) return [];

  const projectById = new Map(projects.map((project) => [project.id, project]));

  return blocks
    .filter((block) => block.date === anchor && isUnfinished(block))
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((block) => {
      const chain = chainFor(block, blocks);
      const project = block.projectId ? projectById.get(block.projectId) : undefined;
      const milestone = block.milestoneId
        ? project?.milestones.find((item) => item.id === block.milestoneId)
        : undefined;

      const row: CarryOverRow = {
        block,
        minutes: blockMinutes(block),
        chainMinutes: chain.reduce((sum, item) => sum + blockMinutes(item), 0),
        chainDays: new Set(chain.map((item) => item.date)).size,
        brokenMilestone: Boolean(block.milestoneId) && !milestone,
      };
      if (milestone) row.milestoneText = milestone.text;
      if (project) row.projectTitle = project.title;
      return row;
    });
}

/**
 * The new block *Schedule again* creates: same label, attribution and
 * category, `carriedFrom` set to the day it continues, and NO time slot —
 * the owner chooses when. Placing it in the grid unasked is the kind of thing
 * that makes a tool feel like it is arguing with you.
 *
 * Status resets to `planned`: the new block has not been worked on yet, and
 * inheriting `blocked` would claim a wall was hit today that was hit
 * yesterday. `blockedOn` is deliberately NOT inherited for the same reason —
 * the reason belongs to the day it was captured.
 */
export function scheduleAgainDraft(
  block: TimeBlockEntry,
  today: string,
): Pick<
  TimeBlockEntry,
  'label' | 'date' | 'status' | 'carriedFrom' | 'category' | 'taskId' | 'projectId' | 'milestoneId'
> {
  const draft: ReturnType<typeof scheduleAgainDraft> = {
    label: block.label,
    date: today,
    status: 'planned',
    carriedFrom: block.date,
  };
  if (block.category) draft.category = block.category;
  if (block.taskId) draft.taskId = block.taskId;
  if (block.projectId) draft.projectId = block.projectId;
  if (block.milestoneId) draft.milestoneId = block.milestoneId;
  return draft;
}
