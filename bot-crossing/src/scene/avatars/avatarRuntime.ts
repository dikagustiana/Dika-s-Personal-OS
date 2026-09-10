'use client';
// Per-avatar runtime state: where it is, where it is walking, what pose it
// holds. Plain objects mutated per frame, outside React (C-5). The stream
// decides *what* an avatar is doing; this only carries out the motion.
import { hexKey, hexToWorld, worldToHex, type HexCoord } from '@/core/hex/hex';
import { CAMPUS } from '@/core/layout/campus';
import { anchorWorldPose } from '@/core/layout/resolve';
import type { AnchorName, FurniturePlacement } from '@/core/layout/types';
import { WALK_SPEED_MPS } from '@/core/movement/movement';
import { advanceFollow, angleDelta, planTrip, startFollow, type FollowState } from '@/core/movement/pathFollow';
import { campusGraph } from '@/core/pathfinding/campusGraph';
import { FLOOR_Y } from '../runtime';
import { RIG } from './rig';

export type AvatarMode = 'stand' | 'walk' | 'sit' | 'talkSit' | 'talkStand' | 'carry' | 'deliver' | 'error' | 'unknown';

export interface AvatarRuntime {
  agentId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  mode: AvatarMode;
  follow: FollowState | null;
  finalYaw: number | null;
  /** Speed multiplier for catch-up walks (see reconciliation in Phase 5). */
  speedScale: number;
  onArrive: (() => void) | null;
  /** Set when a trip had no route (rendered as a visible warning, never hidden). */
  unreachable: boolean;
  /** Where the avatar is heading, for labels and the inspector. */
  destination: HexCoord | null;
}

const graph = campusGraph(CAMPUS);

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
      mode: 'stand',
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

/** Teleport to a tile centre (used only for first appearance and reconciliation snaps). */
export function placeAtHex(rt: AvatarRuntime, hex: HexCoord, yaw?: number): void {
  const w = hexToWorld(hex);
  rt.x = w.x;
  rt.z = w.z;
  rt.y = FLOOR_Y;
  if (yaw !== undefined) rt.yaw = yaw;
  rt.follow = null;
  rt.onArrive = null;
}

/**
 * Plan and start a walk from the current position to `toHex`. If the tile
 * holds furniture the route ends at its approach tile plus a final leg to the
 * stand/deliver anchor. `onArrive` fires once, when the last waypoint is hit.
 */
export function walkTo(rt: AvatarRuntime, toHex: HexCoord, anchor: AnchorName, mode: 'walk' | 'carry', onArrive: (() => void) | null): void {
  const from = currentHex(rt);
  const plan = planTrip(CAMPUS, graph, { x: rt.x, z: rt.z }, from, toHex, anchor);
  rt.follow = startFollow(plan.waypoints, rt.yaw);
  rt.finalYaw = plan.finalYaw;
  rt.unreachable = plan.unreachable;
  rt.destination = toHex;
  rt.mode = mode;
  rt.onArrive = onArrive;
  rt.y = FLOOR_Y;
  if (rt.follow.done) {
    // Already there.
    rt.follow = null;
    if (rt.finalYaw !== null) rt.yaw = rt.finalYaw;
    rt.mode = mode === 'carry' ? 'carry' : 'stand';
    const cb = rt.onArrive;
    rt.onArrive = null;
    cb?.();
  }
}

/** Pose the avatar on a seat anchor: hips on the pan, feet forward on the floor (A-4). */
export function sitAt(rt: AvatarRuntime, furniture: FurniturePlacement, mode: 'sit' | 'talkSit' = 'sit'): void {
  const a = anchorWorldPose(furniture, 'anchor_sit', FLOOR_Y);
  rt.x = a.x + Math.sin(a.yaw) * RIG.sitHipBack;
  rt.z = a.z + Math.cos(a.yaw) * RIG.sitHipBack;
  rt.y = a.y - RIG.sitHipHeight;
  rt.yaw = a.yaw;
  rt.follow = null;
  rt.onArrive = null;
  rt.mode = mode;
  rt.destination = null;
}

/** Stand at a furniture anchor (stand or deliver) facing it. */
export function standAtAnchor(rt: AvatarRuntime, furniture: FurniturePlacement, anchor: AnchorName, mode: AvatarMode = 'stand'): void {
  const a = anchorWorldPose(furniture, anchor, FLOOR_Y);
  rt.x = a.x;
  rt.z = a.z;
  rt.y = a.y;
  rt.yaw = a.yaw;
  rt.follow = null;
  rt.onArrive = null;
  rt.mode = mode;
  rt.destination = null;
}

export function furnitureAt(hex: HexCoord): FurniturePlacement | undefined {
  return CAMPUS.furnitureByHex.get(hexKey(hex));
}

/** Advance one frame. Returns true if the avatar arrived this frame. */
export function advanceAvatar(rt: AvatarRuntime, dt: number): boolean {
  if (!rt.follow) return false;
  advanceFollow(rt.follow, WALK_SPEED_MPS * rt.speedScale, dt);
  rt.x = rt.follow.x;
  rt.z = rt.follow.z;
  rt.yaw = rt.follow.yaw;
  if (rt.follow.done) {
    rt.follow = null;
    if (rt.finalYaw !== null) rt.yaw = rt.finalYaw;
    rt.speedScale = 1;
    rt.mode = rt.mode === 'carry' ? 'carry' : 'stand';
    const cb = rt.onArrive;
    rt.onArrive = null;
    cb?.();
    return true;
  }
  return false;
}

/** Smoothly turn toward a yaw (used for mutual look-at once seated/standing). */
export function turnToward(rt: AvatarRuntime, yaw: number, dt: number, rate = 6): void {
  const d = angleDelta(rt.yaw, yaw);
  const step = rate * dt;
  rt.yaw += Math.abs(d) <= step ? d : Math.sign(d) * step;
}
