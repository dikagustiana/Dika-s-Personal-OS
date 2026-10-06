/**
 * Leads read as leads by position (brief v2 WO-2; v2.1 FX-11): the seats.
 * The lead sits at the head of the room with no staff desk behind it, wider
 * than the lead's capped chip either side; deskScene.test.ts checks the chips
 * themselves on screen, at the building's narrowest width.
 */
import { describe, expect, it } from 'vitest';
import { DEPARTMENT_FLOORS, MAX_STAFF_SLOTS, MIN_STAFF_DESKS, staffSlotBoxes } from './departmentLayout';
import { GATE_ROOMS, type FloorId } from './layout';
import type { Box } from './projection';

/** A desk widened by the given margin either side, across the room. */
function across(box: Box, margin = 0): { x0: number; x1: number } {
  return { x0: box.x - margin, x1: box.x + box.w + margin };
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
  it.each(COUNTS)('%s with %i staff desks: no staff desk stands behind the lead', (floorId, count) => {
    const lead = DEPARTMENT_FLOORS[floorId].lead;
    if (!lead) throw new Error(`${floorId} has no lead`);
    for (const staff of staffSlotBoxes(floorId, count)) expect(meets(across(lead.surface), across(staff.surface)), staff.id).toBe(false);
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

  it('would have caught GLM’s seats (negative control): a staff desk right behind the lead', () => {
    // GLM's floorLayout.ts at 5b5d186: the lead at x 13.8 in front of a staff row spread evenly over 2.5–27.5.
    const glmLead: Box = { x: 13.8, y: 2.6, w: 2.4, d: 1, h: 0.75 };
    const step = (27.5 - 2.5) / 3;
    const glmStaff: Box[] = [0, 1, 2].map((i) => ({ x: 2.5 + step * (i + 0.5) - 1.2, y: 6, w: 2.4, d: 1, h: 0.75 }));
    expect(glmStaff.some((staff) => meets(across(glmLead), across(staff)))).toBe(true);
  });
});
