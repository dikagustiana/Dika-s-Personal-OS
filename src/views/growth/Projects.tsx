import { Plus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ProjectCard } from '../../components/ProjectCard';
import {
  ProjectFields,
  emptyProjectDraft,
  type ProjectDraft,
} from '../../components/ProjectEditor';
import { Button } from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import type { Project, TaskEntry, WeeklyPlan } from '../../data/types';
import { useMutation } from '../../hooks/useMutation';
import {
  buildProjectTree,
  entityTags,
  flattenNode,
  rollupMilestones,
  type ProjectNode,
} from '../../logic/hierarchy';
import { getIsoWeekKey } from '../../logic/week';
import { useAppStore } from '../../store/appStore';

const ALL_ENTITIES = '__all__';

/**
 * The general project list for the active domain. Recurring monthly-close
 * cycles are excluded — they live in the Monthly Close view.
 *
 * Projects render as a forest: a project with children shows each child as a
 * complete card of its own, indented under a rule. A child is not a summary
 * row — it has its own tiles, week strip, milestones, links and documents.
 */
export function Projects() {
  const repository = useAppStore((state) => state.repository);
  const domain = useAppStore((state) => state.workspace);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<TaskEntry[]>([]);
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [creating, setCreating] = useState(false);
  const [entityFilter, setEntityFilter] = useState<string>(ALL_ENTITIES);
  const [draft, setDraft] = useState<ProjectDraft>(emptyProjectDraft);
  const { run, isPending } = useMutation();

  const load = useCallback(async () => {
    const [projectData, taskEntries, weeklyPlan] = await Promise.all([
      repository.listProjects(domain),
      repository.listEntries({ type: 'task', domain }),
      repository.getWeeklyPlan(getIsoWeekKey(new Date()), domain),
    ]);
    setProjects(projectData.filter((project) => project.recurring !== 'monthly'));
    setTasks(taskEntries.filter((entry): entry is TaskEntry => entry.type === 'task'));
    setPlan(weeklyPlan);
  }, [domain, repository]);

  useEffect(() => {
    void load();
  }, [load]);

  const tags = useMemo(() => entityTags(projects), [projects]);
  const tree = useMemo(() => buildProjectTree(projects), [projects]);

  // A parent stays visible when any project in its subtree matches, so
  // filtering narrows the list without ever severing a card from its parent.
  const visibleTree = useMemo(() => {
    if (entityFilter === ALL_ENTITIES) return tree;
    return tree.filter((node) =>
      flattenNode(node).some((project) => project.entityTag === entityFilter),
    );
  }, [entityFilter, tree]);

  // Navigating to a linked project clears the entity filter first — the link
  // may point at a card the filter is hiding, and a click that appears to do
  // nothing is worse than a momentarily wider list. The scroll runs in an
  // effect so it happens after that wider list has actually rendered.
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);

  const scrollToProject = (projectId: string) => {
    setEntityFilter(ALL_ENTITIES);
    setScrollTarget(projectId);
  };

  useEffect(() => {
    if (!scrollTarget) return;
    document
      .getElementById(`project-card-${scrollTarget}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setScrollTarget(null);
  }, [scrollTarget]);

  const createProject = async () => {
    const title = draft.title.trim();
    if (!title) return;
    const input: Omit<Project, 'id'> = {
      domain,
      title,
      type: 'other',
      status: draft.status,
      milestones: [],
      order: projects.length + 1,
      startDate: draft.startDate || undefined,
      deadline: draft.deadline || undefined,
      dateConfidence: draft.dateConfidence,
      entityTag: draft.entityTag.trim() || undefined,
      parentId: draft.parentId || undefined,
      linkedProjects: draft.linkedProjects,
    };
    const created = await run('Create project', () => repository.createProject(input));
    if (!created) return;
    setProjects((current) => [...current, created]);
    setDraft(emptyProjectDraft());
    setCreating(false);
  };

  const deleteProject = async (id: string) => {
    await repository.deleteProject(id);
    // The database drops the parent pointer of any child (ON DELETE SET
    // NULL); mirror that locally so the children reappear at the top level
    // instead of vanishing until the next load.
    setProjects((current) =>
      current
        .filter((project) => project.id !== id)
        .map((project) =>
          project.parentId === id ? { ...project, parentId: undefined } : project,
        ),
    );
  };

  const onChange = (updated: Project) =>
    setProjects((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)),
    );

  const renderNode = (node: ProjectNode) => (
    <div
      key={node.project.id}
      // A card with children owns the full width even on the two-column
      // layout: nested cards inside a half-width column are unreadable.
      className={node.children.length > 0 ? 'min-w-0 2xl:col-span-2' : 'min-w-0'}
    >
      <ProjectCard
        project={node.project}
        domain={domain}
        tasks={tasks}
        goals={plan?.goals ?? []}
        projects={projects}
        rollup={rollupMilestones(node)}
        onNavigateToProject={scrollToProject}
        updateProject={(id, patch) => repository.updateProject(id, patch)}
        onDelete={deleteProject}
        onChange={onChange}
      />
      {node.children.length > 0 && (
        <div className="mt-4 space-y-4 border-l-2 border-border-subtle pl-4 sm:pl-6">
          {node.children.map(renderNode)}
        </div>
      )}
    </div>
  );

  return (
    <div className="page-shell">
      <header className="mb-7 border-b border-border-subtle pb-7 md:flex md:items-end md:justify-between">
        <div>
          <p className="page-kicker">{domain} / Projects</p>
          <h1 className="page-title">Keep it moving</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-foreground-muted">
            Long-range commitments, reduced to the milestones and linked activity that prove momentum.
          </p>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2 md:mt-0">
          {tags.length > 0 && (
            <label className="block">
              <span className="sr-only">Filter by entity</span>
              <select
                className="native-select text-xs sm:min-w-40"
                value={entityFilter}
                onChange={(event) => setEntityFilter(event.target.value)}
                aria-label="Filter by entity tag"
              >
                <option value={ALL_ENTITIES}>All entities</option>
                {tags.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button
            variant={creating ? 'secondary' : 'default'}
            onClick={() => setCreating((current) => !current)}
          >
            {creating ? <X className="size-4" /> : <Plus className="size-4" />}
            {creating ? 'Cancel' : 'New project'}
          </Button>
        </div>
      </header>

      {creating && (
        <Card className="mb-5 border-primary/30">
          <CardContent className="pt-5">
            <ProjectFields
              draft={draft}
              onChange={setDraft}
              idPrefix="New project"
              projects={projects}
            />
            <div className="mt-5">
              <Button onClick={() => void createProject()} disabled={isPending || !draft.title.trim()}>
                <Plus className="size-4" />
                Create project
              </Button>
              <p className="mt-3 text-xs text-foreground-muted">
                Milestones are added from the project card once it exists.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid items-start gap-5 2xl:grid-cols-2">
        {visibleTree.map(renderNode)}
      </div>
    </div>
  );
}
