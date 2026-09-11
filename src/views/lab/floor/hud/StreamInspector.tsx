import { useAgentStore } from '../store/agentStore';

function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/** Live view of the transport boundary: connection, counts, last events, last drops. */
export function StreamInspector() {
  const connection = useAgentStore((s) => s.connection);
  const stats = useAgentStore((s) => s.stats);
  const recent = useAgentStore((s) => s.recent);
  const log = useAgentStore((s) => s.transportLog);
  const agentCount = useAgentStore((s) => Object.keys(s.agents).length);
  const statusColor =
    connection.status === 'open' ? 'text-success' : connection.status === 'closed' ? 'text-destructive' : 'text-escalate';
  return (
    <section className="mt-3 border-t border-border pt-3 text-xs" aria-label="Event stream">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-sm">Event stream</span>
        <span className={`tabular-nums ${statusColor}`} aria-live="polite">
          {connection.status}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-4 gap-x-2 tabular-nums">
        <div>
          <dt className="text-foreground-muted">agents</dt>
          <dd>{agentCount}</dd>
        </div>
        <div>
          <dt className="text-foreground-muted">applied</dt>
          <dd>{stats.applied}</dd>
        </div>
        <div>
          <dt className="text-foreground-muted">invalid</dt>
          <dd className={stats.droppedInvalid ? 'text-destructive' : ''}>{stats.droppedInvalid}</dd>
        </div>
        <div>
          <dt className="text-foreground-muted">stale/dup</dt>
          <dd>
            {stats.droppedStale}/{stats.droppedDuplicate}
          </dd>
        </div>
      </dl>
      <ol className="mt-2 max-h-[104px] overflow-hidden tabular-nums text-xs leading-4 text-foreground-muted" aria-label="Recent events">
        {recent
          .slice()
          .reverse()
          .slice(0, 6)
          .map((r) => (
            <li key={r.eventId} className="truncate">
              <span className="text-foreground-muted/70">{clock(r.atMs)}</span> <span className="text-foreground">{r.agentId}</span>{' '}
              <span className={r.state === 'OFFICE_ERROR' ? 'text-destructive' : ''}>{r.state.replace('OFFICE_', '')}</span>
            </li>
          ))}
      </ol>
      {log.length > 0 ? (
        <ol className="mt-2 border-t border-border pt-2 tabular-nums text-xs leading-4" aria-label="Transport log">
          {log
            .slice(-3)
            .reverse()
            .map((l, i) => (
              <li key={`${l.atMs}-${i}`} className={`truncate ${l.level === 'error' ? 'text-destructive' : l.level === 'warn' ? 'text-escalate' : 'text-foreground-muted'}`}>
                {clock(l.atMs)} {l.text}
              </li>
            ))}
        </ol>
      ) : null}
    </section>
  );
}
