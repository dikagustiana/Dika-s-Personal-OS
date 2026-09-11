/**
 * The floor: the institution's 3D world underneath, the HUD on top.
 *
 * WHAT CHANGED FROM THE STANDALONE BUILD. It was a Next.js page with
 * `next/dynamic`, a react-query provider and a WebSocket to a Fastify
 * server on :4000. It is now one view inside the Lab: the canvas is lazy
 * so Three.js stays out of the main bundle, the data comes from the
 * repository, and the live updates come from Supabase Realtime on the
 * institution's own tables.
 */
import { Suspense, lazy, useEffect, useMemo } from 'react';
import { OutputModal } from './OutputModal';
import { useAgentStore } from '../store/agentStore';
import { useUiStore } from '../store/uiStore';
import { DevPanel } from './DevPanel';
import { TopBar } from './TopBar';
import { useInstitutionFloor } from './useInstitutionFloor';

// The canvas needs a WebGL context and pulls in Three.js, drei and the
// postprocessing stack. Lazy, so none of that is in the main chunk (B-11);
// the bundle report in PROGRESS.md is the check, not this comment.
const OfficeCanvas = lazy(() =>
  import('../scene/OfficeCanvas').then((module) => ({ default: module.OfficeCanvas })),
);

function devToolsRequested(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get('dev') === '1') return true;
  if (params.get('dev') === '0') return false;
  return import.meta.env.DEV;
}

export function OfficeApp() {
  const devTools = useUiStore((state) => state.devTools);
  const setDevTools = useUiStore((state) => state.setDevTools);
  const outputTaskId = useUiStore((state) => state.outputTaskId);
  const setOutputTaskId = useUiStore((state) => state.setOutputTaskId);
  const floor = useInstitutionFloor();

  // The roster row and the name plate are not the same shape: a seat's plate
  // shows the agent's display name, and an unstaffed seat has no agent to
  // ask, so the slug stands in. Mapping here keeps the scene ignorant of the
  // institution's row types.
  // The canvas is remounted when the FLOORPLAN changes, not on every read:
  // several scene modules resolve the campus once and memoise geometry from
  // it, so a new building has to replace the old one rather than be drawn
  // over it. Seat counts are in the key because a department that gains a
  // desk gains a bay tile.
  const layoutKey = useMemo(
    () => floor.spec.departments.map((d) => `${d.slug}:${d.specialistSeats}`).join('|'),
    [floor.spec],
  );

  const phantoms = useMemo(
    () =>
      floor.phantoms.map((seat) => ({
        slug: seat.slug,
        label: seat.name,
        seatPurpose: seat.seatPurpose,
        departmentSlug: seat.departmentSlug,
        role: seat.role,
      })),
    [floor.phantoms],
  );

  useEffect(() => {
    // Esc closes the top-most layer: the document first, then the inspector.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const state = useUiStore.getState();
      if (state.outputTaskId) state.setOutputTaskId(null);
      else if (state.selectedAgentId) state.setSelectedAgentId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    setDevTools(devToolsRequested());
  }, [setDevTools]);

  useEffect(() => {
    useAgentStore.getState().setConnection(
      floor.status === 'open' ? 'open' : floor.status === 'connecting' ? 'connecting' : 'closed',
      floor.status === 'error' ? 'realtime channel error' : undefined,
    );
  }, [floor.status]);

  return (
    // The floor is the one view in the app that is a WORLD rather than a
    // document, so it does not sit inside the 1140px measure: it fills the
    // column after the sidebar and the height the shell leaves it, and it
    // never scrolls — a 3D scene that scrolls has two camera controls
    // fighting each other. `dvh`, matching every other full-height surface
    // here, so the iOS address bar does not leave dead space under it.
    <div className="relative h-[calc(100dvh-4rem)] min-h-[520px] w-full overflow-hidden border-y border-border-subtle bg-surface-1 lg:h-dvh lg:border-y-0">
      <Suspense
        fallback={
          <div className="absolute inset-0 flex items-center justify-center text-sm text-foreground-muted">
            Loading the floor…
          </div>
        }
      >
        <OfficeCanvas
          key={layoutKey}
          layout={floor.layout}
          phantoms={phantoms}
          markers={floor.markers}
        />
      </Suspense>
      <TopBar brief={floor.brief} status={floor.status} phantoms={phantoms.length} mock={floor.mock} redaction={floor.redaction} />
      {devTools ? <DevPanel /> : null}
      {outputTaskId ? <OutputModal taskId={outputTaskId} onClose={() => setOutputTaskId(null)} /> : null}
    </div>
  );
}
