// The data-driven layout contract (C-1). Zone membership, furniture and
// anchors are data; scene code reads this and never hardcodes a coordinate.
import type { HexCoord } from '../hex/hex';

export type TileKind = 'sand' | 'path' | 'floor';

/**
 * A department's slug, as it is in os_inst_departments. The floorplan is the
 * org chart (3-E), so this is not an enum of four invented bays any more —
 * it is whatever the institution's rows say.
 */
export type Department = string;

export type ZoneKind =
  | 'deskBay'       // one per department, in pipeline order
  | 'leadOffice'    // adjoining its bay
  | 'meeting'       // that department's peer-review cluster
  | 'programOffice' // positioned to see the pipeline
  | 'committee'     // the committee chamber, where debates happen
  | 'library'       // the corpus: shelves that fill as it grows
  | 'director';     // finished work, proposals, approvals

export interface ZoneDef {
  id: string;
  kind: ZoneKind;
  /** Signage text. */
  label: string;
  /** Matches `taskDetails.department` on the wire for desk bays. */
  department?: Department;
  tiles: HexCoord[];
  /** Glass walls around the zone perimeter, with these edges left open. */
  walled: boolean;
  doors: Array<[inside: HexCoord, outside: HexCoord]>;
  /** Floor tint (linear-ish sRGB hex). */
  floorColor: string;
}

export type FurnitureType =
  | 'workstation'
  | 'meetingTable'
  | 'meetingChair'
  | 'loungeSofa'
  | 'coffeeBar'
  | 'outputTerminal'
  | 'archiveShelf'
  | 'managerDesk'
  | 'plant';

export type AnchorName = 'anchor_sit' | 'anchor_stand' | 'anchor_deliver';

/** A pose local to the furniture's own frame: metres, yaw radians about +Y. Front is +Z. */
export interface LocalTransform {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface FurnitureSpec {
  type: FurnitureType;
  /** Bounding box used for placeholders and collision; metres. */
  dims: { w: number; d: number; h: number };
  /** Does this piece make its tile impassable (except as a path destination)? */
  blocksTile: boolean;
  anchors: Record<AnchorName, LocalTransform>;
  /** Which anchors are meaningful for this type. */
  canSit: boolean;
  canDeliver: boolean;
}

export interface FurniturePlacement {
  id: string;
  type: FurnitureType;
  hex: HexCoord;
  /** Multiples of 60°; see rotationStepsToYaw. */
  rotationSteps: 0 | 1 | 2 | 3 | 4 | 5;
  zoneId: string;
}

export interface TileDef {
  hex: HexCoord;
  kind: TileKind;
  zoneId: string | null;
}

export interface CampusLayout {
  name: string;
  hexRadius: number;
  tiles: Map<string, TileDef>;
  zones: ZoneDef[];
  furniture: FurniturePlacement[];
  /** Edge keys (see edgeKey) that carry a wall segment. */
  walls: Set<string>;
  /** Tile keys made impassable by furniture. */
  blocked: Set<string>;
  furnitureByHex: Map<string, FurniturePlacement>;
  zoneById: Map<string, ZoneDef>;
  /** World-space extents of the tiled area, metres. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}
