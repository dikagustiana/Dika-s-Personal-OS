import { ArrowRight, Check, Pencil, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import { format, getISOWeek, subDays } from 'date-fns';
import { ProjectCard } from '../../components/ProjectCard';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { Card, CardContent } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Progress } from '../../components/ui/Progress';
import type {
  BrainDumpEntry,
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
import { buildProjectTree, findNode, rollupMilestones } from '../../logic/hierarchy';
import { collectEscalations } from '../../logic/milestones';
import { closeWindowState } from '../../logic/monthlyClose';
import { calculateDailyScore } from '../../logic/score';
import { daysElapsedInWeek, getIsoWeekKey, getWeekRange, summarizeWeek } from '../../logic/week';
import {
  closeEntityCount,
  collectNeedsAction,
  goalProgress,
  isPinnable,
  needsActionBreakdown,
  picInitials,
  summarizeCloseCycle,
  type NeedsActionBreakdown,
  type NeedsActionRow,
} from '../../logic/workDashboard';
import { cn } from '../../lib/utils';
import { useAppStore } from '../../store/appStore';
import type { WorkView } from '../../store/appStore';

const HABIT_WINDOW_DAYS = 30;

/**
 * How many milestone rows the needs-action list shows before collapsing.
 *
 * A close cycle puts dozens of blocked milestones in this list at once. Five is
 * what fits above the fold; the rest are one click away, and the collapse never
 * hides an overdue row because `collectNeedsAction` has already sorted those to
 * the top.
 */
const NEEDS_ACTION_VISIBLE = 5;

// One text-link treatment, shared by `TextLink` and the two toggles that read
// as links rather than as buttons — the pin editor and the needs-action
// disclosure, neither of which navigates.
const LINK_CLASS =
  'inline-flex items-center gap-1 rounded-sm text-xs font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * A text link, which is the ONLY navigation affordance on this page.
 *
 * Deliberate: the page carries no filled primary button at all. Several cards
 * each wanting their own filled button is exactly the competition that made
 * the old dashboard read as a wall of calls to action.
 */
function TextLink({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={LINK_CLASS}>
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
  note,
  right,
}: {
  title: string;
  note?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <div className="min-w-0">
        <h2 className="font-display text-card-heading font-semibold text-foreground">{title}</h2>
        {note && <p className="mt-1 text-xs text-foreground-muted">{note}</p>}
      </div>
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
 * The composition of the needs-action list, zero categories omitted.
 *
 * "3 overdue · 2 today" is the whole point: a flat "29 milestones" reads as one
 * undifferentiated pile, and a category printed as "0 blocked" is a number the
 * eye has to dismiss before it can read the two that matter.
 */
function compositionLine(breakdown: NeedsActionBreakdown): string {
  const parts: string[] = [];
  if (breakdown.overdue > 0) parts.push(`${breakdown.overdue} overdue`);
  if (breakdown.today > 0) parts.push(`${breakdown.today} today`);
  if (breakdown.blocked > 0) parts.push(`${breakdown.blocked} blocked`);
  return parts.join(' · ');
}

/**
 * The WORK landing page: four tiles, what needs action today, a capture box,
 * the close cycle while one is running, this week's goals, and the pinned
 * projects.
 *
 * It is not a second Today. The urgent tasks in Section 1 are the only tasks
 * completed here, and that exception exists because those tasks are what the
 * score tile two rows above is counting. The other exception is the pinned set:
 * a pinned project renders the same complete card the Projects view renders —
 * tiles, target, milestones, links, documents — and is worked in place. That
 * makes this a long scrolling page by design rather than one screen.
 */
export function Dashboard() {
  const repository = useAppStore((state) => state.repository);
  const setWorkView = useAppStore((state) => state.setWorkView);
  const { run, isPending } = useMutation();

  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<TaskEntry[]>([]);
  const [habits, setHabits] = useState<HabitEntry[]>([]);
  const [blocks, setBlocks] = useState<TimeBlockEntry[]>([]);
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [editingPins, setEditingPins] = useState(false);
  const [pinFilter, setPinFilter] = useState('');
  const [showAllNeedsAction, setShowAllNeedsAction] = useState(false);
  const [dumpText, setDumpText] = useState('');
  // 'question' asks; 'dismissed' is "Belum", for this visit only — nothing is
  // persisted, so the question is back on the next load; 'confirm' is "Sudah"
  // one step short of writing six rows.
  const [closeAnswer, setCloseAnswer] = useState<'question' | 'dismissed' | 'confirm'>(
    'question',
  );

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
  const needsActionCounts = useMemo(() => needsActionBreakdown(needsAction), [needsAction]);
  const closeCycle = useMemo(() => summarizeCloseCycle(projects, today), [projects, today]);

  // Already sorted by `collectNeedsAction`; this only caps.
  const visibleNeedsAction = showAllNeedsAction
    ? needsAction
    : needsAction.slice(0, NEEDS_ACTION_VISIBLE);
  const hiddenNeedsAction = needsAction.length - NEEDS_ACTION_VISIBLE;

  const closeWindow = useMemo(
    () => (closeCycle ? closeWindowState(closeCycle.period, today) : null),
    [closeCycle, today],
  );
  const closeProjects = useMemo(
    () =>
      closeCycle
        ? projects.filter(
            (project) =>
              project.recurring === 'monthly' && project.period === closeCycle.period,
          )
        : [],
    [closeCycle, projects],
  );
  const closeSettled =
    closeProjects.length > 0 && closeProjects.every((project) => project.status === 'done');
  /**
   * The close cycle to render, or null.
   *
   * One condition, and it is not "every milestone is ticked": the period must
   * not already be answered for. A cycle that overran its deadline with a
   * part-ticked checklist is precisely the one worth showing — answering
   * "Sudah" is what ends it, not the checklist reaching 100%.
   *
   * The window is not a second condition. `summarizeCloseCycle` keys off
   * `targetPeriod`, which only points at a period from that period's own 22nd
   * onwards — the same day its window opens — so the state here is never
   * 'before'. `closeWindow` decides what the card ASKS, never whether it shows.
   */
  const closeCard = closeCycle && !closeSettled ? closeCycle : null;

  const weekSummary = useMemo(() => {
    const range = getWeekRange(weekKey);
    const weekLogs = logs.filter((entry) => entry.date >= range.from && entry.date < range.to);
    // Days elapsed, not days logged: mid-week the honest window is Mon..today.
    return summarizeWeek(weekLogs, plan, daysElapsedInWeek(weekKey, today));
  }, [logs, plan, today, weekKey]);

  const goals = useMemo(
    () => (plan?.goals ?? []).map((goal) => goalProgress(goal, tasks)),
    [plan, tasks],
  );

  // Close cycles are not part of the project forest here: the close card owns
  // them, and the Projects view builds its tree from the same non-monthly slice.
  const pinnableProjects = useMemo(() => projects.filter(isPinnable), [projects]);

  const pinnable = useMemo(
    () =>
      pinnableProjects
        .filter((project) =>
          project.title.toLowerCase().includes(pinFilter.trim().toLowerCase()),
        )
        .sort((a, b) => a.order - b.order),
    [pinFilter, pinnableProjects],
  );

  /**
   * The pinned cards, each with the rollup `rollupMilestones` gives the
   * Projects view. Nothing else on this page derives project progress: a card
   * whose milestone count disagreed with the same card one view away would be
   * worse than no card.
   */
  const pinnedCards = useMemo(() => {
    const tree = buildProjectTree(pinnableProjects);
    return pinnableProjects
      .filter((project) => project.dashboardPinned)
      .sort((a, b) => a.order - b.order)
      .flatMap((project) => {
        const node = findNode(tree, project.id);
        return node ? [{ project, rollup: rollupMilestones(node) }] : [];
      });
  }, [pinnableProjects]);

  const replaceProject = (updated: Project) =>
    setProjects((current) => current.map((item) => (item.id === updated.id ? updated : item)));

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

  /** Capture only. The entries are read and processed in Today, not here. */
  const captureDump = async (event: FormEvent) => {
    event.preventDefault();
    const text = dumpText.trim();
    if (!text) return;
    const input: Omit<BrainDumpEntry, 'id' | 'createdAt' | 'updatedAt'> = {
      type: 'braindump',
      domain: 'work',
      text,
      tags: [],
    };
    const created = await run('Save brain dump', () => repository.createEntry(input));
    if (!created) return;
    setDumpText('');
  };

  /**
   * Answering "Sudah": `status: 'done'` on every project in the cycle, and not
   * one milestone touched. The checklists are normally left part-ticked, and
   * ticking ~88 boxes here would record work as evidenced that nobody
   * evidenced — an unfinished checklist under a closed period is the true
   * record. `status` is also what the entity tile counts, so the tile and this
   * card stop and start together.
   */
  const closePeriod = async () => {
    const updated = await run('Close period', () =>
      Promise.all(
        closeProjects.map((project) =>
          repository.updateProject(project.id, { status: 'done' }),
        ),
      ),
    );
    if (!updated) return;
    const byId = new Map(updated.map((project) => [project.id, project]));
    setProjects((current) => current.map((item) => byId.get(item.id) ?? item));
    setCloseAnswer('question');
  };

  const togglePin = async (project: Project) => {
    const updated = await run('Update pinned projects', () =>
      repository.updateProject(project.id, { dashboardPinned: !project.dashboardPinned }),
    );
    if (!updated) return;
    replaceProject(updated);
  };

  const openMilestone = (project: Project) =>
    setWorkView(project.recurring === 'monthly' ? 'monthly-close' : 'projects');

  /**
   * A link chip on a pinned card. Only the pinned subset has a card here, so
   * scroll to the target when it does and hand off to the full list when it
   * does not — a chip that silently does nothing is the worse outcome.
   */
  const openLinkedProject = (projectId: string) => {
    const card = document.getElementById(`project-card-${projectId}`);
    if (!card) {
      setWorkView('projects');
      return;
    }
    card.scrollIntoView({ block: 'start' });
  };

  const go = (view: WorkView) => () => setWorkView(view);

  const tiles: Array<{ value: string; caption: string; view: WorkView }> = [
    { value: String(escalations), caption: 'Escalations waiting', view: 'escalations' },
    {
      value: closeTile.total > 0 ? `${closeTile.done} of ${closeTile.total}` : '—',
      caption: `${closeTile.label} · entities closed`,
      view: 'monthly-close',
    },
    // '—', not '0%': with no habits, tasks or blocks there is nothing the
    // number could be describing, and a zero reads as a judgement.
    { value: score.isEmpty ? '—' : `${score.score}%`, caption: "Today's score", view: 'today' },
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
                  {/* The counts here are the whole list's, never the five rows'. */}
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className="surface-label">Milestones · not scored</p>
                    <p className="text-[11px] tabular-nums text-foreground-muted">
                      {compositionLine(needsActionCounts)}
                    </p>
                  </div>
                  <ul className="mt-1 divide-y divide-border-subtle">
                    {visibleNeedsAction.map((row) => {
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
                  {/* Absent, not disabled, when everything already fits. */}
                  {hiddenNeedsAction > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowAllNeedsAction((current) => !current)}
                      aria-expanded={showAllNeedsAction}
                      className={cn(LINK_CLASS, 'min-h-11')}
                    >
                      {showAllNeedsAction ? 'Show less' : `Show ${hiddenNeedsAction} more`}
                      {!showAllNeedsAction && <ArrowRight className="size-3" />}
                    </button>
                  )}
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* -------------------------------------------------- 2. Brain dump */}
        <Card>
          <CardContent className="pt-5">
            <SectionHeading
              title="Brain dump"
              note="Capture it here; it is read and processed in Today."
            />
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
                className="shrink-0"
                disabled={isPending}
              >
                Capture
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* ------------------------------------------------- 3. Close cycle */}
        {closeCard && (
          <Card>
            <CardContent className="pt-5">
              <SectionHeading
                title={`Close cycle · ${closeCard.label}`}
                right={
                  <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs tabular-nums text-foreground-muted">
                    <span>
                      {closeCard.done} of {closeCard.total} milestones
                    </span>
                    {closeCard.deadline && <span>due {formatDateFor(closeCard.deadline)}</span>}
                    <TextLink onClick={go('monthly-close')}>Monthly close</TextLink>
                  </span>
                }
              />

              {/* Past the deadline the card asks instead of vanishing. Both
                  answers are secondary: this page carries no filled button. */}
              {closeWindow === 'ask' && closeAnswer !== 'dismissed' && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border-subtle pb-4">
                  {closeAnswer === 'question' ? (
                    <>
                      <p className="text-sm text-foreground-secondary">
                        {closeCard.label} — sudah selesai?
                      </p>
                      <span className="flex items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setCloseAnswer('dismissed')}
                        >
                          Belum
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setCloseAnswer('confirm')}
                        >
                          Sudah
                        </Button>
                      </span>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-foreground-secondary">
                        Marks {closeProjects.length}{' '}
                        {closeProjects.length === 1 ? 'project' : 'projects'} done. Every
                        milestone is left exactly as it is.
                      </p>
                      <span className="flex items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setCloseAnswer('question')}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={isPending}
                          onClick={() => void closePeriod()}
                        >
                          Mark closed
                        </Button>
                      </span>
                    </>
                  )}
                </div>
              )}

              <div className="grid gap-x-8 sm:grid-cols-2">
                {closeCard.series.map((series) => (
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
                This card runs from the 22nd to the close deadline, then asks whether the period
                is finished. Milestones here; the tile above counts entities.
              </p>
            </CardContent>
          </Card>
        )}

        {/* --------------------------------------------------- 4. This week */}
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

        {/* ---------------------------------------------------- 5. Projects */}
        <Card>
          <CardContent className="pt-5">
            <SectionHeading
              title="Projects"
              note={
                pinnedCards.length > 0
                  ? `${pinnedCards.length} pinned ${
                      pinnedCards.length === 1 ? 'project' : 'projects'
                    }, each as its full card below`
                  : undefined
              }
              right={
                <span className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => setEditingPins((current) => !current)}
                    className={LINK_CLASS}
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
                {/* Close cycles are absent from this list entirely — Section 3
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

            {pinnedCards.length === 0 && (
              <EmptyRow
                label="Pinned projects"
                clause="None pinned"
                action="Choose projects"
                onAction={() => setEditingPins(true)}
              />
            )}
          </CardContent>
        </Card>

        {/* The pinned cards are the Projects view's card, unchanged and
            unabridged — so they sit at this page's width rather than nested
            inside the card above, which would indent every one of them. */}
        {pinnedCards.map(({ project, rollup }) => (
          <ProjectCard
            key={project.id}
            project={project}
            domain="work"
            tasks={tasks}
            goals={plan?.goals ?? []}
            projects={pinnableProjects}
            rollup={rollup}
            onNavigateToProject={openLinkedProject}
            updateProject={(id, patch) => repository.updateProject(id, patch)}
            onChange={replaceProject}
            today={today}
          />
        ))}
      </div>
    </div>
  );
}
