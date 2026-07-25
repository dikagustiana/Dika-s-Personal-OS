import { ArrowRight, CalendarCheck2, Pin, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { format, parseISO, subDays } from 'date-fns';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Checkbox } from '../../components/ui/Checkbox';
import { Input } from '../../components/ui/Input';
import { IeltsTrendChart } from '../../components/IeltsTrendChart';
import { ScoreRing } from '../../components/ScoreRing';
import type {
  HabitEntry,
  IeltsResult,
  Project,
  TaskEntry,
  WeeklyGoal,
  WeeklyPlan,
} from '../../data/types';
import {
  daysLeft,
  daysLeftLabelFor,
  formatDateFor,
  urgencyForConfident,
  type Urgency,
} from '../../logic/deadlines';
import { buildGanttChart } from '../../logic/gantt';
import { GROWTH_INITIATIVES, initiativeProjects } from '../../logic/initiatives';
import { calculateDailyScore } from '../../logic/score';
import { scoredTasks } from '../../logic/dailyLog';
import { useDailyLog } from '../../hooks/useDailyLog';
import { useMutation } from '../../hooks/useMutation';
import { getIsoWeekKey, getPreviousWeekKey, getWeekRange, summarizeWeek } from '../../logic/week';
import { cn } from '../../lib/utils';
import { useAppStore } from '../../store/appStore';

const urgencyText: Record<Urgency, string> = {
  overdue: 'text-destructive',
  'due-soon': 'text-escalate',
  'on-track': 'text-primary',
};

const barColor: Record<Urgency, string> = {
  overdue: 'bg-destructive/80',
  'due-soon': 'bg-escalate/80',
  'on-track': 'bg-primary/80',
};

/**
 * The GROWTH landing page: initiative deadline strip, compact daily (score,
 * habits, tasks) and weekly (goals + last-week recap) sections, and the Gantt
 * timeline comparing the six initiatives.
 */
