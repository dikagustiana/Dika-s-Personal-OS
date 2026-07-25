import { ArrowRight, Check, Pencil, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { format, getISOWeek, subDays } from 'date-fns';
import { Checkbox } from '../../components/ui/Checkbox';
import { Card, CardContent } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Progress } from '../../components/ui/Progress';
import type {
  DailyLog,
  HabitEntry,
  Project,
  TaskEntry,
  TimeBlockEntry,
  WeeklyPlan,
} from '../../data/types';
import { useDailyLog } from '../../hooks/useDailyLog';
import { useMutation } from '../../hooks/useMutation';
import { windowHabitConsistency } from '../../logic/contribution';
import { scoredTasks } from '../../logic/dailyLog';
import { formatDateFor } from '../../logic/deadlines';
import { collectEscalations } from '../../logic/milestones';
import { calculateDailyScore } from '../../logic/score';
import { getIsoWeekKey, getWeekRange, summarizeWeek } from '../../logic/week';
import {
  closeEntityCount,
  collectNeedsAction,
  goalProgress,
  isPinnable,
  picInitials,
  pinnedProjectRows,
  summarizeCloseCycle,
  type NeedsActionRow,
} from '../../logic/workDashboard';
import { cn } from '../../lib/utils';
import { useAppStore } from '../../store/appStore';
import type { WorkView } from '../../store/appStore';

const HABIT_WINDOW_DAYS = 30;

/**
 * A text link, which is the ONLY navigation affordance on this page.
 *
 * Deliberate: the page carries no filled primary button at all. Several cards
 * each wanting their own filled button is exactly the competition that made
 * the old dashboard read as a wall of calls to action.
 */
function TextLink({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-sm text-xs font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
      <ArrowRight className="size-3" />
    </button>
  );
}

/**
 * An empty section, as one 44px row.
 *
 * The hard constraint on this page: an empty section is never taller than the
 * same section with content in it. Most of this screen is empty most days, so
 * a boxed empty state with a heading and two sentences would make the sparse
 * render — the common one — the longest.
 */
function EmptyRow({
  label,
  clause,
  action,
  onAction,
}: {
  label: string;
  clause: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-1">
      <span className="surface-label">{label}</span>
      <span className="flex items-center gap-2 text-xs text-foreground-muted">
        {clause}
        <TextLink onClick={onAction}>{action}</TextLink>
      </span>
    </div>
  );
}

function SectionHeading({
  title,
  right,
}: {
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 className="font-display text-card-heading font-semibold text-foreground">{title}</h2>
      {right}
    </div>
  );
}

/** Overdue and blocked are both red, so one is filled and one is outlined. */
function StateBadge({ row }: { row: NeedsActionRow }) {
  const base =
    'shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider tabular-nums';
  if (row.state === 'overdue') {
    return (
      <span className={cn(base, 'bg-destructive text-destructive-foreground')}>
        Overdue {row.daysOverdue}d
      </span>
    );
  }
  if (row.state === 'today') {
    return <span className={cn(base, 'bg-escalate text-escalate-foreground')}>Today</span>;
  }
  return (
    <span className={cn(base, 'border border-destructive text-destructive')}>Blocked</span>
  );
}

function BlockedBadge() {
  return (
    <span className="shrink-0 rounded-sm border border-destructive px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-destructive">
      Blocked
    </span>
  );
}

/**
 * The WORK landing page, in five parts: four tiles, what needs action today,
 * the close cycle while one is running, this week's goals, and a pinned set
 * of projects.
 *
 * It is not a second Today. Only the urgent tasks in Section 1 are completed
 * here — everything else links out to where it lives — and that exception
 * exists because those tasks are what the score tile two rows above is
 * counting.
 */
