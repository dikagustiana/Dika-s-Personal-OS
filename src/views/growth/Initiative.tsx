import { useCallback, useEffect, useState } from 'react';
import { ProjectCard } from '../../components/ProjectCard';
import type { Project, TaskEntry, WeeklyPlan } from '../../data/types';
import { GROWTH_INITIATIVES, type InitiativeKey } from '../../logic/initiatives';
import { getIsoWeekKey } from '../../logic/week';
import { useAppStore } from '../../store/appStore';

/**
 * A single GROWTH initiative rendered as its own page (Uni Applications,
 * Chevening, LPDP, Research, Website). Reuses ProjectCard; the project is
 * matched by the initiative's fixed id.
 */
export function Initiative({ initiative }: { initiative: InitiativeKey }) {
  const repository = useAppStore((state) => state.repository);
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<TaskEntry[]>([]);
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [loaded, setLoaded] = useState(false);

  const meta = GROWTH_INITIATIVES.find((item) => item.key === initiative);

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

  return (
    <div className="page-shell">
      <header className="mb-7 border-b border-gray-800 pb-7">
        <p className="page-kicker">Growth / {meta?.label}</p>
        <h1 className="page-title">{meta?.label}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-500">
          Milestones, status, and the notes that keep this initiative moving.
        </p>
      </header>

      {project ? (
        <div className="max-w-3xl">
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
          <div className="grid min-h-52 place-items-center border border-dashed border-gray-800 text-center">
            <p className="text-sm text-gray-600">This initiative has not been set up yet.</p>
          </div>
        )
      )}
    </div>
  );
}
