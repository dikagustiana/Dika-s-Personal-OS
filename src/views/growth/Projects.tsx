import { Plus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { readStoredKey } from '../../components/PassphraseGate';
import { ProjectCard } from '../../components/ProjectCard';
import { ProjectChildren } from '../../components/ProjectChildren';
import {
  ProjectFields,
  emptyProjectDraft,
  type ProjectDraft,
} from '../../components/ProjectEditor';
import { ContributorProjectCard } from '../../components/project/ContributorProjectCard';
import type { TaskSectionData } from '../../components/project/TaskSection';
import { Button } from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import { readThrew, type ReadResult } from '../../data/readResult';
import type { ProjectTaskWrite } from '../../data/repository';
import { isSupabaseConfigured, provisionCollaborator } from '../../data/supabaseRepository';
import type {
  FinishLineEdge,
  Project,
  ProjectMember,
  ProjectTask,
  TaskEntry,
  WeeklyPlan,
} from '../../data/types';
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
  const viewer = useAppStore((state) => state.viewer);
  const isContributor = viewer.kind === 'contributor';
  const projectFocus = useAppStore((state) => state.projectFocus);
  const setProjectFocus = useAppStore((state) => state.setProjectFocus);
  const setWorkView = useAppStore((state) => state.setWorkView);
  const setFinishLineFocus = useAppStore((state) => state.setFinishLineFocus);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<TaskEntry[]>([]);
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  // `null` means this domain has no pack at all; a failed ReadResult means the
  // pack exists and we could not read it. Neither may render as a zero.
  const [finishLineEdges, setFinishLineEdges] = useState<ReadResult<FinishLineEdge> | null>(null);
  // Slice 1: the tasks inside projects and the project-membership grants.
  // For a collaborator both arrive RLS-scoped (granted projects; own grant
  // rows); the owner reads everything and uses the grants for the marker.
  const [projectTasks, setProjectTasks] = useState<ProjectTask[]>([]);
  const [projectMembers, setProjectMembers] = useState<ProjectMember[]>([]);
  // uuid → email, from the provisioning list. Owner-only and best-effort:
  // when the Edge Function is unreachable the UI falls back to short ids —
  // attribution still renders, just less friendly.
  const [emailByUser, setEmailByUser] = useState<Map<string, string>>(new Map());
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
    // project list down. A FAILED read is not an empty one, though: the tile
    // renders `—` ("not loaded") rather than a confident zero, which is what
    // `hasPackData: false` means downstream.
    if (domain === 'work') {
      try {
        setFinishLineEdges(await repository.listFinishLineEdges());
      } catch (error: unknown) {
        setFinishLineEdges(readThrew('listFinishLineEdges', error));
      }
      const [taskRows, memberRows] = await Promise.all([
        repository.listProjectTasks(),
        repository.listProjectMembers(),
      ]);
      setProjectTasks(taskRows.ok ? taskRows.rows : []);
      setProjectMembers(memberRows.ok ? memberRows.rows : []);
    } else {
      setFinishLineEdges(null);
      setProjectTasks([]);
      setProjectMembers([]);
    }
  }, [domain, repository]);

  useEffect(() => {
    void load();
  }, [load]);

  // Email resolution for attribution and the assignee picker. Skipped in mock
  // mode and for contributors (the function is owner-gated); a failure is
  // silent because short ids are an acceptable fallback, a blocked page not.
  useEffect(() => {
    if (isContributor || domain !== 'work' || !isSupabaseConfigured) return;
    const appKey = readStoredKey();
    if (!appKey) return;
    let cancelled = false;
    void provisionCollaborator(appKey, { action: 'list' })
      .then((result) => {
        if (cancelled || result.error || !result.users) return;
        setEmailByUser(new Map(result.users.map((user) => [user.userId, user.email])));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [domain, isContributor]);

  const resolveUser = useCallback(
    (userId: string): string => {
      const email = emailByUser.get(userId);
      if (email) return email;
      if (viewer.kind === 'contributor' && viewer.userId === userId) {
        return viewer.email ?? 'saya';
      }
      return `kontributor ${userId.slice(0, 8)}`;
    },
    [emailByUser, viewer],
  );

  const createTask = useCallback(
    async (input: {
      projectId: string;
      title: string;
      detail?: string;
      dueDate?: string;
      assignee?: string;
    }): Promise<boolean> => {
      const created = await run('Tambah tugas', () => repository.createProjectTask(input));
      if (!created) return false;
      setProjectTasks((current) => [...current, created]);
      return true;
    },
    [repository, run],
  );

  const updateTask = useCallback(
    async (id: string, patch: ProjectTaskWrite): Promise<boolean> => {
      const updated = await run('Simpan tugas', () => repository.updateProjectTask(id, patch));
      if (!updated) return false;
      setProjectTasks((current) =>
        current.map((task) => (task.id === updated.id ? updated : task)),
      );
      return true;
    },
    [repository, run],
  );

  const taskSectionFor = useCallback(
    (projectId: string): TaskSectionData | undefined => {
      if (domain !== 'work') return undefined;
      return {
        tasks: projectTasks.filter((task) => task.projectId === projectId),
        memberIds: projectMembers
          .filter((member) => member.projectId === projectId)
          .map((member) => member.userId),
        ...(viewer.kind === 'contributor' ? { viewerUserId: viewer.userId } : {}),
        resolveUser,
        onCreate: createTask,
        onUpdate: updateTask,
      };
    },
    [createTask, domain, projectMembers, projectTasks, resolveUser, updateTask, viewer],
  );

  // The shared/private marker is the OWNER's fact: a contributor sees only
  // their own grant rows, from which a count would be a half-truth.
  const memberCountFor = useCallback(
    (projectId: string): number | undefined => {
      if (domain !== 'work' || isContributor) return undefined;
      return projectMembers.filter((member) => member.projectId === projectId).length;
    },
    [domain, isContributor, projectMembers],
  );

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
    // GROWTH is always the owner's own world; WORK requires an explicit
    // client choice — the button below stays disabled until one is made, so
    // reaching here with '' is impossible for WORK.
    const engagement = domain === 'growth' ? 'internal' : draft.engagement;
    if (!engagement) return;
    const input: Omit<Project, 'id'> = {
      domain,
      engagement,
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

  // The reverse of Finish line's "closes via": a card's PACK LINES tile lands
  // on the matrix NARROWED TO THE CELLS THAT PROJECT CLOSES — the same
  // one-shot handoff shape projectFocus uses in the other direction. Cell ids
  // rather than a line id, because a project's cells are scattered across
  // sections and entities and scrolling to one of them would imply it was the
  // only one.
  const openFinishLine =
    domain === 'work'
      ? (itemId: string, entityCode?: string, cellIds?: string[]) => {
          setFinishLineFocus(
            cellIds ? { itemId, cellIds } : entityCode ? { itemId, entityCode } : { itemId },
          );
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
        finishLineEdges={domain === 'work' ? finishLineEdges : null}
        onOpenFinishLine={openFinishLine}
        taskSection={taskSectionFor(node.project.id)}
        memberCount={memberCountFor(node.project.id)}
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
        finishLineEdges={domain === 'work' ? finishLineEdges : null}
        onOpenFinishLine={openFinishLine}
        taskSectionFor={taskSectionFor}
        memberCountFor={memberCountFor}
      />
    </div>
  );

  // A collaborator's Projects page is the granted list, flat: parents they
  // were not granted are invisible, so the owner's tree would misplace what
  // remains. Zero grants renders as exactly that — nothing is wrong, nothing
  // was shared yet — never as an error.
  if (isContributor) {
    return (
      <div className="page-shell">
        <header className="mb-7 border-b border-border-subtle pb-7">
          <p className="page-kicker">work / Projects</p>
          <h1 className="page-title">Proyek yang dibagikan</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-foreground-muted">
            Daftar proyek yang aksesnya diberikan ke akunmu, dengan tugas dan linimasa per
            proyek.
          </p>
        </header>
        {projects.length === 0 ? (
          <Card>
            <CardContent className="pt-5">
              <p className="text-sm text-foreground-secondary">
                Belum ada proyek yang dibagikan ke akunmu.
              </p>
              <p className="mt-1.5 text-xs leading-5 text-foreground-muted">
                Akses proyek diberikan per proyek oleh pemilik — terpisah dari akses entitas
                Finish line. Minta pemilik membagikan proyeknya, lalu muat ulang halaman ini.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid items-start gap-5 2xl:grid-cols-2">
            {projects.map((project) => {
              const data = taskSectionFor(project.id);
              return data ? (
                <ContributorProjectCard key={project.id} project={project} taskData={data} />
              ) : null;
            })}
          </div>
        )}
      </div>
    );
  }

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
              showEngagement={domain === 'work'}
            />
            <div className="mt-5">
              <Button
                onClick={() => void createProject()}
                disabled={
                  isPending ||
                  !draft.title.trim() ||
                  (domain === 'work' && !draft.engagement)
                }
              >
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
