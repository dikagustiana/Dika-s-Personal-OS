import {
  ArrowRight,
  Brain,
  Clock3,
  Inbox,
  Pin,
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
import { format, isSameDay, parseISO } from 'date-fns';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Checkbox } from '../../components/ui/Checkbox';
import { Input } from '../../components/ui/Input';
import { EmptyRow } from '../../components/ui/EmptyRow';
import { ScoreRing } from '../../components/ScoreRing';
import { TimeboxSection } from '../../components/TimeboxSection';
import { DOMAIN_HOURS, minutesToTime } from '../../logic/timebox';
import type {
  BrainDumpEntry,
  HabitEntry,
  Project,
  TaskEntry,
  TimeBlockEntry,
  WeeklyPlan,
} from '../../data/types';
import type { EscalationTarget } from '../../logic/milestones';
import { calculateDailyScore } from '../../logic/score';
import { isScoredTask, scoredTasks } from '../../logic/dailyLog';
import { getIsoWeekKey } from '../../logic/week';
import { useDailyLog } from '../../hooks/useDailyLog';
import { useMutation } from '../../hooks/useMutation';
import { useAppStore } from '../../store/appStore';

/**
 * An Inbox task is one that has been captured but not triaged: not urgent and
 * not pinned to a day. Capture is meant to be frictionless, so nothing typed
 * into the quick-add box lands on Today — or in the score — until it is
 * deliberately pinned there.
 */
function isInboxTask(task: TaskEntry): boolean {
  return !task.done && task.priority !== 'urgent' && !task.dueDate;
}

/**
 * The fields that put a task on today's list. Pinning from the Inbox and
 * adding straight to Urgent tasks are the same act, so both read the shape
 * from here rather than each spelling it out.
 */
function onTodayFields(dateKey: string): Pick<TaskEntry, 'priority' | 'dueDate'> {
  return { priority: 'urgent', dueDate: dateKey };
}

