// World-space resolution of layout data: where a piece of furniture sits, where
// its anchors are, and which tile a walker must arrive on to use an anchor.
import {
  HEX_DIRECTIONS,
  hexAdd,
  hexToWorld,
  rotationStepsToYaw,
  type HexCoord,
  type HexDirection,
} from '../hex/hex';
import { FURNITURE_SPECS } from './furnitureSpecs';
import type { AnchorName, FurniturePlacement, LocalTransform } from './types';

export interface WorldPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** Furniture origin: tile centre at floor level, yawed by its rotation steps. */
export function furnitureWorldPose(p: FurniturePlacement, floorY = 0): WorldPose {
  const c = hexToWorld(p.hex);
  return { x: c.x, y: floorY, z: c.z, yaw: rotationStepsToYaw(p.rotationSteps) };
}

/** Rotate a local offset by yaw and add it to a world pose. */
export function localToWorld(base: WorldPose, local: LocalTransform): WorldPose {
  const s = Math.sin(base.yaw);
  const c = Math.cos(base.yaw);
  return {
    x: base.x + local.x * c + local.z * s,
    y: base.y + local.y,
    z: base.z - local.x * s + local.z * c,
    yaw: base.yaw + local.yaw,
  };
}

export function anchorWorldPose(p: FurniturePlacement, anchor: AnchorName, floorY = 0): WorldPose {
  const spec = FURNITURE_SPECS[p.type];
  return localToWorld(furnitureWorldPose(p, floorY), spec.anchors[anchor]);
}

/**
 * The neighbour tile a walker should stand on before stepping to an anchor.
 * Pathfinding targets this tile; the final leg is a straight walk from its
 * centre to the anchor, so nobody clips through the furniture.
 *
 * The side is taken from anchor_stand for a seat (a chair's seat anchor leans
 * toward the table, but you get onto it from behind) and from the anchor's own
 * offset otherwise (a delivery point is on whichever face receives visitors).
 */
export function approachHexFor(p: FurniturePlacement, anchor: AnchorName): HexCoord {
  const base = furnitureWorldPose(p);
  const a = anchorWorldPose(p, anchor === 'anchor_sit' ? 'anchor_stand' : anchor);
  const dx = a.x - base.x;
  const dz = a.z - base.z;
  let best: HexDirection = 0;
  let bestDot = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < 6; i++) {
    const n = hexToWorld(HEX_DIRECTIONS[i]);
    const dot = dx * n.x + dz * n.z;
    if (dot > bestDot) {
      bestDot = dot;
      best = i as HexDirection;
    }
  }
  return hexAdd(p.hex, HEX_DIRECTIONS[best]);
}
