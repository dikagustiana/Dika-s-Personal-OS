'use client';
import { formatHour } from '@/core/time/clock';
import { useUiStore } from '@/stores/uiStore';

const PRESET_LABEL: Record<string, string> = {
  MORNING: 'Morning',
  MIDDAY: 'Midday',
  DUSK: 'Sunset',
  NIGHT: 'Late shift',
};

export function TopBar() {
  const hour = useUiStore((s) => s.displayHour);
  const preset = useUiStore((s) => s.displayPreset);
  const timeMode = useUiStore((s) => s.timeMode);
  const timeZone = useUiStore((s) => s.timeZone);
  return (
    <header className="pointer-events-none absolute left-4 top-4 flex items-center gap-3">
      <div className="bc-panel pointer-events-auto flex items-baseline gap-3 px-3 py-2">
        <span className="text-base font-semibold tracking-tight">Bot Crossing</span>
        <span className="font-mono text-sm text-ink-muted" aria-live="off">
          {formatHour(hour)}
        </span>
        <span className="text-xs text-ink-muted">
          {PRESET_LABEL[preset] ?? '—'}
          {timeMode === 'scrub' ? ' · scrubbed' : ` · ${timeZone}`}
        </span>
      </div>
    </header>
  );
}
