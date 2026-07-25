import { CheckCircle2, Megaphone } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import type { MilestoneStatus, Project } from '../../data/types';
import { collectEscalations, MILESTONE_STATUSES } from '../../logic/milestones';
import { cn } from '../../lib/utils';
import { useAppStore } from '../../store/appStore';

const statusLabel = new Map(
  MILESTONE_STATUSES.map((option) => [option.value, option.label]),
);

function StatusChip({ status }: { status: MilestoneStatus }) {
  return (
    <span
      className={cn(
        'shrink-0 border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
        status === 'blocked' && 'border-destructive/40 text-destructive',
        status === 'done' && 'border-success/40 text-success',
        status === 'in-progress' && 'border-border text-foreground-secondary',
        status === 'not-started' && 'border-border text-foreground-muted',
      )}
    >
      {statusLabel.get(status)}
    </span>
  );
}

export function Escalations() {
  const repository = useAppStore((state) => state.repository);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setProjects(await repository.listProjects('work'));
    setIsLoading(false);
  }, [repository]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => collectEscalations(projects), [projects]);
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <div className="page-shell">
      <header className="mb-7 border-b border-border-subtle pb-7">
        <p className="page-kicker">Work / Escalations</p>
        <h1 className="page-title">Raise it early</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-foreground-muted">
          Every milestone flagged for leadership, grouped by who needs to hear it.
          {total > 0 && (
            <span className="ml-2 text-escalate">
              {total} item{total === 1 ? '' : 's'} waiting.
            </span>
          )}
        </p>
      </header>

      {!isLoading && groups.length === 0 && (
        <div className="grid min-h-52 place-items-center border border-dashed border-border-subtle text-center">
          <div>
            <CheckCircle2 className="mx-auto size-6 text-foreground-muted" />
            <p className="mt-3 font-semibold text-foreground-secondary">Nothing to escalate right now.</p>
            <p className="mt-1 text-sm text-foreground-muted">
              Flag a WORK milestone from Projects when it needs leadership attention.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        {groups.map((group) => (
          <Card key={group.target}>
            <CardHeader className="border-b border-border-subtle">
              <div className="flex items-center gap-3">
                <div className="grid size-10 shrink-0 place-items-center border border-escalate/40 bg-escalate/10">
                  <Megaphone className="size-4 text-escalate" />
                </div>
                <CardTitle className="normal-case tracking-normal text-foreground">
                  {group.label}
                </CardTitle>
              </div>
              <span className="text-xs tabular-nums text-foreground-muted">
                {group.items.length} item{group.items.length === 1 ? '' : 's'}
              </span>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="divide-y divide-border-subtle">
                {group.items.map((item) => (
                  <div key={item.milestone.id} className="py-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-foreground-muted">
                      {item.projectTitle}
                    </p>
                    <div className="mt-1 flex items-start justify-between gap-3">
                      <p className="min-w-0 text-sm text-foreground">{item.milestone.text}</p>
                      <StatusChip status={item.milestone.status} />
                    </div>
                    {item.milestone.note && (
                      <p className="mt-2 border-l border-border pl-3 text-sm leading-5 text-foreground-muted">
                        {item.milestone.note}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
