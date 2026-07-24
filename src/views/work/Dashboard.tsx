import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CalendarDays,
  Megaphone,
  TrendingUp,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { format, subDays } from 'date-fns';
import { ContributionGraph, WeeklyScoreChart } from '../../components/AnalyticsPanels';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import type { DailyLog, Project } from '../../data/types';
import { daysLeft, daysLeftLabel, urgencyFor, type Urgency } from '../../logic/deadlines';
import { collectEscalations } from '../../logic/milestones';
import { periodLabel, targetPeriod } from '../../logic/monthlyClose';
import { cn } from '../../lib/utils';
import { useAppStore } from '../../store/appStore';

const urgencyText: Record<Urgency, string> = {
  overdue: 'text-destructive',
  'due-soon': 'text-escalate',
  'on-track': 'text-primary',
};

interface Countdown {
  title: string;
  date: string;
  days: number;
  urgency: Urgency;
}

/**
 * The WORK landing page: deadline countdowns, escalation and monthly-close
 * summaries, projects needing attention, and the folded-in analytics
 * (contribution graph + weekly score trend).
 */
export function Dashboard() {
  const repository = useAppStore((state) => state.repository);
  const setWorkView = useAppStore((state) => state.setWorkView);
  const [projects, setProjects] = useState<Project[]>([]);
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const today = useMemo(() => new Date(), []);
  const todayKey = format(today, 'yyyy-MM-dd');

  const load = useCallback(async () => {
    const [projectData, logData] = await Promise.all([
      repository.listProjects('work'),
      repository.listDailyLogs({
        from: format(subDays(today, 29), 'yyyy-MM-dd'),
        to: todayKey,
        domain: 'work',
      }),
    ]);
    setProjects(projectData);
    setLogs(logData);
  }, [repository, today, todayKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const countdowns = useMemo<Countdown[]>(() => {
    return projects
      .filter((project) => project.deadline && project.status !== 'done')
      .map((project) => ({
        title: project.title,
        date: project.deadline as string,
        days: daysLeft(project.deadline as string, today),
        urgency: urgencyFor(project.deadline as string, today, 7),
      }))
      .sort((a, b) => a.days - b.days)
      .slice(0, 5);
  }, [projects, today]);

  const escalationCount = useMemo(
    () => collectEscalations(projects).reduce((sum, group) => sum + group.items.length, 0),
    [projects],
  );

  const needsAttention = useMemo(() => {
    return projects
      .filter((project) => project.status !== 'done')
      .map((project) => {
        const blocked = project.milestones.some((m) => m.status === 'blocked');
        const urgency = project.deadline
          ? urgencyFor(project.deadline, today, 7)
          : ('on-track' as Urgency);
        return { project, blocked, urgency };
      })
      .filter((item) => item.blocked || item.urgency !== 'on-track');
  }, [projects, today]);

  const close = useMemo(() => {
    const period = targetPeriod(today);
    const cycle = projects.filter(
      (project) => project.recurring === 'monthly' && project.period === period,
    );
    const done = cycle.filter((project) =>
      project.milestones.every((milestone) => milestone.done),
    ).length;
    return { period, label: periodLabel(period), total: cycle.length, done };
  }, [projects, today]);

  const consistency = useMemo(() => {
    const values = logs.flatMap((log) => Object.values(log.habits));
    return values.length
      ? Math.round((100 * values.filter(Boolean).length) / values.length)
      : 0;
  }, [logs]);

  return (
    <div className="page-shell">
      <header className="mb-7 border-b border-gray-800 pb-7">
        <p className="page-kicker">Work / Dashboard</p>
        <h1 className="page-title">The helicopter view</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-500">
          Deadlines, escalations, and the close cycle — everything that needs a decision, on one screen.
        </p>
      </header>

      <div className="mb-5 grid gap-px overflow-hidden border border-gray-800 bg-gray-800 sm:grid-cols-3">
        <button
          className="bg-card p-5 text-left transition-colors hover:bg-muted"
          onClick={() => setWorkView('escalations')}
          aria-label="Open escalations"
        >
          <Megaphone className="size-4 text-escalate" />
          <p className="mt-4 text-3xl font-bold tabular-nums">{escalationCount}</p>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-gray-600">
            Escalations waiting <ArrowRight className="ml-1 inline size-3" />
          </p>
        </button>
        <button
          className="bg-card p-5 text-left transition-colors hover:bg-muted"
          onClick={() => setWorkView('monthly-close')}
          aria-label="Open monthly close"
        >
          <CalendarClock className="size-4 text-primary" />
          <p className="mt-4 text-3xl font-bold tabular-nums">
            {close.total > 0 ? `${close.done} of ${close.total}` : '—'}
          </p>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-gray-600">
            {close.label} · closes done <ArrowRight className="ml-1 inline size-3" />
          </p>
        </button>
        <div className="bg-card p-5">
          <TrendingUp className="size-4 text-primary" />
          <p className="mt-4 text-3xl font-bold tabular-nums">{consistency}%</p>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-gray-600">
            Habit consistency · 30 days
          </p>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Deadline countdowns</CardTitle>
              <p className="mt-2 text-sm text-gray-600">Nearest first, including close cycles.</p>
            </div>
            <CalendarClock className="size-4 text-gray-600" />
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-gray-800">
              {countdowns.map((item) => (
                <div key={`${item.title}-${item.date}`} className="flex min-h-12 items-center gap-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-300">{item.title}</span>
                  <span className="font-mono text-xs text-gray-600">{item.date}</span>
                  <span className={cn('w-24 text-right text-sm font-bold tabular-nums', urgencyText[item.urgency])}>
                    {daysLeftLabel(item.days)}
                  </span>
                </div>
              ))}
              {countdowns.length === 0 && (
                <p className="py-8 text-center text-sm text-gray-600">No open deadlines.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Needs attention</CardTitle>
              <p className="mt-2 text-sm text-gray-600">Blocked, overdue, or due within a week.</p>
            </div>
            <AlertTriangle className="size-4 text-escalate" />
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-gray-800">
              {needsAttention.map(({ project, blocked, urgency }) => (
                <button
                  key={project.id}
                  className="flex min-h-12 w-full items-center gap-2 py-2 text-left transition-colors hover:bg-muted/40"
                  onClick={() =>
                    setWorkView(project.recurring === 'monthly' ? 'monthly-close' : 'projects')
                  }
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-300">{project.title}</span>
                  {blocked && (
                    <span className="border border-destructive/40 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-destructive">
                      Blocked
                    </span>
                  )}
                  {urgency !== 'on-track' && project.deadline && (
                    <span
                      className={cn(
                        'border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider tabular-nums',
                        urgency === 'overdue'
                          ? 'border-destructive/40 text-destructive'
                          : 'border-escalate/40 text-escalate',
                      )}
                    >
                      {daysLeftLabel(daysLeft(project.deadline, today))}
                    </span>
                  )}
                </button>
              ))}
              {needsAttention.length === 0 && (
                <p className="py-8 text-center text-sm text-gray-600">All clear. Nothing on fire.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Habit consistency</CardTitle>
              <p className="mt-2 text-sm text-gray-600">Last 30 days · one cell per day</p>
            </div>
            <CalendarDays className="size-4 text-gray-600" />
          </CardHeader>
          <CardContent>
            <ContributionGraph logs={logs} today={today} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Daily score</CardTitle>
              <p className="mt-2 text-sm text-gray-600">Current ISO week · Mon–Sun</p>
            </div>
            <TrendingUp className="size-4 text-primary" />
          </CardHeader>
          <CardContent>
            <WeeklyScoreChart logs={logs} today={today} />
          </CardContent>
        </Card>
      </div>

      <div className="mt-5 flex justify-end">
        <Button variant="secondary" onClick={() => setWorkView('today')}>
          Start the day
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
