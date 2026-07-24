import {
  ArrowRight,
  Brain,
  Clock3,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import { format, isSameDay } from 'date-fns';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Checkbox } from '../../components/ui/Checkbox';
import { Input } from '../../components/ui/Input';
import { ScoreRing } from '../../components/ScoreRing';
import type {
  BrainDumpEntry,
  DailyLog,
  HabitEntry,
  TaskEntry,
  TimeBlockEntry,
  WeeklyPlan,
} from '../../data/types';
import { calculateDailyScore } from '../../logic/score';
import { getIsoWeekKey } from '../../logic/week';
import { useAppStore } from '../../store/appStore';

function isTodayTask(task: TaskEntry, todayKey: string): boolean {
  if (!task.done) return true;
  return Boolean(task.completedAt?.startsWith(todayKey));
}

export function Today() {
  const repository = useAppStore((state) => state.repository);
  const setWorkView = useAppStore((state) => state.setWorkView);
  const [now, setNow] = useState(new Date());
  const [tasks, setTasks] = useState<TaskEntry[]>([]);
  const [habits, setHabits] = useState<HabitEntry[]>([]);
  const [dumps, setDumps] = useState<BrainDumpEntry[]>([]);
  const [blocks, setBlocks] = useState<TimeBlockEntry[]>([]);
  const [dailyLog, setDailyLog] = useState<DailyLog | null>(null);
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [dumpText, setDumpText] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const todayKey = format(now, 'yyyy-MM-dd');

  const loadToday = useCallback(async () => {
    const [entryData, logData, planData] = await Promise.all([
      repository.listEntries(),
      repository.getDailyLog(todayKey),
      repository.getWeeklyPlan(getIsoWeekKey(now)),
    ]);
    setTasks(entryData.filter((entry): entry is TaskEntry => entry.type === 'task'));
    setHabits(
      entryData
        .filter((entry): entry is HabitEntry => entry.type === 'habit' && entry.active)
        .sort((a, b) => a.order - b.order),
    );
    setDumps(
      entryData
        .filter((entry): entry is BrainDumpEntry => entry.type === 'braindump')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
    setBlocks(
      entryData
        .filter(
          (entry): entry is TimeBlockEntry =>
            entry.type === 'timeblock' && entry.date === todayKey,
        )
        .sort((a, b) => a.start.localeCompare(b.start)),
    );
    setDailyLog(logData);
    setPlan(planData);
    setIsLoading(false);
  }, [now, repository, todayKey]);

  useEffect(() => {
    void loadToday();
  }, [loadToday]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const urgentTasks = useMemo(
    () => tasks.filter((task) => task.priority === 'urgent' && isTodayTask(task, todayKey)),
    [tasks, todayKey],
  );

  const score = useMemo(
    () =>
      calculateDailyScore({
        habits: {
          completed: habits.filter((habit) => dailyLog?.habits[habit.id]).length,
          total: habits.length,
        },
        tasks: {
          completed: urgentTasks.filter((task) => task.done).length,
          total: urgentTasks.length,
        },
        timeblocks: {
          completed: blocks.filter((block) => block.status === 'done').length,
          total: blocks.length,
        },
      }),
    [blocks, dailyLog, habits, urgentTasks],
  );

  const persistTodayScore = async (
    nextLog: DailyLog,
    nextTasks = urgentTasks,
  ): Promise<DailyLog> => {
    const nextScore = calculateDailyScore({
      habits: {
        completed: habits.filter((habit) => nextLog.habits[habit.id]).length,
        total: habits.length,
      },
      tasks: {
        completed: nextTasks.filter((task) => task.done).length,
        total: nextTasks.length,
      },
      timeblocks: {
        completed: blocks.filter((block) => block.status === 'done').length,
        total: blocks.length,
      },
    }).score;
    return repository.upsertDailyLog({ ...nextLog, score: nextScore });
  };

  const addTask = async (event: FormEvent) => {
    event.preventDefault();
    const title = taskTitle.trim();
    if (!title) return;
    setTaskTitle('');
    const input: Omit<TaskEntry, 'id' | 'createdAt' | 'updatedAt'> = {
      type: 'task',
      title,
      priority: 'urgent',
      done: false,
      dueDate: todayKey,
      tags: [],
    };
    const created = (await repository.createEntry(input)) as TaskEntry;
    setTasks((current) => [created, ...current]);
  };

  const toggleTask = async (task: TaskEntry) => {
    const done = !task.done;
    const updated = (await repository.updateEntry(task.id, {
      done,
      completedAt: done ? new Date().toISOString() : undefined,
    })) as TaskEntry;
    const nextTasks = urgentTasks.map((item) => (item.id === task.id ? updated : item));
    setTasks((current) => current.map((item) => (item.id === task.id ? updated : item)));
    if (dailyLog) {
      const saved = await persistTodayScore(dailyLog, nextTasks);
      setDailyLog(saved);
    }
  };

  const deleteTask = async (id: string) => {
    await repository.deleteEntry(id);
    setTasks((current) => current.filter((task) => task.id !== id));
  };

  const toggleHabit = async (habit: HabitEntry) => {
    const currentLog: DailyLog = dailyLog ?? {
      date: todayKey,
      habits: {},
      score: 0,
    };
    const nextLog: DailyLog = {
      ...currentLog,
      habits: {
        ...currentLog.habits,
        [habit.id]: !currentLog.habits[habit.id],
      },
    };
    setDailyLog(nextLog);
    const saved = await persistTodayScore(nextLog);
    setDailyLog(saved);
  };

  const captureDump = async (event: FormEvent) => {
    event.preventDefault();
    const text = dumpText.trim();
    if (!text) return;
    setDumpText('');
    const input: Omit<BrainDumpEntry, 'id' | 'createdAt' | 'updatedAt'> = {
      type: 'braindump',
      text,
      tags: [],
    };
    const created = (await repository.createEntry(input)) as BrainDumpEntry;
    setDumps((current) => [created, ...current]);
  };

  const upcomingBlocks = blocks
    .filter((block) => block.end >= format(now, 'HH:mm') && block.status === 'planned')
    .slice(0, 3);

  return (
    <div className="page-shell">
      <header className="mb-7 border-b border-gray-800 pb-7 md:mb-9 md:flex md:items-end md:justify-between">
        <div>
          <p className="page-kicker">Work / Today</p>
          <h1 className="page-title">{format(now, 'EEEE')}</h1>
          <p className="mt-3 text-sm text-gray-500 md:text-base">
            {format(now, 'MMMM d, yyyy')} <span className="mx-2 text-gray-700">/</span>
            <span className="tabular-nums text-gray-300">{format(now, 'HH:mm')}</span>
          </p>
        </div>
        <div className="mt-6 border-l-2 border-primary pl-4 md:mt-0 md:max-w-md">
          <p className="surface-label">Today&apos;s focus</p>
          <p className="mt-1 text-base font-semibold text-gray-200">
            {plan?.goals.find((goal) => !goal.done)?.text ?? 'Choose the one move that matters.'}
          </p>
        </div>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.75fr)]">
        <div className="grid min-w-0 gap-5">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Daily score</CardTitle>
                <p className="mt-2 text-sm text-gray-600">Execution quality, recalculated live.</p>
              </div>
              <Sparkles className="size-4 text-gold" />
            </CardHeader>
            <CardContent>
              <ScoreRing result={score} />
            </CardContent>
          </Card>

          <Card className="order-first xl:order-none">
            <CardHeader className="pb-3">
              <div>
                <CardTitle>Brain dump</CardTitle>
                <p className="mt-2 text-sm text-gray-500">Capture now. Process later.</p>
              </div>
              <Brain className="size-4 text-primary" />
            </CardHeader>
            <CardContent>
              <form onSubmit={captureDump} className="flex gap-2">
                <Input
                  value={dumpText}
                  onChange={(event) => setDumpText(event.target.value)}
                  placeholder="What is taking up mental space?"
                  aria-label="Capture a brain dump"
                  className="h-14 flex-1"
                />
                <Button type="submit" size="icon" className="size-14 shrink-0" aria-label="Save brain dump">
                  <ArrowRight className="size-5" />
                </Button>
              </form>
              <div className="mt-4 space-y-2">
                {dumps.slice(0, 3).map((dump) => (
                  <div key={dump.id} className="border-l border-gray-700 py-1 pl-3">
                    <p className="text-sm leading-5 text-gray-300">{dump.text}</p>
                    <time className="mt-1 block text-[11px] text-gray-600">
                      {isSameDay(new Date(dump.createdAt), now)
                        ? format(new Date(dump.createdAt), "'Today' HH:mm")
                        : format(new Date(dump.createdAt), 'MMM d · HH:mm')}
                    </time>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Urgent tasks</CardTitle>
              <span className="text-xs tabular-nums text-gray-600">
                {urgentTasks.filter((task) => task.done).length}/{urgentTasks.length}
              </span>
            </CardHeader>
            <CardContent>
              <form onSubmit={addTask} className="mb-3 flex gap-2">
                <Input
                  value={taskTitle}
                  onChange={(event) => setTaskTitle(event.target.value)}
                  placeholder="Add today’s urgent task"
                  aria-label="New urgent task"
                />
                <Button type="submit" size="icon" className="shrink-0" aria-label="Add task">
                  <Plus className="size-5" />
                </Button>
              </form>
              <div className="divide-y divide-gray-800">
                {urgentTasks.map((task) => (
                  <div key={task.id} className="flex min-h-16 items-center gap-3 py-2">
                    <Checkbox
                      checked={task.done}
                      onCheckedChange={() => void toggleTask(task)}
                      aria-label={`Mark ${task.title} ${task.done ? 'open' : 'done'}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className={task.done ? 'text-gray-600 line-through' : 'text-sm text-gray-200'}>
                        {task.title}
                      </p>
                      {task.projectId && <span className="text-[10px] uppercase tracking-wider text-gold/70">Linked work</span>}
                    </div>
                    <Button
                      variant="danger"
                      size="icon"
                      onClick={() => void deleteTask(task.id)}
                      aria-label={`Delete ${task.title}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                {!isLoading && urgentTasks.length === 0 && (
                  <p className="py-8 text-center text-sm text-gray-600">Clear runway. Add only what truly matters.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid content-start gap-5">
          <Card>
            <CardHeader>
              <CardTitle>Weekly direction</CardTitle>
              <span className="text-[10px] uppercase tracking-widest text-primary">{plan?.week}</span>
            </CardHeader>
            <CardContent>
              {plan?.theme && <p className="mb-4 text-sm italic text-gold/80">“{plan.theme}”</p>}
              <ol className="space-y-3">
                {plan?.goals.map((goal, index) => (
                  <li key={goal.id} className="flex gap-3 text-sm leading-5">
                    <span className="font-mono text-xs text-gray-600">0{index + 1}</span>
                    <span className={goal.done ? 'text-gray-600 line-through' : 'text-gray-300'}>{goal.text}</span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Habits</CardTitle>
              <span className="text-xs text-gray-600">{format(now, 'MMM d')}</span>
            </CardHeader>
            <CardContent className="space-y-2">
              {habits.map((habit) => (
                <label
                  key={habit.id}
                  className="flex min-h-14 cursor-pointer items-center gap-3 border border-transparent px-1 transition-colors hover:border-gray-800"
                >
                  <Checkbox
                    checked={Boolean(dailyLog?.habits[habit.id])}
                    onCheckedChange={() => void toggleHabit(habit)}
                    aria-label={`Toggle ${habit.title}`}
                  />
                  <span className={dailyLog?.habits[habit.id] ? 'text-sm text-gray-500 line-through' : 'text-sm text-gray-200'}>
                    {habit.title}
                  </span>
                </label>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Next blocks</CardTitle>
              <Clock3 className="size-4 text-gray-600" />
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {upcomingBlocks.map((block) => (
                  <div key={block.id} className="grid grid-cols-[3.5rem_1fr] gap-3 border-l border-primary/50 pl-3">
                    <span className="font-mono text-xs text-gray-500">{block.start}</span>
                    <span className="text-sm text-gray-300">{block.label}</span>
                  </div>
                ))}
                {upcomingBlocks.length === 0 && (
                  <p className="text-sm text-gray-600">No planned blocks remain today.</p>
                )}
              </div>
              <Button variant="secondary" className="mt-5 w-full" onClick={() => setWorkView('timebox')}>
                Open timebox
                <ArrowRight className="size-4" />
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
