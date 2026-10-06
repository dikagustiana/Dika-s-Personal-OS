/**
 * FSRE BUILDING — EVERY RENDER CONSTANT, IN ONE PLACE.
 *
 * The components under src/views/lab/fsre/ carry no number literals at all
 * (fsreRules.test.ts parses them and fails on one). Every size, offset, count
 * and rate the drawing needs lives here or in layout.ts, so a reviewer who
 * wants to know why a chip sits where it does reads one file instead of
 * forty call sites. The source app scattered 125 literals across three
 * components; this is the fix for that, not a style preference.
 *
 * Units: "floor units" are the cutaway's own grid — x across 0..30, y depth
 * 0..10 with 0 at the open front, z height. Pixels are SVG user units of one
 * floor's viewBox. Nothing here is data: no figure, stage, skill or ticker.
 */

/** The floor's extent in floor units. */
export const FLOOR_UNITS = { width: 30, depth: 10, height: 3 } as const;

/**
 * The cutaway projection, exactly as the source specified it: a front-on
 * view with depth receding upwards and a mild foreshortening, so the back
 * wall is an axis-aligned rectangle in screen space (projection.ts relies on
 * that to lay HTML text over wall features).
 */
export const PROJECTION = {
  centreX: 480,
  scale: 30,
  depthStep: 13.5,
  zScale: 26,
  originY: 226,
  /** Fraction of width lost at the back wall. */
  foreshortening: 0.14,
} as const;

/** One floor's SVG viewBox, and the slab under its front edge. */
export const FLOOR_SVG = { width: 960, height: 252, slab: 14 } as const;

/** Decimal places kept when writing SVG point strings. */
export const POINT_PRECISION = 2;

/** Agent proportions in floor units (shadow, seated body, head). */
export const AGENT_FIGURE = {
  bodyWidth: 0.78,
  bodyZ0: 0.12,
  bodyZ1: 1.15,
  headZ: 1.32,
  headR: 0.21,
  shadowRX: 0.52,
  shadowRY: 0.18,
  /** How far behind its desk's front edge an agent sits. */
  behindDesk: 1.4,
} as const;

/** Potted plant proportions in floor units. */
export const PLANT_FIGURE = {
  pot: 0.56,
  potH: 0.4,
  crowns: [
    { dx: -0.2, z: 0.65, r: 0.4 },
    { dx: 0.22, z: 0.6, r: 0.34 },
    { dx: 0, z: 0.85, r: 0.44 },
  ],
} as const;

/** Desk monitor proportions in floor units. */
export const MONITOR_FIGURE = {
  standW: 0.15,
  standH: 0.3,
  screenW: 1.3,
  screenD: 0.12,
  screenH: 0.7,
  screenInsetY: 0.18,
} as const;

/** Server rack slats, as heights above the rack's base. */
export const RACK_FIGURE = { slatZs: [0.5, 1.1, 1.7], slatInset: 0.12 } as const;

/** A company folder, and how a desk's folders stack. */
export const FOLDER_BOX = { w: 0.9, d: 0.6, h: 0.16 } as const;
export const FOLDER_STACK = {
  /** At most this many folders are drawn on one desk; the chip says the rest. */
  maxDrawn: 3,
  /** Air between stacked folders, in floor units of height. */
  gap: 0.05,
} as const;

/** A document sheet on the partner desk, and how sheets pile up. */
export const DOC_SHEET = {
  w: 0.9,
  d: 0.7,
  h: 0.06,
  gap: 0.03,
  /** At most this many sheets per pile are drawn; a "+N" chip says the rest. */
  maxDrawn: 3,
} as const;

/**
 * How high above a thing its chip is anchored, in floor units of z. The
 * agent chip clears the head; the gate chip clears the room's glass roof.
 */
export const CHIP_HEADROOM = {
  agent: 1.75,
  gate: 0.3,
  folder: 0.14,
  doc: 0.1,
} as const;

/** Chip levels: neighbouring agents alternate so their chips never overlap. */
export const CHIP_STAGGER_LEVELS = 2;

/**
 * Two chips are neighbours when they stand in the same row (their people
 * less than `rowDepth` apart in depth) and less than `width` apart across:
 * about a chip's width at the building's design size. Only neighbours take
 * different levels; a chip with no neighbour stays on the lower one, so a
 * raised chip never climbs onto a wall screen for nothing.
 */
export const CHIP_NEIGHBOUR = { width: 6, rowDepth: 1 } as const;

/**
 * The chips' CSS sizes in px (index.css: .fsre-chip, .fsre-chip-detail,
 * .fsre-chip[data-lead]), for the tests that check on screen that a lead's
 * chip covers no staff desk or chip (FX-11). Keep both in step.
 */
export const CHIP_CSS = { minFontPx: 9, lineHeight: 1.45, lines: 2, paddingXPx: 6, borderPx: 1, staggerGapEm: 0.25, detailMaxPx: 176, leadMaxPx: 128 } as const;

/** The building's narrowest drawn width in px (its scroll container's min-w-[40rem]): chips are largest against the drawing there. */
export const BUILDING_MIN_PX = 640;

/** Hit areas over the drawing, in floor units (the CSS adds the 44px floor). */
export const HIT = {
  agentHalfWidth: 0.9,
  agentHalfDepth: 0.5,
  agentHeight: 1.6,
  folderPad: 0.3,
  folderHeadroom: 0.5,
} as const;

/** The selection ring, in floor units. */
export const RING = {
  lift: 0.03,
  agentHalfWidth: 1.2,
  agentFront: 0.8,
  agentDepth: 1.9,
  folderPad: 0.35,
  deskPadX: 0.5,
  deskPadFront: 0.3,
  deskPadBack: 1.6,
} as const;

/** Wall features: the inset between a frame and its screen. */
export const WALL_FRAME = { insetX: 0.12, insetZ: 0.1 } as const;

/** The 1F stage screen: cells per row. */
export const STAGE_SCREEN = { columns: 7 } as const;

/** The 2F board: at most this many open issues are listed on the wall; the panel lists them all. */
export const ISSUE_BOARD = { maxShown: 2 } as const;

/** The right panel and the search box. */
export const PANEL = {
  /** Events listed in an agent's history before "N earlier" takes over. */
  recentEvents: 12,
  /** Results offered by the search combobox. */
  searchResults: 8,
} as const;

/**
 * Snapshots kept while reducing, so stepping back from event k replays at
 * most this many events instead of all k. Live runs append thousands.
 */
export const CHECKPOINT_EVERY = 64;

/** A floor's box keeps the SVG's proportions, as a CSS aspect-ratio. */
export const FLOOR_ASPECT_RATIO = `${FLOOR_SVG.width} / ${FLOOR_SVG.height}`;
