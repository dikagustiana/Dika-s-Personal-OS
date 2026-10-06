/**
 * Leads read as leads by position (brief v2 WO-2; v2.1 FX-11), checked on
 * the geometry rather than on a screenshot.
 *
 * A desk's chip stands above its person and reads upward on screen, which in
 * floor units is toward the back of the room: a front-row chip covers what
 * stands behind it at the same x. So "the lead's desk and chip never cover a
 * staff desk or its chip" is a statement about x-ranges: a desk's footprint
 * is the wider of the desk and its chip, centred on the desk, and the lead's
 * must not meet any staff desk's, for every staff count a floor can draw.
 */
import { describe, expect, it } from 'vitest';
import { CHIP_HALF_WIDTH, DEPARTMENT_FLOORS, MAX_STAFF_SLOTS, MIN_STAFF_DESKS, staffSlotBoxes } from './departmentLayout';
import { GATE_ROOMS, type FloorId } from './layout';
import type { Box } from './projection';

function chipFootprint(box: Box): { x0: number; x1: number } {
  const centre = box.x + box.w / 2;
  const half = Math.max(CHIP_HALF_WIDTH, box.w / 2);
  return { x0: centre - half, x1: centre + half };
}

function meets(a: { x0: number; x1: number }, b: { x0: number; x1: number }): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1;
}

const COUNTS: Array<[FloorId, number]> = [
  ...Array.from({ length: MAX_STAFF_SLOTS - MIN_STAFF_DESKS + 1 }, (_, i): [FloorId, number] => ['b1', MIN_STAFF_DESKS + i]),
  ...Array.from({ length: MAX_STAFF_SLOTS - MIN_STAFF_DESKS + 1 }, (_, i): [FloorId, number] => ['f2', MIN_STAFF_DESKS + i]),
  ['f3', MIN_STAFF_DESKS],
];

describe('the department floors (FX-11)', () => {
  it.each(COUNTS)('%s with %i staff desks: the lead’s chip footprint meets no staff desk’s', (floorId, count) => {
    const lead = DEPARTMENT_FLOORS[floorId].lead;
    if (!lead) throw new Error(`${floorId} has no lead`);
    for (const staff of staffSlotBoxes(floorId, count)) {
      expect(meets(chipFootprint(lead.surface), chipFootprint(staff.surface)), staff.id).toBe(false);
    }
  });

  it.each(COUNTS)('%s with %i staff desks: the lead sits at the head of the room, in front of the staff row', (floorId, count) => {
    const lead = DEPARTMENT_FLOORS[floorId].lead;
    if (!lead) throw new Error(`${floorId} has no lead`);
    for (const staff of staffSlotBoxes(floorId, count)) expect(lead.surface.y + lead.surface.d).toBeLessThan(staff.surface.y);
  });

  it.each(COUNTS)('%s with %i staff desks: no two staff desks overlap', (floorId, count) => {
    const boxes = staffSlotBoxes(floorId, count).map((b) => ({ x0: b.surface.x, x1: b.surface.x + b.surface.w }));
    boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => expect(meets(a, b)).toBe(false)));
  });

  it('keeps the review checkers’ row clear of the gate rooms', () => {
    for (const checker of staffSlotBoxes('f3', MIN_STAFF_DESKS)) expect(checker.surface.x + checker.surface.w).toBeLessThanOrEqual(GATE_ROOMS.x0);
  });

  it('seats two companies either side of the lead', () => {
    const lead = DEPARTMENT_FLOORS.b1.lead;
    if (!lead) throw new Error('b1 has no lead');
    const [a, b] = staffSlotBoxes('b1', MIN_STAFF_DESKS);
    expect(a.surface.x + a.surface.w).toBeLessThan(lead.surface.x);
    expect(b.surface.x).toBeGreaterThan(lead.surface.x + lead.surface.w);
  });

  it('would have caught GLM’s seats (negative control): a lead in front of the middle staff desk', () => {
    // GLM's floorLayout.ts at 5b5d186: the lead at x 13.8 in front of a staff row spread evenly over 2.5–27.5.
    const glmLead: Box = { x: 13.8, y: 2.6, w: 2.4, d: 1, h: 0.75 };
    const step = (27.5 - 2.5) / 3;
    const glmStaff: Box[] = [0, 1, 2].map((i) => ({ x: 2.5 + step * (i + 0.5) - 1.2, y: 6, w: 2.4, d: 1, h: 0.75 }));
    expect(glmStaff.some((staff) => meets(chipFootprint(glmLead), chipFootprint(staff)))).toBe(true);
  });
});
