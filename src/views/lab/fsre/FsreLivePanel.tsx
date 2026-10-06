/**
 * The synthetic office's side panel: a desk (brief v2 WO-3) or the partner
 * room (the engagements, the locked approval, the open escalations).
 *
 * The desk's state badge is the desk's own derived state — the same
 * DeskView the floor draws — so the panel can never say "Working" while the
 * chip says "No signal" or "Escalated" (GLM's panel derived its own, without
 * the escalated and no-signal states).
 *
 * The Approve button computes its lock from event-derived state and is
 * disabled with the reason beside it; the transport stays the authority and
 * a refusal is written out in a status line (FX-6). Every gate line carries
 * its real open count (FX-3).
 *
 * Ported from the GLM workspace (src/panels/LiveSidePanel.tsx at 5b5d186).
 */
import { useState } from 'react';
import type { Agent, Engagement } from '../../../data/fsreTransport/contract';
import { OWNER_ROLE } from '../../../data/fsreTransport/provisional';
import type { DeskView } from '../../../logic/lab/fsre/deskViews';
import { formatHHMM, formatNumber } from '../../../logic/lab/fsre/format';
import { ENGAGEMENT_GLYPHS, ENGAGEMENT_TONES, LOCK_GLYPH } from '../../../logic/lab/fsre/glyphs';
import type { LiveState } from '../../../logic/lab/fsre/liveReducer';
import { escalationsOfAgent } from '../../../logic/lab/fsre/liveReducer';
import { approvalLock, commandsOfAgent, countsText, departmentLabel, gateLine, openCommandCount, queueLine, recentEvents } from '../../../logic/lab/fsre/liveView';
import { ENGAGEMENT_STATUS_WORDS } from '../../../logic/lab/fsre/statuses';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { FsreCommandThread, FsreComposer } from './FsreComposer';
import { Glyph, PanelSection, Quiet, StatusBadge } from './fsreUi';
import { useFsreLiveStore } from './useFsreLiveStore';
import { useFsreOfficeStore } from './useFsreOfficeStore';

/** The version the owner approves. The contract has no field for it yet (an open owner decision), so it stays GLM's. */
const VERSION_TO_APPROVE = 'v1';

