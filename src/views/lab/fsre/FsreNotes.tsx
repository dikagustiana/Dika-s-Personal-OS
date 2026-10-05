/**
 * The note under the metrics: what this screen is, WHICH input file is
 * provisional (each by name, with the source it gives for itself), and —
 * only when the run says so — that times were not recorded.
 */
import type { FsreRun } from '../../../logic/lab/fsre/data';
import { runNotes } from '../../../logic/lab/fsre/viewModel';

export function FsreNotes({ run, kind }: { run: FsreRun; kind: 'replay' | 'live' }) {
  return (
    <ul aria-label="About this data" className="mt-3 space-y-1 text-sm text-foreground-secondary">
      {runNotes(run, kind).map((note) => (
        <li key={note.key} data-note={note.key}>
          {note.glyph ? (
            <span aria-hidden="true" className="mr-1.5 fsre-tone" data-tone="escalated">
              {note.glyph}
            </span>
          ) : null}
          {note.text}
        </li>
      ))}
    </ul>
  );
}
