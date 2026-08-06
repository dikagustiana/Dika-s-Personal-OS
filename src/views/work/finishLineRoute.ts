/**
 * THE ONLY REAL URL IN THE APP, and it earns it.
 *
 * Every other view is zustand state with no address, which is fine for a
 * single-user cockpit nobody links into. The Finish line's three tabs are
 * different: a cell panel links into the swimlane pre-filtered to that row,
 * and "the swimlane, filtered to Storing cost" is a thing worth bookmarking
 * and worth sending to yourself. So these three get paths, and the tab bar
 * pushes history.
 *
 * Deliberately NOT a router: three paths and one query parameter do not need
 * one, and adding one would put every other view's addresslessness up for
 * renegotiation. Parsing and formatting live here, pure, so they are
 * testable without a DOM.
 */

export type FinishLineTab = 'matrix' | 'swimlane' | 'kebutuhan-data';

export interface FinishLineRoute {
  tab: FinishLineTab;
  /**
   * A Finish line row id, carried only by the swimlane tab: arriving from a
   * cell means "show me the steps that feed THIS row". Ignored on the other
   * tabs rather than preserved — a stale filter travelling invisibly between
   * tabs is worse than losing it.
   */
  item?: string;
}

const BASE = '/finish-line';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * null means "this URL is not the Finish line", which is what tells the app
 * to leave the address alone. An unknown segment under /finish-line is not
 * the Finish line either — no silent fallback to the matrix, because a typo'd
 * bookmark quietly showing a different tab is how a link stops being trusted.
 */
export function parseFinishLineRoute(pathname: string, search: string): FinishLineRoute | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path !== BASE && !path.startsWith(`${BASE}/`)) return null;
  const segment = path === BASE ? '' : path.slice(BASE.length + 1);
  if (segment === '') return { tab: 'matrix' };
  if (segment !== 'swimlane' && segment !== 'kebutuhan-data') return null;
  if (segment === 'kebutuhan-data') return { tab: 'kebutuhan-data' };
  const item = new URLSearchParams(search).get('item') ?? '';
  return UUID.test(item) ? { tab: 'swimlane', item } : { tab: 'swimlane' };
}

export function finishLineHref(route: FinishLineRoute): string {
  if (route.tab === 'matrix') return BASE;
  if (route.tab === 'kebutuhan-data') return `${BASE}/kebutuhan-data`;
  return route.item
    ? `${BASE}/swimlane?item=${encodeURIComponent(route.item)}`
    : `${BASE}/swimlane`;
}

/** The browser-facing wrapper. Safe to call where there is no window. */
export function finishLineRouteFromLocation(): FinishLineRoute | null {
  if (typeof window === 'undefined') return null;
  return parseFinishLineRoute(window.location.pathname, window.location.search);
}

/** True when the address bar is pointing at the Finish line, whatever tab. */
export function isFinishLinePath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  return path === BASE || path.startsWith(`${BASE}/`);
}
