import { describe, expect, it } from 'vitest';
import { hexToWorld } from '../hex/hex';
import { CAMPUS, freeTilesOfZone, furnitureOfType } from '../layout/campus';
import { anchorWorldPose, approachHexFor } from '../layout/resolve';
import { campusGraph } from '../pathfinding/campusGraph';
import { WALK_SPEED_MPS, walkDurationSeconds } from './movement';
import { advanceFollow, angleDelta, pathLength, planTrip, startFollow } from './pathFollow';

const graph = campusGraph(CAMPUS);

describe('path following', () => {
  it('moves at constant speed across corners and finishes facing the last segment', () => {
    const wps = [
      { x: 0, z: 0 },
      { x: 2, z: 0 },
      { x: 2, z: 2 },
    ];
    const s = startFollow(wps, 0);
    let t = 0;
    while (!s.done && t < 100) {
      advanceFollow(s, 1, 0.1);
      t += 0.1;
    }
    expect(s.done).toBe(true);
    expect(s.x).toBeCloseTo(2, 6);
    expect(s.z).toBeCloseTo(2, 6);
    expect(t).toBeCloseTo(pathLength(wps), 0);
    // Facing +Z along the final segment → yaw 0.
    expect(Math.abs(angleDelta(s.yaw, 0))).toBeLessThan(1e-6);
  });

  it('a big step that crosses a corner lands on the far segment, not past the corner in a straight line', () => {
    const s = startFollow(
      [
        { x: 0, z: 0 },
        { x: 1, z: 0 },
        { x: 1, z: 1 },
      ],
      0,
    );
    advanceFollow(s, 1, 1.5);
    expect(s.x).toBeCloseTo(1, 6);
    expect(s.z).toBeCloseTo(0.5, 6);
  });

  it('a trip to a workstation ends at its stand anchor, not the tile centre, via the approach tile', () => {
    const lounge = freeTilesOfZone(CAMPUS, 'lounge')[0];
    const desk = furnitureOfType(CAMPUS, 'workstation', 'engineering')[0];
    const from = hexToWorld(lounge);
    const plan = planTrip(CAMPUS, graph, from, lounge, desk.hex, 'anchor_sit');
    expect(plan.unreachable).toBe(false);
    const last = plan.waypoints[plan.waypoints.length - 1];
    const stand = anchorWorldPose(desk, 'anchor_stand');
    expect(last.x).toBeCloseTo(stand.x, 9);
    expect(last.z).toBeCloseTo(stand.z, 9);
    const centre = hexToWorld(desk.hex);
    expect(Math.hypot(last.x - centre.x, last.z - centre.z)).toBeGreaterThan(0.3);
    const approach = hexToWorld(approachHexFor(desk, 'anchor_sit'));
    const beforeLast = plan.waypoints[plan.waypoints.length - 2];
    expect(beforeLast.x).toBeCloseTo(approach.x, 9);
    expect(beforeLast.z).toBeCloseTo(approach.z, 9);
    expect(plan.finalYaw).toBeCloseTo(stand.yaw, 9);
  });

  it('the client walk time agrees with the server schedule for the same route', () => {
    const lounge = freeTilesOfZone(CAMPUS, 'lounge')[0];
    const desk = furnitureOfType(CAMPUS, 'workstation', 'research')[2];
    const plan = planTrip(CAMPUS, graph, hexToWorld(lounge), lounge, desk.hex, 'anchor_sit');
    const clientSeconds = pathLength(plan.waypoints) / WALK_SPEED_MPS;
    // Server counts tiles (route + final tile); the client walks tile centres plus a short anchor leg.
    const serverSeconds = walkDurationSeconds(plan.waypoints.length);
    expect(Math.abs(serverSeconds - clientSeconds)).toBeLessThan(2.5);
    expect(serverSeconds).toBeGreaterThan(clientSeconds - 0.5);
  });

  it('an unreachable destination is flagged, not silently teleported', () => {
    const lounge = freeTilesOfZone(CAMPUS, 'lounge')[0];
    // A sand tile off the paths: no route exists.
    const sand = Array.from(CAMPUS.tiles.values()).find((t) => t.kind === 'sand')!;
    const plan = planTrip(CAMPUS, graph, hexToWorld(lounge), lounge, sand.hex, 'anchor_stand');
    expect(plan.unreachable).toBe(true);
    expect(plan.waypoints).toHaveLength(2);
  });
});
