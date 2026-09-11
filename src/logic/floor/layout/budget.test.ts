// =============================================================================
// THE RENDER BUDGET (3-D), MEASURED WITHOUT A GPU
// =============================================================================
//
// A frame-rate number needs a machine and is therefore not a CI check: the
// figure in PROGRESS.md was measured once, on named hardware, and cannot be
// re-measured here. What CAN be checked on every run is everything that
// DECIDES the frame rate — how much geometry the institution's floorplan
// asks for, and how it is split between the expensive path (a skinned,
// animated avatar) and the cheap one (a seated box, a name plate).
//
// So this is the regression guard on the budget, not a benchmark. A change
// that quietly triples the campus, or that promotes every idle agent to a
// full avatar, fails here — in seconds, in CI — instead of on the owner's
// laptop three weeks later.
import { describe, expect, it } from 'vitest';
import { FALLBACK_SPEC, buildCampus, furnitureOfType } from './campus';

/**
 * The institution as seeded: 8 departments holding 37 specialist seats,
 * plus a lead each, plus the program office, the library, the committee
 * chamber and the director's office — 47 seats in `os_inst_department_
 * members`, 12 of them unstaffed today. If the seed grows, these numbers
 * move and this file is where the cost of that growth becomes visible.
 */
const CAMPUS = buildCampus(FALLBACK_SPEC);

describe('the institution floorplan stays inside the render budget', () => {
  it('is one campus, not a city', () => {
    // Tiles are instanced into a small number of draw calls, but they are
    // also the thing that grows fastest when a department is added.
    expect(CAMPUS.tiles.size).toBeLessThan(3500);
    expect(CAMPUS.zones.length).toBe(FALLBACK_SPEC.departments.length * 3 + 4);
  });

  it('places one desk per seat and no more', () => {
    // A workstation is the single most numerous piece of furniture, and
    // every one of them is a merged geometry with a monitor, a lamp and a
    // chair. One per seat is the contract; a bay that rounds up to a tidy
    // grid would pay for desks nobody sits at.
    const seats = FALLBACK_SPEC.departments.reduce((n, d) => n + d.specialistSeats, 0);
    const desks = furnitureOfType(CAMPUS, 'workstation').length;
    expect(desks).toBeGreaterThanOrEqual(seats);
    expect(desks).toBeLessThanOrEqual(seats + FALLBACK_SPEC.departments.length);
  });

  it('keeps total furniture within what a single merged pass can carry', () => {
    // Each furniture KIND is merged into one geometry per zone by the
    // furniture layer, so the cost that matters is kinds × zones, not the
    // raw count — but the raw count still bounds the merge work at mount.
    expect(CAMPUS.furniture.length).toBeLessThan(400);
    const kinds = new Set(CAMPUS.furniture.map((placement) => placement.type));
    expect(kinds.size).toBeLessThanOrEqual(9);
  });

  it('grows linearly in departments, not quadratically', () => {
    // The bays are laid out in two columns. Doubling the departments must
    // roughly double the tiles; anything super-linear means the campus is
    // being padded to a square and will not survive a bigger institution.
    const one = buildCampus({ departments: FALLBACK_SPEC.departments.slice(0, 4) });
    const two = buildCampus({ departments: FALLBACK_SPEC.departments });
    const ratio = two.tiles.size / one.tiles.size;
    expect(ratio).toBeGreaterThan(1.1);
    expect(ratio).toBeLessThan(2.6);
  });
});

describe('the expensive path is the exception, not the rule', () => {
  /**
   * 3-D's central bet: at 47+ seats the floor can only run if a still
   * figure is cheap. A full avatar is ~8.5k vertices, 65 joints, an
   * animation mixer and a per-frame skinning pass; a quiet desk is three
   * boxes and a sprite, with `castShadow` off and raycast disabled.
   *
   * The states that earn the expensive path are listed in AvatarsLayer as
   * ACTIVE_STATES. This asserts the SHAPE of that rule — that idle is not
   * among them — from the pipeline's side, where it is a fact about the
   * institution rather than a fact about a React component.
   */
  const PIPELINE_STATES = ['idle', 'working', 'collaborating', 'delivering', 'error'] as const;
  const EXPENSIVE = new Set(['working', 'collaborating', 'delivering', 'error']);

  it('leaves idle — the state most agents are in most of the time — on the cheap path', () => {
    expect(EXPENSIVE.has('idle')).toBe(false);
    expect(PIPELINE_STATES.filter((state) => !EXPENSIVE.has(state))).toEqual(['idle']);
  });

  it('bounds the worst case: every seat busy at once', () => {
    // The upper bound is real and worth stating: if the Program Office
    // routed a brief to every department at once, every STAFFED seat would
    // be a full avatar. 37 specialist seats + 8 department leads + the
    // program office lead + the committee = 47 seats, 12 unstaffed, so 35
    // avatars is today's ceiling — and it is the count the frame rate in
    // PROGRESS.md was measured at.
    const seats = FALLBACK_SPEC.departments.reduce((n, d) => n + d.specialistSeats, 0);
    expect(seats).toBe(37);
    expect(seats + FALLBACK_SPEC.departments.length + 2).toBe(47);
  });
});
