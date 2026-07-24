import {
  CalendarClock,
  CheckCircle2,
  Circle,
  FlaskConical,
  GraduationCap,
  Hammer,
  Link2,
  Pause,
  Target,
  Trophy,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Checkbox } from '../../components/ui/Checkbox';
import { Progress } from '../../components/ui/Progress';
import type { Project, TaskEntry, WeeklyPlan } from '../../data/types';
import { getIsoWeekKey } from '../../logic/week';
import { cn } from '../../lib/utils';
import { useAppStore } from '../../store/appStore';

const typeIcons = {
  scholarship: Trophy,
  study: GraduationCap,
  research: FlaskConical,
  build: Hammer,
  other: Target,
} as const;

function deadlineText(deadline?: string): string {
  if (!deadline) return 'No deadline';
  const days = differenceInCalendarDays(parseISO(deadline), new Date());
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Due today';
  return `${days} days left`;
}

export function Projects() {
  const repository = useAppStore((state) => state.repository);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<TaskEntry[]>([]);
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);

  const load = useCallback(async () => {
    const [projectData, taskEntries, weeklyPlan] = await Promise.all([
      repository.listProjects(),
      repository.listEntries({ type: 'task' }),
      repository.getWeeklyPlan(getIsoWeekKey(new Date())),
    ]);
    setProjects(projectData);
    setTasks(taskEntries.filter((entry): entry is TaskEntry => entry.type === 'task'));
    setPlan(weeklyPlan);
  }, [repository]);

  useEffect(() => {
    void load();
  }, [load]);

  const goalProjectById = useMemo(
    () => new Map(plan?.goals.map((goal) => [goal.id, goal.projectId]) ?? []),
    [plan],
  );

  const toggleMilestone = async (project: Project, milestoneId: string) => {
    const milestones = project.milestones.map((milestone) =>
      milestone.id === milestoneId ? { ...milestone, done: !milestone.done } : milestone,
    );
    const updated = await repository.updateProject(project.id, { milestones });
    setProjects((current) =>
      current.map((item) => (item.id === project.id ? updated : item)),
    );
  };

  const setStatus = async (project: Project, status: Project['status']) => {
    const updated = await repository.updateProject(project.id, { status });
    setProjects((current) =>
      current.map((item) => (item.id === project.id ? updated : item)),
    );
  };

  return (
    <div className="page-shell">
      <header className="mb-7 border-b border-gray-800 pb-7">
        <p className="page-kicker">Growth / Projects</p>
        <h1 className="page-title">Keep it moving</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-500">
          Long-range commitments, reduced to the milestones and linked activity that prove momentum.
        </p>
      </header>

      <div className="grid gap-5 2xl:grid-cols-2">
        {projects.map((project) => {
          const Icon = typeIcons[project.type];
          const doneMilestones = project.milestones.filter((milestone) => milestone.done).length;
          const progress = project.milestones.length
            ? Math.round((100 * doneMilestones) / project.milestones.length)
            : 0;
          const linkedGoals = plan?.goals.filter((goal) => goal.projectId === project.id) ?? [];
          const linkedGoalIds = new Set(linkedGoals.map((goal) => goal.id));
          const linkedTasks = tasks.filter(
            (task) =>
              task.projectId === project.id ||
              Boolean(task.weeklyGoalId && linkedGoalIds.has(task.weeklyGoalId)) ||
              Boolean(
                task.weeklyGoalId &&
                  goalProjectById.get(task.weeklyGoalId) === project.id,
              ),
          );

          return (
            <Card key={project.id} className={cn('min-w-0', project.status !== 'active' && 'opacity-70')}>
              <CardHeader className="flex-col border-b border-gray-800 sm:flex-row">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid size-11 shrink-0 place-items-center border border-primary/40 bg-primary/10">
                    <Icon className="size-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <CardTitle className="truncate text-base normal-case tracking-normal text-gray-100">
                      {project.title}
                    </CardTitle>
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-gray-600">
                      {project.type}
                    </p>
                  </div>
                </div>
                <select
                  className="native-select !w-full text-xs sm:!w-auto sm:min-w-28"
                  value={project.status}
                  onChange={(event) =>
                    void setStatus(project, event.target.value as Project['status'])
                  }
                  aria-label={`Status for ${project.title}`}
                >
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="done">Done</option>
                </select>
              </CardHeader>
              <CardContent className="pt-5">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="border border-gray-800 bg-black/10 p-3">
                    <CalendarClock className="size-4 text-gold" />
                    <p className="mt-3 text-sm font-semibold text-gray-200">
                      {deadlineText(project.deadline)}
                    </p>
                    <p className="mt-1 text-[10px] uppercase tracking-wider text-gray-600">
                      {project.deadline
                        ? format(parseISO(project.deadline), 'MMM d, yyyy')
                        : 'Open horizon'}
                    </p>
                  </div>
                  <div className="border border-gray-800 bg-black/10 p-3">
                    <Link2 className="size-4 text-primary" />
                    <p className="mt-3 text-sm font-semibold text-gray-200">
                      {linkedTasks.filter((task) => task.done).length}/{linkedTasks.length} tasks
                    </p>
                    <p className="mt-1 text-[10px] uppercase tracking-wider text-gray-600">
                      Linked this week
                    </p>
                  </div>
                  <div className="border border-gray-800 bg-black/10 p-3">
                    <Target className="size-4 text-primary" />
                    <p className="mt-3 text-sm font-semibold text-gray-200">
                      {linkedGoals.filter((goal) => goal.done).length}/{linkedGoals.length} goals
                    </p>
                    <p className="mt-1 text-[10px] uppercase tracking-wider text-gray-600">
                      Weekly outcomes
                    </p>
                  </div>
                </div>

                {project.targetMetric && (
                  <div className="mt-4 border-l-2 border-gold/50 pl-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-600">Target</p>
                    <p className="mt-1 text-sm text-gold/85">{project.targetMetric}</p>
                  </div>
                )}

                <div className="mt-6">
                  <div className="mb-2 flex items-end justify-between">
                    <div>
                      <p className="surface-label">Milestones</p>
                      <p className="mt-1 text-xs text-gray-600">
                        {doneMilestones} of {project.milestones.length} complete
                      </p>
                    </div>
                    <span className="font-mono text-sm text-primary">{progress}%</span>
                  </div>
                  <Progress value={progress} />
                  <div className="mt-3 divide-y divide-gray-800">
                    {project.milestones.map((milestone) => (
                      <label
                        key={milestone.id}
                        className="flex min-h-14 cursor-pointer items-center gap-3 py-1"
                      >
                        <Checkbox
                          checked={milestone.done}
                          onCheckedChange={() => void toggleMilestone(project, milestone.id)}
                          aria-label={`Toggle ${milestone.text}`}
                        />
                        <span
                          className={cn(
                            'min-w-0 flex-1 text-sm text-gray-300',
                            milestone.done && 'text-gray-600 line-through',
                          )}
                        >
                          {milestone.text}
                        </span>
                        {milestone.done ? (
                          <CheckCircle2 className="size-4 shrink-0 text-primary" />
                        ) : project.status === 'paused' ? (
                          <Pause className="size-4 shrink-0 text-gray-700" />
                        ) : (
                          <Circle className="size-4 shrink-0 text-gray-700" />
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
