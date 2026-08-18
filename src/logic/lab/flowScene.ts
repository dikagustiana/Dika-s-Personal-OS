/**
 * Builds the Flow floorplan as DATA — polygons, fills, labels, callouts —
 * from the thirteen stage states. Pure and dependency-free like iso.ts, so
 * the bounds test can construct every variant of the scene and prove that
 * nothing ever falls outside the computed viewBox (the prototype's first
 * bug, silently clipped callouts, is a failing test here).
 *
 * The layout rules it encodes, from the brief:
 *  - thirteen stations on a serpentine across three rows (5/4/4) on a
 *    ~15×9 tile grid, so the path reads left-to-right, back, then
 *    left-to-right again;
 *  - plinths coloured by ACTOR (agent slate, owner amber, gate near-ink);
 *    HUMAN STATIONS ARE PHYSICALLY LARGER, S5 largest of all — the point
 *    of the screen is where work stops and who has to move it;
 *  - blocked stations get a hatched top and a desaturated palette:
 *    barred, not hidden;
 *  - the stage code sits on every top face; full callouts only for the
 *    front line, anything running, and blocked stations — label all
 *    thirteen and they collide;
 *  - path segments carry their own state, drawn per segment;
 *  - agent tokens stand at their station only when that agent actually ran
 *    or is running — an idle-agent crowd would be the UI lying about an
 *    owner-initiated architecture;
 *  - paint back to front: stations sorted by gx + gy; callouts last.
 */
import {
  boundsToViewBox,
  FACE_SHADE,
  iso,
  plinth,
  sceneBounds,
  shade,
  type Bounds,
  type PlinthFaces,
  type Pt,
} from './iso';

export type FlowActor = 'agent' | 'owner' | 'gate';
export type FlowStageStatus = 'done' | 'attention' | 'blocked' | 'idle';

export interface SceneStageInput {
  code: string;
  actor: FlowActor;
  status: FlowStageStatus;
  running: boolean;
  frontLine: boolean;
  /** Non-empty ⇒ this station gets a floating callout (front line /
   *  running / blocked — the caller decides, this module just draws). */
  calloutLines: string[];
  tokens: Array<{ slug: string; color: string }>;
}

/** Literal actor colours — SVG attributes, where var(--…) fails silently. */
export const ACTOR_COLOR: Record<FlowActor, string> = {
  agent: '#5B7089',
  owner: '#9A5200',
  gate: '#232E3C',
};
const BLOCKED_BASE = '#8B95A0';

export const PATH_COLOR = { walked: '#93A3B3', live: '#3B5A7E', ahead: '#C4CED8' } as const;
export const FLOOR_FILL = '#E7EDF2';
export const FLOOR_EDGE = '#C9D4DE';
export const FLOOR_GRID = '#DBE3EA';

/** Center-x, center-y (tiles), footprint side (tiles), height (px). */
interface StationGeom {
  cx: number;
  cy: number;
  side: number;
  h: number;
}

/**
 * The serpentine. Sizes are the hierarchy rule made literal: agents 1.5,
 * owners 2.0, S5 (Verify — the bottleneck the screen exists to show) 2.7,
 * the Finalize gate 1.9 but tallest.
 */
function stationGeom(index: number, actor: FlowActor): StationGeom {
  const ROW_A = [1.6, 4.3, 7.0, 9.7, 12.4];
  const ROW_B = [12.4, 9.4, 6.4, 3.4];
  const ROW_C = [1.6, 4.6, 7.6, 10.9];
  const cx = index <= 4 ? ROW_A[index] : index <= 8 ? ROW_B[index - 5] : ROW_C[index - 9];
  const cy = index <= 4 ? 1.6 : index <= 8 ? 4.6 : 7.6;
  if (index === 5) return { cx, cy, side: 2.7, h: 36 };
  if (actor === 'gate') return { cx, cy, side: 1.9, h: 44 };
  if (actor === 'owner') return { cx, cy, side: 2.0, h: 26 };
  return { cx, cy, side: 1.5, h: 15 };
}

const GRID_W = 15;
const GRID_D = 9;
const CALLOUT_FONT = 10.5;
const CALLOUT_LINE_H = 14;
const CALLOUT_MAX_CHARS = 34;

/** Monospace estimate; the view renders with the same literal font stack,
 *  so the estimated box IS the drawn box and the bounds test is honest. */
export function estTextWidth(text: string, fontPx: number): number {
  return text.length * fontPx * 0.62;
}

export interface ScenePlinth {
  code: string;
  index: number;
  actor: FlowActor;
  status: FlowStageStatus;
  running: boolean;
  frontLine: boolean;
  faces: PlinthFaces;
  fills: { top: string; left: string; right: string };
  hatched: boolean;
  tokens: Array<{ slug: string; color: string; faces: PlinthFaces }>;
}

export interface SceneSegment {
  points: Pt[];
  state: 'walked' | 'live' | 'ahead';
}

export interface SceneCallout {
  code: string;
  leader: [Pt, Pt];
  box: { x: number; y: number; w: number; h: number };
  lines: string[];
}

