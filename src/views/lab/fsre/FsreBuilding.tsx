/**
 * THE FSRE BUILDING — the owner's financial-statement reverse-engineering
 * pipeline drawn as an office building and replayed event by event.
 *
 * Each floor is a function, each skill an agent at a desk, each company a
 * folder that moves between them, and the top floor is the partner room
 * where escalations and proposals wait. The building is a pure function of
 * events: an event source (eventSource.ts) gives a run, the reducer folds
 * the first `cursor` events into state, and everything below renders that
 * state. With no event applied, nothing moves and no figure is shown.
 *
 * OWNER ONLY, and lazy. App.tsx mounts this behind React.lazy for the owner
 * viewer only; a contributor gets FsreOwnerOnly, which imports nothing from
 * here. The replay files are dynamic imports inside the event source, so
 * they are fetched only when this view opens.
 *
 * Mount report: docs/lab/fsre-building-mount-report.md.
 */
import { useEffect, useMemo, useState } from 'react';
import type { FsreRun } from '../../../logic/lab/fsre/data';
import type { FsreEvent } from '../../../logic/lab/fsre/events';
import { fsreApproval } from '../../../data/fsreApproval';
import { fsreLiveFeed } from '../../../data/fsreLiveFeed';
import { appendEvents, connectedLiveSource, followCursor, replaySource, type FsreEventSource, type FsreLoadFailure } from '../../../logic/lab/fsre/eventSource';
import { FLOOR_DISPLAY_ORDER } from '../../../logic/lab/fsre/layout';
import { buildContext, createStateCache, runTotals } from '../../../logic/lab/fsre/reducer';
import { agentStatuses, buildFloorScene, focusTickerOf, touchedBy, type FsreSelection, type Touched } from '../../../logic/lab/fsre/scene';
import { hasApplied, stepAt } from '../../../logic/lab/fsre/viewModel';
import { FsreFloor } from './FsreFloor';
import { FsreHeader } from './FsreHeader';
import { FsreLegend } from './FsreLegend';
import { FsreMetrics } from './FsreMetrics';
import { FsreNotes } from './FsreNotes';
import { FsrePanel } from './FsrePanel';
import { FsreReplayControls } from './FsreReplayControls';
import { FsreTimeline } from './FsreTimeline';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';
import { useFsreViewStore } from './useFsreViewStore';

type LoadState =
  | { kind: 'loading'; sourceId: string }
  | { kind: 'failed'; sourceId: string; failure: FsreLoadFailure }
  | { kind: 'ready'; sourceId: string; run: FsreRun };

const NOTHING_MOVED: Touched = { chips: new Set(), arrivals: new Set() };

/** The run switcher's entries: the bundled replay first, then the live pipeline over the data layer's feed. */
const DEFAULT_SOURCES: readonly FsreEventSource[] = [replaySource, connectedLiveSource(fsreLiveFeed, fsreApproval)];

