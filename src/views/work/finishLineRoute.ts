/**
 * THE ONLY REAL URL IN THE APP, and it earns it.
 *
 * Every other view is zustand state with no address, which is fine for a
 * single-user cockpit nobody links into. The Finish line's tabs are
 * different: a cell panel links into the swimlane pre-filtered to that row,
 * and "the swimlane, filtered to Storing cost" is a thing worth bookmarking
 * and worth sending to yourself. So the tabs get paths, and the tab bar
 * pushes history.
 *
 * FOUR tabs since the simulation joined: matrix, swimlane, kebutuhan-data and
 * simulasi. The fourth has an address so a reload and Back/Forward keep it,
 * but it is not a process view and carries NOTHING — no ?item, no ?entity;
 * both are dropped on parse like any other junk parameter.
 *
 * Deliberately NOT a router: four paths and two query parameters do not need
 * one, and adding one would put every other view's addresslessness up for
 * renegotiation. Parsing and formatting live here, pure, so they are
 * testable without a DOM.
 */

export type FinishLineTab = 'matrix' | 'swimlane' | 'kebutuhan-data' | 'simulasi';

/**
 * The entity a bare process URL means. A named constant rather than scattered
 * literals so "the default chain" is one decision; comparisons against it are
 * about DEFAULTNESS, never about SAMB-the-entity — the views themselves carry
 * no per-entity branches.
 */
export const DEFAULT_PROCESS_ENTITY = 'SAMB';

export interface FinishLineRoute {
  tab: FinishLineTab;
  /**
   * A Finish line row id, carried only by the swimlane tab: arriving from a
   * cell means "show me the steps that feed THIS row". Ignored on the other
   * tabs rather than preserved — a stale filter travelling invisibly between
   * tabs is worse than losing it.
   */
  item?: string;
  /**
   * Which entity's chain the two process tabs show (?entity=ARBI). Absent
   * means DEFAULT_PROCESS_ENTITY, so a bare /finish-line/swimlane bookmark
   * keeps meaning the SAMB chain. Never carried by the matrix tab — the
   * matrix IS every entity at once, and an entity context that survived into
   * it would imply a filter that does not exist — nor by the simulation tab,
   * which is no entity's view at all.
   */
  entity?: string;
}

/**
 * THE ONE PREDICATE for "this tab shows an entity's process chain". The
 * entity context (?entity=, prosesEntity) belongs to these tabs and to no
 * other: the matrix IS every entity at once, and a tab that is not a process
 * view must neither carry an entity in its address nor reset the picker by
 * being visited. Four call sites used to spell this as `tab !== 'matrix'`,
 * which meant the same thing only for as long as every other tab was a
 * process tab.
 */
export function isProcessTab(tab: FinishLineTab): tab is 'swimlane' | 'kebutuhan-data' {
  return tab === 'swimlane' || tab === 'kebutuhan-data';
}

const BASE = '/finish-line';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Entity codes as os_finish_line_entities stores them: short upper tokens. */
const ENTITY = /^[A-Z][A-Z0-9]{1,11}$/;

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
  // Before the parameters are even read: the simulation tab takes none, so a
  // stale ?item or ?entity arriving with it is dropped, never carried.
  if (segment === 'simulasi') return { tab: 'simulasi' };
  if (segment !== 'swimlane' && segment !== 'kebutuhan-data') return null;
  const params = new URLSearchParams(search);
  // A junk entity is dropped like a junk item: filtering on garbage would
  // render a confident empty chain for an entity that never existed.
  const entityParam = params.get('entity') ?? '';
  const entity = ENTITY.test(entityParam) ? entityParam : undefined;
  if (segment === 'kebutuhan-data') {
    return entity ? { tab: 'kebutuhan-data', entity } : { tab: 'kebutuhan-data' };
  }
  const item = params.get('item') ?? '';
  const route: FinishLineRoute = { tab: 'swimlane' };
  if (UUID.test(item)) route.item = item;
  if (entity) route.entity = entity;
  return route;
}

export function finishLineHref(route: FinishLineRoute): string {
  if (route.tab === 'simulasi') return `${BASE}/simulasi`;
  if (!isProcessTab(route.tab)) return BASE;
  const params = new URLSearchParams();
  // The default entity stays OUT of the address: a bare URL and an
  // ?entity=SAMB URL are the same claim, and only one of them should exist.
  if (route.entity && route.entity !== DEFAULT_PROCESS_ENTITY) {
    params.set('entity', route.entity);
  }
  if (route.tab === 'swimlane' && route.item) params.set('item', route.item);
  const query = params.toString();
  const path = route.tab === 'kebutuhan-data' ? `${BASE}/kebutuhan-data` : `${BASE}/swimlane`;
  return query ? `${path}?${query}` : path;
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
