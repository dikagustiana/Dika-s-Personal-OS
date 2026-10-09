/**
 * THE REPLAY MODE of the FSRE building: a recorded run, replayed event by
 * event on the v2 department floors.
 *
 * Unchanged from the v1 building in what it does: an event source gives a
 * run, the reducer folds the first `cursor` events into state, and the
 * metrics, notes (with the run's own source label), floors, panel, timeline
 * and controls render that state. With no event applied, nothing moves and
 * no figure is shown. What v2 changes is where everyone sits: the context is
 * built on the department plan (departmentPlan.ts), so the run's per-skill
 * agents work at the departments' lead and staff desks (brief v2 WO-2), and
 * folders, gate rooms and the partner room follow from the same desk keys.
 *
 * Two sources are offered (milestone M3, PRD "FSRE publish path" §6.2 E): the
 * bundled replay, and the live pipeline feed over the data layer's calls
 * (src/data/fsreLiveFeed.ts, fsreApproval.ts) with the owner's approve
 * button in the partner room. A build without a backend, or one whose
 * functions are not deployed or not given their secret, still lists the live
 * source: choosing it says "not connected" in words and draws no building,
 * never an empty one. Tests pass their own sources through the prop.
 *
 * Mount report: docs/lab/fsre-building-mount-report.md; v2 port:
 * docs/lab/fsre-building-v2-port.md.
 */
import { useEffect, useMemo, useState } from 'react';
import type { FsreRun } from '../../../logic/lab/fsre/data';
import type { FsreEvent } from '../../../logic/lab/fsre/events';
import { planDepartmentFloors } from '../../../logic/lab/fsre/departmentPlan';
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

/** The replay mode's sources, in switcher order: the bundled replay first (opened by default), then the live pipeline feed. */
export const REPLAY_SOURCES: readonly FsreEventSource[] = [replaySource, connectedLiveSource(fsreLiveFeed, fsreApproval)];

export function FsreReplay({ sources = REPLAY_SOURCES }: { sources?: readonly FsreEventSource[] }) {
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
  const ctx = useMemo(() => (run ? buildContext(run, planDepartmentFloors(run.stages, run.skills)) : null), [run]);
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
    <>
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
    </>
  );
}
