import {
  CalendarClock,
  FlaskConical,
  GraduationCap,
  Hammer,
  Link2,
  Megaphone,
  Target,
  Trophy,
} from 'lucide-react';
import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { Input } from './ui/Input';
import { Progress } from './ui/Progress';
import type {
  Domain,
  EscalateTo,
  Milestone,
  MilestoneStatus,
  Project,
  TaskEntry,
  WeeklyGoal,
} from '../data/types';
import { daysLeft, daysLeftLabel, urgencyFor } from '../logic/deadlines';
import {
  ESCALATION_TARGETS,
  MILESTONE_STATUSES,
  withMilestoneStatus,
} from '../logic/milestones';
import { cn } from '../lib/utils';

const typeIcons = {
  scholarship: Trophy,
  study: GraduationCap,
  research: FlaskConical,
  build: Hammer,
  other: Target,
} as const;

function deadlineText(deadline?: string): string {
  if (!deadline) return 'No deadline';
  return daysLeftLabel(daysLeft(deadline, new Date()));
}

function MilestoneDueChip({ dueDate }: { dueDate: string }) {
  const days = daysLeft(dueDate, new Date());
  const urgency = urgencyFor(dueDate, new Date(), 7);
  return (
    <span
      className={cn(
        'shrink-0 border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider tabular-nums',
        urgency === 'overdue' && 'border-destructive/40 text-destructive',
        urgency === 'due-soon' && 'border-escalate/40 text-escalate',
        urgency === 'on-track' && 'border-gray-700 text-gray-500',
      )}
    >
      {daysLeftLabel(days)}
    </span>
  );
}

export interface ProjectCardProps {
  project: Project;
  domain: Domain;
  /** Tasks in the project's domain, for the "linked this week" tile. */
  tasks?: TaskEntry[];
  /** This week's goals, for the linked-goals tile. */
  goals?: WeeklyGoal[];
  onChange: (updated: Project) => void;
  updateProject: (id: string, patch: Partial<Project>) => Promise<Project>;
  /** Hide the deadline/tasks/goals tile strip for compact contexts. */
  compact?: boolean;
}

/**
 * One project with its milestone editor: status select, note (saved on blur),
 * and — WORK only — the escalation selector. Blocked rows carry a red edge,
 * escalated rows an amber edge + megaphone. Milestones with a dueDate show a
 * days-left chip.
 */
export function ProjectCard({
  project,
  domain,
  tasks = [],
  goals = [],
  onChange,
  updateProject,
  compact = false,
}: ProjectCardProps) {
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  const Icon = typeIcons[project.type];
  const doneMilestones = project.milestones.filter((milestone) => milestone.done).length;
  const progress = project.milestones.length
    ? Math.round((100 * doneMilestones) / project.milestones.length)
    : 0;
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

  const saveNote = async (milestone: Milestone) => {
    const draft = noteDrafts[milestone.id];
    if (draft === undefined) return;
    const note = draft.trim();
    if (note === (milestone.note ?? '')) return;
    await patchMilestone(milestone.id, (current) => ({
      ...current,
      note: note || undefined,
    }));
  };

  const setStatus = async (status: Project['status']) => {
    onChange(await updateProject(project.id, { status }));
  };

  return (
    <Card className={cn('min-w-0', project.status !== 'active' && 'opacity-70')}>
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
              {project.recurring === 'monthly' ? 'monthly close' : project.type}
            </p>
          </div>
        </div>
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
      </CardHeader>
      <CardContent className="pt-5">
        {!compact && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="border border-gray-800 bg-black/10 p-3">
              <CalendarClock className="size-4 text-primary" />
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
        )}

        {project.targetMetric && (
          <div className={cn('border-l-2 border-primary/50 pl-3', compact ? '' : 'mt-4')}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-600">Target</p>
            <p className="mt-1 text-sm text-primary/85">{project.targetMetric}</p>
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
            {project.milestones.map((milestone) => {
              const escalated = (milestone.escalateTo ?? 'none') !== 'none';
              return (
                <div
                  key={milestone.id}
                  className={cn(
                    'space-y-2 border-l-2 py-3 pl-3',
                    milestone.status === 'blocked'
                      ? 'border-l-destructive/60'
                      : escalated
                        ? 'border-l-escalate/60'
                        : 'border-l-transparent',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'min-w-0 flex-1 text-sm text-gray-300',
                        milestone.done && 'text-gray-600 line-through',
                      )}
                    >
                      {milestone.text}
                    </span>
                    {milestone.dueDate && !milestone.done && (
                      <MilestoneDueChip dueDate={milestone.dueDate} />
                    )}
                    {escalated && (
                      <Megaphone className="size-4 shrink-0 text-escalate" aria-label="Escalated" />
                    )}
                  </div>
                  <div
                    className={cn(
                      'grid gap-2',
                      domain === 'work'
                        ? 'sm:grid-cols-[minmax(120px,0.4fr)_minmax(0,1fr)_minmax(150px,0.5fr)]'
                        : 'sm:grid-cols-[minmax(120px,0.4fr)_minmax(0,1fr)]',
                    )}
                  >
                    <select
                      className="native-select text-xs"
                      value={milestone.status}
                      onChange={(event) =>
                        void patchMilestone(milestone.id, (current) =>
                          withMilestoneStatus(current, event.target.value as MilestoneStatus),
                        )
                      }
                      aria-label={`Status for ${milestone.text}`}
                    >
                      {MILESTONE_STATUSES.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <Input
                      className="h-11 text-sm"
                      value={noteDrafts[milestone.id] ?? milestone.note ?? ''}
                      onChange={(event) =>
                        setNoteDrafts((current) => ({
                          ...current,
                          [milestone.id]: event.target.value,
                        }))
                      }
                      onBlur={() => void saveNote(milestone)}
                      placeholder="What's left / blocker…"
                      aria-label={`Note for ${milestone.text}`}
                    />
                    {domain === 'work' && (
                      <select
                        className={cn('native-select text-xs', escalated && 'text-escalate')}
                        value={milestone.escalateTo ?? 'none'}
                        onChange={(event) =>
                          void patchMilestone(milestone.id, (current) => ({
                            ...current,
                            escalateTo: event.target.value as EscalateTo,
                          }))
                        }
                        aria-label={`Escalation for ${milestone.text}`}
                      >
                        <option value="none">None</option>
                        {ESCALATION_TARGETS.map((target) => (
                          <option key={target.value} value={target.value}>
                            {target.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