export function Dashboard() {
  const repository = useAppStore((state) => state.repository);
  const setWorkView = useAppStore((state) => state.setWorkView);
  const { run } = useMutation();

  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<TaskEntry[]>([]);
  const [habits, setHabits] = useState<HabitEntry[]>([]);
  const [blocks, setBlocks] = useState<TimeBlockEntry[]>([]);
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [editingPins, setEditingPins] = useState(false);
  const [pinFilter, setPinFilter] = useState('');

  const today = useMemo(() => new Date(), []);
  const todayKey = format(today, 'yyyy-MM-dd');
  const weekKey = getIsoWeekKey(today);

  const { log: dailyLog, setLog, syncInputs, recomputeAndPersistDailyLog } = useDailyLog(
    todayKey,
    'work',
  );

  const load = useCallback(async () => {
    const [projectData, entries, logData, weekPlan, todayLog] = await Promise.all([
      repository.listProjects('work'),
      repository.listEntries({ domain: 'work' }),
      repository.listDailyLogs({
        from: format(subDays(today, HABIT_WINDOW_DAYS - 1), 'yyyy-MM-dd'),
        to: todayKey,
        domain: 'work',
      }),
      repository.getWeeklyPlan(weekKey, 'work'),
      repository.getDailyLog(todayKey, 'work'),
    ]);
    setProjects(projectData);
    setTasks(entries.filter((entry): entry is TaskEntry => entry.type === 'task'));
    setHabits(
      entries.filter((entry): entry is HabitEntry => entry.type === 'habit' && entry.active),
    );
    setBlocks(
      entries.filter(
        (entry): entry is TimeBlockEntry => entry.type === 'timeblock' && entry.date === todayKey,
      ),
    );
    setPlan(weekPlan);
    setLogs(logData);
    setLog(todayLog);
  }, [repository, setLog, today, todayKey, weekKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const urgentTasks = useMemo(() => scoredTasks(tasks, todayKey), [tasks, todayKey]);

  // Mirror the scoring inputs so a tick persists against fresh values rather
  // than a closed-over snapshot — same contract Today uses.
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

  const escalations = useMemo(
    () => collectEscalations(projects).reduce((sum, group) => sum + group.items.length, 0),
    [projects],
  );
  const closeTile = useMemo(() => closeEntityCount(projects, today), [projects, today]);
  const consistency = useMemo(
    () => windowHabitConsistency(logs, today, HABIT_WINDOW_DAYS),
    [logs, today],
  );
  const needsAction = useMemo(() => collectNeedsAction(projects, today), [projects, today]);
  const closeCycle = useMemo(() => summarizeCloseCycle(projects, today), [projects, today]);
  const pinned = useMemo(() => pinnedProjectRows(projects, today), [projects, today]);

  const weekSummary = useMemo(() => {
    const range = getWeekRange(weekKey);
    const weekLogs = logs.filter((entry) => entry.date >= range.from && entry.date < range.to);
    return summarizeWeek(weekLogs, plan);
  }, [logs, plan, weekKey]);

  const goals = useMemo(
    () => (plan?.goals ?? []).map((goal) => goalProgress(goal, tasks)),
    [plan, tasks],
  );

  const pinnable = useMemo(
    () =>
      projects
        .filter(isPinnable)
        .filter((project) =>
          project.title.toLowerCase().includes(pinFilter.trim().toLowerCase()),
        )
        .sort((a, b) => a.order - b.order),
    [pinFilter, projects],
  );

  const toggleTask = async (task: TaskEntry) => {
    const done = !task.done;
    const updated = await run(done ? 'Complete task' : 'Reopen task', () =>
      repository.updateEntry(task.id, {
        done,
        completedAt: done ? new Date().toISOString() : undefined,
      }),
    );
    if (!updated) return;
    const next = tasks.map((item) => (item.id === task.id ? (updated as TaskEntry) : item));
    setTasks(next);
    await recomputeAndPersistDailyLog({ tasks: scoredTasks(next, todayKey) });
  };

  const togglePin = async (project: Project) => {
    const updated = await run('Update pinned projects', () =>
      repository.updateProject(project.id, { dashboardPinned: !project.dashboardPinned }),
    );
    if (!updated) return;
    setProjects((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  };

  const openMilestone = (project: Project) =>
    setWorkView(project.recurring === 'monthly' ? 'monthly-close' : 'projects');

  const go = (view: WorkView) => () => setWorkView(view);

  const tiles: Array<{ value: string; caption: string; view: WorkView }> = [
    { value: String(escalations), caption: 'Escalations waiting', view: 'escalations' },
    {
      value: closeTile.total > 0 ? `${closeTile.done} of ${closeTile.total}` : '—',
      caption: `${closeTile.label} · entities closed`,
      view: 'monthly-close',
    },
    { value: `${score.score}%`, caption: "Today's score", view: 'today' },
    {
      value: `${consistency}%`,
      caption: `Habit consistency · ${HABIT_WINDOW_DAYS} days`,
      view: 'week',
    },
  ];

  return (
    <div className="page-shell">
      <header className="mb-7 border-b border-border-subtle pb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h1 className="page-title mt-0">Work</h1>
          <p className="text-xs tabular-nums text-foreground-muted">
            {format(today, 'EEEE d MMMM yyyy')} · Week {getISOWeek(today)}
          </p>
        </div>
        <p className="mt-2 text-sm text-foreground-muted">
          What needs a decision today, and nothing that doesn&apos;t.
        </p>
      </header>

      {/* Tiles. No icons: at this size the little coloured marks read as
          noise rather than as meaning. */}
      <div className="mb-6 grid gap-px overflow-hidden rounded-lg border border-border bg-border-subtle shadow-card sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <button
            key={tile.caption}
            onClick={go(tile.view)}
            className="bg-card p-4 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <p className="text-2xl font-bold tabular-nums text-foreground">{tile.value}</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-foreground-muted">
              {tile.caption}
            </p>
          </button>
        ))}
      </div>

      <div className="space-y-5">
        {/* ---------------------------------------------- 1. Needs action today */}
        <Card>
          <CardContent className="pt-5">
            <SectionHeading title="Needs action today" />

            {urgentTasks.length === 0 ? (
              <EmptyRow
                label="Urgent tasks · counts toward today's score"
                clause="Nothing flagged yet"
                action="Flag a task"
                onAction={go('today')}
              />
            ) : (
              <>
                <div className="flex items-baseline justify-between gap-4">
                  <p className="surface-label">Urgent tasks</p>
                  <p className="text-[11px] text-foreground-muted">
                    counts toward today&apos;s score
                  </p>
                </div>
                <ul className="mt-1 divide-y divide-border-subtle">
                  {urgentTasks.map((task) => (
                    <li key={task.id} className="flex min-h-11 items-center gap-2">
                      <Checkbox
                        checked={task.done}
                        onCheckedChange={() => void toggleTask(task)}
                        aria-label={`Mark ${task.title} ${task.done ? 'open' : 'done'}`}
                      />
                      <span
                        className={cn(
                          'min-w-0 flex-1 text-sm',
                          task.done
                            ? 'text-foreground-muted line-through'
                            : 'text-foreground-secondary',
                        )}
                      >
                        {task.title}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <div className="mt-4">
              {needsAction.length === 0 ? (
                <EmptyRow
                  label="Milestones · not scored"
                  clause="Nothing overdue, due today or blocked"
                  action="Open projects"
                  onAction={go('projects')}
                />
              ) : (
                <>
                  <div className="flex items-baseline justify-between gap-4">
                    <p className="surface-label">Milestones</p>
                    <p className="text-[11px] text-foreground-muted">not scored</p>
                  </div>
                  <ul className="mt-1 divide-y divide-border-subtle">
                    {needsAction.map((row) => {
                      const initials = picInitials(row.milestone.pic);
                      return (
                        <li key={row.milestone.id}>
                          <button
                            onClick={() => openMilestone(row.project)}
                            className="flex min-h-11 w-full items-center gap-2 py-1.5 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm text-foreground-secondary">
                                {row.milestone.text}
                              </span>
                              <span className="block truncate text-[11px] text-foreground-muted">
                                {row.project.title}
                              </span>
                            </span>
                            {initials && (
                              <span
                                className="shrink-0 rounded-sm border border-border-subtle bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-foreground-muted"
                                title={row.milestone.pic}
                              >
                                {initials}
                              </span>
                            )}
                            {row.alsoBlocked && <BlockedBadge />}
                            <StateBadge row={row} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* -------------------------------------------------- 2. Close cycle */}
        {closeCycle && (
          <Card>
            <CardContent className="pt-5">
              <SectionHeading
                title={`Close cycle · ${closeCycle.label}`}
                right={
                  <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs tabular-nums text-foreground-muted">
                    <span>
                      {closeCycle.done} of {closeCycle.total} milestones
                    </span>
                    {closeCycle.deadline && <span>due {formatDateFor(closeCycle.deadline)}</span>}
                    <TextLink onClick={go('monthly-close')}>Monthly close</TextLink>
                  </span>
                }
              />
              <div className="grid gap-x-8 sm:grid-cols-2">
                {closeCycle.series.map((series) => (
                  <div key={series.series} className="flex h-[34px] items-center gap-3">
                    <span className="w-24 shrink-0 truncate text-xs font-semibold text-foreground-secondary">
                      {series.series}
                    </span>
                    <Progress
                      className="h-1 flex-1"
                      value={series.total ? (100 * series.done) / series.total : 0}
                    />
                    <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-foreground-muted">
                      {series.done}/{series.total}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-foreground-muted">
                This card hides itself once every entity in the current and previous cycle is
                closed. Milestones here; the tile above counts entities.
              </p>
            </CardContent>
          </Card>
        )}

        {/* --------------------------------------------------- 3. This week */}
        <Card>
          <CardContent className="pt-5">
            <SectionHeading title="This week" />
            {goals.length === 0 ? (
              <EmptyRow
                label="Weekly goals"
                clause="No goals set"
                action="Set this week's goals"
                onAction={go('week')}
              />
            ) : (
              <ul className="divide-y divide-border-subtle">
                {goals.map((item) => (
                  <li key={item.goal.id} className="flex min-h-11 items-center gap-3 py-1.5">
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate text-sm',
                        item.goal.done
                          ? 'text-foreground-muted line-through'
                          : 'text-foreground-secondary',
                      )}
                    >
                      {item.goal.text}
                    </span>
                    <Progress className="h-1 w-24 shrink-0" value={item.percent} />
                    <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-foreground-muted">
                      {item.binary ? `${item.percent}%` : `${item.done}/${item.total}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <TextLink onClick={go('week')}>Habit contribution graph</TextLink>
              <span className="text-xs tabular-nums text-foreground-muted">
                Week score {weekSummary.averageScore}%
              </span>
            </div>
          </CardContent>
        </Card>

        {/* ---------------------------------------------------- 4. Projects */}
        <Card>
          <CardContent className="pt-5">
            <SectionHeading
              title="Projects"
              right={
                <span className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => setEditingPins((current) => !current)}
                    className="inline-flex items-center gap-1 rounded-sm text-xs font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-expanded={editingPins}
                  >
                    {editingPins ? <X className="size-3" /> : <Pencil className="size-3" />}
                    {editingPins ? 'Done' : 'Edit'}
                  </button>
                  <TextLink onClick={go('projects')}>All projects</TextLink>
                </span>
              }
            />

            {editingPins && (
              <div className="mb-4 rounded-md border border-border bg-surface-2 p-3">
                <Input
                  className="h-9 text-sm"
                  value={pinFilter}
                  onChange={(event) => setPinFilter(event.target.value)}
                  placeholder="Filter projects…"
                  aria-label="Filter projects to pin"
                />
                {/* Close cycles are absent from this list entirely — Section 2
                    owns them, and pinning one would duplicate it. */}
                <ul className="mt-2 max-h-64 overflow-y-auto">
                  {pinnable.map((project) => (
                    <li key={project.id}>
                      <button
                        type="button"
                        onClick={() => void togglePin(project)}
                        aria-pressed={Boolean(project.dashboardPinned)}
                        className="flex min-h-11 w-full items-center gap-2 rounded-sm px-1 text-left transition-colors duration-150 hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {/* Selection, not completion — so this uses the action
                            colour, never the `success` used for done. */}
                        <span
                          className={cn(
                            'grid size-4 shrink-0 place-items-center rounded-sm border',
                            project.dashboardPinned
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border',
                          )}
                        >
                          {project.dashboardPinned && <Check className="size-3" strokeWidth={3} />}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm text-foreground-secondary">
                          {project.title}
                        </span>
                      </button>
                    </li>
                  ))}
                  {pinnable.length === 0 && (
                    <li className="py-2 text-xs text-foreground-muted">No project matches.</li>
                  )}
                </ul>
              </div>
            )}

            {pinned.length === 0 ? (
              <EmptyRow
                label="Pinned projects"
                clause="None pinned"
                action="Choose projects"
                onAction={() => setEditingPins(true)}
              />
            ) : (
              <ul className="divide-y divide-border-subtle">
                {pinned.map((row) => (
                  <li key={row.project.id}>
                    <button
                      onClick={go('projects')}
                      className="flex min-h-11 w-full items-center gap-2 py-1.5 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground-secondary">
                        {row.project.title}
                      </span>
                      {row.blocked && <BlockedBadge />}
                      {row.overdue && !row.blocked && (
                        <span className="shrink-0 rounded-sm bg-destructive px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-destructive-foreground">
                          Overdue
                        </span>
                      )}
                      {row.nextDate && (
                        <span className="w-20 shrink-0 text-right text-[11px] tabular-nums text-foreground-muted">
                          {formatDateFor(row.nextDate)}
                        </span>
                      )}
                      <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-foreground-muted">
                        {row.done}/{row.total}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
