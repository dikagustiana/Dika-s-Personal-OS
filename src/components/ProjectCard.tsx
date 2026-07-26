import {
  Check,
  FlaskConical,
  GraduationCap,
  Hammer,
  Pencil,
  Target,
  Trash2,
  Trophy,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from './ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import type {
  Domain,
  Milestone,
  Project,
  ProjectDocument,
  TaskEntry,
  WeeklyGoal,
} from '../data/types';
import { appendDocument, removeDocumentAt } from '../logic/documents';
import {
  buildProjectTree,
  findNode,
  rollupMilestones,
  type MilestoneRollup,
} from '../logic/hierarchy';
import {
  MilestoneEditorRows,
  ProjectFields,
  draftToPatch,
  projectToDraft,
  type ProjectDraft,
} from './ProjectEditor';
import { DocumentLinks, DocumentUpload } from './project/DocumentSection';
import { LinkedSection } from './project/LinkedSection';
import { MetricTiles } from './project/MetricTiles';
import { MilestoneSection } from './project/MilestoneSection';
import { WeekStripSection } from './project/WeekStripSection';
import { useMutation } from '../hooks/useMutation';
import { cn } from '../lib/utils';

const typeIcons = {
  scholarship: Trophy,
  study: GraduationCap,
  research: FlaskConical,
  build: Hammer,
  other: Target,
} as const;

/** Own counts only — the fallback when the card has no tree context. */
function ownRollup(project: Project): MilestoneRollup {
  const done = project.milestones.filter((milestone) => milestone.done).length;
  return {
    ownDone: done,
    ownTotal: project.milestones.length,
    done,
    total: project.milestones.length,
    childCount: 0,
  };
}

export interface ProjectCardProps {
  project: Project;
  domain: Domain;
  /** Tasks in the project's domain, for the "linked this week" tile. */
  tasks?: TaskEntry[];
  /** This week's goals, used to resolve goal-linked tasks. */
  goals?: WeeklyGoal[];
  onChange: (updated: Project) => void;
  updateProject: (id: string, patch: Partial<Project>) => Promise<Project>;
  /** Hide the dashboard strip (tiles, week, linked, documents) — Monthly Close. */
  compact?: boolean;
  /** Arrive with the milestone list open — set by cross-view navigation that
   *  targets a specific milestone, so the reader lands inside the list rather
   *  than in front of a collapsed section. */
  defaultMilestonesOpen?: boolean;
  /**
   * Supplied by views that own the project list. Its presence is what turns
   * on the delete control — a card embedded in a read-only context has none.
   */
  onDelete?: (id: string) => Promise<void>;
  /**
   * The domain's project list. Powers the parent/link pickers, resolves link
   * chip titles live, and supplies the child milestone rollup.
   */
  projects?: Project[];
  /** Milestone rollup including children; computed from `projects` if absent. */
  rollup?: MilestoneRollup;
  /** Navigates to a linked project. Absent means chips render as plain text. */
  onNavigateToProject?: (projectId: string) => void;
  /** Fixed "now" so every countdown on a screen agrees. Defaults to render time. */
  today?: Date;
}

/**
 * One project, top to bottom:
 *
 *   title + entity tag · metric tiles · target · this-week strip ·
 *   MILESTONES (collapsible) · linked · documents
 *
 * Only the milestone list collapses. The tiles, target, week strip, linked
 * chips and document list are the project's permanent dashboard — they do not
 * move, hide, or reflow when the milestone list opens or closes.
 */
