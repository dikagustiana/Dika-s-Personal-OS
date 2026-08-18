/**
 * The Flow floorplan's projection — PURE, dependency-free, and the only
 * place isometric math lives. Generated geometry, never hand-authored: the
 * prototype's first bug was a hand-picked viewBox silently clipping the
 * floor plate and the back-row callouts, so the viewBox here is COMPUTED
 * from sceneBounds() plus padding, and iso.test.ts asserts every drawn
 * element falls inside it. That test is the reason this module must stay
 * pure.
 *
 * Projection (the classic 2:1-ish dimetric the brief states):
 *   px = OX + (x − y) · T · cos30
 *   py = OY + (x + y) · T · 0.5 − z
 * OX = OY = 0 on purpose — negative coordinates are legal in SVG once the
 * viewBox is computed, so an origin guess has nothing to compensate for.
 */

export const TILE = 26;
const COS30 = Math.cos(Math.PI / 6);

export type Pt = readonly [number, number];

export function iso(x: number, y: number, z = 0): Pt {
  return [(x - y) * TILE * COS30, (x + y) * TILE * 0.5 - z];
}

export interface PlinthFaces {
  /** Top face, drawn at height h: back, right, front, left corners. */
  top: Pt[];
  /** The two viewer-facing sides. */
  left: Pt[];
  right: Pt[];
  /** Where the stage code sits — the top face's centroid. */
  topCenter: Pt;
}

/**
 * One box on the grid: footprint [gx, gx+w] × [gy, gy+d], height h px.
 * Faces come back as polygons plus per-face shading factors (top lightest,
 * left mid, right darkest) so the caller mixes ONE base colour per actor
 * and the light stays consistent across the whole floor.
 */
export function plinth(gx: number, gy: number, w: number, d: number, h: number): PlinthFaces {
  const a = iso(gx, gy, h);
  const b = iso(gx + w, gy, h);
  const c = iso(gx + w, gy + d, h);
  const e = iso(gx, gy + d, h);
  const cFloor = iso(gx + w, gy + d, 0);
  const bFloor = iso(gx + w, gy, 0);
  const eFloor = iso(gx, gy + d, 0);
  return {
    top: [a, b, c, e],
    left: [e, c, cFloor, eFloor],
    right: [c, b, bFloor, cFloor],
    topCenter: iso(gx + w / 2, gy + d / 2, h),
  };
}

export const FACE_SHADE = { top: 1, left: 0.82, right: 0.66 } as const;

/** Mixes a #rrggbb toward black by `factor` (1 = unchanged). */
export function shade(hex: string, factor: number): string {
  const value = hex.replace('#', '');
  const channel = (offset: number) =>
    Math.round(parseInt(value.slice(offset, offset + 2), 16) * Math.min(Math.max(factor, 0), 1))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * The bounding box of everything the scene will draw — stations, labels,
 * tokens, whatever point sets the caller passes. The viewBox derives from
 * THIS, never from a guess; an empty scene collapses to a zero box at the
 * origin rather than NaN.
 */
export function sceneBounds(...groups: ReadonlyArray<readonly Pt[]>): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const group of groups) {
    for (const [x, y] of group) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

export function boundsToViewBox(bounds: Bounds, padding: number): string {
  return [
    bounds.minX - padding,
    bounds.minY - padding,
    bounds.maxX - bounds.minX + padding * 2,
    bounds.maxY - bounds.minY + padding * 2,
  ]
    .map((value) => Math.round(value * 100) / 100)
    .join(' ');
}
