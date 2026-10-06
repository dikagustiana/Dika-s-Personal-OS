/**
 * FSRE BUILDING v2 — THE DEPARTMENT FLOORS (brief v2 WO-2).
 *
 * Where each floor's seats stand, in floor units (x across 0–30, y depth 0–10
 * with 0 at the front, as in layout.ts and geometry.ts). Each department floor
 * has a lead seat and a staff strip; the lobby holds the router at reception
 * and the methodology agent in the training room; the partner room holds the
 * owner at the partner desk (layout.ts PARTNER_DESK, the same desk the replay
 * has always drawn).
 *
 * Both modes sit on these seats. The synthetic office fills them from the
 * live roster (deskViews.ts); the replay seats its per-skill agents on them
 * through the roster in the data layer (planDepartmentFloors, in
 * departmentPlan.ts). Like layout.ts, this file names no skill and no stage.
 *
 * Seat positions are GLM's (src/layout/floorLayout.ts at 5b5d186), carried
 * over as they were; brief v2.1 FX-11 moves the leads, in its own commit. The
 * wall screens keep this repository's v1 sizes (layout.ts FLOORS) wherever
 * the v2 rooms leave the wall free: the replay writes its stage screen, data
 * counter and issue board on them, and GLM's smaller screens (drawn blank in
 * its synthetic mode) could not hold that text legibly.
 */
import type { DepartmentId } from '../../../data/fsreTransport/contract';
import { AGENT_FIGURE } from './geometry';
import { LOBBY_FALLBACK, PARTNER_DESK, STANDARD_DESK, type Decoration, type FloorId } from './layout';
import type { Box } from './projection';

/** What kind of seat a desk is. The owner's seat is the partner room's desk. */
export type SeatKind = 'lead' | 'staff' | 'router' | 'methodology' | 'partner';

export interface SeatBox {
  id: string;
  surface: Box;
  monitor: boolean;
}

export interface DepartmentFloor {
  floorId: FloorId;
  departmentId: DepartmentId | null;
  /** The lead's desk; null on the lobby and the partner floor. */
  lead: SeatBox | null;
  /** Staff desks spread evenly across this strip, their front edge at `y`. */
  staffStrip: { x0: number; x1: number; y: number } | null;
  /** Seats that are not a department's: reception, the training room, the partner desk. */
  special: Array<{ kind: Exclude<SeatKind, 'lead' | 'staff'>; seat: SeatBox }>;
  decorations: Decoration[];
}

/** At most this many staff desks are drawn on one floor; the floor tag counts the rest (FX-9). */
export const MAX_STAFF_SLOTS = 8;

/** Per-company departments keep one spare unstaffed desk in view (GLM's choice; an open owner question). */
export const SPARE_STAFF_DESKS = 1;

/** A department shows at least this many staff desks (brief v2 WO-2). */
export const MIN_STAFF_DESKS = 2;

function desk(id: string, x: number, y: number, monitor = true): SeatBox {
  return { id, surface: { x, y, w: STANDARD_DESK.w, d: STANDARD_DESK.d, h: STANDARD_DESK.h }, monitor };
}

