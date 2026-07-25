import { Plus, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
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
  const [creating, setCreating] = useState(false);
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
    };
    const created = await run('Create project', () => repository.createProject(input));
    if (!created) return;
    setProjects((current) => [...current, created]);
    setDraft(emptyProjectDraft());
    setCreating(false);
  };

  const deleteProject = async (id: string) => {
    await repository.deleteProject(id);
    setProjects((current) => current.filter((project) => project.id !== id));
  };

  return (
    <div className="page-shell">
      <header className="mb-7 border-b border-gray-800 pb-7 md:flex md:items-end md:justify-between">
        <div>
          <p className="page-kicker">{domain} / Projects</p>
          <h1 className="page-title">Keep it moving</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-500">
            Long-range commitments, reduced to the milestones and linked activity that prove momentum.
          </p>
        </div>
        <Button
          variant={creating ? 'secondary' : 'default'}
          className="mt-5 md:mt-0"
          onClick={() => setCreating((current) => !current)}
        >
          {creating ? <X className="size-4" /> : <Plus className="size-4" />}
          {creating ? 'Cancel' : 'New project'}
        </Button>
      </header>

      {creating && (
        <Card className="mb-5 border-primary/30">
          <CardContent className="pt-5">
            <ProjectFields draft={draft} onChange={setDraft} idPrefix="New project" />
            <div className="mt-5">
              <Button onClick={() => void createProject()} disabled={isPending || !draft.title.trim()}>
                <Plus className="size-4" />
                Create project
              </Button>
              <p className="mt-3 text-xs text-gray-600">
                Milestones are added from the project card once it exists.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-5 2xl:grid-cols-2">
        {projects.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            domain={domain}
            tasks={tasks}
            goals={plan?.goals ?? []}
            updateProject={(id, patch) => repository.updateProject(id, patch)}
            onDelete={deleteProject}
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
