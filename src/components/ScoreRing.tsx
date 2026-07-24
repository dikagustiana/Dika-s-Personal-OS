import { Activity } from 'lucide-react';
import type { DailyScoreResult } from '../logic/score';

export function ScoreRing({ result }: { result: DailyScoreResult }) {
  const ringColor = result.isEmpty ? 'hsl(var(--muted))' : 'hsl(var(--primary))';
  const fill = result.isEmpty ? 0 : result.score * 3.6;

  return (
    <div className="flex items-center gap-5">
      <div
        className="relative grid size-28 shrink-0 place-items-center rounded-full"
        style={{
          background: `conic-gradient(${ringColor} ${fill}deg, hsl(var(--muted)) ${fill}deg)`,
        }}
        aria-label={result.isEmpty ? 'Daily score is neutral' : `Daily score ${result.score} out of 100`}
      >
        <div className="grid size-[92px] place-items-center rounded-full bg-card">
          {result.isEmpty ? (
            <Activity className="size-6 text-gray-600" />
          ) : (
            <span className="text-3xl font-bold tabular-nums">{Math.round(result.score / 10)}</span>
          )}
        </div>
      </div>
      <div>
        <div className="flex items-baseline gap-1">
          <span className="text-4xl font-bold tabular-nums">
            {result.isEmpty ? '—' : Math.round(result.score / 10)}
          </span>
          <span className="text-lg text-gray-500">/10</span>
        </div>
        <p className="mt-1 max-w-44 text-sm leading-5 text-gray-500">
          {result.isEmpty
            ? 'Add a task, habit, or timeblock to begin.'
            : `${result.activeComponents} signals active today`}
        </p>
      </div>
    </div>
  );
}