export function ProjectCard({
  project,
  domain,
  tasks = [],
  goals = [],
  onChange,
  updateProject,
  compact = false,
  defaultMilestonesOpen = false,
  onDelete,
  projects,
  rollup,
  onNavigateToProject,
  today,
}: ProjectCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProjectDraft>(() => projectToDraft(project));
  const [milestoneDraft, setMilestoneDraft] = useState<Milestone[]>(project.milestones);
  const { run, isPending } = useMutation();

  const now = today ?? new Date();

  const openEditor = () => {
    setDraft(projectToDraft(project));
    setMilestoneDraft(project.milestones);
    setEditing(true);
  };

  /**
   * One write for the whole edit. Milestones are replaced by the array the
   * editor produced, which is the array it was seeded with — so this is still
   * an edit of known ids, not a blind overwrite of someone else's work.
   */
  const saveEdits = async () => {
    const title = draft.title.trim();
    if (!title) return;
    const updated = await run('Save project', () =>
      updateProject(project.id, {
        ...draftToPatch(draft),
        milestones: milestoneDraft
          .map((milestone) => ({
            ...milestone,
            text: milestone.text.trim(),
            pic: milestone.pic?.trim() || undefined,
          }))
          .filter((milestone) => milestone.text.length > 0),
      }),
    );
    if (!updated) return;
    onChange(updated);
    setEditing(false);
  };

  const deleteProject = async () => {
    if (!onDelete) return;
    await run('Delete project', async () => {
      await onDelete(project.id);
      return true as const;
    });
  };

  const Icon = typeIcons[project.type];

  const projectsById = useMemo(
    () => new Map((projects ?? []).map((item) => [item.id, item])),
    [projects],
  );

  // Rollup: use what the list view computed, otherwise derive it from the
  // project list, otherwise fall back to this project's own milestones.
  const counts = useMemo<MilestoneRollup>(() => {
    if (rollup) return rollup;
    if (!projects) return ownRollup(project);
    // Searched across the whole forest, not just the roots: a child project
    // shown on its own page still needs the rollup of its own subtree.
    const node = findNode(buildProjectTree(projects), project.id);
    return node ? rollupMilestones(node) : ownRollup(project);
  }, [project, projects, rollup]);

  const linkedGoals = goals.filter((goal) => goal.projectId === project.id);
  const linkedGoalIds = new Set(linkedGoals.map((goal) => goal.id));
  const linkedTasks = tasks.filter(
    (task) =>
      task.projectId === project.id ||
      Boolean(task.weeklyGoalId && linkedGoalIds.has(task.weeklyGoalId)),
  );

  const patchMilestone = async (
    milestoneId: string,
    mutate: (milestone: Milestone) => Milestone,
  ) => {
    const milestones = project.milestones.map((milestone) =>
      milestone.id === milestoneId ? mutate(milestone) : milestone,
    );
    onChange(await updateProject(project.id, { milestones }));
  };

  const setStatus = async (status: Project['status']) => {
    onChange(await updateProject(project.id, { status }));
  };

  const setDocuments = async (documents: ProjectDocument[]) => {
    onChange(
      await updateProject(project.id, {
        documents: documents.length > 0 ? documents : [],
      }),
    );
  };

  const documents = project.documents ?? [];

  return (
    <Card
      id={`project-card-${project.id}`}
      className={cn('min-w-0 scroll-mt-24', project.status !== 'active' && 'opacity-70')}
    >
      <CardHeader className="flex-col border-b border-border-subtle sm:flex-row">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-md border border-border bg-surface-2">
            <Icon className="size-5 text-foreground-secondary" />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <CardTitle className="truncate text-base normal-case tracking-normal text-foreground">
                {project.title}
              </CardTitle>
              {project.entityTag && (
                <span className="shrink-0 rounded-sm border border-border-subtle bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-foreground-muted">
                  {project.entityTag}
                </span>
              )}
            </div>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-foreground-muted">
              {project.recurring === 'monthly' ? 'monthly close' : project.type}
            </p>
          </div>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <select
            className="native-select !w-full text-xs sm:!w-auto sm:min-w-28"
            value={project.status}
            onChange={(event) => void setStatus(event.target.value as Project['status'])}
            aria-label={`Status for ${project.title}`}
          >
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="done">Done</option>
          </select>
          <Button
            variant="secondary"
            size="icon"
            onClick={() => (editing ? setEditing(false) : openEditor())}
            aria-label={editing ? `Stop editing ${project.title}` : `Edit ${project.title}`}
          >
            {editing ? <X className="size-4" /> : <Pencil className="size-4" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 pt-5">
        {editing && (
          <div className="rounded-md border border-border bg-surface-2/50 p-4">
            <ProjectFields
              draft={draft}
              onChange={setDraft}
              idPrefix={project.title}
              projects={projects}
              self={project}
            />
            <div className="mt-5">
              <p className="surface-label mb-2">Milestones</p>
              <MilestoneEditorRows milestones={milestoneDraft} onChange={setMilestoneDraft} />
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button onClick={() => void saveEdits()} disabled={isPending || !draft.title.trim()}>
                <Check className="size-4" />
                Save changes
              </Button>
              <Button variant="secondary" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              {onDelete && (
                <Button
                  variant="danger"
                  className="sm:ml-auto"
                  onClick={() => void deleteProject()}
                  disabled={isPending}
                >
                  <Trash2 className="size-4" />
                  Delete project
                </Button>
              )}
            </div>
          </div>
        )}

        {!compact && (
          <MetricTiles
            project={project}
            linkedTasksDone={linkedTasks.filter((task) => task.done).length}
            linkedTasksTotal={linkedTasks.length}
            rollup={counts}
          />
        )}

        {project.targetMetric && (
          <div className="border-l-2 border-border pl-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted">
              Target
            </p>
            <p className="mt-1 text-sm text-foreground-secondary">{project.targetMetric}</p>
          </div>
        )}

        {!compact && <WeekStripSection milestones={project.milestones} today={now} />}

        <MilestoneSection
          milestones={project.milestones}
          domain={domain}
          projectTitle={project.title}
          today={now}
          onPatch={patchMilestone}
          rollup={counts}
          // Monthly-close cards are worked as checklists, not read as
          // dashboards, so they open expanded. Everywhere else, collapsed.
          defaultOpen={compact || defaultMilestonesOpen}
        />

        {!compact && (
          <>
            <LinkedSection
              links={project.linkedProjects ?? []}
              projectsById={projectsById}
              onNavigate={onNavigateToProject}
            />

            <section aria-label={`Documents for ${project.title}`}>
              {documents.length === 0 ? (
                // One row when empty, not two affordances. "No documents yet"
                // plus a ~90px dashed drop zone cost ~120px on every card —
                // including every pinned card on the dashboard. The zone
                // returns once a document exists, when dragging is plausible.
                <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <p className="surface-label">Documents</p>
                  <span className="flex items-center gap-2 text-xs text-foreground-muted">
                    none
                    <DocumentUpload
                      variant="inline"
                      ariaContext={project.title}
                      onAdd={(document) => setDocuments(appendDocument(documents, document))}
                    />
                  </span>
                </div>
              ) : (
                <>
                  <p className="surface-label">Documents</p>
                  <DocumentLinks
                    className="mt-1.5"
                    documents={documents}
                    ariaContext={project.title}
                    onRemove={(index) => void setDocuments(removeDocumentAt(documents, index))}
                  />
                  <DocumentUpload
                    ariaContext={project.title}
                    onAdd={(document) => setDocuments(appendDocument(documents, document))}
                  />
                </>
              )}
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
