/**
 * THE SYNTHETIC OFFICE (brief v2): the building as a live office on the mock
 * transport — departments of desks the owner can walk up to, commands to any
 * agent, new engagements started from the building, and the industries board.
 *
 * Everything drawn is a function of the folded events and the clock
 * (useFsreLiveStore); the one motion is a desk's chip flashing once when an
 * event arrives for it, keyed to that event and skipped when the reader asks
 * for less motion. Every synthetic screen carries the Synthetic banner.
 *
 * Opening the mode starts the transport; leaving it stops the transport and
 * its clock.
 */
import { useEffect, useMemo, useState } from 'react';
import { Bell } from 'lucide-react';
import { hasMockControls } from '../../../data/fsreTransport/controls';
import { buildDeskFloorScene } from '../../../logic/lab/fsre/deskScene';
import { applyDimming, syntheticDeskViews } from '../../../logic/lab/fsre/deskViews';
import { formatCount, formatNumber } from '../../../logic/lab/fsre/format';
import { LOCK_GLYPH } from '../../../logic/lab/fsre/glyphs';
import { FLOOR_DISPLAY_ORDER } from '../../../logic/lab/fsre/layout';
import { lastSignalEvent } from '../../../logic/lab/fsre/liveReducer';
import { deskViewOf, partnerWaiting } from '../../../logic/lab/fsre/liveView';
import type { FsreSelection, Touched } from '../../../logic/lab/fsre/scene';
import { LIVE_VIEWS, SYNTHETIC_BANNER } from '../../../logic/lab/fsre/statuses';
import { Button } from '../../../components/ui/Button';
import { cn } from '../../../lib/utils';
import { FsreComposerDialog, FsreEngagementDialog } from './FsreDialogs';
import { FsreFloor } from './FsreFloor';
import { FsreIndustries } from './FsreIndustries';
import { FsreLegend } from './FsreLegend';
import { FsreLiveMetrics } from './FsreLiveMetrics';
import { FsreLivePanel } from './FsreLivePanel';
import { FsreMockClock } from './FsreMockClock';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';
import { useFsreLiveStore } from './useFsreLiveStore';
import { useFsreOfficeStore } from './useFsreOfficeStore';

const NOTHING_MOVED: Touched = { chips: new Set(), arrivals: new Set() };

function SyntheticBanner() {
  return (
    <p role="note" aria-label="Synthetic data banner" className="mt-4 rounded-lg border border-escalate/40 bg-escalate/10 px-4 py-2 text-sm text-foreground">
      <strong className="mr-2">Synthetic</strong>
      {SYNTHETIC_BANNER}
    </p>
  );
}

