import { useCallback, useEffect, useState } from 'react';
import { ProjectCard } from '../../components/ProjectCard';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Input } from '../../components/ui/Input';
import type { Project, TaskEntry, WebsiteCategory, WeeklyPlan } from '../../data/types';
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
 */
export function Initiative({ initiative }: { initiative: InitiativeKey }) {
  const repository = useAppStore((state) => state.repository);
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<TaskEntry[]>([]);
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);

  const meta = GROWTH_INITIATIVES.find((item) => item.key === initiative);
  const showPiece = initiative === 'research' || initiative === 'website';
  const showCategory = initiative === 'website';

  const load = useCallback(async () => {
    const [projects, entries, weeklyPlan] = await Promise.all([
      repository.listProjects('growth'),
      repository.listEntries({ type: 'task', domain: 'growth' }),
      repository.getWeeklyPlan(getIsoWeekKey(new Date()), 'growth'),
    ]);
    setProject(projects.find((item) => item.id === meta?.projectId) ?? null);
    setTasks(entries.filter((entry): entry is TaskEntry => entry.type === 'task'));
    setPlan(weeklyPlan);
    setLoaded(true);
  }, [meta?.projectId, repository]);

  useEffect(() => {
    void load();
  }, [load]);

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
            updateProject={(id, patch) => repository.updateProject(id, patch)}
            onChange={setProject}
          />
        </div>
      ) : (
        loaded && (
          <div className="grid min-h-52 place-items-center rounded-lg border border-dashed border-border">
            <EmptyState
              title="Not set up yet"
              hint="This initiative has no project behind it — create it from the Projects view."
            />
          </div>
        )
      )}
    </div>
  );
}
