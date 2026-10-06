/**
 * Replay controls: play, pause, step back, step forward, restart, speed.
 * One step applies or un-applies exactly one event; the reducer rebuilds
 * the state from the cursor, so stepping back is as pure as stepping
 * forward. Playback pauses itself at the end.
 */
import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import { useEffect } from 'react';
import { Button } from '../../../components/ui/Button';
import { replayProgress } from '../../../logic/lab/fsre/viewModel';
import { REPLAY_SPEEDS, playbackIntervalMs, useFsreViewStore } from './useFsreViewStore';

export function FsreReplayControls({ total }: { total: number }) {
  const cursor = useFsreViewStore((s) => s.cursor);
  const playing = useFsreViewStore((s) => s.playing);
  const speedIndex = useFsreViewStore((s) => s.speedIndex);
  const { stepForward, stepBack, restart, play, pause, tick, setSpeedIndex } = useFsreViewStore.getState();

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => useFsreViewStore.getState().tick(total), playbackIntervalMs(speedIndex));
    return () => window.clearInterval(id);
  }, [playing, speedIndex, total, tick]);

  const atStart = !cursor;
  const atEnd = cursor >= total;

  return (
    <div role="group" aria-label="Replay controls" className="mt-4 flex flex-wrap items-center gap-2 border-t border-border-subtle pt-4">
      {playing ? (
        <Button variant="secondary" className="h-11" onClick={pause} aria-label="Pause the replay">
          <Pause className="size-4" aria-hidden="true" />
          Pause
        </Button>
      ) : (
        <Button variant="secondary" className="h-11" onClick={() => play(total)} aria-label="Play the replay">
          <Play className="size-4" aria-hidden="true" />
          Play
        </Button>
      )}
      <Button variant="secondary" className="h-11" onClick={stepBack} disabled={atStart || playing} aria-label="Step back one event">
        <SkipBack className="size-4" aria-hidden="true" />
        Step back
      </Button>
      <Button variant="secondary" className="h-11" onClick={() => stepForward(total)} disabled={atEnd || playing} aria-label="Step forward one event">
        <SkipForward className="size-4" aria-hidden="true" />
        Step forward
      </Button>
      <Button variant="ghost" className="h-11" onClick={restart} aria-label="Restart the replay from the beginning">
        <RotateCcw className="size-4" aria-hidden="true" />
        Restart
      </Button>

      <label className="ml-auto flex items-center gap-2 text-sm text-foreground-secondary">
        Speed
        <select
          className="native-select min-h-11 w-auto"
          value={speedIndex}
          onChange={(event) => setSpeedIndex(Number(event.target.value))}
          aria-label="Replay speed"
        >
          {REPLAY_SPEEDS.map((speed, index) => (
            <option key={speed.label} value={index}>
              {speed.label}
            </option>
          ))}
        </select>
      </label>

      <p className="w-full text-sm tabular-nums text-foreground-secondary sm:w-auto" aria-live="polite">
        {replayProgress(cursor, total)}
      </p>
    </div>
  );
}