function Toolbar({ waiting }: { waiting: number }) {
  const liveView = useFsreOfficeStore((s) => s.liveView);
  const setLiveView = useFsreOfficeStore((s) => s.setLiveView);
  const openComposer = useFsreOfficeStore((s) => s.openComposer);
  const openEngagementDialog = useFsreOfficeStore((s) => s.openEngagementDialog);
  const select = useFsreOfficeStore((s) => s.select);
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <div role="group" aria-label="Views" className="flex gap-2">
        {LIVE_VIEWS.map((view) => (
          <button
            key={view.id}
            type="button"
            aria-pressed={liveView === view.id}
            onClick={() => setLiveView(view.id)}
            className={cn(
              'min-h-11 rounded-sm border px-3 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              liveView === view.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface-2 text-foreground hover:bg-surface-3',
            )}
          >
            {view.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" className="min-h-11" onClick={() => openComposer(null)}>
          ✉ Message an agent
        </Button>
        <Button type="button" className="min-h-11" onClick={() => openEngagementDialog()}>
          + New engagement
        </Button>
        <button
          type="button"
          onClick={() => {
            setLiveView('building');
            select({ kind: 'partner' });
          }}
          aria-label={`Partner room: ${formatCount(waiting, 'item')} waiting`}
          className="relative inline-flex min-h-11 items-center gap-2 rounded-sm border border-border bg-surface-2 px-3 text-sm text-foreground transition-colors duration-150 hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Bell className="size-4" aria-hidden="true" />
          Partner room
          {waiting ? (
            <span aria-hidden="true" data-testid="fsre-office-badge" className="fsre-tone inline-flex items-center gap-0.5 rounded-full bg-escalate px-1.5 text-xs font-semibold text-escalate-foreground">
              {LOCK_GLYPH} {formatNumber(waiting)}
            </span>
          ) : null}
        </button>
      </div>
    </div>
  );
}

/**
 * The office's floors. One flash per event, on the desk it touched;
 * heartbeats never move it (FX-8). The event already on screen when the
 * floors appear (coming back from the industries board) does not flash
 * again: nothing arrived (review R7).
 */
function OfficeFloors({ views, selection, onSelect, waiting, reducedMotion }: { views: ReturnType<typeof syntheticDeskViews>; selection: FsreSelection | null; onSelect: (next: FsreSelection) => void; waiting: number; reducedMotion: boolean }) {
  const state = useFsreLiveStore((s) => s.state);
  const lastEvent = lastSignalEvent(state.events);
  const [shownFrom] = useState(() => lastEvent?.id ?? null);
  const fresh = lastEvent !== null && lastEvent.id !== shownFrom;
  const touched: Touched = fresh && !reducedMotion ? { chips: new Set([`desk:${lastEvent.agentId}`]), arrivals: new Set() } : NOTHING_MOVED;
  const motionKey = lastEvent?.id ?? 'start';
  return (
    <section aria-label="The building" className="min-w-0">
      <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-card">
        <div className="min-w-[40rem]">
          {FLOOR_DISPLAY_ORDER.map((floorId) => (
            <FsreFloor key={floorId} scene={buildDeskFloorScene(floorId, views[floorId], { selection, partnerWaiting: waiting })} onSelect={onSelect} touched={touched} motionKey={motionKey} />
          ))}
        </div>
      </div>
      <FsreLegend kind="office" />
    </section>
  );
}

export function FsreOffice() {
  const transport = useFsreLiveStore((s) => s.transport);
  const agents = useFsreLiveStore((s) => s.agents);
  const engagements = useFsreLiveStore((s) => s.engagements);
  const state = useFsreLiveStore((s) => s.state);
  const now = useFsreLiveStore((s) => s.now);
  const liveView = useFsreOfficeStore((s) => s.liveView);
  const selection = useFsreOfficeStore((s) => s.selection);
  const select = useFsreOfficeStore((s) => s.select);
  const industriesFilter = useFsreOfficeStore((s) => s.industriesFilter);
  const setIndustriesFilter = useFsreOfficeStore((s) => s.setIndustriesFilter);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    void useFsreLiveStore.getState().start();
    return () => useFsreLiveStore.getState().stop();
  }, []);

  const ownerWaiting = engagements.some((e) => e.status === 'waiting_owner');
  const views = useMemo(
    () => applyDimming(syntheticDeskViews(state, agents, now, ownerWaiting), engagements, industriesFilter),
    [state, agents, now, ownerWaiting, engagements, industriesFilter],
  );
  const waiting = partnerWaiting(state);
  const filtered = engagements.find((e) => e.id === industriesFilter) ?? null;

  return (
    <>
      <Toolbar waiting={waiting} />
      <SyntheticBanner />
      <FsreLiveMetrics state={state} engagements={engagements} filterEngagementId={industriesFilter} />

      {filtered ? (
        <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-foreground" role="status">
          Building filtered to <strong>{filtered.plan.subIndustryName}</strong> ({filtered.plan.tickers.join(' + ')}); desks of other engagements are dimmed and labelled.
          <Button type="button" variant="secondary" size="sm" className="min-h-11" onClick={() => setIndustriesFilter(null)}>
            Clear filter
          </Button>
        </p>
      ) : null}

      {liveView === 'building' ? (
        <div className="fsre-grid canvas-bleed mt-6">
          <OfficeFloors views={views} selection={selection} onSelect={(next) => select(next)} waiting={waiting} reducedMotion={reducedMotion} />
          <aside aria-label="Selection details" className="min-w-0">
            <FsreLivePanel agents={agents} state={state} desks={(agentId) => deskViewOf(views, agentId)} />
          </aside>
        </div>
      ) : (
        <div className="mt-6">
          <FsreIndustries />
        </div>
      )}

      {transport && hasMockControls(transport) ? <FsreMockClock /> : null}
      <FsreComposerDialog />
      <FsreEngagementDialog />
    </>
  );
}
