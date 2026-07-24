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
