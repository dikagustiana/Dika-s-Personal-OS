// Per-type dimensions and anchors (A-4). Anchors are authored here, in the
// furniture's local frame, because the placeholder geometry is authored in
// code too; a GLTF replacement must carry empties with these same names and
// the loader will prefer the asset's own nodes when present.
import type { FurnitureSpec, FurnitureType, LocalTransform } from './types';

const T = (x: number, y: number, z: number, yaw = 0): LocalTransform => ({ x, y, z, yaw });

/**
 * Chair pan height. The avatar rig's seated clip rests its hips 0.49 m above
 * the floor (measured from the clip), so every seat surface sits there and a
 * seated avatar's origin lands on the floor with its hips on the pan.
 */
export const SEAT_HEIGHT = 0.49;

export const FURNITURE_SPECS: Record<FurnitureType, FurnitureSpec> = {
  workstation: {
    type: 'workstation',
    dims: { w: 1.4, d: 0.7, h: 0.75 },
    blocksTile: true,
    // The desk sits on the +Z half of the tile; the agent sits on the -Z half
    // facing +Z, and approaches from the -Z neighbour.
    anchors: {
      anchor_sit: T(0, SEAT_HEIGHT, -0.28),
      anchor_stand: T(0, 0, -0.66),
      anchor_deliver: T(0, 0, -0.66),
    },
    canSit: true,
    canDeliver: false,
  },
  meetingTable: {
    type: 'meetingTable',
    dims: { w: 1.6, d: 1.6, h: 0.74 },
    blocksTile: true,
    anchors: {
      anchor_sit: T(0, SEAT_HEIGHT, -0.9),
      anchor_stand: T(0, 0, -0.95),
      anchor_deliver: T(0, 0, -0.95),
    },
    canSit: false,
    canDeliver: false,
  },
  meetingChair: {
    type: 'meetingChair',
    dims: { w: 0.55, d: 0.55, h: 0.9 },
    blocksTile: true,
    // Faces +Z toward the table at the ring centre.
    anchors: {
      anchor_sit: T(0, SEAT_HEIGHT, 0.05),
      anchor_stand: T(0, 0, -0.5),
      anchor_deliver: T(0, 0, -0.5),
    },
    canSit: true,
    canDeliver: false,
  },
  loungeSofa: {
    type: 'loungeSofa',
    dims: { w: 1.8, d: 0.8, h: 0.8 },
    blocksTile: true,
    anchors: {
      anchor_sit: T(0, SEAT_HEIGHT, 0.05),
      anchor_stand: T(0, 0, -0.7),
      anchor_deliver: T(0, 0, -0.7),
    },
    canSit: true,
    canDeliver: false,
  },
  coffeeBar: {
    type: 'coffeeBar',
    dims: { w: 1.6, d: 0.6, h: 0.95 },
    blocksTile: true,
    anchors: {
      anchor_sit: T(0, SEAT_HEIGHT, -0.7),
      anchor_stand: T(0, 0, -0.75),
      anchor_deliver: T(0, 0, -0.75),
    },
    canSit: false,
    canDeliver: false,
  },
  outputTerminal: {
    type: 'outputTerminal',
    dims: { w: 1.2, d: 0.6, h: 1.9 },
    blocksTile: true,
    // The kiosk face is toward -Z; the agent delivers standing in front of it.
    anchors: {
      anchor_sit: T(0, SEAT_HEIGHT, -0.7),
      anchor_stand: T(0, 0, -0.72),
      anchor_deliver: T(0, 0, -0.72),
    },
    canSit: false,
    canDeliver: true,
  },
  archiveShelf: {
    type: 'archiveShelf',
    dims: { w: 1.6, d: 0.5, h: 2.0 },
    blocksTile: true,
    anchors: {
      anchor_sit: T(0, SEAT_HEIGHT, -0.7),
      anchor_stand: T(0, 0, -0.75),
      anchor_deliver: T(0, 0, -0.75),
    },
    canSit: false,
    canDeliver: false,
  },
  managerDesk: {
    type: 'managerDesk',
    dims: { w: 2.0, d: 0.9, h: 0.76 },
    blocksTile: true,
    // The manager sits behind the desk (-Z side) facing +Z; visitors deliver
    // to the +Z face, which is why deliver points the other way.
    anchors: {
      anchor_sit: T(0, SEAT_HEIGHT, -0.4),
      anchor_stand: T(0, 0, -0.78),
      anchor_deliver: T(0, 0, 0.82, Math.PI),
    },
    canSit: true,
    canDeliver: true,
  },
  plant: {
    type: 'plant',
    dims: { w: 0.6, d: 0.6, h: 1.4 },
    blocksTile: true,
    anchors: {
      anchor_sit: T(0, SEAT_HEIGHT, -0.6),
      anchor_stand: T(0, 0, -0.7),
      anchor_deliver: T(0, 0, -0.7),
    },
    canSit: false,
    canDeliver: false,
  },
};