function DeskPanel({ agent, desk, state, agents }: { agent: Agent; desk: DeskView | null; state: LiveState; agents: readonly Agent[] }) {
  const view = state.agents[agent.id];
  const escalations = escalationsOfAgent(state, agent.id);
  const commands = commandsOfAgent(state, agent.id);
  const lastSignal = view?.lastSignalAt ?? null;
  const department = departmentLabel(agent);
  const recent = recentEvents(view);
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="surface-label">{department ?? agent.title}</p>
          <h2 className="mt-1 text-base font-semibold text-foreground">
            {agent.title}
            {agent.assignedTicker ? ` — ${agent.assignedTicker}` : ''}
          </h2>
          <p className="text-xs text-foreground-secondary">{agent.skills.join(', ') || 'No skills listed'}</p>
        </div>
        {desk ? <StatusBadge glyph={desk.glyph} word={desk.stateWord} tone={desk.tone} /> : null}
      </div>

      <PanelSection title="Current task">{view?.currentTask ? <p className="text-foreground">{view.currentTask}</p> : <Quiet>No open task.</Quiet>}</PanelSection>

      <PanelSection title="Source being read">
        {view?.sourceRef ? (
          <p className="text-foreground">
            {view.sourceRef.docId}
            {view.sourceRef.page !== null ? `, page ${formatNumber(view.sourceRef.page)}` : ''}
            {view.sourceRef.note ? ` — ${view.sourceRef.note}` : ''}
          </p>
        ) : (
          <Quiet>No document open.</Quiet>
        )}
      </PanelSection>

      <PanelSection title={lastSignal ? `Last events (last signal ${formatHHMM(lastSignal)})` : 'Last events'}>
        {recent.length ? (
          <ul className="space-y-2">
            {recent.map((event) => (
              <li key={event.id} className="border-b border-border-subtle pb-1.5 last:border-b-0">
                <time className="mr-2 font-mono text-xs text-foreground-secondary">{formatHHMM(event.at)}</time>
                <span className="text-foreground">{event.summary}</span>
                {countsText(event.counts) ? <span className="ml-1 text-xs text-foreground-secondary">({countsText(event.counts)})</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <Quiet>No events yet.</Quiet>
        )}
      </PanelSection>

      <PanelSection title="Queue">
        <p className="text-foreground">{queueLine(view?.queueDepth ?? null, openCommandCount(commands))}</p>
      </PanelSection>

      {view?.waitingOn ? (
        <PanelSection title="Waiting on">
          <p className="text-foreground">{state.agents[view.waitingOn]?.agent.title ?? view.waitingOn}</p>
        </PanelSection>
      ) : null}

      <PanelSection title="Escalations">
        <p className="fsre-tone" data-tone={escalations.open ? 'escalated' : 'neutral'}>
          {escalations.open ? <Glyph glyph={LOCK_GLYPH} tone="escalated" /> : null} {`Opened ${formatNumber(escalations.opened)} · Open ${formatNumber(escalations.open)} · Closed ${formatNumber(escalations.closed)}`}
        </p>
      </PanelSection>

      <PanelSection title={`Command thread (${formatNumber(commands.length)})`}>
        <FsreCommandThread commands={commands} />
      </PanelSection>

      {agent.role !== OWNER_ROLE ? <FsreComposer agent={agent} agents={agents} engagementId={view?.currentEngagementId ?? null} /> : null}
    </div>
  );
}

function EngagementItem({ engagement, state, onApprove, refusal }: { engagement: Engagement; state: LiveState; onApprove: (id: string) => void; refusal: string | null }) {
  const waiting = engagement.status === 'waiting_owner';
  const lock = waiting ? approvalLock(state, engagement) : null;
  return (
    <li className="rounded-sm border border-border-subtle p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground">
          {engagement.plan.subIndustryName} · {engagement.plan.tickers.join(' + ')}
        </span>
        <StatusBadge glyph={ENGAGEMENT_GLYPHS[engagement.status]} word={ENGAGEMENT_STATUS_WORDS[engagement.status]} tone={ENGAGEMENT_TONES[engagement.status]} />
      </div>
      {waiting ? (
        <div className="mt-2">
          <p className="text-xs text-foreground">
            {engagement.plan.tickers.map((ticker) => (
              <span key={ticker} className="block">
                {gateLine(state, engagement, ticker)}
              </span>
            ))}
          </p>
          <Button type="button" className="mt-2 min-h-11" onClick={() => onApprove(engagement.id)} disabled={lock !== null}>
            Approve version {VERSION_TO_APPROVE}
          </Button>
          {lock ? (
            <p className="fsre-tone mt-1 text-xs" data-tone="escalated">
              <Glyph glyph={LOCK_GLYPH} tone="escalated" /> {lock}
            </p>
          ) : (
            <p className="mt-1 text-xs text-foreground-secondary">Only the owner approves.</p>
          )}
          {refusal ? (
            <p role="status" className="fsre-tone mt-1 text-xs" data-tone="escalated">
              {refusal}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function PartnerRoom({ state }: { state: LiveState }) {
  const engagements = useFsreLiveStore((s) => s.engagements);
  const transport = useFsreLiveStore((s) => s.transport);
  const refreshLists = useFsreLiveStore((s) => s.refreshLists);
  const [refusals, setRefusals] = useState<Record<string, string>>({});
  const openEscalations = state.escalations.filter((escalation) => escalation.closedAt === null);

  const approve = async (engagementId: string) => {
    if (!transport) return;
    const result = await transport.approveVersion(engagementId, VERSION_TO_APPROVE);
    setRefusals((previous) => {
      const next = { ...previous };
      if (!result.ok && result.lockedReason) next[engagementId] = result.lockedReason;
      else delete next[engagementId];
      return next;
    });
    await refreshLists();
  };

  return (
    <div>
      <p className="surface-label">4F</p>
      <h2 className="mt-1 text-base font-semibold text-foreground">Partner room</h2>

      <PanelSection title={`Engagements (${formatNumber(engagements.length)})`}>
        {engagements.length ? (
          <ul className="space-y-2">
            {engagements.map((engagement) => (
              <EngagementItem key={engagement.id} engagement={engagement} state={state} onApprove={approve} refusal={refusals[engagement.id] ?? null} />
            ))}
          </ul>
        ) : (
          <Quiet>No engagements yet.</Quiet>
        )}
      </PanelSection>

      <PanelSection title={`Open escalations (${formatNumber(openEscalations.length)})`}>
        {openEscalations.length ? (
          <ul className="space-y-2">
            {openEscalations.map((escalation) => (
              <li key={escalation.id} className="rounded-sm border border-escalate/40 bg-escalate/5 p-2.5">
                <p className="fsre-tone text-xs font-semibold" data-tone="escalated">
                  <Glyph glyph={LOCK_GLYPH} tone="escalated" /> Escalation · opened {formatHHMM(escalation.openedAt)}
                </p>
                <p className="mt-0.5 text-sm font-medium text-foreground">{escalation.summary}</p>
              </li>
            ))}
          </ul>
        ) : (
          <Quiet>Nothing is waiting.</Quiet>
        )}
        <p className="mt-2 text-xs text-foreground-secondary">
          To resolve an escalation, send the review lead an override with your decision; the workpaper records it as an owner instruction.
        </p>
      </PanelSection>
    </div>
  );
}

export function FsreLivePanel({ agents, state, desks }: { agents: readonly Agent[]; state: LiveState; desks: (agentId: string) => DeskView | null }) {
  const selection = useFsreOfficeStore((s) => s.selection);
  const select = useFsreOfficeStore((s) => s.select);
  let body: React.ReactNode;
  if (selection?.kind === 'seat') {
    const agent = agents.find((a) => a.id === selection.agentId);
    body = agent ? <DeskPanel agent={agent} desk={desks(agent.id)} state={state} agents={agents} /> : <Quiet>That desk has left the roster.</Quiet>;
  } else if (selection?.kind === 'partner') {
    body = <PartnerRoom state={state} />;
  } else {
    body = <Quiet>Select a desk in the building, or the partner room.</Quiet>;
  }
  return (
    <Card className="p-5" aria-label="Details">
      {body}
      {selection ? (
        <button type="button" className="mt-4 min-h-11 text-xs text-foreground-secondary underline" onClick={() => select(null)}>
          Clear selection
        </button>
      ) : null}
    </Card>
  );
}
