/**
 * The replay's toolbar (the building's title and mode switch sit above it,
 * in FsreBuilding): the run switcher (one button per event source), the
 * search, and the partner room's notification count. The
 * count is the open partner items — escalations and proposals — through
 * the one formatter; while any of them is an escalation the badge turns
 * amber and the button says so in words beside a ⚠.
 */
import { Bell } from 'lucide-react';
import type { FsreEventSource } from '../../../logic/lab/fsre/eventSource';
import { LOCK_GLYPH } from '../../../logic/lab/fsre/glyphs';
import type { FsreContext, FsreState } from '../../../logic/lab/fsre/reducer';
import type { FsreSelection } from '../../../logic/lab/fsre/scene';
import { countText, numberText } from '../../../logic/lab/fsre/viewModel';
import { cn } from '../../../lib/utils';
import { FsreSearch } from './FsreSearch';

interface FsreHeaderProps {
  sources: readonly FsreEventSource[];
  activeSourceId: string;
  onSource: (sourceId: string) => void;
  ctx: FsreContext | null;
  state: FsreState | null;
  /** Open partner items, or null before a run is loaded. */
  waiting: number | null;
  /** Open escalations among them, or null before a run is loaded. */
  escalations: number | null;
  query: string;
  onQuery: (query: string) => void;
  onSelect: (selection: FsreSelection) => void;
  onHighlightStage: (stageId: string | null) => void;
}

export function FsreHeader(props: FsreHeaderProps) {
  const { sources, activeSourceId, onSource, waiting, escalations } = props;
  return (
    <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
      <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
        <div role="group" aria-label="Runs" className="flex flex-wrap gap-2">
          {sources.map((source) => {
            const active = source.id === activeSourceId;
            return (
              <button
                key={source.id}
                type="button"
                aria-pressed={active}
                onClick={() => onSource(source.id)}
                className={cn(
                  'min-h-11 rounded-sm border px-3 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface-2 text-foreground hover:bg-surface-3',
                )}
              >
                {source.label}
                {source.availability === 'not-connected' ? <span className={active ? '' : 'text-foreground-muted'}> · not connected</span> : null}
              </button>
            );
          })}
        </div>

        <FsreSearch
          ctx={props.ctx}
          state={props.state}
          query={props.query}
          onQuery={props.onQuery}
          onSelect={props.onSelect}
          onHighlightStage={props.onHighlightStage}
        />

        <button
          type="button"
          disabled={waiting === null}
          onClick={() => props.onSelect({ kind: 'partner' })}
          aria-label={waiting === null ? 'Partner room' : `Partner room: ${countText(waiting, 'item')} waiting${escalations ? `, ${countText(escalations, 'escalation')} among them` : ''}`}
          className="relative inline-flex min-h-11 items-center gap-2 rounded-sm border border-border bg-surface-2 px-3 text-sm text-foreground transition-colors duration-150 hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-45"
        >
          <Bell className="size-4" aria-hidden="true" />
          Partner room
          {waiting ? (
            <span
              aria-hidden="true"
              data-testid="fsre-badge"
              className={cn(
                'inline-flex min-w-6 items-center justify-center gap-0.5 rounded-full px-1.5 text-xs font-semibold tabular-nums',
                escalations ? 'bg-escalate text-escalate-foreground' : 'bg-primary text-primary-foreground',
              )}
            >
              {numberText(waiting)}
            </span>
          ) : null}
          {escalations ? (
            <span aria-hidden="true" className="fsre-tone text-xs font-semibold" data-tone="escalated">
              {LOCK_GLYPH} {countText(escalations, 'escalation')}
            </span>
          ) : null}
        </button>
      </div>
    </div>
  );
}
