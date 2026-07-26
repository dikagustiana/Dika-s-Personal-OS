import { Plus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ProjectCard } from '../../components/ProjectCard';
import { ProjectChildren } from '../../components/ProjectChildren';
import {
  ProjectFields,
  emptyProjectDraft,
  type ProjectDraft,
} from '../../components/ProjectEditor';
import { Button } from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import type { FinishLineItem, Project, TaskEntry, WeeklyPlan } from '../../data/types';
import { useMutation } from '../../hooks/useMutation';
import {
  ancestorIds,
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
 * Projects render as a forest: a root project shows its complete card, and its
 * children are listed beneath it as compact rows that expand in place to the
 * same complete card. Nothing about a child is unreachable — but ten or thirty
 * full cards under one parent is a page measured in tens of thousands of
 * pixels, and that is not a list anyone can use.
 */
export function Projects() {
  const repository = useAppStore((state) => state.repository);
  const domain = useAppStore((state) => state.workspace);
  const projectFocus = useAppStore((state) => state.projectFocus);
  const setProjectFocus = useAppStore((state) => state.setProjectFocus);
  const setWorkView = useAppStore((state) => state.setWorkView);
  const setFinishLineFocus = useAppStore((state) => state.setFinishLineFocus);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<TaskEntry[]>([]);
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [finishLineItems, setFinishLineItems] = useState<FinishLineItem[]>([]);
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
    // The finish-line pack is WORK-only, and its absence must not take the
    // project list down: cards simply render without a "Makes trustworthy"
    // section, exactly as they did before the pack existed.
    if (domain === 'work') {
      try {
        setFinishLineItems(await repository.listFinishLineItems());
      } catch {
        setFinishLineItems([]);
      }
    } else {
      setFinishLineItems([]);
    }
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
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const scrollToProject = (projectId: string) => {
    setEntityFilter(ALL_ENTITIES);
    // A link may point at a collapsed child, whose card is not in the DOM at
    // all. Expand first for the same reason the filter is cleared first — and
    // expand the whole ancestor chain, because a collapsed row renders none of
    // its descendants, so opening only the target would mount nothing.
    setExpanded((current) => {
      const next = new Set(current);
      next.add(projectId);
      for (const id of ancestorIds(projects, projectId)) next.add(id);
      return next;
    });
    setScrollTarget(projectId);
  };

  // The cross-view handoff (a needs-action row on the dashboard): once the
  // list has loaded, run the same clear-filter → expand → scroll mechanism a
  // linked-project chip uses, remember which card should open its milestone
  // list, and clear the handoff so a later visit starts neutral.
  const [milestonesOpenFor, setMilestonesOpenFor] = useState<string | null>(null);
  useEffect(() => {
    if (!projectFocus || projects.length === 0) return;
    if (!projects.some((project) => project.id === projectFocus.projectId)) return;
    if (projectFocus.openMilestones) setMilestonesOpenFor(projectFocus.projectId);
    scrollToProject(projectFocus.projectId);
    setProjectFocus(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectFocus, projects]);

  const toggleChild = (projectId: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });

  useEffect(() => {
    if (!scrollTarget) return;
    document
      .getElementById(`project-card-${scrollTarget}`)
      // 'auto', never 'smooth': an explicit behavior overrides CSS
      // scroll-behavior, which is where the reduced-motion block lives.
      ?.scrollIntoView({ behavior: 'auto', block: 'start' });
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

  // The reverse of Finish line's "closes via": a card's Makes-trustworthy row
  // lands on the pack, scrolled to and expanded at that line — the same
  // one-shot handoff shape projectFocus uses in the other direction.
  const openFinishLine =
    domain === 'work'
      ? (itemId: string) => {
          setFinishLineFocus({ itemId });
          setWorkView('finish-line');
        }
      : undefined;

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
        defaultMilestonesOpen={node.project.id === milestonesOpenFor}
        onNavigateToProject={scrollToProject}
        updateProject={(id, patch) => repository.updateProject(id, patch)}
        onDelete={deleteProject}
        onChange={onChange}
        finishLineItems={domain === 'work' ? finishLineItems : undefined}
        onOpenFinishLine={openFinishLine}
      />
      <ProjectChildren
        nodes={node.children}
        domain={domain}
        // A needs-action milestone can live on a nested project; expanding the
        // ancestor chain mounts the card but does not open the list inside it.
        milestonesOpenFor={milestonesOpenFor}
        expanded={expanded}
        onToggle={toggleChild}
        tasks={tasks}
        goals={plan?.goals ?? []}
        projects={projects}
        onNavigateToProject={scrollToProject}
        updateProject={(id, patch) => repository.updateProject(id, patch)}
        onDelete={deleteProject}
        onChange={onChange}
        finishLineItems={domain === 'work' ? finishLineItems : undefined}
        onOpenFinishLine={openFinishLine}
      />
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
