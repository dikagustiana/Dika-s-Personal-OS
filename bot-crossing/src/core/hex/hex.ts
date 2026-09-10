// Axial hex coordinates and the world mapping. Pure: no Three.js, no React.
//
// Conventions, fixed once here so every other module inherits them:
//   - Axial (q, r), pointy-top orientation. A row (constant r) runs along
//     world X; consecutive rows are offset half a tile.
//   - honeycomb-grid's 2D point (x, y) maps to world (x, z). Y is up.
//   - The six neighbour directions are indexed 0..5 starting at +q ("east")
//     and going anticlockwise when viewed from above with +X right and +Z
//     down the screen. Furniture rotation is a multiple of these steps, so
//     anything rotated by `rotationStepsToYaw` faces a neighbour, never a
//     vertex — the layout reads as deliberate rather than scattered (C-1).
import { Orientation, defineHex, hexToOffset, offsetToCube, pointToCube, round } from 'honeycomb-grid';

export interface HexCoord {
  q: number;
  r: number;
}

/** Circumradius of one tile in metres. Flat-to-flat width is √3 × this ≈ 2.0 m. */
export const HEX_RADIUS = 1.15;

const HEX_SETTINGS = {
  dimensions: { xRadius: HEX_RADIUS, yRadius: HEX_RADIUS },
  orientation: Orientation.POINTY,
  origin: { x: 0, y: 0 },
  offset: -1 as const,
};

/** The honeycomb-grid hex class for this campus; used for point picking and traversers. */
export const CampusHex = defineHex({
  dimensions: HEX_RADIUS,
  orientation: Orientation.POINTY,
  origin: { x: 0, y: 0 },
  offset: -1,
});

const SQRT3 = Math.sqrt(3);

export function hexKey(h: HexCoord): string {
  return `${h.q},${h.r}`;
}

export function parseHexKey(key: string): HexCoord {
  const [q, r] = key.split(',').map(Number);
  return { q, r };
}

export function hexEquals(a: HexCoord | null | undefined, b: HexCoord | null | undefined): boolean {
  if (!a || !b) return a === b;
  return a.q === b.q && a.r === b.r;
}

export function hexAdd(a: HexCoord, b: HexCoord): HexCoord {
  return { q: a.q + b.q, r: a.r + b.r };
}

export function hexScale(a: HexCoord, k: number): HexCoord {
  return { q: a.q * k, r: a.r * k };
}

/** Cube-coordinate distance in tiles. */
export function hexDistance(a: HexCoord, b: HexCoord): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  const ds = -dq - dr;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds));
}

/** Direction index 0..5 → axial delta. 0 = +q (east), anticlockwise from above. */
export const HEX_DIRECTIONS: readonly HexCoord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export type HexDirection = 0 | 1 | 2 | 3 | 4 | 5;

export function hexNeighbor(h: HexCoord, dir: HexDirection): HexCoord {
  return hexAdd(h, HEX_DIRECTIONS[dir]);
}

export function hexNeighbors(h: HexCoord): HexCoord[] {
  return HEX_DIRECTIONS.map((d) => hexAdd(h, d));
}

/** Direction index from `a` to an adjacent `b`, or null if not adjacent. */
export function directionBetween(a: HexCoord, b: HexCoord): HexDirection | null {
  const dq = b.q - a.q;
  const dr = b.r - a.r;
  const idx = HEX_DIRECTIONS.findIndex((d) => d.q === dq && d.r === dr);
  return idx === -1 ? null : (idx as HexDirection);
}

/** The ring of tiles at exactly `radius` from `center`. 6 × radius tiles; the centre itself for radius 0. */
export function hexRing(center: HexCoord, radius: number): HexCoord[] {
  if (radius <= 0) return [{ ...center }];
  const out: HexCoord[] = [];
  // Start at the tile `radius` steps in direction 4 (south-west) so walking
  // anticlockwise through directions 0..5 traces the ring.
  let cur = hexAdd(center, hexScale(HEX_DIRECTIONS[4], radius));
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      out.push(cur);
      cur = hexNeighbor(cur, side as HexDirection);
    }
  }
  return out;
}

