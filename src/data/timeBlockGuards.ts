import type { Entry, TimeBlockEntry } from './types';

/**
 * The two invariants the repository enforces on every time-block write, in the
 * mutation path rather than in the UI.
 *
 * ===========================================================================
 * 1. EXACTLY ONE ATTRIBUTION. A block points at a task OR at a milestone.
 * ===========================================================================
 * Never both. Two attribution routes means two ways to answer "what did this
 * time go to", and a rollup that walked tasks would disagree with one that
 * walked milestones. This app has already been bitten by precisely that: the
 * Monthly Close header and the dashboard tile counted a finished close
 * differently and printed "0 of 6" beside "6 of 6" for the same period.
 *
 * Neither is fine — an unattributed block is honest, it just says the time
 * was not project work. Both is not.
 *
 * ===========================================================================
 * 2. A BLOCKED BLOCK MUST SAY WHAT IT IS WAITING ON.
 * ===========================================================================
 * `blocked` exists to be read tomorrow morning, by which time the wall you hit
 * is no longer fresh. Without `blockedOn` the carry-over row renders a status
 * and nothing actionable, so the one moment where capture is cheap and
 * accurate — the moment of collision — is wasted. A UI-only requirement would
 * be bypassed by the first caller that forgot, and this is exactly the kind of
 * rule that gets forgotten.
 *
 * Same reasoning as finishLineGuards and researchGuards: the rule lives where
 * the write happens.
 * ===========================================================================
 */

export class TimeBlockGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeBlockGuardError';
  }
}

function isTimeBlock(entry: { type?: string }): entry is TimeBlockEntry {
  return entry.type === 'timeblock';
}

/**
 * Checks a fully-merged time block before it is persisted.
 *
 * Takes the MERGED entry, not the patch: a patch adding `milestoneId` to a
 * block that already carries `taskId` is only detectable against the result,
 * which is why both repositories call this after merging rather than on the
 * way in.
 */
export function guardTimeBlock(entry: Entry | Partial<Entry>): void {
  if (!isTimeBlock(entry as { type?: string })) return;
  const block = entry as TimeBlockEntry;

  if (block.taskId && block.milestoneId) {
    throw new TimeBlockGuardError(
      'A time block may attribute to a task or to a milestone, never both. ' +
        'Clear one before setting the other.',
    );
  }

  // A milestone id without its project cannot be resolved back to a milestone:
  // milestones are jsonb array elements, so the project is how you find them.
  if (block.milestoneId && !block.projectId) {
    throw new TimeBlockGuardError(
      'A time block attributed to a milestone must also carry its projectId.',
    );
  }

  if (block.status === 'blocked' && !block.blockedOn?.trim()) {
    throw new TimeBlockGuardError(
      'A blocked time block must record what it is waiting on.',
    );
  }
}

/**
 * Clears the other attribution, for callers switching a block from one to the
 * other. Returns a patch, so the caller still goes through the guarded write.
 *
 * Exists so that "attribute this to a milestone" is one action rather than
 * clear-then-set — two writes would leave a window where a failure strands the
 * block with neither.
 */
export function attributeToMilestone(
  projectId: string,
  milestoneId: string,
): Pick<TimeBlockEntry, 'projectId' | 'milestoneId' | 'taskId'> {
  return { projectId, milestoneId, taskId: undefined };
}

export function attributeToTask(taskId: string): Pick<
  TimeBlockEntry,
  'projectId' | 'milestoneId' | 'taskId'
> {
  return { taskId, projectId: undefined, milestoneId: undefined };
}