export function FsreBuilding({ sources = DEFAULT_SOURCES }: { sources?: readonly FsreEventSource[] }) {
  const [firstSource] = sources;
  const sourceId = useFsreViewStore((s) => s.sourceId);
  const source = sources.find((s) => s.id === sourceId) ?? firstSource;
  const cursor = useFsreViewStore((s) => s.cursor);
  const animate = useFsreViewStore((s) => s.animate);
  const selection = useFsreViewStore((s) => s.selection);
  const query = useFsreViewStore((s) => s.query);
  const highlightStageId = useFsreViewStore((s) => s.highlightStageId);
  const { setSource, setCursor, restart, select, setQuery, setHighlightStage } = useFsreViewStore.getState();
  const reducedMotion = usePrefersReducedMotion();

  const [load, setLoad] = useState<LoadState>({ kind: 'loading', sourceId: source.id });
  const [events, setEvents] = useState<readonly FsreEvent[]>([]);
  const [feedProblem, setFeedProblem] = useState<string | null>(null);

  // Load the run whenever the source changes. The reader starts at the END
  // of a replay (the run as recorded); stepping back replays it.
  useEffect(() => {
    let current = true;
    setLoad({ kind: 'loading', sourceId: source.id });
    void source.load().then((result) => {
      if (!current) return;
      if (result.ok) {
        setEvents(result.run.events);
        setCursor(result.run.events.length);
        setLoad({ kind: 'ready', sourceId: source.id, run: result.run });
      } else {
        setEvents([]);
        restart();
        setLoad({ kind: 'failed', sourceId: source.id, failure: result });
      }
    });
    return () => {
      current = false;
    };
  }, [source, setCursor, restart]);

  // A live source appends; a reader at the end follows, one who stepped back stays.
  useEffect(() => {
    setFeedProblem(null);
    if (load.kind !== 'ready' || !source.subscribe) return;
    return source.subscribe(
      load.run,
      (batch) => {
        setEvents((previous) => {
          const next = appendEvents(previous, batch);
          const store = useFsreViewStore.getState();
          store.setCursor(followCursor(store.cursor, previous.length, next.length));
          return next;
        });
      },
      setFeedProblem,
    );
  }, [load, source]);

  const run = load.kind === 'ready' ? load.run : null;
  const ctx = useMemo(() => (run ? buildContext(run) : null), [run]);
  const cache = useMemo(() => (ctx ? createStateCache(ctx) : null), [ctx]);
  const step = useMemo(() => (cache ? stepAt(cache, events, cursor) : null), [cache, events, cursor]);
  const state = step?.after ?? null;
  const statuses = useMemo(() => (ctx && state ? agentStatuses(ctx, state) : {}), [ctx, state]);
  const totals = useMemo(() => (state ? runTotals(state) : null), [state]);
  const touched = useMemo(
    () => (ctx && step && animate && !reducedMotion ? touchedBy(ctx, step.before, step.after, step.event) : NOTHING_MOVED),
    [ctx, step, animate, reducedMotion],
  );
  const motionKey = step?.event?.id ?? 'start';
  const focusTicker = focusTickerOf(selection);

  const onSelect = (next: FsreSelection | null) => select(next);

  return (
    <div className="page-shell">
      <FsreHeader
        sources={sources}
        activeSourceId={source.id}
        onSource={(id) => {
          // Re-choosing the open run changes nothing: resetting the cursor
          // without a reload would show an empty building over a full run.
          if (id !== source.id) setSource(id);
        }}
        ctx={ctx}
        state={state}
        waiting={totals ? totals.itemsWaiting : null}
        escalations={totals ? totals.escalationsOpen : null}
        query={query}
        onQuery={setQuery}
        onSelect={onSelect}
        onHighlightStage={setHighlightStage}
      />

      {load.kind === 'loading' ? (
        <p role="status" className="mt-6 text-sm text-foreground-muted">
          Loading the building…
        </p>
      ) : null}

      {load.kind === 'failed' ? (
        <div role="status" className="mt-6 rounded-lg border border-border bg-card p-5 shadow-card" data-failure={load.failure.reason}>
          <p className="surface-label">{load.failure.reason === 'not-connected' ? `${source.label} · not connected` : 'Could not load this run'}</p>
          <p className="mt-2 text-sm text-foreground-secondary">{load.failure.detail}</p>
          <p className="mt-2 text-sm text-foreground-muted">No building is drawn: there is no run to draw it from.</p>
        </div>
      ) : null}

      {run && feedProblem ? (
        <p role="status" className="mt-6 text-sm text-foreground-secondary" data-feed-problem="">
          {feedProblem}
        </p>
      ) : null}

      {run && ctx && state && totals ? (
        <>
          <FsreMetrics ctx={ctx} state={state} totals={totals} applied={hasApplied(cursor)} />
          <FsreNotes run={run} kind={source.kind} />

          <div className="fsre-grid canvas-bleed mt-6">
            <section aria-label="The building" className="min-w-0">
              <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-card">
                <div className="min-w-[40rem]">
                  {FLOOR_DISPLAY_ORDER.map((floorId) => (
                    <FsreFloor
                      key={floorId}
                      scene={buildFloorScene(ctx, state, floorId, { selection, agentStatuses: statuses, focusTicker })}
                      onSelect={onSelect}
                      touched={touched}
                      motionKey={motionKey}
                    />
                  ))}
                </div>
              </div>
              <FsreLegend />
            </section>
            <aside aria-label="Selection details" className="min-w-0">
              <FsrePanel
                ctx={ctx}
                state={state}
                events={events}
                cursor={cursor}
                selection={selection}
                query={query}
                agentStatuses={statuses}
                onSelect={onSelect}
                approval={source.approval}
              />
            </aside>
          </div>

          <FsreTimeline ctx={ctx} state={state} focusTicker={focusTicker} highlightStageId={highlightStageId} onSelect={onSelect} />
          <FsreReplayControls total={events.length} />
        </>
      ) : null}
    </div>
  );
}
