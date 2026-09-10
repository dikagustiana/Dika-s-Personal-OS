'use client';
import { useQuery } from '@tanstack/react-query';
import { markdownPreview } from '@/core/text/markdown';
import { fetchOutput } from '../api';

/** Output document preview for the current task, polled while the task runs. */
export function OutputPreview({ taskId, progress, onOpen }: { taskId: string | null; progress: number; onOpen: (taskId: string) => void }) {
  const q = useQuery({
    queryKey: ['output', taskId],
    queryFn: () => fetchOutput(taskId as string),
    enabled: Boolean(taskId),
    retry: false,
    // Poll until a document exists; once it does, stop.
    refetchInterval: (query) => (query.state.data ? false : progress < 100 ? 6000 : 3000),
    staleTime: 3000,
  });
  if (!taskId) return <p className="text-2xs text-ink-muted">No task assigned.</p>;
  if (q.isPending) return <p className="text-2xs text-ink-muted">Checking for output…</p>;
  if (q.isError) {
    return (
      <p className="text-2xs text-error">
        Could not reach the telemetry API. <button type="button" className="underline" onClick={() => q.refetch()}>Retry</button>
      </p>
    );
  }
  if (!q.data) {
    return <p className="text-2xs text-ink-muted">No output yet. It appears here when the task completes{progress < 100 ? ` (now at ${Math.round(progress)}%)` : ''}.</p>;
  }
  return (
    <div>
      <p className="text-2xs text-ink-muted">{markdownPreview(q.data.content, 150)}</p>
      <button
        type="button"
        className="mt-1.5 rounded-panel bg-accent px-2.5 py-1 text-xs font-semibold text-[#0f1420] hover:brightness-110"
        onClick={() => onOpen(q.data!.taskId)}
      >
        Open document
      </button>
    </div>
  );
}
