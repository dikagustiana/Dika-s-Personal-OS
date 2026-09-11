import { useEffect, useRef } from 'react';
import type { LogLine } from '../../../../../logic/floor/events/reducer';

function stamp(ts: string): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/** Streaming log for one agent: state transitions, progress, errors. Follows the tail. */
export function Console({ lines, maxLines = 40 }: { lines: LogLine[]; maxLines?: number }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);
  const shown = lines.slice(-maxLines);
  if (shown.length === 0) return <p className="text-xs text-foreground-muted">Waiting for the first event.</p>;
  return (
    <ol ref={ref} className="max-h-[132px] overflow-y-auto tabular-nums text-xs leading-4" aria-label="Agent log" aria-live="polite">
      {shown.map((l, i) => (
        <li key={`${l.atMs}-${i}`} className={l.kind === 'error' || l.kind === 'unknown' ? 'text-destructive' : l.kind === 'state' ? 'text-foreground' : 'text-foreground-muted'}>
          <span className="text-foreground-muted/70">{stamp(l.timestamp)}</span> {l.text}
        </li>
      ))}
    </ol>
  );
}
