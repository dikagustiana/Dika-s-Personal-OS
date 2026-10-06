/**
 * The synthetic office's bottom bar: the mock clock in HH.MM and the speed
 * control (1×, 10×, pause). The control changes the mock clock only — never
 * a derivation rule — and it exists only when the transport offers
 * MockControls; a transport without them shows neither.
 */
import { formatHHMM } from '../../../logic/lab/fsre/format';
import type { MockSpeed } from '../../../data/fsreTransport/controls';
import { cn } from '../../../lib/utils';
import { useFsreLiveStore } from './useFsreLiveStore';

const SPEEDS: ReadonlyArray<{ id: MockSpeed; label: string }> = [
  { id: '1x', label: '1×' },
  { id: '10x', label: '10×' },
  { id: 'pause', label: 'Pause' },
];

export function FsreMockClock() {
  const now = useFsreLiveStore((s) => s.now);
  const speed = useFsreLiveStore((s) => s.speed);
  const setSpeed = useFsreLiveStore((s) => s.setSpeed);
  return (
    <div role="group" aria-label="Mock clock" className="mt-6 flex flex-wrap items-center gap-4 rounded-lg border border-border bg-card px-5 py-3 shadow-card">
      <p className="text-sm text-foreground-secondary">
        Mock clock <strong className="tabular-nums text-foreground">{formatHHMM(now)}</strong>
      </p>
      <div role="group" aria-label="Mock clock speed" className="flex items-center gap-2">
        <span className="text-sm text-foreground-secondary">Speed</span>
        {SPEEDS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={option.id === speed}
            onClick={() => setSpeed(option.id)}
            className={cn(
              'min-h-11 rounded-sm border px-3 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              option.id === speed ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface-2 text-foreground hover:bg-surface-3',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="text-sm text-foreground-muted">The building moves only when an event arrives; the speed control changes the mock clock only.</p>
    </div>
  );
}
