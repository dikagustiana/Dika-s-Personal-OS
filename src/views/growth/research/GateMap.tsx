import type { ResearchProject } from '../../../data/types';
import { critIND, curStage, gatePass } from '../../../logic/research/pipeline';
import { templateOf } from '../../../logic/research/templates';
import { cn } from '../../../lib/utils';

export interface GateMapProps {
  projects: ResearchProject[];
  onSelect: (projectId: string) => void;
}

/**
 * Rows are projects, columns are stages.
 *
 * Deliberately NOT a progress bar. A bar answers "how far along", which is the
 * question that matters least here: two projects at 60% can be in completely
 * different trouble, and the cell states are what say which. Filled = gate
 * passed, partial fill = the proportion of criteria checked, thick border =
 * the stage being worked, hazard stripe = an open blocker at stage 00. A bar
 * collapses all four into one number and throws the diagnosis away.
 */
export function GateMap({ projects, onSelect }: GateMapProps) {
  if (projects.length === 0) return null;
  const widest = Math.max(
    ...projects.map((item) => templateOf(item.meta.template).stages.length),
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] border-separate border-spacing-0 text-left">
        <thead>
          <tr>
            <th scope="col" className="surface-label pb-2 pr-3 font-normal">
              Project
            </th>
            {Array.from({ length: widest }, (_, index) => (
              <th
                key={index}
                scope="col"
                className="pb-2 pr-1 text-center font-mono text-[10px] font-normal tabular-nums text-foreground-muted"
              >
                {String(index).padStart(2, '0')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {projects.map((research) => {
            const stages = templateOf(research.meta.template).stages;
            const current = curStage(research);
            const blocked = critIND(research).length > 0;

            return (
              <tr key={research.project.id}>
                <th scope="row" className="max-w-[14rem] py-1 pr-3 font-normal">
                  <button
                    type="button"
                    onClick={() => onSelect(research.project.id)}
                    className="block max-w-full truncate text-left text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {research.project.title}
                  </button>
                </th>
                {Array.from({ length: widest }, (_, index) => {
                  const stage = stages[index];
                  if (!stage) return <td key={index} className="py-1 pr-1" />;

                  const gate = research.meta.gates[index] ?? [];
                  const checked = gate.filter(Boolean).length;
                  const passed = gatePass(research, index);
                  const proportion = gate.length > 0 ? checked / gate.length : 0;
                  const isCurrent = index === current;
                  const hazard = index === 0 && blocked && !passed;

                  return (
                    <td key={index} className="py-1 pr-1">
                      <span
                        title={`${stage.n} ${stage.t} — ${checked}/${gate.length}${hazard ? ' · blocker open' : ''}`}
                        className={cn(
                          'relative mx-auto block h-6 w-full min-w-6 overflow-hidden rounded-sm border',
                          passed ? 'border-success' : 'border-border',
                          isCurrent && 'border-2 border-foreground-secondary',
                          hazard && 'gate-hazard border-destructive',
                        )}
                      >
                        {!hazard && (
                          <span
                            className={cn(
                              'absolute inset-y-0 left-0 block',
                              passed ? 'bg-success' : 'bg-success/35',
                            )}
                            style={{ width: `${Math.round(proportion * 100)}%` }}
                          />
                        )}
                        <span className="sr-only">
                          {stage.n}: {checked} of {gate.length} criteria
                          {hazard ? ', blocker open' : ''}
                        </span>
                      </span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
