import { ArrowRight, Flag, Megaphone, OctagonAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { EmptyRow } from '../../components/ui/EmptyRow';
import { Progress } from '../../components/ui/Progress';
import type { Milestone, Project } from '../../data/types';
import { cn } from '../../lib/utils';
import { useAppStore } from '../../store/appStore';

interface FinishLineRow {
  project: Project;
  remaining: Milestone[];
  done: number;
  total: number;
  blockedCount: number;
  /** Blocked milestones that have not been escalated to anyone. */
  silentBlockers: number;
}

/**
 * The question this view answers: "Which projects are within a push of done,
 * and what exactly — blocked or just unstarted — still stands in the way?"
 *
 * One-off active WORK projects only, ranked by fewest remaining milestones.
 * Monthly closes are excluded: they reset every cycle and already have their
 * own view. The remaining milestones are listed in full, because the whole
 * point is seeing the exact last mile — with a marker on any blocker that has
 * been documented but never escalated.
 */
export function FinishLine() {
  const repository = useAppStore((state) => state.repository);
  const setWorkView = useAppStore((state) => state.setWorkView);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setProjects(await repository.listProjects('work'));
    setLoaded(true);
  }, [repository]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo<FinishLineRow[]>(() => {
    return projects
      .filter(
        (project) =>
          project.status === 'active' && !project.recurring && project.milestones.length > 0,
      )
      .map((project) => {
        const remaining = project.milestones.filter((milestone) => !milestone.done);
        const blocked = remaining.filter((milestone) => milestone.status === 'blocked');
        return {
          project,
          remaining,
          done: project.milestones.length - remaining.length,
          total: project.milestones.length,
          blockedCount: blocked.length,
          silentBlockers: blocked.filter(
            (milestone) => (milestone.escalateTo ?? 'none') === 'none',
          ).length,
        };
      })
      .filter((row) => row.remaining.length > 0)
      .sort(
        (a, b) =>
          a.remaining.length - b.remaining.length ||
          b.done / b.total - a.done / a.total,
      );
  }, [projects]);

  const nearlyDone = rows.filter((row) => row.remaining.length <= 3);
  const silentTotal = rows.reduce((sum, row) => sum + row.silentBlockers, 0);

  return (
    <div className="page-shell">
      <header className="mb-7 border-b border-border-subtle pb-7">
        <p className="page-kicker">Work / Finish line</p>
        <h1 className="page-title">The last mile</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-foreground-muted">
          Projects ranked by how little is left — and exactly what that little is.
          A project that is 90% done and parked is a decision waiting to be made.
        </p>
      </header>

      <div className="mb-5 grid gap-px overflow-hidden rounded-lg border border-border-subtle bg-border-subtle sm:grid-cols-3">
        <div className="bg-card p-5">
          <Flag className="size-4 text-foreground-muted" />
          <p className="metric-hero mt-4">{nearlyDone.length}</p>
          <p className="surface-label mt-1.5">Within 3 milestones of done</p>
        </div>
        <div className="bg-card p-5">
          <OctagonAlert className="size-4 text-foreground-muted" />
          <p className="metric-hero mt-4">
            {rows.reduce((sum, row) => sum + row.blockedCount, 0)}
          </p>
          <p className="surface-label mt-1.5">Blocked milestones in the way</p>
        </div>
        <button
          className="bg-card p-5 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          // Projects, not Escalations: the Escalations view deliberately shows
          // only milestones that already have a target, so silent blockers
          // would vanish on click. The escalation selector lives in Projects.
          onClick={() => setWorkView('projects')}
          aria-label="Open projects to assign an escalation target"
        >
          <Megaphone className="size-4 text-foreground-muted" />
          <p className="metric-hero mt-4">{silentTotal}</p>
          <p className="surface-label mt-1.5">
            Blocked, escalated to no one <ArrowRight className="ml-1 inline size-3" />
          </p>
        </button>
      </div>

      <div className="space-y-5">
        {rows.map((row) => (
          <Card key={row.project.id}>
            <CardHeader className="items-center">
              <div className="min-w-0">
                <CardTitle className="truncate">{row.project.title}</CardTitle>
                <p className="mt-1.5 text-xs tabular-nums text-foreground-muted">
                  {row.done} of {row.total} done ·{' '}
                  {row.remaining.length === 1
                    ? 'one milestone left'
                    : `${row.remaining.length} milestones left`}
                </p>
              </div>
              <span
                className={cn(
                  'text-data font-semibold tabular-nums',
                  row.done === row.total ? 'text-success' : 'text-foreground-secondary',
                )}
              >
                {Math.round((100 * row.done) / row.total)}%
              </span>
            </CardHeader>
            <CardContent>
              <Progress value={(100 * row.done) / row.total} className="mb-3" />
              <ul className="divide-y divide-border-subtle">
                {row.remaining.map((milestone) => {
                  const blocked = milestone.status === 'blocked';
                  const silent = blocked && (milestone.escalateTo ?? 'none') === 'none';
                  return (
                    <li
                      key={milestone.id}
                      className={cn(
                        'flex min-h-11 items-center gap-2 border-l-2 py-1.5 pl-3',
                        blocked ? 'border-l-destructive/60' : 'border-l-transparent',
                      )}
                    >
                      <span className="min-w-0 flex-1 text-sm text-foreground-secondary">
                        {milestone.text}
                        {milestone.note && (
                          <span className="mt-0.5 block truncate text-xs text-foreground-muted">
                            {milestone.note}
                          </span>
                        )}
                      </span>
                      {blocked && (
                        <span className="shrink-0 rounded-sm border border-destructive/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-destructive">
                          Blocked
                        </span>
                      )}
                      {silent && (
                        <span
                          className="shrink-0 rounded-sm border border-escalate/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-escalate"
                          title="Blocked but not escalated to anyone"
                        >
                          Not escalated
                        </span>
                      )}
                      {milestone.status === 'in-progress' && (
                        <span className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground-muted">
                          In progress
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="mt-3 flex justify-end">
                <Button variant="ghost" size="sm" onClick={() => setWorkView('projects')}>
                  Open in Projects
                  <ArrowRight className="size-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {loaded && rows.length === 0 && (
          <Card>
            <CardContent className="pt-5">
              <EmptyRow
                label="In flight"
                clause="Nothing — every active project is finished or has no milestones yet"
                action="Open Projects"
                onAction={() => setWorkView('projects')}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
