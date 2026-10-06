/**
 * The synthetic office's summary card (brief v2 WO-2: "derive every number
 * from events and use the shared vocabulary"). Every value comes from
 * summaryCard (liveView.ts): facts loaded summed per company, escalations
 * open counted from the escalation list, the gates of the engagement the card
 * names in its labels — the filtered one, else the oldest live one (FX-7) —
 * each with its real open count (FX-3).
 */
import type { Engagement } from '../../../data/fsreTransport/contract';
import { Card } from '../../../components/ui/Card';
import { formatCount, formatNumber } from '../../../logic/lab/fsre/format';
import { LIVE_GATE_GLYPHS, LIVE_GATE_TONES, LOCK_GLYPH } from '../../../logic/lab/fsre/glyphs';
import type { LiveState } from '../../../logic/lab/fsre/liveReducer';
import { summaryCard } from '../../../logic/lab/fsre/liveView';
import { NO_LIVE_ENGAGEMENT_WORD, figureLabel, gateStatusLabel } from '../../../logic/lab/fsre/statuses';
import { Glyph } from './fsreUi';

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-[8.5rem]">
      <dt className="text-xs text-foreground-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{children}</dd>
    </div>
  );
}

export function FsreLiveMetrics({ state, engagements, filterEngagementId }: { state: LiveState; engagements: readonly Engagement[]; filterEngagementId: string | null }) {
  const card = summaryCard(state, engagements, filterEngagementId);
  return (
    <Card className="mt-4 px-5 py-4" aria-label="Run metrics">
      <dl className="flex flex-wrap gap-x-8 gap-y-3">
        <Metric label="Companies in engagements">{formatNumber(card.companies)}</Metric>
        <Metric label="Escalations open">
          {card.escalationsOpen ? (
            <span className="fsre-tone" data-tone="escalated">
              {LOCK_GLYPH} {formatCount(card.escalationsOpen, 'escalation')} open
            </span>
          ) : (
            'None open'
          )}
        </Metric>
        {card.focus ? (
          card.gates.map((gate) => (
            <Metric key={gate.label} label={gate.label}>
              <Glyph glyph={LIVE_GATE_GLYPHS[gate.status]} tone={LIVE_GATE_TONES[gate.status]} /> {gateStatusLabel(gate.status, gate.open)}
            </Metric>
          ))
        ) : (
          // With nothing running, the gates speak for no engagement: say so, not "Pending".
          <Metric label="Gates">{NO_LIVE_ENGAGEMENT_WORD}</Metric>
        )}
        <Metric label="Waiting for the owner">{formatCount(card.waitingOwner, 'engagement')}</Metric>
        <Metric label={figureLabel('factsLoaded')}>{formatNumber(card.factsLoaded)}</Metric>
      </dl>
    </Card>
  );
}
