import { AlertTriangle, Download, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Card, CardContent } from '../../../components/ui/Card';
import type { FactLibraryEntry, ResearchProject } from '../../../data/types';
import {
  librarySweepCandidates,
  sharedPending,
  valueConflicts,
} from '../../../logic/research/portfolio';

export interface LibraryTabProps {
  projects: ResearchProject[];
  library: FactLibraryEntry[];
  onPull: (fact: FactLibraryEntry, projectId: string) => Promise<void>;
  onDeleteEntry: (id: string) => Promise<void>;
  onSweep: () => Promise<void>;
  isPending: boolean;
}

export function LibraryTab({
  projects,
  library,
  onPull,
  onDeleteEntry,
  onSweep,
  isPending,
}: LibraryTabProps) {
  const [target, setTarget] = useState<string>(projects[0]?.project.id ?? '');
  const conflicts = useMemo(() => valueConflicts(projects), [projects]);
  const shared = useMemo(() => sharedPending(projects), [projects]);
  const sweepable = useMemo(
    () => librarySweepCandidates(projects, library),
    [library, projects],
  );

  return (
    <div className="space-y-6">
      {/* Conflicts lead. This is the one thing on the screen that could put two
          different numbers for the same quantity into two published papers. */}
      <Card className={conflicts.length > 0 ? 'border-destructive' : undefined}>
        <CardContent className="pt-5">
          <h2 className="flex items-center gap-2 font-display text-card-heading font-semibold text-foreground">
            {conflicts.length > 0 && <AlertTriangle className="size-4 text-destructive" />}
            Value conflicts
          </h2>
          <p className="mb-3 mt-1 text-xs text-foreground-muted">
            The same name carrying different values in different projects.
          </p>

          {conflicts.length === 0 ? (
            <p className="text-xs text-foreground-muted">
              No conflicts. Two projects agreeing is not a conflict, and an unfilled item is not a
              disagreement — neither is counted here.
            </p>
          ) : (
            <ul className="space-y-4">
              {conflicts.map((conflict) => (
                <li key={conflict.name}>
                  <p className="text-sm font-semibold text-foreground">{conflict.name}</p>
                  <ul className="mt-1.5 divide-y divide-border-subtle">
                    {conflict.values.map((entry, index) => (
                      <li
                        key={`${entry.projectTitle}-${index}`}
                        className="flex flex-wrap gap-x-3 gap-y-0.5 py-1.5 text-xs"
                      >
                        <span className="font-mono font-semibold tabular-nums text-destructive">
                          {entry.value}
                        </span>
                        <span className="text-foreground-secondary">{entry.projectTitle}</span>
                        {entry.source && (
                          <span className="text-foreground-muted">{entry.source}</span>
                        )}
                        {entry.asof && (
                          <span className="font-mono text-foreground-muted">{entry.asof}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-xs text-foreground-muted">
                    If the difference is legitimate because the definitions differ, the definitions
                    go into each caveat.
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          <h2 className="font-display text-card-heading font-semibold text-foreground">
            Shared pending work
          </h2>
          <p className="mb-3 mt-1 text-xs text-foreground-muted">
            Indeterminate items more than one project is waiting on — verify once, use many times.
          </p>
          {shared.length === 0 ? (
            <p className="text-xs text-foreground-muted">Nothing pending.</p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {shared.map((item) => (
                <li key={item.name} className="flex flex-wrap gap-x-3 gap-y-1 py-2 text-xs">
                  <span className="text-sm font-semibold text-foreground">{item.name}</span>
                  {item.unit && <span className="text-foreground-muted">{item.unit}</span>}
                  {item.crit && (
                    <span className="rounded-sm border border-destructive px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-destructive">
                      Critical
                    </span>
                  )}
                  <span className="text-foreground-secondary">
                    {item.projects.length} project{item.projects.length === 1 ? '' : 's'}:{' '}
                    {item.projects.join(', ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-card-heading font-semibold text-foreground">
                Fact library
              </h2>
              <p className="mt-1 text-xs text-foreground-muted">
                {library.length} facts. A pulled fact arrives verified and carries a note saying its
                definition must be re-checked for this use — the same figure can be right in one
                project and wrong in another.
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={() => void onSweep()}
              disabled={isPending || sweepable.length === 0}
              title="Promote every verified item not already here, skipping name-duplicates"
            >
              Sweep {sweepable.length > 0 ? `(${sweepable.length})` : ''}
            </Button>
          </div>

          {projects.length > 0 && (
            <label className="mb-3 block">
              <span className="surface-label">Pull into</span>
              <select
                className="native-select mt-1 text-xs"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              >
                {projects.map((research) => (
                  <option key={research.project.id} value={research.project.id}>
                    {research.project.title}
                  </option>
                ))}
              </select>
            </label>
          )}

          {library.length === 0 ? (
            <p className="text-xs text-foreground-muted">
              Empty. Promote a verified register item from a project to start it.
            </p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {library.map((fact) => (
                <li key={fact.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="text-sm font-semibold text-foreground">{fact.name}</span>
                  <span className="font-mono text-xs tabular-nums text-foreground-secondary">
                    {fact.value}
                    {fact.unit && ` ${fact.unit}`}
                  </span>
                  {fact.asof && (
                    <span className="font-mono text-xs text-foreground-muted">{fact.asof}</span>
                  )}
                  {fact.source && (
                    <span className="min-w-0 truncate text-xs text-foreground-muted">
                      {fact.source}
                    </span>
                  )}
                  {fact.fromProject && (
                    <span className="text-xs text-foreground-muted">from {fact.fromProject}</span>
                  )}
                  <span className="ml-auto flex shrink-0 gap-1.5">
                    <Button
                      size="icon"
                      variant="secondary"
                      disabled={isPending || !target}
                      onClick={() => void onPull(fact, target)}
                      aria-label={`Pull ${fact.name} into the selected project`}
                    >
                      <Download className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="danger"
                      onClick={() => void onDeleteEntry(fact.id)}
                      aria-label={`Delete ${fact.name} from the library`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
