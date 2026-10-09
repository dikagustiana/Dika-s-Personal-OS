/**
 * The building's mode switch (brief v2 WO-2): Replay (the recorded run, and
 * since M3 the live pipeline feed as a second run), Synthetic (the mock live
 * office) and Live office, which stays disabled and says why until the v2
 * transport has a backend (statuses.ts MODES says which "live" is which).
 */
import { MODES, type ModeId } from '../../../logic/lab/fsre/statuses';
import { cn } from '../../../lib/utils';

export function FsreModeSwitch({ mode, onMode }: { mode: ModeId; onMode: (mode: ModeId) => void }) {
  return (
    <div role="group" aria-label="Mode" className="flex flex-wrap gap-2">
      {MODES.map((entry) => {
        const disabled = entry.id === 'live';
        const active = entry.id === mode;
        return (
          <button
            key={entry.id}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            title={entry.note || undefined}
            onClick={() => onMode(entry.id)}
            className={cn(
              'min-h-11 rounded-sm border px-3 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60',
              active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface-2 text-foreground hover:bg-surface-3',
            )}
          >
            {entry.label}
            {disabled ? <span className="text-foreground-muted"> · {entry.note}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
