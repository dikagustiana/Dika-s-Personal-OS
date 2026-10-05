/**
 * FSRE BUILDING — THE CUTAWAY PROJECTION. PURE, NO REACT.
 *
 * Ported from the source app as it was (mount report §3.5: a second
 * isometric projection beside src/logic/lab/iso.ts; merging the two is a
 * separate change). Floor units go in, SVG user units come out.
 *
 * Everything that turns a box into polygons also lives here, so components
 * receive finished point strings and never do arithmetic: that is what lets
 * them carry no number literals.
 */
import {
  AGENT_FIGURE,
  FLOOR_SVG,
  FLOOR_UNITS,
  MONITOR_FIGURE,
  PLANT_FIGURE,
  POINT_PRECISION,
  PROJECTION,
} from './geometry';

export interface Pt {
  x: number;
  y: number;
}

/** A box in floor units; `z` is its base height (things resting on furniture). */
export interface Box {
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
  z?: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Foreshortening factor at a depth, for sizing screen-space details. */
export function depthScale(y: number): number {
  return 1 - (PROJECTION.foreshortening * y) / FLOOR_UNITS.depth;
}

export function project(x: number, y: number, z = 0): Pt {
  const f = depthScale(y);
  return {
    x: PROJECTION.centreX + (x - FLOOR_UNITS.width / 2) * PROJECTION.scale * f,
    y: PROJECTION.originY - y * PROJECTION.depthStep - z * PROJECTION.zScale * f,
  };
}

export function ptsToString(pts: readonly Pt[]): string {
  return pts.map((p) => `${p.x.toFixed(POINT_PRECISION)},${p.y.toFixed(POINT_PRECISION)}`).join(' ');
}

/** Screen-space bounding box of a set of points. */
export function boundsOf(pts: readonly Pt[]): Rect {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

/**
 * A rectangle in SVG units as CSS percentages of the floor's box, for the
 * HTML chips, hit buttons and wall text laid over the drawing. The floor's
 * SVG scales with its column, so pixels would drift; percentages do not.
 */
export interface PercentRect {
  left: string;
  top: string;
  width: string;
  height: string;
}

const pct = (value: number, of: number) => `${((value / of) * 100).toFixed(POINT_PRECISION)}%`;

export function toPercentRect(rect: Rect): PercentRect {
  return {
    left: pct(rect.left, FLOOR_SVG.width),
    top: pct(rect.top, FLOOR_SVG.height),
    width: pct(rect.width, FLOOR_SVG.width),
    height: pct(rect.height, FLOOR_SVG.height),
  };
}

export function toPercentPoint(pt: Pt): { left: string; top: string } {
  return { left: pct(pt.x, FLOOR_SVG.width), top: pct(pt.y, FLOOR_SVG.height) };
}

/* ---------- boxes ---------- */

export interface BoxFaces {
  top: string;
  side: string;
  front: string;
}

const baseZ = (box: Box) => box.z ?? 0;

/** The one side face of a box that faces the building's centre. */
function sideFacePoints(box: Box): Pt[] {
  const centre = box.x + box.w / 2;
  const facesRight = centre <= FLOOR_UNITS.width / 2;
  const sx = facesRight ? box.x + box.w : box.x;
  const z = baseZ(box);
  return [project(sx, box.y, z), project(sx, box.y + box.d, z), project(sx, box.y + box.d, z + box.h), project(sx, box.y, z + box.h)];
}

export function boxFaces(box: Box): BoxFaces {
  const z = baseZ(box);
  return {
    top: ptsToString([
      project(box.x, box.y, z + box.h),
      project(box.x + box.w, box.y, z + box.h),
      project(box.x + box.w, box.y + box.d, z + box.h),
      project(box.x, box.y + box.d, z + box.h),
    ]),
    side: ptsToString(sideFacePoints(box)),
    front: ptsToString([
      project(box.x, box.y, z),
      project(box.x + box.w, box.y, z),
      project(box.x + box.w, box.y, z + box.h),
      project(box.x, box.y, z + box.h),
    ]),
  };
}

export function boundsOfBox(box: Box): Rect {
  const z = baseZ(box);
  return boundsOf([
    project(box.x, box.y + box.d, z),
    project(box.x + box.w, box.y + box.d, z),
    project(box.x, box.y, z + box.h),
    project(box.x + box.w, box.y, z + box.h),
  ]);
}

/** A glass room's two halves: the back and inner side first, the top and front last. */
export function glassFaces(box: Box): { back: string[]; front: string[] } {
  return {
    back: [
      ptsToString([
        project(box.x, box.y + box.d, 0),
        project(box.x + box.w, box.y + box.d, 0),
        project(box.x + box.w, box.y + box.d, box.h),
        project(box.x, box.y + box.d, box.h),
      ]),
      ptsToString(sideFacePoints(box)),
    ],
    front: [
      ptsToString([
        project(box.x, box.y, box.h),
        project(box.x + box.w, box.y, box.h),
        project(box.x + box.w, box.y + box.d, box.h),
        project(box.x, box.y + box.d, box.h),
      ]),
      ptsToString([project(box.x, box.y, 0), project(box.x + box.w, box.y, 0), project(box.x + box.w, box.y, box.h), project(box.x, box.y, box.h)]),
    ],
  };
}

/** A footprint drawn flat on the floor, for the selection ring. */
export function footprintPoints(footprint: { x: number; y: number; w: number; d: number }, lift: number): string {
  return ptsToString([
    project(footprint.x, footprint.y, lift),
    project(footprint.x + footprint.w, footprint.y, lift),
    project(footprint.x + footprint.w, footprint.y + footprint.d, lift),
    project(footprint.x, footprint.y + footprint.d, lift),
  ]);
}

/* ---------- figures ---------- */

export interface AgentShape {
  shadow: { cx: number; cy: number; rx: number; ry: number };
  body: { x: number; y: number; width: number; height: number; rx: number };
  head: { cx: number; cy: number; r: number };
}

export function agentShape(x: number, y: number): AgentShape {
  const base = project(x, y, AGENT_FIGURE.bodyZ0);
  const bodyTop = project(x, y, AGENT_FIGURE.bodyZ1);
  const head = project(x, y, AGENT_FIGURE.headZ);
  const bodyWidth = AGENT_FIGURE.bodyWidth * PROJECTION.scale;
  return {
    shadow: {
      cx: base.x,
      cy: project(x, y, 0).y,
      rx: AGENT_FIGURE.shadowRX * PROJECTION.scale,
      ry: AGENT_FIGURE.shadowRY * PROJECTION.depthStep,
    },
    body: { x: base.x - bodyWidth / 2, y: bodyTop.y, width: bodyWidth, height: base.y - bodyTop.y, rx: bodyWidth / 2 },
    head: { cx: head.x, cy: head.y, r: AGENT_FIGURE.headR * PROJECTION.scale },
  };
}

export interface PlantShape {
  pot: BoxFaces;
  crowns: Array<{ cx: number; cy: number; r: number }>;
}

export function plantShape(x: number, y: number): PlantShape {
  const f = depthScale(y);
  return {
    pot: boxFaces({ x: x - PLANT_FIGURE.pot / 2, y: y - PLANT_FIGURE.pot / 2, w: PLANT_FIGURE.pot, d: PLANT_FIGURE.pot, h: PLANT_FIGURE.potH }),
    crowns: PLANT_FIGURE.crowns.map((crown) => {
      const centre = project(x + crown.dx, y, crown.z);
      return { cx: centre.x, cy: centre.y, r: crown.r * PROJECTION.scale * f };
    }),
  };
}

/** The monitor standing on a desk: a stand and a screen, both boxes. */
export function monitorBoxes(desk: Box): Box[] {
  const centreX = desk.x + desk.w / 2;
  const top = baseZ(desk) + desk.h;
  return [
    {
      x: centreX - MONITOR_FIGURE.standW / 2,
      y: desk.y + MONITOR_FIGURE.screenInsetY,
      w: MONITOR_FIGURE.standW,
      d: MONITOR_FIGURE.standW,
      h: MONITOR_FIGURE.standH,
      z: top,
    },
    {
      x: centreX - MONITOR_FIGURE.screenW / 2,
      y: desk.y + MONITOR_FIGURE.screenInsetY,
      w: MONITOR_FIGURE.screenW,
      d: MONITOR_FIGURE.screenD,
      h: MONITOR_FIGURE.screenH,
      z: top + MONITOR_FIGURE.standH,
    },
  ];
}

/** A rectangle on the back wall, as screen points (axis-aligned by construction). */
export function wallRect(x0: number, x1: number, z0: number, z1: number): Rect {
  return boundsOf([project(x0, FLOOR_UNITS.depth, z0), project(x1, FLOOR_UNITS.depth, z1)]);
}

export function wallPoints(x0: number, x1: number, z0: number, z1: number): string {
  return ptsToString([
    project(x0, FLOOR_UNITS.depth, z0),
    project(x1, FLOOR_UNITS.depth, z0),
    project(x1, FLOOR_UNITS.depth, z1),
    project(x0, FLOOR_UNITS.depth, z1),
  ]);
}

/** The floor's shell: the slab under the front edge, the ground, the back and the two side walls. */
export interface FloorShell {
  slab: string;
  ground: string;
  back: string;
  sides: string[];
}

export function floorShell(): FloorShell {
  const frontLeft = project(0, 0, 0);
  const frontRight = project(FLOOR_UNITS.width, 0, 0);
  const { width, depth, height } = FLOOR_UNITS;
  return {
    slab: ptsToString([
      frontLeft,
      frontRight,
      { x: frontRight.x, y: frontRight.y + FLOOR_SVG.slab },
      { x: frontLeft.x, y: frontLeft.y + FLOOR_SVG.slab },
    ]),
    ground: ptsToString([project(0, 0, 0), project(width, 0, 0), project(width, depth, 0), project(0, depth, 0)]),
    back: ptsToString([project(0, depth, 0), project(width, depth, 0), project(width, depth, height), project(0, depth, height)]),
    sides: [0, width].map((x) =>
      ptsToString([project(x, 0, 0), project(x, depth, 0), project(x, depth, height), project(x, 0, height)]),
    ),
  };
}