export function GrowthDashboard() {
  const repository = useAppStore((state) => state.repository);
  const setGrowthView = useAppStore((state) => state.setGrowthView);
  const [projects, setProjects] = useState<Project[]>([]);
  const [habits, setHabits] = useState<HabitEntry[]>([]);
  const [tasks, setTasks] = useState<TaskEntry[]>([]);
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [recap, setRecap] = useState({ averageScore: 0, habitConsistency: 0, daysLogged: 0 });
  const [ieltsResults, setIeltsResults] = useState<IeltsResult[]>([]);
  const [taskTitle, setTaskTitle] = useState('');
  const [goalDraft, setGoalDraft] = useState('');

  const today = useMemo(() => new Date(), []);
  const todayKey = format(today, 'yyyy-MM-dd');
  const week = getIsoWeekKey(today);
  const { run, isPending } = useMutation();
  const {
    log: dailyLog,
    setLog,
    syncInputs,
    recomputeAndPersistDailyLog,
  } = useDailyLog(todayKey, 'growth');

  const load = useCallback(async () => {
    const previousWeek = getPreviousWeekKey(week);
    const previousRange = getWeekRange(previousWeek);
    const [projectData, entries, log, weeklyPlan, previousPlan, previousLogs, ielts] =
      await Promise.all([
        repository.listProjects('growth'),
        repository.listEntries({ domain: 'growth' }),
        repository.getDailyLog(todayKey, 'growth'),
        repository.getWeeklyPlan(week, 'growth'),
        repository.getWeeklyPlan(previousWeek, 'growth'),
        repository.listDailyLogs({
          from: previousRange.from,
          to: format(subDays(parseISO(previousRange.to), 1), 'yyyy-MM-dd'),
          domain: 'growth',
        }),
        repository.listIeltsResults(),
      ]);
    setProjects(projectData);
    setIeltsResults(ielts);
    setHabits(
      entries
        .filter((entry): entry is HabitEntry => entry.type === 'habit' && entry.active)
        .sort((a, b) => a.order - b.order),
    );
    // Every task, not only today's: the Inbox lives in this view too.
    setTasks(entries.filter((entry): entry is TaskEntry => entry.type === 'task'));
    setLog(log);
    setPlan(weeklyPlan);
    const summary = summarizeWeek(previousLogs, previousPlan);
    setRecap({
      averageScore: summary.averageScore,
      habitConsistency: summary.habitConsistency,
      daysLogged: summary.daysLogged,
    });
  }, [repository, setLog, todayKey, week]);

  useEffect(() => {
    void load();
  }, [load]);

  const initiatives = useMemo(() => initiativeProjects(projects), [projects]);
  const gantt = useMemo(() => buildGanttChart(initiatives, today, 14), [initiatives, today]);

  const todayTasks = useMemo(() => scoredTasks(tasks, todayKey), [tasks, todayKey]);
  const inboxTasks = useMemo(
    () => tasks.filter((task) => !task.done && task.priority !== 'urgent' && !task.dueDate),
    [tasks],
  );

  // GROWTH has no timebox, so the score renormalizes over habits and tasks.
  useEffect(() => {
    syncInputs({ habits, tasks: todayTasks, blocks: [] });
  }, [habits, syncInputs, todayTasks]);

  const score = useMemo(
    () =>
      calculateDailyScore({
        habits: {
          completed: habits.filter((habit) => dailyLog?.habits[habit.id]).length,
          total: habits.length,
        },
        tasks: {
          completed: todayTasks.filter((task) => task.done).length,
          total: todayTasks.length,
        },
        timeblocks: { completed: 0, total: 0 },
      }),
    [dailyLog, habits, todayTasks],
  );

  const toggleHabit = async (habit: HabitEntry) => {
    const previous = dailyLog;
    const currentHabits = dailyLog?.habits ?? {};
    const nextHabits = { ...currentHabits, [habit.id]: !currentHabits[habit.id] };
    setLog({
      ...(dailyLog ?? { date: todayKey, domain: 'growth', habits: {}, score: 0 }),
      habits: nextHabits,
    });
    const saved = await run('Save habit', () =>
      recomputeAndPersistDailyLog({ habitState: nextHabits }),
    );
    if (!saved) setLog(previous);
  };

  /** Captured to the Inbox, exactly as in WORK — see Today.tsx. */
  const addTask = async (event: FormEvent) => {
    event.preventDefault();
    const title = taskTitle.trim();
    if (!title) return;
    const input: Omit<TaskEntry, 'id' | 'createdAt' | 'updatedAt'> = {
      type: 'task',
      domain: 'growth',
      title,
      priority: 'normal',
      done: false,
      tags: [],
    };
    const created = await run('Add task', () => repository.createEntry(input));
    if (!created) return;
    setTaskTitle('');
    setTasks((current) => [created as TaskEntry, ...current]);
  };

  const pinToToday = async (task: TaskEntry) => {
    const updated = await run('Pin task to Today', () =>
      repository.updateEntry(task.id, { priority: 'urgent', dueDate: todayKey }),
    );
    if (!updated) return;
    const nextTasks = tasks.map((item) => (item.id === task.id ? (updated as TaskEntry) : item));
    setTasks(nextTasks);
    await recomputeAndPersistDailyLog({ tasks: scoredTasks(nextTasks, todayKey) });
  };

  const toggleTask = async (task: TaskEntry) => {
    const done = !task.done;
    const updated = await run(done ? 'Complete task' : 'Reopen task', () =>
      repository.updateEntry(task.id, {
        done,
        completedAt: done ? new Date().toISOString() : undefined,
      }),
    );
    if (!updated) return;
    const nextTasks = tasks.map((item) => (item.id === task.id ? (updated as TaskEntry) : item));
    setTasks(nextTasks);
    await recomputeAndPersistDailyLog({ tasks: scoredTasks(nextTasks, todayKey) });
  };

  const savePlan = async (goals: WeeklyGoal[]) => {
    const saved = await repository.upsertWeeklyPlan({
      week,
      domain: 'growth',
      theme: plan?.theme,
      goals,
      reviewedAt: plan?.reviewedAt,
    });
    setPlan(saved);
  };

  const toggleGoal = async (goal: WeeklyGoal) => {
    if (!plan) return;
    await savePlan(
      plan.goals.map((item) =>
        item.id === goal.id ? { ...item, done: !item.done } : item,
      ),
    );
  };

  const addGoal = async (event: FormEvent) => {
    event.preventDefault();
    const text = goalDraft.trim();
    if (!text || (plan?.goals.length ?? 0) >= 5) return;
    setGoalDraft('');
    await savePlan([
      ...(plan?.goals ?? []),
      { id: crypto.randomUUID(), text, done: false },
    ]);
  };

  const removeGoal = async (goal: WeeklyGoal) => {
    if (!plan) return;
    await savePlan(plan.goals.filter((item) => item.id !== goal.id));
  };

  return (
    <div className="page-shell">
      <header className="mb-7 border-b border-gray-800 pb-7">
        <p className="page-kicker">Growth / Dashboard</p>
        <h1 className="page-title">{format(today, 'EEEE')}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-500">
          {format(today, 'MMMM d, yyyy')} — the whole growth campaign on one screen.
        </p>
      </header>

      {/* Deadline countdown strip */}
      <div className="mb-5 grid gap-px overflow-hidden border border-gray-800 bg-gray-800 sm:grid-cols-3 xl:grid-cols-6">
        {GROWTH_INITIATIVES.map((initiative) => {
          const project = projects.find((item) => item.id === initiative.projectId);
          const deadline = project?.deadline;
          const confidence = project?.dateConfidence;
          const days = deadline ? daysLeft(deadline, today) : null;
          // Placeholder dates never drive urgency colour — see DateConfidence.
          const urgency = deadline
            ? urgencyForConfident(deadline, today, 14, confidence)
            : null;
          return (
            <div key={initiative.key} className="bg-card p-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-600">
                {initiative.label}
              </p>
              <p
                className={cn(
                  'mt-2 text-lg font-bold tabular-nums',
                  urgency ? urgencyText[urgency] : 'text-gray-600',
                )}
              >
                {days !== null ? daysLeftLabelFor(days, confidence) : '—'}
              </p>
              <p className="mt-1 font-mono text-[10px] text-gray-600">
                {deadline ? formatDateFor(deadline, confidence) : 'no deadline'}
              </p>
            </div>
          );
        })}
      </div>

      {/* Gantt timeline — the centerpiece */}
      <Card className="mb-5">
        <CardHeader>
          <div>
            <CardTitle>Initiative timeline</CardTitle>
            <p className="mt-2 text-sm text-gray-600">
              {format(gantt.windowStart, 'MMM d')} – {format(gantt.windowEnd, 'MMM d, yyyy')} ·
              bar per initiative, line = today
            </p>
          </div>
          <Sparkles className="size-4 text-primary" />
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <div className="relative min-w-[560px] space-y-2 py-2">
              <span
                className="absolute inset-y-0 z-10 w-px bg-gray-300/70"
                style={{ left: `${gantt.todayPct}%` }}
                aria-label="Today"
              />
              {gantt.rows.map((row) => (
                <div key={row.project.id} className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3">
                  <span className="truncate text-xs text-gray-400">{row.project.title}</span>
                  <div className="relative h-6 rounded-sm bg-black/20">
                    {row.hasDates ? (
                      <div
                        className={cn('absolute inset-y-1 rounded-sm', barColor[row.urgency])}
                        style={{ left: `${row.startPct}%`, width: `${row.widthPct}%` }}
                        title={`${row.project.startDate ?? 'lead-in'} → ${row.project.deadline}`}
                      />
                    ) : (
                      <span className="absolute inset-y-0 left-2 flex items-center text-[10px] text-gray-700">
                        No deadline set
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-3 flex items-center gap-4 text-[10px] text-gray-600">
            <span className="flex items-center gap-1.5"><span className="size-2.5 bg-primary/80" /> on track</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 bg-escalate/80" /> due soon</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 bg-destructive/80" /> overdue</span>
          </div>
        </CardContent>
      </Card>

      {/* IELTS trend preview — read-only, links to the full tracker */}
      <Card className="mb-5">
        <CardHeader>
          <div>
            <CardTitle>IELTS trend</CardTitle>
            <p className="mt-2 text-sm text-gray-600">
              Four skills + overall vs the 7.0 target.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setGrowthView('ielts')}>
            Open tracker
            <ArrowRight className="size-4" />
          </Button>
        </CardHeader>
        <CardContent>
          {ieltsResults.length > 0 ? (
            <IeltsTrendChart results={ieltsResults} compact />
          ) : (
            <p className="py-8 text-center text-sm text-gray-600">
              No IELTS results yet. Add your first mock in the tracker.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-3">
        {/* Daily — compact */}
        <Card>
          <CardHeader>
            <CardTitle>Today</CardTitle>
            <span className="text-xs text-gray-600">{format(today, 'MMM d')}</span>
          </CardHeader>
          <CardContent>
            <ScoreRing result={score} />
            <div className="mt-5 space-y-1">
              {habits.map((habit) => (
                <label key={habit.id} className="flex min-h-11 cursor-pointer items-center gap-3 px-1">
                  <Checkbox
                    checked={Boolean(dailyLog?.habits[habit.id])}
                    onCheckedChange={() => void toggleHabit(habit)}
                    aria-label={`Toggle ${habit.title}`}
                  />
                  <span
                    className={
                      dailyLog?.habits[habit.id]
                        ? 'text-sm text-gray-500 line-through'
                        : 'text-sm text-gray-200'
                    }
                  >
                    {habit.title}
                  </span>
                </label>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Today's tasks — compact */}
        <Card>
          <CardHeader>
            <CardTitle>Today&apos;s tasks</CardTitle>
            <span className="text-xs tabular-nums text-gray-600">
              {todayTasks.filter((task) => task.done).length}/{todayTasks.length}
            </span>
          </CardHeader>
          <CardContent>
            <form onSubmit={addTask} className="mb-3 flex gap-2">
              <Input
                value={taskTitle}
                onChange={(event) => setTaskTitle(event.target.value)}
                placeholder="Capture a growth task"
                aria-label="Capture a growth task to the inbox"
              />
              <Button
                type="submit"
                size="icon"
                className="shrink-0"
                disabled={isPending}
                aria-label="Add task to inbox"
              >
                <Plus className="size-5" />
              </Button>
            </form>
            <div className="divide-y divide-gray-800">
              {todayTasks.map((task) => (
                <label key={task.id} className="flex min-h-12 cursor-pointer items-center gap-3 py-1">
                  <Checkbox
                    checked={task.done}
                    onCheckedChange={() => void toggleTask(task)}
                    aria-label={`Mark ${task.title} ${task.done ? 'open' : 'done'}`}
                  />
                  <span className={task.done ? 'text-sm text-gray-600 line-through' : 'text-sm text-gray-200'}>
                    {task.title}
                  </span>
                </label>
              ))}
              {todayTasks.length === 0 && (
                <p className="py-6 text-center text-sm text-gray-600">Nothing pinned to today.</p>
              )}
            </div>

            {inboxTasks.length > 0 && (
              <div className="mt-4 border-t border-gray-800 pt-3">
                <p className="surface-label">Inbox · {inboxTasks.length}</p>
                <div className="mt-2 divide-y divide-gray-800">
                  {inboxTasks.map((task) => (
                    <div key={task.id} className="flex min-h-12 items-center gap-2 py-1">
                      <span className="min-w-0 flex-1 truncate text-sm text-gray-400">
                        {task.title}
                      </span>
                      <Button
                        variant="secondary"
                        size="icon"
                        onClick={() => void pinToToday(task)}
                        aria-label={`Pin ${task.title} to Today`}
                      >
                        <Pin className="size-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* This week — compact */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>This week</CardTitle>
              <p className="mt-2 text-xs text-gray-600">
                Last week: avg {recap.averageScore} · habits {recap.habitConsistency}% ·{' '}
                {recap.daysLogged} days logged
              </p>
            </div>
            <CalendarCheck2 className="size-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-gray-800">
              {(plan?.goals ?? []).map((goal) => (
                <div key={goal.id} className="flex min-h-12 items-center gap-3 py-1">
                  <Checkbox
                    checked={goal.done}
                    onCheckedChange={() => void toggleGoal(goal)}
                    aria-label={`Toggle goal ${goal.text}`}
                  />
                  <span
                    className={cn(
                      'min-w-0 flex-1 text-sm',
                      goal.done ? 'text-gray-600 line-through' : 'text-gray-200',
                    )}
                  >
                    {goal.text}
                  </span>
                  <Button
                    variant="danger"
                    size="icon"
                    onClick={() => void removeGoal(goal)}
                    aria-label={`Remove goal ${goal.text}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
              {(plan?.goals.length ?? 0) === 0 && (
                <p className="py-6 text-center text-sm text-gray-600">No goals set for this week.</p>
              )}
            </div>
            {(plan?.goals.length ?? 0) < 5 && (
              <form onSubmit={addGoal} className="mt-3 flex gap-2">
                <Input
                  value={goalDraft}
                  onChange={(event) => setGoalDraft(event.target.value)}
                  placeholder="Add a weekly goal (3–5)"
                  aria-label="New weekly goal"
                />
                <Button type="submit" size="icon" className="shrink-0" aria-label="Add goal">
                  <Plus className="size-5" />
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
