import { markdownPreview } from '../../../../../logic/floor/text/markdown';
import { useAssignmentOutput } from '../corpusOutput';

/**
 * The output of the selected agent's current assignment, read from the
 * corpus. There is no polling: a Realtime change re-reads the floor, and a
 * document that does not exist yet is a normal state with its own sentence
 * rather than a spinner that never resolves.
 */
export function OutputPreview({
  taskId,
  progress,
  onOpen,
}: {
  taskId: string | null;
  progress: number;
  onOpen: (taskId: string) => void;
}) {
  const output = useAssignmentOutput(taskId);
  if (!taskId) return <p className="text-xs text-foreground-muted">No assignment.</p>;
  if (output.status === 'loading') return <p className="text-xs text-foreground-muted">Reading the archive…</p>;
  if (output.status === 'error') {
    return (
      <p className="text-xs text-destructive">
        Could not read the archive. That is not the same as no output: {output.detail}
      </p>
    );
  }
  if (output.status === 'none') {
    return (
      <p className="text-xs text-foreground-muted">
        Nothing archived for this assignment yet. It appears here when the work produces a corpus record
        {progress < 100 ? ` (estimated ${Math.round(progress)}% of the way)` : ''}.
      </p>
    );
  }
  return (
    <div>
      <p className="text-xs text-foreground-muted">{markdownPreview(output.document.content, 150)}</p>
      <button
        type="button"
        className="mt-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground hover:brightness-110"
        onClick={() => onOpen(output.document.taskId)}
      >
        Open the record
      </button>
    </div>
  );
}
