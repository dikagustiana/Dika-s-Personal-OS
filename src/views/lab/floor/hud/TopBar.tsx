import { formatHour } from '../../../../logic/floor/time/clock';
import { useUiStore } from '../store/uiStore';
import { FleetSummary } from './FleetSummary';

const PRESET_LABEL: Record<string, string> = {
  MORNING: 'Morning',
  MIDDAY: 'Midday',
  DUSK: 'Sunset',
  NIGHT: 'Late shift',
};

export function TopBar({
  brief,
  status,
  phantoms,
  mock = false,
  redaction = '',
}: {
  brief: { question: string; weightClass: string; status: string; routing: string[] } | null;
  status: 'connecting' | 'open' | 'closed' | 'error';
  phantoms: number;
  /** ?mock=1 — say so loudly: a screenshot of the mock must not read as a run. */
  mock?: boolean;
  /** 3-C: what is hidden and why; '' when nothing is. */
  redaction?: string;
}) {
  const hour = useUiStore((s) => s.displayHour);
  const preset = useUiStore((s) => s.displayPreset);
  const timeMode = useUiStore((s) => s.timeMode);
  const timeZone = useUiStore((s) => s.timeZone);
  const reveal = useUiStore((s) => s.revealInternal);
  const setReveal = useUiStore((s) => s.setRevealInternal);
  return (
    <header className="pointer-events-none absolute left-4 top-4 flex items-center gap-3">
      <div className="floor-panel pointer-events-auto flex items-baseline gap-3 px-3 py-2">
        <span className="text-base font-semibold tracking-tight">The floor</span>
        <span className="tabular-nums text-sm text-foreground-muted" aria-live="off">
          {formatHour(hour)}
        </span>
        <span className="text-xs text-foreground-muted">
          {PRESET_LABEL[preset] ?? '—'}
          {timeMode === 'scrub' ? ' · scrubbed' : ` · ${timeZone}`}
        </span>
      </div>
      <div className="floor-panel pointer-events-auto max-w-[32rem] px-3 py-2">
        {mock ? (
          <p className="text-xs font-semibold text-escalate">
            SYNTHETIC FLOOR (?mock=1) — nothing here came from a row.
          </p>
        ) : null}
        {brief ? (
          <>
            <p className="truncate text-xs font-semibold">{brief.question}</p>
            <p className="text-xs text-foreground-muted">
              {brief.weightClass} · {brief.status} · {brief.routing.length > 0 ? brief.routing.join(' → ') : 'not routed'}
            </p>
          </>
        ) : (
          <p className="text-xs text-foreground-muted">No brief is running. The floor shows the institution at rest.</p>
        )}
        <p className="text-xs text-foreground-muted">
          realtime: {status}
          {phantoms > 0 ? ` · ${phantoms} empty desk${phantoms === 1 ? '' : 's'}` : ''}
        </p>
        {redaction ? (
          <p className="mt-1 text-xs text-escalate">
            {redaction}{' '}
            <button
              type="button"
              className="underline underline-offset-2 hover:text-foreground"
              onClick={() => setReveal(true)}
            >
              Show for this session
            </button>
          </p>
        ) : null}
        {reveal ? (
          <p className="mt-1 text-xs text-escalate">
            Internal task content is on screen.{' '}
            <button
              type="button"
              className="underline underline-offset-2 hover:text-foreground"
              onClick={() => setReveal(false)}
            >
              Hide again
            </button>
          </p>
        ) : null}
      </div>
      <div className="floor-panel pointer-events-auto px-3 py-2">
        <FleetSummary />
      </div>
    </header>
  );
}