export interface FlowScene {
  viewBox: string;
  bounds: Bounds;
  floor: { outline: Pt[]; gridLines: Pt[][] };
  segments: SceneSegment[];
  /** Back-to-front paint order, tokens bundled with their station. */
  plinths: ScenePlinth[];
  /** Painted last, above everything. */
  callouts: SceneCallout[];
}

export function buildFlowScene(stages: readonly SceneStageInput[]): FlowScene {
  if (stages.length !== 13) {
    throw new Error(`buildFlowScene expects exactly 13 stages, got ${stages.length}`);
  }

  const geoms = stages.map((stage, index) => stationGeom(index, stage.actor));

  // --- floor -----------------------------------------------------------
  const outline = [
    iso(-0.5, -0.5),
    iso(GRID_W - 0.5, -0.5),
    iso(GRID_W - 0.5, GRID_D - 0.5),
    iso(-0.5, GRID_D - 0.5),
  ];
  const gridLines: Pt[][] = [];
  for (let gx = 0; gx < GRID_W; gx += 1) {
    gridLines.push([iso(gx - 0.5, -0.5), iso(gx - 0.5, GRID_D - 0.5)]);
  }
  for (let gy = 0; gy < GRID_D; gy += 1) {
    gridLines.push([iso(-0.5, gy - 0.5), iso(GRID_W - 0.5, gy - 0.5)]);
  }

  // --- path, per segment, elbowed at row turns --------------------------
  const segments: SceneSegment[] = [];
  for (let index = 0; index < stages.length - 1; index += 1) {
    const from = geoms[index];
    const to = geoms[index + 1];
    const points: Pt[] =
      from.cy === to.cy || from.cx === to.cx
        ? [iso(from.cx, from.cy), iso(to.cx, to.cy)]
        : [iso(from.cx, from.cy), iso(to.cx, from.cy), iso(to.cx, to.cy)];
    const into = stages[index + 1];
    segments.push({
      points,
      state: into.running ? 'live' : into.status === 'done' || into.status === 'attention' ? 'walked' : 'ahead',
    });
  }

  // --- plinths + tokens, painter-sorted ---------------------------------
  const plinths: ScenePlinth[] = stages
    .map((stage, index) => {
      const { cx, cy, side, h } = geoms[index];
      const gx = cx - side / 2;
      const gy = cy - side / 2;
      const base = stage.status === 'blocked' ? BLOCKED_BASE : ACTOR_COLOR[stage.actor];
      const tokens = stage.tokens.map((token, tokenIndex) => ({
        slug: token.slug,
        color: token.color,
        faces: plinth(gx - 0.2 + tokenIndex * 0.85, gy + side + 0.25, 0.6, 0.6, 10),
      }));
      return {
        code: stage.code,
        index,
        actor: stage.actor,
        status: stage.status,
        running: stage.running,
        frontLine: stage.frontLine,
        faces: plinth(gx, gy, side, side, h),
        fills: {
          top: shade(base, FACE_SHADE.top),
          left: shade(base, FACE_SHADE.left),
          right: shade(base, FACE_SHADE.right),
        },
        hatched: stage.status === 'blocked',
        tokens,
        paintOrder: gx + gy,
      };
    })
    .sort((a, b) => a.paintOrder - b.paintOrder)
    .map(({ paintOrder: _paintOrder, ...rest }) => rest);

  // --- callouts, staggered so same-row neighbours cannot overlap --------
  const callouts: SceneCallout[] = [];
  let calloutIndex = 0;
  stages.forEach((stage, index) => {
    if (stage.calloutLines.length === 0) return;
    const { cx, cy, h } = geoms[index];
    const top = iso(cx, cy, h);
    const lines = stage.calloutLines
      .slice(0, 2)
      .map((line) => (line.length > CALLOUT_MAX_CHARS ? `${line.slice(0, CALLOUT_MAX_CHARS - 1)}…` : line));
    const lift = 30 + (calloutIndex % 2) * 40;
    calloutIndex += 1;
    const width = Math.max(...lines.map((line) => estTextWidth(line, CALLOUT_FONT))) + 16;
    const height = lines.length * CALLOUT_LINE_H + 10;
    const leaderTopY = top[1] - lift;
    callouts.push({
      code: stage.code,
      leader: [top, [top[0], leaderTopY]],
      box: { x: top[0] - width / 2, y: leaderTopY - height, w: width, h: height },
      lines,
    });
  });

  // --- bounds from EVERYTHING drawn, then the viewBox --------------------
  const pointGroups: Array<readonly Pt[]> = [outline];
  for (const line of gridLines) pointGroups.push(line);
  for (const segment of segments) pointGroups.push(segment.points);
  for (const entry of plinths) {
    pointGroups.push(entry.faces.top, entry.faces.left, entry.faces.right, [entry.faces.topCenter]);
    for (const token of entry.tokens) {
      pointGroups.push(token.faces.top, token.faces.left, token.faces.right);
    }
  }
  for (const callout of callouts) {
    pointGroups.push(callout.leader, [
      [callout.box.x, callout.box.y],
      [callout.box.x + callout.box.w, callout.box.y + callout.box.h],
    ]);
  }
  const bounds = sceneBounds(...pointGroups);
  return {
    viewBox: boundsToViewBox(bounds, 14),
    bounds,
    floor: { outline, gridLines },
    segments,
    plinths,
    callouts,
  };
}