export const DEPARTMENT_FLOORS: Record<FloorId, DepartmentFloor> = {
  f4: {
    floorId: 'f4',
    departmentId: null,
    lead: null,
    staffStrip: null,
    special: [{ kind: 'partner', seat: { id: 'f4-partner', surface: PARTNER_DESK, monitor: false } }],
    decorations: [
      { kind: 'solid', id: 'partner-chair', box: { x: 14.4, y: 6.6, w: 1.2, d: 0.9, h: 0.9 } },
      { kind: 'solid', id: 'bookshelf', box: { x: 3, y: 9.2, w: 5, d: 0.6, h: 2.2 } },
      { kind: 'plant', id: 'f4-plant-a', x: 26.5, y: 8.2 },
      { kind: 'plant', id: 'f4-plant-b', x: 1.2, y: 1.2 },
    ],
  },
  f3: {
    floorId: 'f3',
    departmentId: 'review',
    lead: desk('f3-lead', 13.8, 2.6),
    staffStrip: { x0: 3, x1: 9.5, y: 2.6 },
    special: [],
    decorations: [
      { kind: 'plant', id: 'f3-plant-a', x: 9.8, y: 1 },
      { kind: 'plant', id: 'f3-plant-b', x: 28.6, y: 1 },
    ],
  },
  f2: {
    floorId: 'f2',
    departmentId: 'modelling',
    lead: desk('f2-lead', 13.8, 2.6),
    staffStrip: { x0: 2.5, x1: 27.5, y: 6 },
    special: [],
    decorations: [
      { kind: 'wall', id: 'issue-board', content: 'issues', x0: 7, x1: 23, z0: 0.75, z1: 2.85 },
      { kind: 'plant', id: 'f2-plant-a', x: 1.2, y: 8.4 },
      { kind: 'plant', id: 'f2-plant-b', x: 28.2, y: 8.4 },
    ],
  },
  f1: {
    floorId: 'f1',
    departmentId: null,
    lead: null,
    staffStrip: null,
    special: [
      { kind: 'router', seat: desk('f1-router', 13.8, 4.6, false) },
      { kind: 'methodology', seat: desk('f1-methodology', 4.5, 7.2, false) },
    ],
    decorations: [
      // The training room's glass stands at the left of the back wall, so the
      // stage screen starts right of it; the lift keeps the v1 corner.
      { kind: 'wall', id: 'stage-screen', content: 'stages', x0: 10, x1: 25, z0: 0.55, z1: 2.85 },
      { kind: 'wall', id: 'lift-doors', content: 'lift', x0: 26, x1: 29, z0: 0, z1: 2.4 },
      { kind: 'solid', id: 'reception', box: { x: 12, y: 3, w: 6, d: 1.2, h: 0.9 } },
      { kind: 'glass', id: 'training-room', box: { x: 1, y: 5, w: 8, d: 5, h: 2.2 } },
      { kind: 'wall', id: 'training-board', content: 'blank', x0: 2, x1: 7, z0: 1.2, z1: 2.4 },
      { kind: 'solid', id: 'f1-bench', box: LOBBY_FALLBACK },
      { kind: 'solid', id: 'f1-seat-a', box: { x: 21, y: 1.2, w: 1.4, d: 1, h: 0.5 } },
      { kind: 'solid', id: 'f1-seat-b', box: { x: 23.2, y: 1.2, w: 1.4, d: 1, h: 0.5 } },
      { kind: 'plant', id: 'f1-plant-a', x: 10, y: 1 },
      { kind: 'plant', id: 'f1-plant-b', x: 28.4, y: 6.5 },
    ],
  },
  b1: {
    floorId: 'b1',
    departmentId: 'data',
    lead: desk('b1-lead', 13.8, 2.6),
    staffStrip: { x0: 2.5, x1: 27.5, y: 6 },
    special: [],
    decorations: [
      { kind: 'wall', id: 'data-counter', content: 'figures', x0: 2, x1: 15, z0: 1.1, z1: 2.5 },
      { kind: 'rack', id: 'rack-a', box: { x: 22.6, y: 8.6, w: 1.1, d: 1, h: 2.4 } },
      { kind: 'rack', id: 'rack-b', box: { x: 23.9, y: 8.6, w: 1.1, d: 1, h: 2.4 } },
      { kind: 'rack', id: 'rack-c', box: { x: 25.2, y: 8.6, w: 1.1, d: 1, h: 2.4 } },
      { kind: 'rack', id: 'rack-d', box: { x: 26.5, y: 8.6, w: 1.1, d: 1, h: 2.4 } },
      { kind: 'plant', id: 'b1-plant-a', x: 1, y: 8.6 },
      { kind: 'plant', id: 'b1-plant-b', x: 28.6, y: 1 },
    ],
  },
};

/** The floor each department works on. */
export const DEPARTMENT_FLOOR: Record<DepartmentId, FloorId> = { data: 'b1', modelling: 'f2', review: 'f3' };

/** Staff desks: `count` of them spread evenly across the floor's staff strip. */
export function staffSlotBoxes(floorId: FloorId, count: number): SeatBox[] {
  const strip = DEPARTMENT_FLOORS[floorId].staffStrip;
  if (!strip || count <= 0) return [];
  const step = (strip.x1 - strip.x0) / count;
  return Array.from({ length: count }, (_, index) => desk(`${floorId}-staff-${index}`, strip.x0 + step * (index + 0.5) - STANDARD_DESK.w / 2, strip.y));
}

/**
 * How many staff desks a department draws for `staffCount` agents: one spare
 * beyond the staff on per-company floors, the standing checkers exactly on
 * review, at least two, at most MAX_STAFF_SLOTS.
 */
export function staffSlotCount(departmentId: DepartmentId, staffCount: number): number {
  const spare = departmentId === 'review' ? 0 : SPARE_STAFF_DESKS;
  return Math.min(MAX_STAFF_SLOTS, Math.max(MIN_STAFF_DESKS, staffCount + spare));
}

/** Where the person at a desk stands: centred, just behind it. */
export function agentSpotAt(surface: Box): { x: number; y: number } {
  return { x: surface.x + surface.w / 2, y: surface.y + AGENT_FIGURE.behindDesk };
}
