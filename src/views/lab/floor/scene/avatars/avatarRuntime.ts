// Per-avatar runtime state: where it is, where it is walking, what pose it
// holds. Plain objects mutated per frame, outside React (C-5). The stream
// decides *what* an avatar is doing (reconcile.ts); this only carries out the
// motion and never changes state on its own (B-1).
import { hexKey, hexToWorld, worldToHex, type HexCoord } from '../../../../../logic/floor/hex/hex';
import { activeCampus } from '../../../../../logic/floor/layout/campus';
import { anchorWorldPose } from '../../../../../logic/floor/layout/resolve';
import type { AnchorName, FurniturePlacement } from '../../../../../logic/floor/layout/types';
import { WALK_SPEED_MPS } from '../../../../../logic/floor/movement/movement';
import { advanceFollow, angleDelta, pathLength, planTrip, startFollow, type FollowState } from '../../../../../logic/floor/movement/pathFollow';
import { campusGraph } from '../../../../../logic/floor/pathfinding/campusGraph';
import { FLOOR_Y } from '../runtime';
import { RIG } from './rig';

/** Body pose / motion. */
export type AvatarPose = 'stand' | 'sit' | 'walk';
/** What the body is doing in that pose; drives the clip choice. */
export type AvatarActivity = 'idle' | 'typing' | 'talking' | 'delivering' | 'waiting';
/** Visible warnings. `stale` is set by the layer from the connection, the rest by the stream. */
export type AvatarAlert = 'none' | 'error' | 'unknown' | 'nodesk' | 'stale';

export interface AvatarRuntime {
  agentId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pose: AvatarPose;
  activity: AvatarActivity;
  /** Holding the document (carry overlay + prop). */
  carrying: boolean;
  alert: AvatarAlert;
  alertText: string;
  /** Collaboration group, for mutual look-at while standing. */
  groupId: string | null;
  /** Task whose hand-over animation already played, so a repeated DELIVERING frame does not replay it. */
  deliveredTaskId: string | null;
  follow: FollowState | null;
  finalYaw: number | null;
  /** Speed multiplier for catch-up walks (reconcile.ts). */
  speedScale: number;
  /** Pose to take when the current walk ends. */
  onArrive: (() => void) | null;
  /** Set when a trip had no route (rendered as a visible warning, never hidden). */
  unreachable: boolean;
  /** Where the avatar is heading, for reconciliation and labels. */
  destination: HexCoord | null;
}

/**
 * The pathfinding graph reads the ACTIVE campus on every query rather than
 * closing over the one that existed at import time — this module loads
 * before the institution's rows do.
 */
const graph = {
  isWalkable: (hex: HexCoord) => campusGraph(activeCampus()).isWalkable(hex),
  canTraverse: (a: HexCoord, b: HexCoord) => campusGraph(activeCampus()).canTraverse(a, b),
  inBounds: (hex: HexCoord) => campusGraph(activeCampus()).inBounds(hex),
};

export const avatarRuntimes = new Map<string, AvatarRuntime>();

export function getOrCreateRuntime(agentId: string, at: HexCoord): AvatarRuntime {
  let rt = avatarRuntimes.get(agentId);
  if (!rt) {
    const w = hexToWorld(at);
    rt = {
      agentId,
      x: w.x,
      y: FLOOR_Y,
      z: w.z,
      yaw: 0,
      pose: 'stand',
      activity: 'idle',
      carrying: false,
      alert: 'none',
      alertText: '',
      groupId: null,
      deliveredTaskId: null,
      follow: null,
      finalYaw: null,
      speedScale: 1,
      onArrive: null,
      unreachable: false,
      destination: null,
    };
    avatarRuntimes.set(agentId, rt);
  }
  return rt;
}

export function removeRuntime(agentId: string): void {
  avatarRuntimes.delete(agentId);
}

/** The tile the avatar currently stands on. */
export function currentHex(rt: AvatarRuntime): HexCoord {
  return worldToHex(rt.x, rt.z);
}

export function furnitureAt(hex: HexCoord): FurniturePlacement | undefined {
  return activeCampus().furnitureByHex.get(hexKey(hex));
}

function stopMoving(rt: AvatarRuntime): void {
  rt.follow = null;
  rt.onArrive = null;
  rt.destination = null;
  rt.speedScale = 1;
}

/** Teleport to a tile centre (first appearance, or a reconciliation snap). */
export function placeAtHex(rt: AvatarRuntime, hex: HexCoord, yaw?: number): void {
  const w = hexToWorld(hex);
  rt.x = w.x;
  rt.z = w.z;
  rt.y = FLOOR_Y;
  if (yaw !== undefined) rt.yaw = yaw;
  stopMoving(rt);
  rt.pose = 'stand';
}

