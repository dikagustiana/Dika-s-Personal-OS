// Pure path following: waypoints in world XZ, advanced by wall-clock seconds.
// No Three.js; the avatar component copies the result into its Object3D.
import { hexToWorld, type HexCoord, type WorldXZ } from '../hex/hex';
import { findPath, type HexGraph } from '../pathfinding/astar';
import { approachHexFor, anchorWorldPose } from '../layout/resolve';
import type { AnchorName, CampusLayout } from '../layout/types';
import { hexKey } from '../hex/hex';

export interface Waypoint {
  x: number;
  z: number;
}

export interface FollowState {
  waypoints: Waypoint[];
  /** Index of the waypoint currently being approached. */
  index: number;
  x: number;
  z: number;
  /** Yaw the walker is facing, radians about +Y, +Z-forward convention. */
  yaw: number;
  done: boolean;
}

export function startFollow(waypoints: Waypoint[], startYaw: number): FollowState {
  const first = waypoints[0] ?? { x: 0, z: 0 };
  return { waypoints, index: 1, x: first.x, z: first.z, yaw: startYaw, done: waypoints.length <= 1 };
}

/** Shortest signed angle from a to b. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Advance along the waypoints by `speed * dt`, carrying leftover distance
 * across corners so speed is constant. Yaw turns toward the current segment
 * at `turnRate` rad/s. Returns the same object, mutated.
 */
export function advanceFollow(s: FollowState, speed: number, dt: number, turnRate = 10): FollowState {
  if (s.done) return s;
  let remaining = speed * dt;
  while (remaining > 0 && s.index < s.waypoints.length) {
    const target = s.waypoints[s.index];
    const dx = target.x - s.x;
    const dz = target.z - s.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= remaining) {
      s.x = target.x;
      s.z = target.z;
      s.index++;
      remaining -= dist;
      continue;
    }
    s.x += (dx / dist) * remaining;
    s.z += (dz / dist) * remaining;
    remaining = 0;
    const wantYaw = Math.atan2(dx, dz);
    const delta = angleDelta(s.yaw, wantYaw);
    const maxTurn = turnRate * dt;
    s.yaw += Math.abs(delta) <= maxTurn ? delta : Math.sign(delta) * maxTurn;
  }
  if (s.index >= s.waypoints.length) {
    s.done = true;
    // Face along the final segment.
    const n = s.waypoints.length;
    if (n >= 2) {
      const a = s.waypoints[n - 2];
      const b = s.waypoints[n - 1];
      if (Math.hypot(b.x - a.x, b.z - a.z) > 1e-6) s.yaw = Math.atan2(b.x - a.x, b.z - a.z);
    }
  }
  return s;
}

export function pathLength(waypoints: Waypoint[]): number {
  let len = 0;
  for (let i = 1; i < waypoints.length; i++) len += Math.hypot(waypoints[i].x - waypoints[i - 1].x, waypoints[i].z - waypoints[i - 1].z);
  return len;
}

export interface TripPlan {
  waypoints: Waypoint[];
  /** The final yaw to settle into, or null to face along the last segment. */
  finalYaw: number | null;
  /** True if no route existed and the plan is a straight line (a visible fallback, never silent). */
  unreachable: boolean;
}

/**
 * Waypoints for a walk from world position (x, z) on `fromHex` to `toHex`.
 * If the destination tile holds furniture, the route ends on its approach
 * tile and a final leg goes to the requested anchor (A-4: never the tile
 * centre). Otherwise it ends at the tile centre.
 */
export function planTrip(
  layout: CampusLayout,
  graph: HexGraph,
  from: WorldXZ,
  fromHex: HexCoord,
  toHex: HexCoord,
  anchor: AnchorName,
): TripPlan {
  const furniture = layout.furnitureByHex.get(hexKey(toHex));
  const routeGoal = furniture && layout.blocked.has(hexKey(toHex)) ? approachHexFor(furniture, anchor) : toHex;
  const res = findPath(graph, fromHex, routeGoal);
  const waypoints: Waypoint[] = [{ x: from.x, z: from.z }];
  let unreachable = false;
  if (res) {
    // Skip the start tile centre: the walker begins where it actually stands.
    for (let i = 1; i < res.path.length; i++) {
      const w = hexToWorld(res.path[i]);
      waypoints.push({ x: w.x, z: w.z });
    }
  } else {
    unreachable = true;
    const w = hexToWorld(routeGoal);
    waypoints.push({ x: w.x, z: w.z });
  }
  let finalYaw: number | null = null;
  if (furniture) {
    // Walk onto the approach tile, then to the stand anchor, facing the furniture.
    const stand = anchorWorldPose(furniture, anchor === 'anchor_deliver' ? 'anchor_deliver' : 'anchor_stand');
    waypoints.push({ x: stand.x, z: stand.z });
    finalYaw = stand.yaw;
  }
  return { waypoints: dedupe(waypoints), finalYaw, unreachable };
}

function dedupe(points: Waypoint[]): Waypoint[] {
  const out: Waypoint[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.z - p.z) > 1e-4) out.push(p);
  }
  return out;
}
