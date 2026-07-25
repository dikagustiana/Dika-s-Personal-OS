import { ChevronDown, ChevronUp, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type {
  DateConfidence,
  LinkedProject,
  Milestone,
  MilestoneStatus,
  Project,
} from '../data/types';
import { eligibleParents } from '../logic/hierarchy';
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
  entityTag: string;
  /** '' means top-level. */
  parentId: string;
  linkedProjects: LinkedProject[];
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
    entityTag: '',
    parentId: '',
    linkedProjects: [],
  };
}

export function projectToDraft(project: Project): ProjectDraft {
  return {
    title: project.title,
    startDate: project.startDate ?? '',
    deadline: project.deadline ?? '',
    status: project.status,
    dateConfidence: project.dateConfidence ?? 'confirmed',
    entityTag: project.entityTag ?? '',
    parentId: project.parentId ?? '',
    linkedProjects: project.linkedProjects ?? [],
  };
}

export function draftToPatch(draft: ProjectDraft): Partial<Project> {
  return {
    title: draft.title.trim(),
    startDate: draft.startDate || undefined,
    deadline: draft.deadline || undefined,
    status: draft.status,
    dateConfidence: draft.dateConfidence,
    entityTag: draft.entityTag.trim() || undefined,
    parentId: draft.parentId || undefined,
    linkedProjects: draft.linkedProjects,
  };
}

/**
 * Title, dates, status, entity tag, parent, links. Controlled — the caller
 * owns the draft and the save.
 *
 * The hierarchy controls appear only when `projects` is supplied, so a
 * context with no project list (there is one today: none) degrades to the
 * original field set rather than rendering an empty picker.
 */
export function ProjectFields({
  draft,
  onChange,
  idPrefix,
  projects,
  self,
}: {
  draft: ProjectDraft;
  onChange: (next: ProjectDraft) => void;
  idPrefix: string;
  /** Candidates for the parent and link pickers, usually the domain's list. */
  projects?: Project[];
  /** The project being edited; omitted when creating a new one. */
  self?: Project;
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
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="surface-label">Entity tag</span>
          <Input
            className="mt-2"
            value={draft.entityTag}
            onChange={(event) => patch({ entityTag: event.target.value })}
            placeholder="Free text — used to group the list"
            aria-label={`${idPrefix} entity tag`}
          />
        </label>
        {projects && (
          <label className="block">
            <span className="surface-label">Parent project</span>
            <select
              className="native-select mt-2"
              value={draft.parentId}
              onChange={(event) => patch({ parentId: event.target.value })}
              aria-label={`${idPrefix} parent project`}
            >
              <option value="">No parent — top level</option>
              {/* Itself and its own descendants are excluded, so the picker
                  cannot build a cycle the renderer would have to survive. */}
              {(self ? eligibleParents(projects, self) : projects).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.title}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {projects && (
        <LinkedProjectPicker
          links={draft.linkedProjects}
          onChange={(linkedProjects) => patch({ linkedProjects })}
          projects={projects.filter((option) => option.id !== self?.id)}
          idPrefix={idPrefix}
        />
      )}
    </div>
  );
}

/**
 * Add / annotate / remove soft links.
 *
 * A link carries an optional note and nothing else. It never blocks anything:
 * no code path anywhere consults this list before allowing a milestone or a
 * project to be marked done, and none should be added.
 */
function LinkedProjectPicker({
  links,
  onChange,
  projects,
  idPrefix,
}: {
  links: LinkedProject[];
  onChange: (next: LinkedProject[]) => void;
  projects: Project[];
  idPrefix: string;
}) {
  const [pending, setPending] = useState('');
  const linkedIds = new Set(links.map((link) => link.projectId));
  const available = projects.filter((project) => !linkedIds.has(project.id));
  const titleOf = (projectId: string) =>
    projects.find((project) => project.id === projectId)?.title ?? 'Project not in this list';

  return (
    <div>
      <span className="surface-label">Linked projects</span>
      <div className="mt-2 space-y-2">
        {links.map((link, index) => (
          <div key={link.projectId} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs text-foreground-secondary">
              {titleOf(link.projectId)}
            </span>
            <Input
              className="h-9 min-w-0 flex-1 text-sm"
              value={link.note ?? ''}
              onChange={(event) =>
                onChange(
                  links.map((item, position) =>
                    position === index
                      ? { ...item, note: event.target.value || undefined }
                      : item,
                  ),
                )
              }
              placeholder="Why they're related (optional)"
              aria-label={`${idPrefix} note for link to ${titleOf(link.projectId)}`}
            />
            <Button
              variant="danger"
              size="icon"
              onClick={() => onChange(links.filter((_, position) => position !== index))}
              aria-label={`${idPrefix} remove link to ${titleOf(link.projectId)}`}
            >
              <X className="size-4" />
            </Button>
          </div>
        ))}
        {available.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              className="native-select text-xs"
              value={pending}
              onChange={(event) => setPending(event.target.value)}
              aria-label={`${idPrefix} project to link`}
            >
              <option value="">Choose a project to link…</option>
              {available.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </select>
            <Button
              variant="secondary"
              size="sm"
              disabled={!pending}
              onClick={() => {
                onChange([...links, { projectId: pending }]);
                setPending('');
              }}
            >
              <Plus className="size-3.5" />
              Link
            </Button>
          </div>
        )}
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
 * Milestone editing: text, start/end dates, PIC, confidence, status, note,
 * order, delete.
 *
 * The whole array is handed back on every change and the caller decides when
 * to persist, so a half-typed milestone never reaches the database.
 *
 * On dates: the end field reads `endDate ?? dueDate`, so a milestone written
 * before `endDate` existed shows its real date and is not silently blanked.
 * Editing that field writes `endDate` and drops `dueDate` for that milestone
 * only — a per-milestone move the owner initiated, never a sweep over data
 * nobody touched. A milestone left alone keeps `dueDate` exactly as it is.
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
        <div key={milestone.id} className="border border-border-subtle bg-surface-2 p-3">
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
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="surface-label">Start</span>
              <Input
                type="date"
                className="mt-1"
                value={milestone.startDate ?? ''}
                onChange={(event) =>
                  replace(milestone.id, (m) => ({
                    ...m,
                    startDate: event.target.value || undefined,
                  }))
                }
                aria-label={`Milestone ${index + 1} start date`}
              />
            </label>
            <label className="block">
              <span className="surface-label">End</span>
              <Input
                type="date"
                className="mt-1"
                value={milestone.endDate ?? milestone.dueDate ?? ''}
                onChange={(event) =>
                  replace(milestone.id, (m) => ({
                    ...m,
                    endDate: event.target.value || undefined,
                    dueDate: undefined,
                  }))
                }
                aria-label={`Milestone ${index + 1} end date`}
              />
            </label>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <Input
              value={milestone.pic ?? ''}
              onChange={(event) =>
                // Not trimmed here — trimming mid-keystroke makes a two-word
                // name impossible to type. The save path trims.
                replace(milestone.id, (m) => ({ ...m, pic: event.target.value || undefined }))
              }
              placeholder="PIC"
              aria-label={`Milestone ${index + 1} PIC`}
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
