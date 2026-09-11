import { useEffect, useState } from 'react';
import { isKnownState } from '../../../../../logic/floor/events/schema';
import { useAgentStore } from '../../store/agentStore';
import { useUiStore } from '../../store/uiStore';
import { Console } from './Console';
import { OutputPreview } from './OutputPreview';
import { TokenGraph } from './TokenGraph';
import { departmentColor } from '../../../../../logic/floor/theme/palette';

const STATE_LABEL: Record<string, string> = {
  OFFICE_IDLE: 'Idle',
  OFFICE_WALKING: 'Walking',
  OFFICE_WORKING: 'Working',
  OFFICE_COLLABORATING: 'In a meeting',
  OFFICE_DELIVERING: 'Delivering',
  OFFICE_ERROR: 'Error',
};

function stateStyle(state: string): string {
  if (!isKnownState(state) || state === 'OFFICE_ERROR') return 'bg-destructive text-destructive-foreground';
  if (state === 'OFFICE_WORKING') return 'bg-primary text-primary-foreground';
  if (state === 'OFFICE_COLLABORATING') return 'bg-primary/25 text-primary';
  if (state === 'OFFICE_DELIVERING') return 'bg-escalate/20 text-escalate';
  return 'bg-surface-3 text-foreground-muted';
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
      <div className="floor-panel w-[360px] p-3 text-sm">
        <p>This agent has not sent an event yet.</p>
        <button type="button" className="mt-2 rounded-md border border-border px-2 py-1 text-xs" onClick={onClose}>
          Close
        </button>
      </div>
    );
  }
  const ev = record.latest;
  const t = ev.taskDetails;
  const color = departmentColor(t.department);
  const stateLabel = isKnownState(ev.currentState) ? STATE_LABEL[ev.currentState] : `Unknown state`;
  return (
    <section className="floor-panel w-[380px] text-sm" aria-label={`Inspector for ${agentId}`} data-floor-inspector>
      <header className="flex items-start gap-3 border-b border-border p-3">
        <span className="mt-1 h-9 w-1 shrink-0 rounded-sm" style={{ background: color }} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold leading-6">{agentId.replace(/^agent-/, '')}</h2>
          <p className="truncate text-xs text-foreground-muted">
            {ev.agentRole} · {t.department}
          </p>
        </div>
        <button type="button" className="rounded-md border border-border px-2 py-0.5 text-xs text-foreground-muted hover:border-primary hover:text-foreground" onClick={onClose} aria-label="Close inspector">
          ✕
        </button>
      </header>

      <div className="space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-md px-2 py-0.5 tabular-nums text-xs ${stateStyle(ev.currentState)}`}>{stateLabel}</span>
          {!isKnownState(ev.currentState) ? <span className="tabular-nums text-xs text-destructive">{ev.currentState}</span> : null}
          {ev.collaborationGroupId ? <span className="tabular-nums text-xs text-foreground-muted">group {ev.collaborationGroupId}</span> : null}
          <span className="ml-auto tabular-nums text-xs text-foreground-muted" aria-live="off">
            {connection === 'open' ? `updated ${ago}s ago` : `stream ${connection}`}
          </span>
        </div>

        <div>
          <p className="truncate font-semibold">{t.title || (ev.currentTaskId ? ev.currentTaskId : 'No task assigned')}</p>
          <p className={`truncate text-xs ${ev.currentState === 'OFFICE_ERROR' ? 'text-destructive' : 'text-foreground-muted'}`}>
            {ev.currentState === 'OFFICE_ERROR' ? `Failed: ${t.activeSubtask || 'no detail sent'}. Waiting for the agent to recover.` : t.activeSubtask || '—'}
          </p>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(t.progressPercentage)} aria-label="Task progress">
            <div className={`h-full ${ev.currentState === 'OFFICE_ERROR' ? 'bg-destructive' : 'bg-primary'}`} style={{ width: `${Math.min(100, Math.max(0, t.progressPercentage))}%` }} />
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-2 tabular-nums text-xs">
          <div>
            <dt className="text-foreground-muted">progress</dt>
            <dd>{Math.round(t.progressPercentage)}%</dd>
          </div>
          <div>
            <dt className="text-foreground-muted">tokens</dt>
            <dd>{t.tokensUsed.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-foreground-muted">task</dt>
            <dd className="truncate">{ev.currentTaskId ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-foreground-muted">at hex</dt>
            <dd>
              ({ev.currentLocationHex.q}, {ev.currentLocationHex.r})
            </dd>
          </div>
          <div>
            <dt className="text-foreground-muted">heading to</dt>
            <dd>{ev.targetDestinationHex ? `(${ev.targetDestinationHex.q}, ${ev.targetDestinationHex.r})` : '—'}</dd>
          </div>
          <div>
            <dt className="text-foreground-muted">events</dt>
            <dd>{record.log.length}</dd>
          </div>
        </dl>

        <div>
          <div className="mb-1 flex items-baseline justify-between text-xs text-foreground-muted">
            <span>Token usage</span>
            <span className="tabular-nums">{t.tokensUsed.toLocaleString()}</span>
          </div>
          <TokenGraph samples={record.tokenHistory} width={356} />
        </div>

        <div>
          <div className="mb-1 text-xs text-foreground-muted">Console</div>
          <Console lines={record.log} />
        </div>

        <div>
          <div className="mb-1 text-xs text-foreground-muted">Output</div>
          <OutputPreview taskId={ev.currentTaskId} progress={t.progressPercentage} onOpen={onOpenOutput} />
        </div>
      </div>

      <footer className="flex items-center gap-2 border-t border-border p-3">
        <button
          type="button"
          className={`rounded-md px-2.5 py-1 text-xs font-semibold ${following ? 'bg-primary text-primary-foreground' : 'border border-border text-foreground hover:border-primary'}`}
          aria-pressed={following}
          onClick={() => setFollow(following ? null : agentId)}
        >
          {following ? 'Following' : 'Follow camera'}
        </button>
        <span className="ml-auto text-xs text-foreground-muted">Esc closes</span>
      </footer>
    </section>
  );
}
