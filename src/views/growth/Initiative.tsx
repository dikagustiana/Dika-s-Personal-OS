import { useCallback, useEffect, useMemo, useState } from 'react';
import { ProjectCard } from '../../components/ProjectCard';
import { ProjectChildren } from '../../components/ProjectChildren';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { EmptyRow } from '../../components/ui/EmptyRow';
import { Input } from '../../components/ui/Input';
import type { Project, TaskEntry, WebsiteCategory, WeeklyPlan } from '../../data/types';
import { buildProjectTree, findNode, rollupMilestones } from '../../logic/hierarchy';
import { GROWTH_INITIATIVES, type InitiativeKey } from '../../logic/initiatives';
import { getIsoWeekKey } from '../../logic/week';
import { useAppStore } from '../../store/appStore';

const WEBSITE_CATEGORIES: Array<{ value: WebsiteCategory; label: string }> = [
  { value: 'finance', label: 'Finance' },
  { value: 'accounting', label: 'Accounting' },
  { value: 'green-transition', label: 'Green Transition' },
  { value: 'development-finance', label: 'Development Finance' },
  { value: 'critical-thinking', label: 'Critical Thinking' },
  { value: 'next-big-thing', label: 'Next Big Thing' },
  { value: 'books', label: 'Books' },
];

/**
 * A single GROWTH initiative rendered as its own page (Uni Applications,
 * Chevening, LPDP, Research, Website). Reuses ProjectCard; the project is
 * matched by the initiative's fixed id. Research and Website additionally
 * show a "current piece" (workingTitle); Website adds a section category.
 *
 * The page resolves the initiative's own project AND its children. It used to
 * resolve exactly one project by id, which is why child projects — correct in
 * the database, with correct parent ids — were invisible everywhere in GROWTH:
 * this view predates `parent_id` and was never updated when it landed.
 */
export function Initiative({ initiative }: { initiative: InitiativeKey }) {
  const repository = useAppStore((state) => state.repository);
  const [project, setProject] = useState<Project | null>(null);
  // The whole GROWTH list is kept so linked-project chips can resolve their
  // titles live and the parent/link pickers have candidates.
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<TaskEntry[]>([]);
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  // Expansion lives here, not in ProjectChildren, so a child can be opened
  // programmatically — a link that scrolls to a collapsed card finds nothing.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const meta = GROWTH_INITIATIVES.find((item) => item.key === initiative);
  const showPiece = initiative === 'research' || initiative === 'website';
  const showCategory = initiative === 'website';

  const load = useCallback(async () => {
    const [projects, entries, weeklyPlan] = await Promise.all([
      repository.listProjects('growth'),
      repository.listEntries({ type: 'task', domain: 'growth' }),
      repository.getWeeklyPlan(getIsoWeekKey(new Date()), 'growth'),
    ]);
    setAllProjects(projects);
    setProject(projects.find((item) => item.id === meta?.projectId) ?? null);
    setTasks(entries.filter((entry): entry is TaskEntry => entry.type === 'task'));
    setPlan(weeklyPlan);
    setLoaded(true);
  }, [meta?.projectId, repository]);

  useEffect(() => {
    void load();
  }, [load]);

  // `listProjects` already returns sort_order ascending, so the forest keeps
  // the owner's ordering without a second sort here.
  const node = useMemo(() => {
    if (!project) return undefined;
    return findNode(buildProjectTree(allProjects), project.id);
  }, [allProjects, project]);

  const toggleChild = (projectId: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });

  const onProjectChange = (updated: Project) => {
    setAllProjects((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)),
    );
    if (updated.id === project?.id) setProject(updated);
  };

  const saveWorkingTitle = async () => {
    if (!project || titleDraft === null) return;
    const workingTitle = titleDraft.trim();
    if (workingTitle === (project.workingTitle ?? '')) return;
    setProject(
      await repository.updateProject(project.id, {
        workingTitle: workingTitle || undefined,
      }),
    );
  };

  const setCategory = async (category: WebsiteCategory | '') => {
    if (!project) return;
    setProject(
      await repository.updateProject(project.id, {
        category: category || undefined,
      }),
    );
  };

  return (
    <div className="page-shell">
      <header className="mb-7 border-b border-border-subtle pb-7">
        <p className="page-kicker">Growth / {meta?.label}</p>
        <h1 className="page-title">{meta?.label}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-foreground-muted">
          Milestones, status, and the notes that keep this initiative moving.
        </p>
      </header>

      {project ? (
        <div className="max-w-3xl space-y-5">
          {showPiece && (
            <Card>
              <CardHeader>
                <CardTitle>Current piece</CardTitle>
              </CardHeader>
              <CardContent
                className={showCategory ? 'grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(180px,0.5fr)]' : ''}
              >
                <label className="block">
                  <span className="surface-label">Working title</span>
                  <Input
                    className="mt-1"
                    value={titleDraft ?? project.workingTitle ?? ''}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    onBlur={() => void saveWorkingTitle()}
                    placeholder="What you're writing right now…"
                    aria-label="Working title"
                  />
                </label>
                {showCategory && (
                  <label className="block">
                    <span className="surface-label">Site section</span>
                    <select
                      className="native-select mt-1"
                      value={project.category ?? ''}
                      onChange={(event) => void setCategory(event.target.value as WebsiteCategory | '')}
                      aria-label="Site section"
                    >
                      <option value="">No section</option>
                      {WEBSITE_CATEGORIES.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </CardContent>
            </Card>
          )}

          <ProjectCard
            project={project}
            domain="growth"
            tasks={tasks}
            goals={plan?.goals ?? []}
            projects={allProjects}
            // The umbrella project owns no milestones of its own; without the
            // rollup its Milestones tile reads 0 of 0 while ten children below
            // hold two hundred.
            rollup={node ? rollupMilestones(node) : undefined}
            updateProject={(id, patch) => repository.updateProject(id, patch)}
            onChange={onProjectChange}
          />

          <ProjectChildren
            nodes={node?.children ?? []}
            domain="growth"
            expanded={expanded}
            onToggle={toggleChild}
            tasks={tasks}
            goals={plan?.goals ?? []}
            projects={allProjects}
            updateProject={(id, patch) => repository.updateProject(id, patch)}
            onChange={onProjectChange}
          />
        </div>
      ) : (
        loaded && (
          <EmptyRow
            label="Project"
            clause="Not set up yet — create it from the Projects view"
          />
        )
      )}
    </div>
  );
}
