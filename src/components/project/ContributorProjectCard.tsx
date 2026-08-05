import { format, parseISO } from 'date-fns';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import type { Project } from '../../data/types';
import { milestoneEnd } from '../../logic/milestones';
import { cn } from '../../lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { TaskSection, type TaskSectionData } from './TaskSection';

/**
 * A GRANTED PROJECT, AS A COLLABORATOR SEES IT.
 *
 * Deliberately its own component rather than a readOnly mode threaded through
 * the owner's ProjectCard: a contributor has no UPDATE or DELETE on
 * os_projects (RLS matches zero rows), so a card offering status selects and
 * edit pencils would be a wall of controls that all fail server-side. This
 * card offers exactly what SQL permits — reading the project, and working its
 * TASKS, which open expanded because they are the reason the grant exists.
 *
 * Milestones render as a read-only list: they are the owner's plan, shown for
 * context. The interactive milestone surface stays owner-only this slice.
 */
const STATUS_LABEL: Record<Project['status'], string> = {
  active: 'aktif',
  paused: 'jeda',
  parked: 'parkir',
  done: 'selesai',
};

export function ContributorProjectCard({
  project,
  taskData,
  today,
}: {
  project: Project;
  taskData: TaskSectionData;
  today?: Date;
}) {
  const [milestonesOpen, setMilestonesOpen] = useState(false);
  const doneCount = project.milestones.filter((milestone) => milestone.done).length;
  const documents = project.documents ?? [];

  return (
    <Card className={cn('min-w-0', project.status !== 'active' && 'opacity-70')}>
      <CardHeader className="flex-col border-b border-border-subtle sm:flex-row">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <CardTitle className="truncate text-base normal-case tracking-normal text-foreground">
              {project.title}
            </CardTitle>
            <span className="shrink-0 rounded-sm border border-border-subtle bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-foreground-muted">
              {STATUS_LABEL[project.status]}
            </span>
          </div>
          {project.targetMetric && (
            <p className="mt-1 text-xs leading-5 text-foreground-muted">{project.targetMetric}</p>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <TaskSection
          projectId={project.id}
          projectTitle={project.title}
          data={taskData}
          today={today}
          defaultOpen
        />

        {project.milestones.length > 0 && (
          <section aria-label={`Milestone ${project.title}`}>
            <button
              type="button"
              onClick={() => setMilestonesOpen((current) => !current)}
              aria-expanded={milestonesOpen}
              className="flex min-h-9 w-full items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {milestonesOpen ? (
                <ChevronDown className="size-4 shrink-0 text-foreground-muted" />
              ) : (
                <ChevronRight className="size-4 shrink-0 text-foreground-muted" />
              )}
              <span className="surface-label">Rencana pemilik</span>
              <span className="text-[11px] tabular-nums text-foreground-muted">
                {doneCount}/{project.milestones.length}
              </span>
            </button>
            {milestonesOpen && (
              <ul className="mt-1.5 space-y-1 border-l-2 border-border-subtle pl-3">
                {project.milestones.map((milestone) => {
                  const end = milestoneEnd(milestone);
                  return (
                    <li key={milestone.id} className="flex items-center gap-2 text-[11px]">
                      <span
                        className={cn(
                          'size-1.5 shrink-0 rounded-full',
                          milestone.done ? 'bg-border' : 'bg-foreground-muted',
                        )}
                        aria-hidden="true"
                      />
                      <span
                        className={cn(
                          'min-w-0 flex-1',
                          milestone.done
                            ? 'text-foreground-muted line-through'
                            : 'text-foreground-secondary',
                        )}
                      >
                        {milestone.text}
                      </span>
                      {end && (
                        <span className="shrink-0 tabular-nums text-foreground-muted">
                          {format(parseISO(end), 'd MMM')}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {documents.length > 0 && (
          <section aria-label={`Dokumen ${project.title}`}>
            <p className="surface-label">Dokumen</p>
            <ul className="mt-1.5 space-y-1">
              {documents.map((document, index) => (
                <li key={`${document.url}-${index}`}>
                  <a
                    href={document.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-primary underline-offset-4 hover:underline"
                  >
                    <ExternalLink className="size-3" />
                    {document.label}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
