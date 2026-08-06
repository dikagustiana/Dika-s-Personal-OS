/**
 * THE FINISH LINE IS ONE PAGE WITH THREE TABS, AND THAT IS THE POINT.
 *
 * The matrix says what "done" looks like; the swimlane says how the work
 * actually flows; the register says which data is missing before either can
 * be trusted. An earlier cut shipped the last two as their own sidebar
 * entries — three levels of navigation for two views, and the connection
 * between the target and the road to it reduced to a hyperlink. They belong
 * here: the target is the destination, the process is the journey.
 *
 * This component owns the page header, the tab bar, the URL, and the
 * handoffs between tabs. Each tab renders its own description and its own
 * data; there is exactly one <h1> on the page and it lives here.
 *
 * On the URL: entering the area REPLACES the address rather than pushing, so
 * the sidebar keeps behaving like the rest of the app (view switching is
 * state, not history); tab clicks PUSH, so Back walks the tabs; leaving the
 * area is handled in App, which puts the address back to `/` rather than
 * leaving a Finish line URL over a Dashboard.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import { useAppStore } from '../../store/appStore';
import { FinishLine } from './FinishLine';
import { FinishLineNeeds } from './FinishLineNeeds';
import { FinishLineSwimlane } from './FinishLineSwimlane';
import {
  DEFAULT_PROCESS_ENTITY,
  finishLineHref,
  finishLineRouteFromLocation,
  type FinishLineRoute,
  type FinishLineTab,
} from './finishLineRoute';

const TABS: Array<{ id: FinishLineTab; label: string }> = [
  { id: 'matrix', label: 'Matrix' },
  { id: 'swimlane', label: 'Swimlane' },
  { id: 'kebutuhan-data', label: 'Kebutuhan data' },
];

export function FinishLineArea() {
  const setFinishLineFocus = useAppStore((state) => state.setFinishLineFocus);
  const setProsesFocus = useAppStore((state) => state.setProsesFocus);
  const prosesEntity = useAppStore((state) => state.prosesEntity);
  const setProsesEntity = useAppStore((state) => state.setProsesEntity);

  const [route, setRoute] = useState<FinishLineRoute>(
    () => finishLineRouteFromLocation() ?? { tab: 'matrix' },
  );

  // URL → store: an address that names an entity wins on arrival and on
  // Back/Forward; a bare process URL means the default. The matrix tab never
  // touches the entity — it is every entity at once.
  const syncEntityFromRoute = useCallback(
    (next: FinishLineRoute) => {
      if (next.tab === 'matrix') return;
      setProsesEntity(next.entity ?? DEFAULT_PROCESS_ENTITY);
    },
    [setProsesEntity],
  );

  // Arriving from the sidebar leaves the address at `/`; make it say where we
  // are without adding a history entry for a click that was not navigation.
  useEffect(() => {
    const parsed = finishLineRouteFromLocation();
    if (parsed === null) {
      window.history.replaceState(null, '', finishLineHref({ tab: 'matrix' }));
      setRoute({ tab: 'matrix' });
      return;
    }
    syncEntityFromRoute(parsed);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- arrival only
  }, []);

  // Back and Forward walk the tabs. A pop that lands outside the area (the
  // entry before the app was opened, say) normalises to the matrix rather
  // than leaving the tab and the address disagreeing.
  useEffect(() => {
    const onPop = () => {
      const next = finishLineRouteFromLocation();
      if (next) {
        setRoute(next);
        syncEntityFromRoute(next);
        return;
      }
      window.history.replaceState(null, '', finishLineHref({ tab: 'matrix' }));
      setRoute({ tab: 'matrix' });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [syncEntityFromRoute]);

  const go = useCallback((next: FinishLineRoute) => {
    setRoute(next);
    window.history.pushState(null, '', finishLineHref(next));
    // The tab bar sits under the page header; a tab change that leaves the
    // reader halfway down the previous tab reads as a broken render.
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  // store → URL: when the picker changes the entity, the address follows IN
  // PLACE — replaceState, not push, because switching chains is a view
  // change on one page, not a navigation. Skipped on first render (the
  // arrival effect owns that direction) and on the matrix tab.
  const entitySyncSkippedRef = useRef(true);
  useEffect(() => {
    if (entitySyncSkippedRef.current) {
      entitySyncSkippedRef.current = false;
      return;
    }
    setRoute((current) => {
      if (current.tab === 'matrix') return current;
      const next: FinishLineRoute =
        prosesEntity === DEFAULT_PROCESS_ENTITY
          ? { tab: current.tab, ...(current.item ? { item: current.item } : {}) }
          : { ...current, entity: prosesEntity };
      window.history.replaceState(null, '', finishLineHref(next));
      return next;
    });
  }, [prosesEntity]);

  return (
    <div className="page-shell">
      <header className="mb-6 border-b border-border-subtle pb-6">
        <p className="page-kicker">Work / Finish line</p>
        <h1 className="page-title">Finish line</h1>
      </header>

      <div className="mb-6 flex flex-wrap gap-1 border-b border-border-subtle">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() =>
              go(
                tab.id === 'matrix'
                  ? { tab: tab.id }
                  : { tab: tab.id, entity: prosesEntity },
              )
            }
            aria-current={route.tab === tab.id ? 'page' : undefined}
            className={cn(
              'min-h-11 border-b-2 px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              route.tab === tab.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-foreground-muted hover:text-foreground-secondary',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {route.tab === 'matrix' && (
        <FinishLine
          onOpenSwimlane={(itemId, stepLabel, entityCode) => {
            // §4.3: a cell hands over ITS entity — the swimlane opens in
            // that context with the feeding steps highlighted.
            if (stepLabel) setProsesFocus({ stepLabel });
            setProsesEntity(entityCode);
            go({ tab: 'swimlane', item: itemId, entity: entityCode });
          }}
        />
      )}
      {route.tab === 'swimlane' && (
        <FinishLineSwimlane
          itemFilter={route.item}
          onClearItemFilter={() => go({ tab: 'swimlane' })}
          onOpenMatrix={(itemId) => {
            // §4.4 the reverse direction: land on the CELL (row, this
            // entity), not the row in general.
            setFinishLineFocus({ itemId, entityCode: prosesEntity });
            go({ tab: 'matrix' });
          }}
        />
      )}
      {route.tab === 'kebutuhan-data' && (
        <FinishLineNeeds
          onOpenStep={(stepLabel) => {
            setProsesFocus({ stepLabel });
            go({ tab: 'swimlane', entity: prosesEntity });
          }}
        />
      )}
    </div>
  );
}
