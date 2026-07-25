import type {
  EscalateTo,
  Milestone,
  MilestoneStatus,
  Project,
} from '../data/types';

export const MILESTONE_STATUSES: Array<{ value: MilestoneStatus; label: string }> = [
  { value: 'not-started', label: 'Not started' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Done' },
];

/**
 * The date a milestone is actually tracked to.
 *
 * `endDate` is what new and edited milestones write. `dueDate` is the field
 * every milestone written before this existed carries, and it is never
 * rewritten in place — so every read goes through here and old rows keep
 * counting down exactly as they always did.
 */
export function milestoneEnd(milestone: Milestone): string | undefined {
  return milestone.endDate ?? milestone.dueDate;
}

/**
 * The inclusive span a milestone occupies, or null when it has no dates at
 * all. A milestone with only an end date is a single day — a target, not a
 * stretch of work. A start later than the end is bad data, not a backwards
 * bar: it collapses to the end date rather than rendering inverted.
 */
export function milestoneRange(
  milestone: Milestone,
): { start: string; end: string } | null {
  const end = milestoneEnd(milestone);
  if (!end) return null;
  const start = milestone.startDate ?? end;
  return { start: start > end ? end : start, end };
}

export type EscalationTarget = Exclude<EscalateTo, 'none'>;

// Fixed board-review order; also the group order on the Escalations view.
export const ESCALATION_TARGETS: Array<{ value: EscalationTarget; label: string }> = [
  { value: 'pak-jo-bu-lenny', label: 'Pak Jo & Bu Lenny' },
  { value: 'mbak-muti', label: 'Mbak Muti' },
  { value: 'pak-teddy', label: 'Pak Teddy' },
  { value: 'other', label: 'Other departments' },
];

// `status` is the source of truth and `done` is kept in sync so existing
// code that reads `done` (progress bars, counts) keeps working.
export function withMilestoneStatus(
  milestone: Milestone,
  status: MilestoneStatus,
): Milestone {
  return { ...milestone, status, done: status === 'done' };
}

export function withMilestoneDone(milestone: Milestone, done: boolean): Milestone {
  if (done) return { ...milestone, done: true, status: 'done' };
  return {
    ...milestone,
    done: false,
    status: milestone.status === 'done' ? 'not-started' : milestone.status,
  };
}

export interface EscalationItem {
  projectId: string;
  projectTitle: string;
  milestone: Milestone;
}

export interface EscalationGroup {
  target: EscalationTarget;
  label: string;
  items: EscalationItem[];
}

/**
 * Collects every milestone across all projects with escalateTo !== 'none',
 * grouped by target in board-review order. Groups with no items are omitted.
 */
export function collectEscalations(projects: Project[]): EscalationGroup[] {
  return ESCALATION_TARGETS.map(({ value, label }) => ({
    target: value,
    label,
    items: projects.flatMap((project) =>
      project.milestones
        .filter((milestone) => (milestone.escalateTo ?? 'none') === value)
        .map((milestone) => ({
          projectId: project.id,
          projectTitle: project.title,
          milestone,
        })),
    ),
  })).filter((group) => group.items.length > 0);
}
