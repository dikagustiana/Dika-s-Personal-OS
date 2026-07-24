import { useCallback, useEffect, useState } from 'react';
import { ProjectCard } from '../../components/ProjectCard';
import type { Project, TaskEntry, WeeklyPlan } from '../../data/types';
import { getIsoWeekKey } from '../../logic/week';
import { useAppStore } from '../../store/appStore';

/**
 * The general project list for the active domain. Recurring monthly-close
 * cycles are excluded — they live in the Monthly Close view.
 */
export function Projects() {
  const repository = useAppStore((state) => state.repository);
  const domain = useAppStore((state) => state.workspace);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<TaskEntry[]>([]);
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);

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

  return (
    <div className="page-shell">
      <header className="mb-7 border-b border-gray-800 pb-7">
        <p className="page-kicker">{domain} / Projects</p>
        <h1 className="page-title">Keep it moving</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-500">
          Long-range commitments, reduced to the milestones and linked activity that prove momentum.
        </p>
      </header>

      <div className="grid gap-5 2xl:grid-cols-2">
        {projects.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            domain={domain}
            tasks={tasks}
            goals={plan?.goals ?? []}
            updateProject={(id, patch) => repository.updateProject(id, patch)}
            onChange={(updated) =>
              setProjects((current) =>
                current.map((item) => (item.id === updated.id ? updated : item)),
              )
            }
          />
        ))}
      </div>
    </div>
  );
}
