/**
 * Bottom timeline: every stage from the stage data in order, each as glyph +
 * name + word. With a folder selected it speaks for that company; otherwise
 * each stage shows the worst status any company has there, so the run view
 * is never cleaner than its worst company. A stage is a button: it opens
 * its gate room or its runner.
 */
import type { FsreContext, FsreState } from '../../../logic/lab/fsre/reducer';
import { stageCells, type FsreSelection } from '../../../logic/lab/fsre/scene';
import { selectionForResult } from '../../../logic/lab/fsre/search';
import { SEARCH_TYPE_WORDS } from '../../../logic/lab/fsre/statuses';
import { cn } from '../../../lib/utils';
import { Glyph } from './fsreUi';

interface FsreTimelineProps {
  ctx: FsreContext;
  state: FsreState;
  focusTicker: string | null;
  highlightStageId: string | null;
  onSelect: (selection: FsreSelection) => void;
}

export function FsreTimeline({ ctx, state, focusTicker, highlightStageId, onSelect }: FsreTimelineProps) {
  const focus = focusTicker ? (state.companies[focusTicker] ?? null) : null;
  return (
    <nav aria-label={focus ? `Stage timeline for ${focus.ticker}` : 'Stage timeline, worst status across the run'} className="mt-6 overflow-x-auto">
      <p className="surface-label mb-2">{focus ? `Stages · ${focus.ticker}` : 'Stages · whole run'}</p>
      <ol className="flex min-w-max items-stretch gap-1.5 pb-2">
        {stageCells(ctx, state, focus).map((cell) => (
          <li key={cell.stageId} aria-current={cell.status === 'current' ? 'step' : undefined}>
            <button
              type="button"
              onClick={() => onSelect(selectionForResult(ctx, { type: 'stage', typeWord: SEARCH_TYPE_WORDS.stage, id: cell.stageId, label: cell.name }))}
              className={cn(
                'inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full border bg-card px-3 text-sm transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                highlightStageId === cell.stageId ? 'border-primary ring-2 ring-primary/40' : 'border-border',
              )}
            >
              <Glyph glyph={cell.glyph} tone={cell.tone} />
              <span className="text-foreground">{cell.name}</span>
              <span className="fsre-tone text-xs" data-tone={cell.tone}>
                · {cell.word}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
