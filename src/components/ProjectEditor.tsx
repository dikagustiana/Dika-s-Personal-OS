import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import type {
  DateConfidence,
  Milestone,
  MilestoneStatus,
  Project,
} from '../data/types';
import { MILESTONE_STATUSES, withMilestoneStatus } from '../logic/milestones';
import { Button } from './ui/Button';
import { Input } from './ui/Input';

export const DATE_CONFIDENCES: Array<{ value: DateConfidence; label: string }> = [
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'estimated', label: 'Estimated' },
  { value: 'unknown', label: 'Unknown' },
];

/** The editable subset of a project. Everything else is set by seed or code. */
export interface ProjectDraft {
  title: string;
  startDate: string;
  deadline: string;
  status: Project['status'];
  dateConfidence: DateConfidence;
}

export function emptyProjectDraft(): ProjectDraft {
  return {
    title: '',
    startDate: '',
    deadline: '',
    status: 'active',
    // A date you have just typed in is only as good as your source, and the
    // point of this field is to stop placeholders masquerading as deadlines.
    dateConfidence: 'estimated',
  };
}

export function projectToDraft(project: Project): ProjectDraft {
  return {
    title: project.title,
    startDate: project.startDate ?? '',
    deadline: project.deadline ?? '',
    status: project.status,
    dateConfidence: project.dateConfidence ?? 'confirmed',
  };
}

export function draftToPatch(draft: ProjectDraft): Partial<Project> {
  return {
    title: draft.title.trim(),
    startDate: draft.startDate || undefined,
    deadline: draft.deadline || undefined,
    status: draft.status,
    dateConfidence: draft.dateConfidence,
  };
}

/** Title, dates, status. Controlled — the caller owns the draft and the save. */
export function ProjectFields({
  draft,
  onChange,
  idPrefix,
}: {
  draft: ProjectDraft;
  onChange: (next: ProjectDraft) => void;
  idPrefix: string;
}) {
  const patch = (partial: Partial<ProjectDraft>) => onChange({ ...draft, ...partial });

  return (
    <div className="grid gap-3">
      <label className="block">
        <span className="surface-label">Title</span>
        <Input
          className="mt-2"
          value={draft.title}
          onChange={(event) => patch({ title: event.target.value })}
          placeholder="Project title"
          aria-label={`${idPrefix} title`}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="surface-label">Start</span>
          <Input
            type="date"
            className="mt-2"
            value={draft.startDate}
            onChange={(event) => patch({ startDate: event.target.value })}
            aria-label={`${idPrefix} start date`}
          />
        </label>
        <label className="block">
          <span className="surface-label">Deadline</span>
          <Input
            type="date"
            className="mt-2"
            value={draft.deadline}
            onChange={(event) => patch({ deadline: event.target.value })}
            aria-label={`${idPrefix} deadline`}
          />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="surface-label">Status</span>
          <select
            className="native-select mt-2"
            value={draft.status}
            onChange={(event) => patch({ status: event.target.value as Project['status'] })}
            aria-label={`${idPrefix} status`}
          >
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="done">Done</option>
          </select>
        </label>
        <label className="block">
          <span className="surface-label">Date confidence</span>
          <select
            className="native-select mt-2"
            value={draft.dateConfidence}
            onChange={(event) =>
              patch({ dateConfidence: event.target.value as DateConfidence })
            }
            aria-label={`${idPrefix} date confidence`}
          >
            {DATE_CONFIDENCES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

export function newMilestone(): Milestone {
  return {
    id: crypto.randomUUID(),
    text: '',
    done: false,
    status: 'not-started',
    dateConfidence: 'estimated',
  };
}

/**
 * Milestone editing: text, due date, confidence, status, note, order, delete.
 *
 * The whole array is handed back on every change and the caller decides when
 * to persist, so a half-typed milestone never reaches the database.
 */
export function MilestoneEditorRows({
  milestones,
  onChange,
}: {
  milestones: Milestone[];
  onChange: (next: Milestone[]) => void;
}) {
  const replace = (id: string, mutate: (milestone: Milestone) => Milestone) =>
    onChange(milestones.map((item) => (item.id === id ? mutate(item) : item)));

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= milestones.length) return;
    const next = [...milestones];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {milestones.map((milestone, index) => (
        <div key={milestone.id} className="border border-border-subtle bg-black/10 p-3">
          <div className="flex items-start gap-2">
            <Input
              className="min-w-0 flex-1"
              value={milestone.text}
              onChange={(event) => replace(milestone.id, (m) => ({ ...m, text: event.target.value }))}
              placeholder="Milestone"
              aria-label={`Milestone ${index + 1} text`}
            />
            <Button
              variant="secondary"
              size="icon"
              disabled={index === 0}
              onClick={() => move(index, -1)}
              aria-label={`Move milestone ${index + 1} up`}
            >
              <ChevronUp className="size-4" />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              disabled={index === milestones.length - 1}
              onClick={() => move(index, 1)}
              aria-label={`Move milestone ${index + 1} down`}
            >
              <ChevronDown className="size-4" />
            </Button>
            <Button
              variant="danger"
              size="icon"
              onClick={() => onChange(milestones.filter((item) => item.id !== milestone.id))}
              aria-label={`Delete milestone ${index + 1}`}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <Input
              type="date"
              value={milestone.dueDate ?? ''}
              onChange={(event) =>
                replace(milestone.id, (m) => ({ ...m, dueDate: event.target.value || undefined }))
              }
              aria-label={`Milestone ${index + 1} due date`}
            />
            <select
              className="native-select text-xs"
              value={milestone.dateConfidence ?? 'confirmed'}
              onChange={(event) =>
                replace(milestone.id, (m) => ({
                  ...m,
                  dateConfidence: event.target.value as DateConfidence,
                }))
              }
              aria-label={`Milestone ${index + 1} date confidence`}
            >
              {DATE_CONFIDENCES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              className="native-select text-xs"
              value={milestone.status}
              onChange={(event) =>
                replace(milestone.id, (m) =>
                  withMilestoneStatus(m, event.target.value as MilestoneStatus),
                )
              }
              aria-label={`Milestone ${index + 1} status`}
            >
              {MILESTONE_STATUSES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <Input
            className="mt-2 h-11 text-sm"
            value={milestone.note ?? ''}
            onChange={(event) =>
              replace(milestone.id, (m) => ({ ...m, note: event.target.value || undefined }))
            }
            placeholder="Note — what's left / blocker"
            aria-label={`Milestone ${index + 1} note`}
          />
        </div>
      ))}
      <Button variant="secondary" onClick={() => onChange([...milestones, newMilestone()])}>
        <Plus className="size-4" />
        Add milestone
      </Button>
    </div>
  );
}
