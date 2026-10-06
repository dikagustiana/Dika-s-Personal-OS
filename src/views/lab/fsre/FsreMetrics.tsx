/**
 * The metrics bar. Every value is summed from the reducer's companies
 * (runTotals) — none is read from a file and none is stored. Before the
 * first event it shows no number at all: "nothing applied yet" is a
 * sentence, not a row of zeros.
 */
import { Card } from '../../../components/ui/Card';
import { LOCK_GLYPH } from '../../../logic/lab/fsre/glyphs';
import type { FsreContext, FsreState, RunTotals } from '../../../logic/lab/fsre/reducer';
import { figureLabel } from '../../../logic/lab/fsre/statuses';
import { countText, figureTotalText, gateParts, numberText, stageName, tieOutSummary } from '../../../logic/lab/fsre/viewModel';
import { Glyph } from './fsreUi';

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-[8.5rem]">
      <dt className="text-xs text-foreground-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{children}</dd>
    </div>
  );
}

export function FsreMetrics({ ctx, state, totals, applied }: { ctx: FsreContext; state: FsreState; totals: RunTotals; applied: boolean }) {
  if (!applied) {
    return (
      <Card className="mt-6 px-5 py-4" aria-label="Run metrics">
        <p className="text-sm text-foreground-secondary">No event applied yet. Figures appear here as the events that carry them are applied.</p>
      </Card>
    );
  }
  const tieOut = tieOutSummary(totals);
  const facts = figureTotalText(totals, 'factsLoaded');
  return (
    <Card className="mt-6 px-5 py-4" aria-label="Run metrics">
      <dl className="flex flex-wrap gap-x-8 gap-y-3">
        <Metric label="Companies in this run">{numberText(totals.companies)}</Metric>
        <Metric label="Escalations open">
          {totals.escalationsOpen ? (
            <span className="fsre-tone" data-tone="escalated">
              {LOCK_GLYPH} {countText(totals.escalationsOpen, 'escalation')} open
            </span>
          ) : (
            'None open'
          )}
        </Metric>
        {ctx.plan.gateStageIds.map((stageId) => (
          <Metric key={stageId} label={stageName(ctx.plan, stageId) ?? stageId}>
            {gateParts(state, stageId).map((part) => (
              <span key={part.result} className="mr-2 inline-block whitespace-nowrap">
                <Glyph glyph={part.glyph} tone={part.tone} /> {part.text}
              </span>
            ))}
          </Metric>
        ))}
        <Metric label={figureLabel('tieOutChecks')}>{tieOut ?? 'Not reported yet'}</Metric>
        <Metric label="Waiting for the owner">{countText(totals.itemsWaiting, 'item')}</Metric>
        <Metric label={figureLabel('factsLoaded')}>{facts ?? 'Not reported yet'}</Metric>
      </dl>
    </Card>
  );
}