/** All tiles within `radius` of `center`, centre first, then ring by ring. */
export function hexSpiral(center: HexCoord, radius: number): HexCoord[] {
  const out: HexCoord[] = [];
  for (let k = 0; k <= radius; k++) out.push(...hexRing(center, k));
  return out;
}

/** Round fractional axial coordinates to the nearest tile (cube rounding). */
export function hexRound(q: number, r: number): HexCoord {
  const rounded = round({ q, r, s: -q - r });
  // `+ 0` folds a -0 from rounding into 0 so keys and equality stay exact.
  return { q: rounded.q + 0, r: rounded.r + 0 };
}

/** Tiles on the straight line from `a` to `b`, inclusive. */
export function hexLine(a: HexCoord, b: HexCoord): HexCoord[] {
  const n = hexDistance(a, b);
  if (n === 0) return [{ ...a }];
  const out: HexCoord[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // Nudge off exact edge midpoints so rounding is deterministic.
    out.push(hexRound(a.q + (b.q - a.q) * t + 1e-6, a.r + (b.r - a.r) * t + 1e-6));
  }
  return out;
}

export interface WorldXZ {
  x: number;
  z: number;
}

/** Tile centre in world metres. Same formula honeycomb-grid uses for pointy hexes; kept inline so hot paths allocate nothing. */
export function hexToWorld(h: HexCoord): WorldXZ {
  return {
    x: HEX_RADIUS * SQRT3 * (h.q + h.r / 2),
    z: HEX_RADIUS * 1.5 * h.r,
  };
}

/** Writes the tile centre into `out` and returns it. */
export function hexToWorldInto(h: HexCoord, out: WorldXZ): WorldXZ {
  out.x = HEX_RADIUS * SQRT3 * (h.q + h.r / 2);
  out.z = HEX_RADIUS * 1.5 * h.r;
  return out;
}

/** The tile under a world point (for click picking). */
export function worldToHex(x: number, z: number): HexCoord {
  const cube = pointToCube(HEX_SETTINGS, { x, y: z });
  return { q: cube.q + 0, r: cube.r + 0 };
}

/** Offset (col, row) → axial, using honeycomb-grid's convention for this campus (odd rows shifted). */
export function offsetToAxial(col: number, row: number): HexCoord {
  const cube = offsetToCube(HEX_SETTINGS, { col, row });
  return { q: cube.q, r: cube.r };
}

export function axialToOffset(h: HexCoord): { col: number; row: number } {
  return hexToOffset({ q: h.q, r: h.r, offset: -1, isPointy: true });
}

/** The six corners of a tile in world XZ, starting from the +Z ("pointy") corner, anticlockwise from above. */
export function hexCornersWorld(h: HexCoord, inset = 0): WorldXZ[] {
  const c = hexToWorld(h);
  const rad = HEX_RADIUS - inset;
  const corners: WorldXZ[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i;
    corners.push({ x: c.x + rad * Math.sin(angle), z: c.z + rad * Math.cos(angle) });
  }
  return corners;
}

/**
 * Yaw (radians about +Y) that makes an object whose local front is +Z face
 * neighbour direction `steps`. Multiples of 60°, aligned with tile edges.
 */
export function rotationStepsToYaw(steps: number): number {
  const s = ((steps % 6) + 6) % 6;
  const d = HEX_DIRECTIONS[s];
  const w = hexToWorld(d);
  return Math.atan2(w.x, w.z);
}

/** Yaw for an object at `from` to face `to` (world positions). */
export function yawToward(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return Math.atan2(toX - fromX, toZ - fromZ);
}

/** Canonical key for the edge shared by two adjacent tiles; order-independent. */
export function edgeKey(a: HexCoord, b: HexCoord): string {
  const ka = hexKey(a);
  const kb = hexKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

/** Tiles of an axial-aligned rectangle given in offset coordinates. */
export function offsetRect(col0: number, row0: number, cols: number, rows: number): HexCoord[] {
  const out: HexCoord[] = [];
  for (let row = row0; row < row0 + rows; row++) {
    for (let col = col0; col < col0 + cols; col++) out.push(offsetToAxial(col, row));
  }
  return out;
}
