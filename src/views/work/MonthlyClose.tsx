import { CalendarClock, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ProjectCard } from '../../components/ProjectCard';
import type { Project } from '../../data/types';
import { ensureMonthlyClose, periodLabel, targetPeriod } from '../../logic/monthlyClose';
import { useAppStore } from '../../store/appStore';

/**
 * The recurring monthly-close cycles: five entity closes + consolidation per
 * period. The current period auto-generates on load (on/after the 22nd,
 * idempotently); unfinished items from older periods stay visible as overdue.
 */
export function MonthlyClose() {
  const repository = useAppStore((state) => state.repository);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    await ensureMonthlyClose(repository, new Date());
    const all = await repository.listProjects('work');
    setProjects(all.filter((project) => project.recurring === 'monthly'));
    setIsLoading(false);
  }, [repository]);

  useEffect(() => {
    void load();
  }, [load]);

  const periods = useMemo(() => {
    const keys = [...new Set(projects.map((project) => project.period ?? ''))]
      .filter(Boolean)
      .sort()
      .reverse();
    return keys.map((period) => ({
      period,
      label: periodLabel(period),
      projects: projects
        .filter((project) => project.period === period)
        .sort((a, b) => a.order - b.order),
    }));
  }, [projects]);

  const current = targetPeriod(new Date());

  return (
    <div className="page-shell">
      <header className="mb-7 border-b border-gray-800 pb-7">
        <p className="page-kicker">Work / Monthly Close</p>
        <h1 className="page-title">Close the month</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-500">
          Recurring cycles for BMG, OKI, KGR, NMG, KBF and Consolidation. Each
          period generates on the 22nd; whatever is not done stays visible as overdue.
        </p>
      </header>

      {!isLoading && periods.length === 0 && (
        <div className="grid min-h-52 place-items-center border border-dashed border-gray-800 text-center">
          <div>
            <RefreshCw className="mx-auto size-6 text-gray-700" />
            <p className="mt-3 font-semibold text-gray-400">No close cycles yet.</p>
            <p className="mt-1 text-sm text-gray-600">
              The {periodLabel(current)} cycle generates automatically on the 22nd.
            </p>
          </div>
        </div>
      )}

      {periods.map(({ period, label, projects: cycle }) => {
        const done = cycle.filter((project) =>
          project.milestones.every((milestone) => milestone.done),
        ).length;
        return (
          <section key={period} className="mb-8">
            <div className="mb-3 flex items-end justify-between border-b border-gray-800 pb-3">
              <div>
                <h2 className="text-lg font-bold text-gray-100">{label}</h2>
                <p className="mt-1 text-xs text-gray-600">
                  {period}
                  {period === current && ' · current cycle'}
                </p>
              </div>
              <p className="flex items-center gap-2 text-sm tabular-nums text-gray-400">
                <CalendarClock className="size-4 text-primary" />
                {done} of {cycle.length} closes done
              </p>
            </div>
            <div className="grid gap-5 2xl:grid-cols-2">
              {cycle.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  domain="work"
                  compact
                  updateProject={(id, patch) => repository.updateProject(id, patch)}
                  onChange={(updated) =>
                    setProjects((currentProjects) =>
                      currentProjects.map((item) =>
                        item.id === updated.id ? updated : item,
                      ),
                    )
                  }
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