export function Today() {
  const repository = useAppStore((state) => state.repository);
  const domain = useAppStore((state) => state.workspace);
  const [now, setNow] = useState(new Date());
  const [tasks, setTasks] = useState<TaskEntry[]>([]);
  const [habits, setHabits] = useState<HabitEntry[]>([]);
  const [dumps, setDumps] = useState<BrainDumpEntry[]>([]);
  const [blocks, setBlocks] = useState<TimeBlockEntry[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [urgentTitle, setUrgentTitle] = useState('');
  const [dumpText, setDumpText] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const todayKey = format(now, 'yyyy-MM-dd');
  const { run, isPending } = useMutation();
  const {
    log: dailyLog,
    setLog,
    syncInputs,
    recomputeAndPersistDailyLog,
  } = useDailyLog(todayKey, domain);

  // Depends on todayKey (a date string), not the ticking `now` Date, so the
  // 60s clock interval below no longer triggers a full refetch each minute —
  // data loads on mount and again only when the calendar date rolls over.
  const loadToday = useCallback(async () => {
    const [entryData, logData, planData, projectData] = await Promise.all([
      repository.listEntries({ domain }),
      repository.getDailyLog(todayKey, domain),
      repository.getWeeklyPlan(getIsoWeekKey(parseISO(todayKey)), domain),
      // For attributing a block to a milestone, and for the escalation offer.
      repository.listProjects(domain),
    ]);
    setProjects(projectData);
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
    setLog(logData);
    setPlan(planData);
    setIsLoading(false);
  }, [domain, repository, setLog, todayKey]);

  useEffect(() => {
    void loadToday();
  }, [loadToday]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const urgentTasks = useMemo(() => scoredTasks(tasks, todayKey), [tasks, todayKey]);
  const inboxTasks = useMemo(() => tasks.filter(isInboxTask), [tasks]);

  // Keep the score inputs mirrored for the write path. Mutations additionally
  // pass what they just produced, because this effect has not run yet at that
  // point — see useDailyLog.
  useEffect(() => {
    syncInputs({ habits, tasks: urgentTasks, blocks });
  }, [blocks, habits, syncInputs, urgentTasks]);

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

  /**
   * Commits a task set that may have changed the scored set, rewriting the
   * stored log from it. Anything that lands a task on today's list has to come
   * through here — a task that is scored on screen but not in the persisted log
   * desyncs silently, with nothing on the page to show it.
   */
  const commitTasks = async (nextTasks: TaskEntry[]) => {
    setTasks(nextTasks);
    await recomputeAndPersistDailyLog({ tasks: scoredTasks(nextTasks, todayKey) });
  };

  /**
   * The one create-task write, shared by both quick-adds: the Inbox field
   * passes no triage, the Urgent field passes `onTodayFields`. Resolves true
   * only once the row exists, so callers know when it is safe to clear a draft.
   */
  const createTask = async (
    title: string,
    fields?: Pick<TaskEntry, 'priority' | 'dueDate'>,
  ) => {
    const input: Omit<TaskEntry, 'id' | 'createdAt' | 'updatedAt'> = {
      type: 'task',
      domain,
      title,
      priority: 'normal',
      done: false,
      tags: [],
      ...fields,
    };
    const created = await run('Add task', () => repository.createEntry(input));
    if (!created) return false;
    const task = created as TaskEntry;
    const nextTasks = [task, ...tasks];
    // Captured-to-Inbox tasks are outside the scored set, so they leave the log
    // alone; an urgent task counts from the moment it exists.
    if (isScoredTask(task, todayKey)) await commitTasks(nextTasks);
    else setTasks(nextTasks);
    return true;
  };

  /**
   * Adds to the Inbox, not to Today. The draft is only cleared once the write
   * has come back, so a failed save leaves the text on screen to retry.
   */
  const addTask = async (event: FormEvent) => {
    event.preventDefault();
    const title = taskTitle.trim();
    if (!title) return;
    if (await createTask(title)) setTaskTitle('');
  };

  /** Skips the Inbox: what is already known to be urgent belongs on Today now. */
  const addUrgentTask = async (event: FormEvent) => {
    event.preventDefault();
    const title = urgentTitle.trim();
    if (!title) return;
    if (await createTask(title, onTodayFields(todayKey))) setUrgentTitle('');
  };

  /** The deliberate act of putting an Inbox task on today's list. */
  const pinToToday = async (task: TaskEntry) => {
    const updated = await run('Pin task to Today', () =>
      repository.updateEntry(task.id, onTodayFields(todayKey)),
    );
    if (!updated) return;
    await commitTasks(
      tasks.map((item) => (item.id === task.id ? (updated as TaskEntry) : item)),
    );
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
    await commitTasks(
      tasks.map((item) => (item.id === task.id ? (updated as TaskEntry) : item)),
    );
  };

  const deleteTask = async (id: string) => {
    const result = await run('Delete task', async () => {
      await repository.deleteEntry(id);
      return true as const;
    });
    if (!result) return;
    await commitTasks(tasks.filter((task) => task.id !== id));
  };

  const toggleHabit = async (habit: HabitEntry) => {
    const previous = dailyLog;
    const currentHabits = dailyLog?.habits ?? {};
    const nextHabits = { ...currentHabits, [habit.id]: !currentHabits[habit.id] };
    // Optimistic: the checkbox must feel instant. Reverted if the write fails.
    setLog({ ...(dailyLog ?? { date: todayKey, domain, habits: {}, score: 0 }), habits: nextHabits });
    const saved = await run('Save habit', () =>
      recomputeAndPersistDailyLog({ habitState: nextHabits }),
    );
    if (!saved) setLog(previous);
  };

  const captureDump = async (event: FormEvent) => {
    event.preventDefault();
    const text = dumpText.trim();
    if (!text) return;
    const input: Omit<BrainDumpEntry, 'id' | 'createdAt' | 'updatedAt'> = {
      type: 'braindump',
      domain,
      text,
      tags: [],
    };
    const created = await run('Save brain dump', () => repository.createEntry(input));
    if (!created) return;
    setDumpText('');
    setDumps((current) => [created as BrainDumpEntry, ...current]);
  };

  const createBlock = async (
    input: Omit<TimeBlockEntry, 'id' | 'createdAt' | 'updatedAt'>,
  ) => {
    const created = await run('Add timeblock', () => repository.createEntry(input));
    if (!created) return;
    const nextBlocks = [...blocks, created as TimeBlockEntry].sort((a, b) =>
      a.start.localeCompare(b.start),
    );
    setBlocks(nextBlocks);
    await recomputeAndPersistDailyLog({ blocks: nextBlocks });
  };

  const setBlockStatus = async (
    block: TimeBlockEntry,
    status: TimeBlockEntry['status'],
    detail?: Pick<TimeBlockEntry, 'blockedOn' | 'carryNote'>,
  ) => {
    // Leaving `blocked` clears the reason: it belonged to that wall, and a
    // stale one on a replanned block is worse than none.
    const patch: Partial<TimeBlockEntry> = { status };
    if (status === 'blocked') patch.blockedOn = detail?.blockedOn;
    else patch.blockedOn = undefined;
    if (status === 'carried') patch.carryNote = detail?.carryNote;
    else patch.carryNote = undefined;

    const updated = await run('Update timeblock', () =>
      repository.updateEntry(block.id, patch),
    );
    if (!updated) return;
    const nextBlocks = blocks.map((item) =>
      item.id === block.id ? (updated as TimeBlockEntry) : item,
    );
    setBlocks(nextBlocks);

    // Completing a block completes its linked task, so the task set the score
    // is computed from changes too. Scoring against the pre-completion tasks
    // here was the stale-closure bug.
    let nextTasks = tasks;
    if (status === 'done' && block.taskId) {
      const completed = await run('Complete linked task', () =>
        repository.updateEntry(block.taskId as string, {
          done: true,
          completedAt: new Date().toISOString(),
        }),
      );
      if (completed) {
        nextTasks = tasks.map((item) =>
          item.id === (completed as TaskEntry).id ? (completed as TaskEntry) : item,
        );
        setTasks(nextTasks);
      }
    }
    await recomputeAndPersistDailyLog({
      blocks: nextBlocks,
      tasks: scoredTasks(nextTasks, todayKey),
    });
  };

  /** Category / task-link refinements made on the row of an existing block. */
  /**
   * The escalation offer's write, and the reason the whole feature exists.
   *
   * 37 milestones are blocked and NOT ONE of 477 carries a real escalation
   * target — every value is the literal `none` or absent, so the Escalations
   * view has never had anything to show. The cause is structural: milestones
   * get marked blocked in retrospect, days later, when nobody remembers what
   * they were waiting on. A time block ends at the moment of collision, which
   * is the cheapest and most accurate moment to capture it.
   *
   * Only ever called from an explicit tap on a named person. Declining the
   * offer calls nothing, so the milestone is untouched.
   */
  const escalateMilestone = async (
    projectId: string,
    milestoneId: string,
    target: EscalationTarget,
    reason: string,
  ) => {
    const project = projects.find((item) => item.id === projectId);
    if (!project) return;
    const milestones = project.milestones.map((milestone) =>
      milestone.id === milestoneId
        ? {
            ...milestone,
            status: 'blocked' as const,
            escalateTo: target,
            // Append rather than overwrite: the milestone's note may already
            // carry context this block knows nothing about.
            note: [milestone.note?.trim(), reason.trim() && `Waiting on ${reason.trim()}`]
              .filter(Boolean)
              .join(' · '),
          }
        : milestone,
    );
    const updated = await run('Escalate milestone', () =>
      repository.updateProject(projectId, { milestones }),
    );
    if (updated) {
      setProjects((current) =>
        current.map((item) => (item.id === projectId ? (updated as Project) : item)),
      );
    }
  };

  const updateBlock = async (
    block: TimeBlockEntry,
    patch: Partial<Pick<TimeBlockEntry, 'category' | 'taskId' | 'label'>>,
  ) => {
    const updated = await run('Update timeblock', () =>
      repository.updateEntry(block.id, patch),
    );
    if (!updated) return;
    setBlocks((current) =>
      current.map((item) => (item.id === block.id ? (updated as TimeBlockEntry) : item)),
    );
  };

  const deleteBlock = async (block: TimeBlockEntry) => {
    const result = await run('Delete timeblock', async () => {
      await repository.deleteEntry(block.id);
      return true as const;
    });
    if (!result) return;
    const nextBlocks = blocks.filter((item) => item.id !== block.id);
    setBlocks(nextBlocks);
    await recomputeAndPersistDailyLog({ blocks: nextBlocks });
  };

  const openTasks = tasks.filter((task) => !task.done);

  return (
    <div className="page-shell">
      <header className="mb-7 border-b border-border-subtle pb-7 md:mb-9 md:flex md:items-end md:justify-between">
        <div>
          <p className="page-kicker">{domain} / Today</p>
          <h1 className="page-title">{format(now, 'EEEE')}</h1>
          <p className="mt-3 text-sm text-foreground-muted md:text-base">
            {format(now, 'MMMM d, yyyy')} <span className="mx-2 text-foreground-muted">/</span>
            <span className="tabular-nums text-foreground-secondary">{format(now, 'HH:mm')}</span>
          </p>
        </div>
        <div className="mt-6 border-l-2 border-primary pl-4 md:mt-0 md:max-w-md">
          <p className="surface-label">Today&apos;s focus</p>
          <p className="mt-1 text-base font-semibold text-foreground">
            {plan?.goals.find((goal) => !goal.done)?.text ?? 'Choose the one move that matters.'}
          </p>
        </div>
      </header>

      {/* The timebox renders FIRST. It used to be the last section, below six
          cards — the feature that matters most was a full page of scroll away,
          and it went unused. The grid opens on the current slot; everything
          else on this page is secondary to "what is this half-hour for". */}
      <section className="mb-5">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <p className="surface-label">Timebox</p>
            <p className="mt-1 text-xs text-foreground-muted">
              {minutesToTime(DOMAIN_HOURS[domain].startMinutes)}–
              {minutesToTime(DOMAIN_HOURS[domain].endMinutes)} · 30 min ·{' '}
              {blocks.filter((block) => block.status === 'done').length}/{blocks.length} done
            </p>
          </div>
          <Clock3 className="size-4 text-foreground-muted" />
        </div>
        <TimeboxSection
          domain={domain}
          date={todayKey}
          now={now}
          blocks={blocks}
          tasks={openTasks}
          projects={projects}
          onCreate={createBlock}
          onSetStatus={setBlockStatus}
          onDelete={deleteBlock}
          onUpdate={updateBlock}
          onEscalateMilestone={escalateMilestone}
        />
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.75fr)]">
        <div className="grid min-w-0 gap-5">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Daily score</CardTitle>
                <p className="mt-2 text-sm text-foreground-muted">Execution quality, recalculated live.</p>
              </div>
              <Sparkles className="size-4 text-foreground-muted" />
            </CardHeader>
            <CardContent>
              <ScoreRing result={score} />
            </CardContent>
          </Card>

          <Card className="order-first xl:order-none">
            <CardHeader className="pb-3">
              <div>
                <CardTitle>Brain dump</CardTitle>
                <p className="mt-2 text-sm text-foreground-muted">Capture now. Process later.</p>
              </div>
              <Brain className="size-4 text-foreground-muted" />
            </CardHeader>
            <CardContent>
              <form onSubmit={captureDump} className="flex items-center gap-2">
                <Input
                  value={dumpText}
                  onChange={(event) => setDumpText(event.target.value)}
                  placeholder="What is taking up mental space?"
                  aria-label="Capture a brain dump"
                  className="flex-1"
                />
                <Button
                  type="submit"
                  variant="secondary"
                  size="icon"
                  className="shrink-0"
                  aria-label="Save brain dump"
                >
                  <ArrowRight className="size-4" />
                </Button>
              </form>
              <div className="mt-4 space-y-2">
                {dumps.slice(0, 3).map((dump) => (
                  <div key={dump.id} className="border-l border-border py-1 pl-3">
                    <p className="text-sm leading-5 text-foreground-secondary">{dump.text}</p>
                    <time className="mt-1 block text-[11px] text-foreground-muted">
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
              <span className="text-xs tabular-nums text-foreground-muted">
                {urgentTasks.filter((task) => task.done).length}/{urgentTasks.length}
              </span>
            </CardHeader>
            <CardContent>
              <form onSubmit={addUrgentTask} className="mb-3 flex gap-2">
                <Input
                  value={urgentTitle}
                  onChange={(event) => setUrgentTitle(event.target.value)}
                  placeholder="Add an urgent task"
                  aria-label="Add an urgent task to today"
                />
                {/* Secondary, not filled: this submits a field that is
                    already visible and carries no page-level intent. The
                    timebox save below keeps the page's one fill. */}
                <Button
                  type="submit"
                  variant="secondary"
                  size="icon"
                  className="shrink-0"
                  disabled={isPending}
                  aria-label="Add urgent task to today"
                >
                  <Plus className="size-5" />
                </Button>
              </form>
              <div className="divide-y divide-border-subtle">
                {urgentTasks.map((task) => (
                  <div key={task.id} className="flex min-h-11 items-center gap-3 py-1.5">
                    <Checkbox
                      checked={task.done}
                      onCheckedChange={() => void toggleTask(task)}
                      aria-label={`Mark ${task.title} ${task.done ? 'open' : 'done'}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className={task.done ? 'text-foreground-muted line-through' : 'text-sm text-foreground'}>
                        {task.title}
                      </p>
                      {task.projectId && <span className="text-[10px] uppercase tracking-wider text-foreground-muted">Linked work</span>}
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
                  <EmptyRow
                    label="Urgent tasks"
                    clause="Clear runway — add one above, or pin from the inbox below"
                  />
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Inbox</CardTitle>
                <p className="mt-2 text-sm text-foreground-muted">
                  Captured, not yet triaged. Pin one to put it on Today.
                </p>
              </div>
              <Inbox className="size-4 text-foreground-muted" />
            </CardHeader>
            <CardContent>
              <form onSubmit={addTask} className="mb-3 flex gap-2">
                <Input
                  value={taskTitle}
                  onChange={(event) => setTaskTitle(event.target.value)}
                  placeholder="Capture a task"
                  aria-label="Capture a task to the inbox"
                />
                <Button
                  type="submit"
                  variant="secondary"
                  size="icon"
                  className="shrink-0"
                  disabled={isPending}
                  aria-label="Add task to inbox"
                >
                  <Plus className="size-5" />
                </Button>
              </form>
              <div className="divide-y divide-border-subtle">
                {inboxTasks.map((task) => (
                  <div key={task.id} className="flex min-h-11 items-center gap-3 py-1.5">
                    <span className="min-w-0 flex-1 text-sm text-foreground-secondary">{task.title}</span>
                    <Button
                      variant="secondary"
                      size="icon"
                      onClick={() => void pinToToday(task)}
                      aria-label={`Pin ${task.title} to Today`}
                    >
                      <Pin className="size-4" />
                    </Button>
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
                {!isLoading && inboxTasks.length === 0 && (
                  <EmptyRow
                    label="Inbox"
                    clause="Inbox zero — a captured task waits here until pinned to a day"
                  />
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid content-start gap-5">
          <Card>
            <CardHeader>
              <CardTitle>Weekly direction</CardTitle>
              <span className="surface-label">{plan?.week}</span>
            </CardHeader>
            <CardContent>
              {plan?.theme && <p className="mb-4 text-sm italic text-foreground-secondary">“{plan.theme}”</p>}
              <ol className="space-y-3">
                {plan?.goals.map((goal, index) => (
                  <li key={goal.id} className="flex gap-3 text-sm leading-5">
                    <span className="text-xs text-foreground-muted">0{index + 1}</span>
                    <span className={goal.done ? 'text-foreground-muted line-through' : 'text-foreground-secondary'}>{goal.text}</span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Habits</CardTitle>
              <span className="text-xs text-foreground-muted">{format(now, 'MMM d')}</span>
            </CardHeader>
            <CardContent className="divide-y divide-border-subtle">
              {habits.map((habit) => (
                <label
                  key={habit.id}
                  className="flex min-h-11 cursor-pointer items-center gap-3 py-0.5 transition-colors duration-150 hover:bg-surface-2/50"
                >
                  <Checkbox
                    checked={Boolean(dailyLog?.habits[habit.id])}
                    onCheckedChange={() => void toggleHabit(habit)}
                    aria-label={`Toggle ${habit.title}`}
                  />
                  <span className={dailyLog?.habits[habit.id] ? 'text-sm text-foreground-muted line-through' : 'text-sm text-foreground'}>
                    {habit.title}
                  </span>
                </label>
              ))}
            </CardContent>
          </Card>

        </div>
      </div>

    </div>
  );
}
