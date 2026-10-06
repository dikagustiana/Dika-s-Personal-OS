/**
 * The synthetic office's two dialogs, on this app's modal pattern (a scrim
 * in the `black` token, the one colour kept for scrims; a card; Escape and a
 * click outside close it).
 *
 *   "Message an agent" (brief v2 WO-3): the composer, with an agent picker.
 *   The owner's desk is not offered: the owner does not command themselves.
 *
 *   "New engagement" (WO-4): free text in, a plan card out — sub-industry and
 *   chain position, the peer pair, archetype status, conflict check, filings
 *   found, blocked reasons — then Start (disabled, with the reason, when
 *   blocked or excluded) or Cancel.
 *
 * Ported from the GLM workspace (src/panels/ComposerDialog.tsx and
 * EngagementDialog.tsx at 5b5d186).
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { Engagement } from '../../../data/fsreTransport/contract';
import { OWNER_ROLE } from '../../../data/fsreTransport/provisional';
import { formatCount } from '../../../logic/lab/fsre/format';
import { ENGAGEMENT_GLYPHS, ENGAGEMENT_TONES } from '../../../logic/lab/fsre/glyphs';
import { chainPositionText } from '../../../logic/lab/fsre/liveView';
import { ENGAGEMENT_STATUS_WORDS } from '../../../logic/lab/fsre/statuses';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { FsreComposer } from './FsreComposer';
import { FigureRow, StatusBadge } from './fsreUi';
import { useFsreLiveStore } from './useFsreLiveStore';
import { useFsreOfficeStore } from './useFsreOfficeStore';

function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-6" role="presentation" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={label} className="w-full max-w-lg rounded-lg border border-border bg-card p-5 shadow-card">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-foreground">{label}</h2>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label={`Close: ${label}`}>
            ✕
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function FsreComposerDialog() {
  const open = useFsreOfficeStore((s) => s.composer.open);
  const presetAgentId = useFsreOfficeStore((s) => s.composer.agentId);
  const closeComposer = useFsreOfficeStore((s) => s.closeComposer);
  const agents = useFsreLiveStore((s) => s.agents);
  const state = useFsreLiveStore((s) => s.state);
  const [pickedId, setPickedId] = useState<string | null>(null);
  if (!open) return null;
  const agent = agents.find((a) => a.id === (presetAgentId ?? pickedId)) ?? null;
  const commandable = agents.filter((a) => a.role !== OWNER_ROLE);
  const close = () => {
    closeComposer();
    setPickedId(null);
  };
  return (
    <Modal label="Message an agent" onClose={close}>
      {agent ? (
        <FsreComposer agent={agent} agents={agents} engagementId={state.agents[agent.id]?.currentEngagementId ?? null} onSent={close} />
      ) : (
        <label className="mt-3 block text-sm">
          <span className="text-foreground-secondary">To</span>
          <select
            aria-label="Pick an agent"
            className="mt-1 min-h-11 w-full rounded-sm border border-border bg-card px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            defaultValue=""
            onChange={(event) => setPickedId(event.target.value || null)}
          >
            <option value="" disabled>
              Pick an agent…
            </option>
            {commandable.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
                {a.assignedTicker ? ` (${a.assignedTicker})` : ''}
              </option>
            ))}
          </select>
        </label>
      )}
    </Modal>
  );
}

function PlanCard({ plan, started, busy, onStart, onCancel }: { plan: Engagement; started: boolean; busy: boolean; onStart: () => void; onCancel: () => void }) {
  const progress = useFsreLiveStore((s) => s.progress);
  const blocked = Boolean(plan.plan.blockedReasons.length);
  const reasons = plan.plan.blockedReasons.join('; ');
  return (
    <section className="mt-4 rounded-lg border border-border bg-surface-2 p-3" aria-label="Plan">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Plan: {plan.plan.subIndustryName}</h3>
        <StatusBadge glyph={ENGAGEMENT_GLYPHS[plan.status]} word={ENGAGEMENT_STATUS_WORDS[plan.status]} tone={ENGAGEMENT_TONES[plan.status]} />
      </div>
      <div className="mt-2 text-sm">
        <FigureRow label="Chain position" value={chainPositionText(plan.plan.chainNodeId, plan.plan.subIndustryCode, progress)} />
        <FigureRow label="Peer pair" value={plan.plan.tickers.join(' + ')} />
        <FigureRow label="Archetype" value={plan.plan.archetype.status === 'available' ? `${plan.plan.archetype.id ?? ''} — available` : 'Missing — not built yet'} />
        <FigureRow label="Conflict check" value={plan.plan.conflictCheck.result === 'clear' ? 'Clear' : `Excluded — ${plan.plan.conflictCheck.reason ?? ''}`} />
        <FigureRow label="Filings found" value={formatCount(plan.plan.filingsFound.length, 'document')} />
        <FigureRow label="Blocked reasons" value={blocked ? reasons : 'None — the engagement can start'} />
      </div>
      {started ? (
        <p role="status" className="fsre-tone mt-3 text-sm" data-tone="done">
          ✓ Engagement started: staff desks are assigned and events are arriving.
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" className="min-h-11" onClick={onStart} disabled={busy || blocked || started} title={blocked ? `Blocked: ${reasons}` : undefined}>
          Start engagement
        </Button>
        <Button type="button" variant="secondary" className="min-h-11" onClick={onCancel} disabled={busy || started}>
          Cancel
        </Button>
      </div>
      {blocked ? (
        <p className="fsre-tone mt-2 text-xs" data-tone="stalled">
          Start is disabled: {reasons}.
        </p>
      ) : null}
    </section>
  );
}

export function FsreEngagementDialog() {
  const open = useFsreOfficeStore((s) => s.engagementDialog.open);
  const prefilledText = useFsreOfficeStore((s) => s.engagementDialog.prefilledText);
  const closeEngagementDialog = useFsreOfficeStore((s) => s.closeEngagementDialog);
  const transport = useFsreLiveStore((s) => s.transport);
  const refreshLists = useFsreLiveStore((s) => s.refreshLists);
  const [text, setText] = useState(prefilledText);
  const [plan, setPlan] = useState<Engagement | null>(null);
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A new opening starts clean, possibly prefilled from the industries board.
  useEffect(() => {
    if (!open) return;
    setText(prefilledText);
    setPlan(null);
    setStarted(false);
    setError(null);
  }, [open, prefilledText]);

  if (!open) return null;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const propose = () =>
    run(async () => {
      if (!transport || !text.trim()) return;
      // A plan proposed here and never started is withdrawn when another replaces it (review R10).
      if (plan && !started && (plan.status === 'proposed' || plan.status === 'blocked')) await transport.cancelEngagement(plan.id);
      setPlan(null);
      setStarted(false);
      setPlan(await transport.proposeEngagement(text.trim()));
      await refreshLists();
    });
  const start = () =>
    run(async () => {
      if (!transport || !plan) return;
      // The card shows the engagement as it now is (Running), not the proposal it was (FX-14).
      setPlan(await transport.startEngagement(plan.id));
      setStarted(true);
      await refreshLists();
    });
  const cancel = () =>
    run(async () => {
      if (!transport || !plan) return;
      await transport.cancelEngagement(plan.id);
      await refreshLists();
      closeEngagementDialog();
    });

  // Closing with ✕ or Escape withdraws a plan that was proposed and never started, as
  // Cancel does, so stale proposals do not pile up in the partner room (FX-14).
  const close = () => {
    if (transport && plan && !started && (plan.status === 'proposed' || plan.status === 'blocked')) {
      void transport.cancelEngagement(plan.id).then(() => refreshLists());
    }
    closeEngagementDialog();
  };

  return (
    <Modal label="New engagement" onClose={close}>
      <label className="mt-3 block text-sm">
        <span className="text-foreground-secondary">Ticker or company name (free text)</span>
        <div className="mt-1 flex gap-2">
          <Input
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void propose();
              }
            }}
            aria-label="Ticker or company name"
            placeholder="e.g. SYNC or Synthetic steel"
          />
          <Button type="button" variant="secondary" className="min-h-11" onClick={() => void propose()} disabled={busy || !text.trim()}>
            Propose
          </Button>
        </div>
      </label>
      {error ? (
        <p role="alert" className="fsre-tone mt-2 text-sm" data-tone="escalated">
          {error}
        </p>
      ) : null}
      {plan ? <PlanCard plan={plan} started={started} busy={busy} onStart={() => void start()} onCancel={() => void cancel()} /> : null}
    </Modal>
  );
}