/**
 * Plan and start a walk from the current position to `toHex`. If the tile
 * holds furniture the route ends at its approach tile plus a final leg to the
 * stand/deliver anchor. `onArrive` fires once, when the last waypoint is hit.
 * `maxSeconds` scales the speed up (capped) so a catch-up walk stays short.
 */
export function walkTo(
  rt: AvatarRuntime,
  toHex: HexCoord,
  anchor: AnchorName,
  onArrive: (() => void) | null,
  opts: { carrying?: boolean; maxSeconds?: number } = {},
): void {
  const from = currentHex(rt);
  const plan = planTrip(activeCampus(), graph, { x: rt.x, z: rt.z }, from, toHex, anchor);
  rt.carrying = opts.carrying ?? rt.carrying;
  if (plan.waypoints.length <= 1) {
    stopMoving(rt);
    if (plan.finalYaw !== null) rt.yaw = plan.finalYaw;
    rt.pose = 'stand';
    onArrive?.();
    return;
  }
  rt.follow = startFollow(plan.waypoints, rt.yaw);
  rt.finalYaw = plan.finalYaw;
  rt.unreachable = plan.unreachable;
  rt.destination = toHex;
  rt.pose = 'walk';
  rt.activity = 'idle';
  rt.onArrive = onArrive;
  rt.y = FLOOR_Y;
  const seconds = pathLength(plan.waypoints) / WALK_SPEED_MPS;
  rt.speedScale = opts.maxSeconds && seconds > opts.maxSeconds ? Math.min(3, seconds / opts.maxSeconds) : 1;
}

/** Pose the avatar on a seat anchor: hips on the pan, feet forward on the floor (A-4). */
export function sitAt(rt: AvatarRuntime, furniture: FurniturePlacement, activity: AvatarActivity = 'typing'): void {
  const a = anchorWorldPose(furniture, 'anchor_sit', FLOOR_Y);
  rt.x = a.x + Math.sin(a.yaw) * RIG.sitHipBack;
  rt.z = a.z + Math.cos(a.yaw) * RIG.sitHipBack;
  rt.y = a.y - RIG.sitHipHeight;
  rt.yaw = a.yaw;
  stopMoving(rt);
  rt.pose = 'sit';
  rt.activity = activity;
  rt.carrying = false;
}

/** Stand at a furniture anchor (stand or deliver) facing it. */
export function standAtAnchor(rt: AvatarRuntime, furniture: FurniturePlacement, anchor: AnchorName, activity: AvatarActivity = 'idle'): void {
  const a = anchorWorldPose(furniture, anchor, FLOOR_Y);
  rt.x = a.x;
  rt.z = a.z;
  rt.y = a.y;
  rt.yaw = a.yaw;
  stopMoving(rt);
  rt.pose = 'stand';
  rt.activity = activity;
}

/** Stand where the avatar already is (no micro-snap), or at the tile centre if it is not on the tile. */
export function standAtHex(rt: AvatarRuntime, hex: HexCoord, activity: AvatarActivity = 'idle'): void {
  const here = currentHex(rt);
  if (here.q !== hex.q || here.r !== hex.r) {
    const w = hexToWorld(hex);
    rt.x = w.x;
    rt.z = w.z;
  }
  rt.y = FLOOR_Y;
  stopMoving(rt);
  rt.pose = 'stand';
  rt.activity = activity;
}

/** Advance one frame. Returns true if the avatar arrived this frame. */
export function advanceAvatar(rt: AvatarRuntime, dt: number): boolean {
  if (!rt.follow) return false;
  advanceFollow(rt.follow, WALK_SPEED_MPS * rt.speedScale, dt);
  rt.x = rt.follow.x;
  rt.z = rt.follow.z;
  rt.yaw = rt.follow.yaw;
  if (rt.follow.done) {
    const cb = rt.onArrive;
    const finalYaw = rt.finalYaw;
    stopMoving(rt);
    if (finalYaw !== null) rt.yaw = finalYaw;
    rt.pose = 'stand';
    // Without a confirming event the avatar waits here; it never sits down on its own (B-1).
    rt.activity = 'waiting';
    cb?.();
    return true;
  }
  return false;
}

/** Smoothly turn toward a yaw (mutual look-at for standing collaborators). */
export function turnToward(rt: AvatarRuntime, yaw: number, dt: number, rate = 6): void {
  const d = angleDelta(rt.yaw, yaw);
  const step = rate * dt;
  rt.yaw += Math.abs(d) <= step ? d : Math.sign(d) * step;
}
