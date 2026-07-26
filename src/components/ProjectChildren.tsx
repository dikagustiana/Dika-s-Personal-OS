import { ChevronDown, ChevronRight } from 'lucide-react';
import { ProjectCard } from './ProjectCard';
import { Progress } from './ui/Progress';
import type { Domain, FinishLineItem, Project, TaskEntry, WeeklyGoal } from '../data/types';
import { rollupMilestones, type ProjectNode } from '../logic/hierarchy';
import { projectAlertState } from '../logic/milestones';
import { cn } from '../lib/utils';

export interface ProjectChildrenProps {
  nodes: ProjectNode[];
  domain: Domain;
  /** Ids currently expanded to their full card. Owned by the view. */
  expanded: ReadonlySet<string>;
  onToggle: (projectId: string) => void;
  tasks?: TaskEntry[];
  goals?: WeeklyGoal[];
  projects?: Project[];
  today?: Date;
  onChange: (updated: Project) => void;
  updateProject: (id: string, patch: Partial<Project>) => Promise<Project>;
  onDelete?: (id: string) => Promise<void>;
  onNavigateToProject?: (projectId: string) => void;
  /**
   * Project whose milestone list should arrive open — the cross-view deep
   * link's target. Passed down at every depth: a needs-action milestone can
   * belong to a nested project, and expanding the ancestor chain only mounts
   * the card, it does not open the list inside it.
   */
  milestonesOpenFor?: string | null;
  /** The finish-line pack — forwarded so nested cards answer "why" too. */
  finishLineItems?: FinishLineItem[];
  onOpenFinishLine?: (itemId: string) => void;
}

function AlertBadge({ alert }: { alert: 'overdue' | 'blocked' }) {
  // Same two-treatment rule the needs-action list uses: both states are red,
  // so the time-critical one is filled and the stuck one is outlined.
  const base =
    'shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider';
  return alert === 'overdue' ? (
    <span className={cn(base, 'bg-destructive text-destructive-foreground')}>Overdue</span>
  ) : (
    <span className={cn(base, 'border border-destructive text-destructive')}>Blocked</span>
  );
}

/**
 * Child projects under a parent card: one compact row each, expanding in place
 * to the complete `ProjectCard`.
 *
 * A full card runs to roughly 700px. The Website initiative has ten children,
 * and the GROWTH forest has more — rendering those as full cards is sixteen
 * thousand pixels of scroll, which is not a page anyone reads. So the default
 * is a row carrying the three facts that decide whether to open it: what it is,
 * how far along it is, and whether anything is late or stuck. Nothing is
 * removed; the full card is one click away, and expansion state lives in the
 * view so navigating to a linked child can open it first.
 */
export function ProjectChildren({
  nodes,
  domain,
  expanded,
  onToggle,
  tasks,
  goals,
  projects,
  today,
  onChange,
  updateProject,
  onDelete,
  onNavigateToProject,
  milestonesOpenFor,
  finishLineItems,
  onOpenFinishLine,
}: ProjectChildrenProps) {
  if (nodes.length === 0) return null;
  const now = today ?? new Date();

  return (
    <ul className="mt-4 space-y-2 border-l-2 border-border-subtle pl-4 sm:pl-6">
      {nodes.map((node) => {
        const rollup = rollupMilestones(node);
        const isOpen = expanded.has(node.project.id);
        const alert = projectAlertState(node.project, now);
        const percent = rollup.total > 0 ? (rollup.done / rollup.total) * 100 : 0;

        return (
          <li key={node.project.id}>
            <button
              type="button"
              onClick={() => onToggle(node.project.id)}
              aria-expanded={isOpen}
              className="flex min-h-11 w-full items-center gap-3 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {isOpen ? (
                <ChevronDown className="size-4 shrink-0 text-foreground-muted" />
              ) : (
                <ChevronRight className="size-4 shrink-0 text-foreground-muted" />
              )}
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                {node.project.title}
              </span>
              {alert && <AlertBadge alert={alert} />}
              <span className="hidden w-24 shrink-0 sm:block">
                <Progress value={percent} className="h-1" />
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-foreground-muted">
                {rollup.done}/{rollup.total}
              </span>
            </button>

            {isOpen && (
              <div className="mb-4 mt-2">
                <ProjectCard
                  project={node.project}
                  domain={domain}
                  tasks={tasks}
                  goals={goals}
                  projects={projects}
                  rollup={rollup}
                  today={today}
                  defaultMilestonesOpen={node.project.id === milestonesOpenFor}
                  onNavigateToProject={onNavigateToProject}
                  updateProject={updateProject}
                  onDelete={onDelete}
                  onChange={onChange}
                  finishLineItems={finishLineItems}
                  onOpenFinishLine={onOpenFinishLine}
                />
                {/* Grandchildren keep the same treatment rather than becoming
                    full cards at depth two. */}
                <ProjectChildren
                  nodes={node.children}
                  domain={domain}
                  milestonesOpenFor={milestonesOpenFor}
                  expanded={expanded}
                  onToggle={onToggle}
                  tasks={tasks}
                  goals={goals}
                  projects={projects}
                  today={today}
                  onChange={onChange}
                  updateProject={updateProject}
                  onDelete={onDelete}
                  onNavigateToProject={onNavigateToProject}
                  finishLineItems={finishLineItems}
                  onOpenFinishLine={onOpenFinishLine}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
