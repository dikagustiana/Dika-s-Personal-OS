'use client';
import { useEffect, useState } from 'react';
import { isKnownState } from '@/core/events/schema';
import { useAgentStore } from '@/stores/agentStore';
import { useUiStore } from '@/stores/uiStore';
import { Console } from './Console';
import { OutputPreview } from './OutputPreview';
import { TokenGraph } from './TokenGraph';

const DEPARTMENT_COLORS: Record<string, string> = {
  'Engineering Bay': '#4f8fd8',
  'Research Bay': '#8f6fd8',
  'Creative Bay': '#e0a04a',
  'QA Bay': '#4fb08a',
  'Executive Office': '#d85f6f',
};

const STATE_LABEL: Record<string, string> = {
  OFFICE_IDLE: 'Idle',
  OFFICE_WALKING: 'Walking',
  OFFICE_WORKING: 'Working',
  OFFICE_COLLABORATING: 'In a meeting',
  OFFICE_DELIVERING: 'Delivering',
  OFFICE_ERROR: 'Error',
};

function stateStyle(state: string): string {
  if (!isKnownState(state) || state === 'OFFICE_ERROR') return 'bg-error text-[#0f1420]';
  if (state === 'OFFICE_WORKING') return 'bg-accent text-[#0f1420]';
  if (state === 'OFFICE_COLLABORATING') return 'bg-accent/25 text-accent';
  if (state === 'OFFICE_DELIVERING') return 'bg-warn/25 text-warn';
  return 'bg-white/10 text-ink-muted';
}

function useSecondsAgo(ms: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return Math.max(0, Math.round((now - ms) / 1000));
}

export interface InspectorPanelProps {
  agentId: string;
  onClose: () => void;
  onOpenOutput: (taskId: string) => void;
}

/** Live telemetry for one agent: state, task, progress, tokens, log, output. Everything here comes from the stream or the REST API. */
export function InspectorPanel({ agentId, onClose, onOpenOutput }: InspectorPanelProps) {
  const record = useAgentStore((s) => s.agents[agentId]);
  const connection = useAgentStore((s) => s.connection.status);
  const following = useUiStore((s) => s.followAgentId === agentId);
  const setFollow = useUiStore((s) => s.setFollowAgentId);
  const ago = useSecondsAgo(record?.appliedAtMs ?? Date.now());
  if (!record) {
    return (
      <div className="bc-panel w-[360px] p-3 text-sm">
        <p>This agent has not sent an event yet.</p>
        <button type="button" className="mt-2 rounded-panel border border-white/10 px-2 py-1 text-xs" onClick={onClose}>
          Close
        </button>
      </div>
    );
  }
  const ev = record.latest;
  const t = ev.taskDetails;
  const color = DEPARTMENT_COLORS[t.department] ?? '#9aa6b8';
  const stateLabel = isKnownState(ev.currentState) ? STATE_LABEL[ev.currentState] : `Unknown state`;
  return (
    <section className="bc-panel w-[380px] text-sm" aria-label={`Inspector for ${agentId}`} data-bc-inspector>
      <header className="flex items-start gap-3 border-b border-white/10 p-3">
        <span className="mt-1 h-9 w-1 shrink-0 rounded-sm" style={{ background: color }} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold leading-6">{agentId.replace(/^agent-/, '')}</h2>
          <p className="truncate text-xs text-ink-muted">
            {ev.agentRole} · {t.department}
          </p>
        </div>
        <button type="button" className="rounded-panel border border-white/10 px-2 py-0.5 text-xs text-ink-muted hover:border-accent hover:text-ink" onClick={onClose} aria-label="Close inspector">
          ✕
        </button>
      </header>

      <div className="space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-panel px-2 py-0.5 font-mono text-2xs ${stateStyle(ev.currentState)}`}>{stateLabel}</span>
          {!isKnownState(ev.currentState) ? <span className="font-mono text-2xs text-error">{ev.currentState}</span> : null}
          {ev.collaborationGroupId ? <span className="font-mono text-2xs text-ink-muted">group {ev.collaborationGroupId}</span> : null}
          <span className="ml-auto font-mono text-2xs text-ink-muted" aria-live="off">
            {connection === 'open' ? `updated ${ago}s ago` : `stream ${connection}`}
          </span>
        </div>

        <div>
          <p className="truncate font-semibold">{t.title || (ev.currentTaskId ? ev.currentTaskId : 'No task assigned')}</p>
          <p className={`truncate text-xs ${ev.currentState === 'OFFICE_ERROR' ? 'text-error' : 'text-ink-muted'}`}>
            {ev.currentState === 'OFFICE_ERROR' ? `Failed: ${t.activeSubtask || 'no detail sent'}. Waiting for the agent to recover.` : t.activeSubtask || '—'}
          </p>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(t.progressPercentage)} aria-label="Task progress">
            <div className={`h-full ${ev.currentState === 'OFFICE_ERROR' ? 'bg-error' : 'bg-accent'}`} style={{ width: `${Math.min(100, Math.max(0, t.progressPercentage))}%` }} />
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-2 font-mono text-2xs">
          <div>
            <dt className="text-ink-muted">progress</dt>
            <dd>{Math.round(t.progressPercentage)}%</dd>
          </div>
          <div>
            <dt className="text-ink-muted">tokens</dt>
            <dd>{t.tokensUsed.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">task</dt>
            <dd className="truncate">{ev.currentTaskId ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">at hex</dt>
            <dd>
              ({ev.currentLocationHex.q}, {ev.currentLocationHex.r})
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">heading to</dt>
            <dd>{ev.targetDestinationHex ? `(${ev.targetDestinationHex.q}, ${ev.targetDestinationHex.r})` : '—'}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">events</dt>
            <dd>{record.log.length}</dd>
          </div>
        </dl>

        <div>
          <div className="mb-1 flex items-baseline justify-between text-2xs text-ink-muted">
            <span>Token usage</span>
            <span className="font-mono">{t.tokensUsed.toLocaleString()}</span>
          </div>
          <TokenGraph samples={record.tokenHistory} width={356} />
        </div>

        <div>
          <div className="mb-1 text-2xs text-ink-muted">Console</div>
          <Console lines={record.log} />
        </div>

        <div>
          <div className="mb-1 text-2xs text-ink-muted">Output</div>
          <OutputPreview taskId={ev.currentTaskId} progress={t.progressPercentage} onOpen={onOpenOutput} />
        </div>
      </div>

      <footer className="flex items-center gap-2 border-t border-white/10 p-3">
        <button
          type="button"
          className={`rounded-panel px-2.5 py-1 text-xs font-semibold ${following ? 'bg-accent text-[#0f1420]' : 'border border-white/10 text-ink hover:border-accent'}`}
          aria-pressed={following}
          onClick={() => setFollow(following ? null : agentId)}
        >
          {following ? 'Following' : 'Follow camera'}
        </button>
        <span className="ml-auto text-2xs text-ink-muted">Esc closes</span>
      </footer>
    </section>
  );
}
