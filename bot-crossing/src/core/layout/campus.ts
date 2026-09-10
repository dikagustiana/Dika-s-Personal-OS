// The one campus. Everything here is data: zones as tile sets, furniture as
// (hex, type, rotation) rows, doors as edges. Scene code reads the resolved
// CampusLayout and never hardcodes a coordinate; changing the floorplan is
// editing this file and re-running the layout tests.
//
// Coordinates below are offset (col, row) because rooms are rectangles and
// rectangles are easiest to read that way; they are converted to axial once,
// at build time.
import {
  HEX_RADIUS,
  directionBetween,
  edgeKey,
  hexKey,
  hexNeighbors,
  hexRing,
  hexSpiral,
  hexToWorld,
  offsetRect,
  offsetToAxial,
  type HexCoord,
  type HexDirection,
} from '../hex/hex';
import { FURNITURE_SPECS } from './furnitureSpecs';
import type { CampusLayout, FurniturePlacement, FurnitureType, TileDef, ZoneDef } from './types';

export const CAMPUS_COLS = 33;
export const CAMPUS_ROWS = 23;

const O = offsetToAxial;

function door(insideCol: number, insideRow: number, outsideCol: number, outsideRow: number): [HexCoord, HexCoord] {
  return [O(insideCol, insideRow), O(outsideCol, outsideRow)];
}

function steps(n: number): 0 | 1 | 2 | 3 | 4 | 5 {
  return (((n % 6) + 6) % 6) as 0 | 1 | 2 | 3 | 4 | 5;
}

type PlacementInput = { type: FurnitureType; rot: number } & (
  | { col: number; row: number; axial?: undefined }
  | { axial: HexCoord; col?: undefined; row?: undefined }
);

interface ZoneInput {
  def: ZoneDef;
  furniture: PlacementInput[];
}

/** A desk bay: 8 × 5 tiles, two rows of three workstations facing north-east, aisles behind them. */
function deskBay(
  id: string,
  label: string,
  department: ZoneDef['department'],
  col0: number,
  row0: number,
  floorColor: string,
): ZoneInput {
  const furniture: PlacementInput[] = [];
  for (const row of [row0 + 1, row0 + 3]) {
    for (const col of [col0 + 1, col0 + 3, col0 + 5]) {
      furniture.push({ type: 'workstation', col, row, rot: 1 });
    }
  }
  furniture.push({ type: 'plant', col: col0 + 7, row: row0 + 4, rot: 0 });
  return {
    def: {
      id,
      kind: 'deskBay',
      label,
      department,
      tiles: offsetRect(col0, row0, 8, 5),
      walled: true,
      doors: [door(col0 + 3, row0, col0 + 3, row0 - 1)],
      floorColor,
    },
    furniture,
  };
}

/** A meeting room: a hex cluster of radius 2, table in the centre, six chairs facing it, door to the west. */
function meetingRoom(id: string, label: string, centerCol: number, centerRow: number): ZoneInput {
  const center = O(centerCol, centerRow);
  const chairs: PlacementInput[] = hexRing(center, 1).map((c) => {
    const dir = directionBetween(c, center);
    if (dir === null) throw new Error('ring-1 tile must be adjacent to the centre');
    return { type: 'meetingChair', axial: c, rot: dir };
  });
  const west2 = { q: center.q - 2, r: center.r };
  const west3 = { q: center.q - 3, r: center.r };
  return {
    def: {
      id,
      kind: 'meeting',
      label,
      tiles: hexSpiral(center, 2),
      walled: true,
      doors: [[west2, west3]],
      floorColor: '#cbc2b4',
    },
    furniture: [{ type: 'meetingTable', axial: center, rot: 0 }, ...chairs],
  };
}

const ZONES: ZoneInput[] = [
  {
    def: {
      id: 'lounge',
      kind: 'lounge',
      label: 'Coffee Lounge',
      tiles: offsetRect(3, 2, 7, 5),
      walled: true,
      doors: [door(6, 6, 6, 7)],
      floorColor: '#dcc7ad',
    },
    furniture: [
      { type: 'loungeSofa', col: 4, row: 3, rot: 5 },
      { type: 'loungeSofa', col: 7, row: 3, rot: 4 },
      { type: 'coffeeBar', col: 9, row: 4, rot: 3 },
      { type: 'plant', col: 3, row: 6, rot: 0 },
      { type: 'plant', col: 9, row: 2, rot: 0 },
    ],
  },
  {
    def: {
      id: 'output',
      kind: 'output',
      label: 'Output & Archive',
      tiles: offsetRect(12, 2, 7, 5),
      walled: true,
      doors: [door(15, 6, 15, 7)],
      floorColor: '#c8c3bd',
    },
    furniture: [
      { type: 'archiveShelf', col: 13, row: 2, rot: 5 },
      { type: 'archiveShelf', col: 15, row: 2, rot: 5 },
      { type: 'archiveShelf', col: 17, row: 2, rot: 5 },
      { type: 'outputTerminal', col: 15, row: 4, rot: 1 },
      { type: 'plant', col: 18, row: 6, rot: 0 },
    ],
  },
  {
    def: {
      id: 'executive',
      kind: 'executive',
      label: 'Executive Office',
      tiles: offsetRect(21, 2, 8, 5),
      walled: true,
      doors: [door(24, 6, 24, 7)],
      floorColor: '#d6c6ad',
    },
    furniture: [
      { type: 'managerDesk', col: 24, row: 4, rot: 4 },
      { type: 'loungeSofa', col: 27, row: 3, rot: 4 },
      { type: 'plant', col: 21, row: 2, rot: 0 },
      { type: 'plant', col: 28, row: 6, rot: 0 },
    ],
  },
  deskBay('engineering', 'Engineering Bay', 'Engineering Bay', 3, 9, '#d5c8b4'),
  deskBay('research', 'Research Bay', 'Research Bay', 13, 9, '#cfc7bc'),
  deskBay('creative', 'Creative Bay', 'Creative Bay', 3, 15, '#dccbb0'),
  deskBay('qa', 'QA Bay', 'QA Bay', 13, 15, '#d2c9b8'),
  meetingRoom('meeting-a', 'Meeting Room A', 25, 11),
  meetingRoom('meeting-b', 'Meeting Room B', 25, 17),
];

/** Paved exterior walkways between the glass pods, as offset rectangles [col, row, cols, rows]. */
const PATHS: Array<[number, number, number, number]> = [
  [1, 7, 31, 2], // north corridor
  [1, 14, 31, 1], // middle corridor
  [1, 20, 31, 1], // south corridor
  [1, 1, 2, 21], // west spine
  [30, 1, 2, 21], // east spine
  [10, 1, 2, 6], // lounge | output
  [19, 1, 2, 6], // output | executive
  [11, 9, 2, 11], // engineering | research, creative | qa
  [21, 9, 2, 11], // research | meeting rooms
];

export const PATH_COLOR = '#e3d2b4';
export const SAND_COLOR = '#e4bd82';

function buildCampus(): CampusLayout {
  const tiles = new Map<string, TileDef>();
  for (let row = 0; row < CAMPUS_ROWS; row++) {
    for (let col = 0; col < CAMPUS_COLS; col++) {
      const hex = O(col, row);
      tiles.set(hexKey(hex), { hex, kind: 'sand', zoneId: null });
    }
  }
  for (const [c, r, w, h] of PATHS) {
    for (const hex of offsetRect(c, r, w, h)) {
      const t = tiles.get(hexKey(hex));
      if (!t) throw new Error(`path tile ${hexKey(hex)} is outside the campus`);
      t.kind = 'path';
    }
  }

  const zones: ZoneDef[] = [];
  const furniture: FurniturePlacement[] = [];
  const walls = new Set<string>();
  const blocked = new Set<string>();
  const furnitureByHex = new Map<string, FurniturePlacement>();
  const zoneById = new Map<string, ZoneDef>();

  for (const { def, furniture: pieces } of ZONES) {
    const zone: ZoneDef = { ...def };
    const zoneKeys = new Set(zone.tiles.map(hexKey));
    for (const hex of zone.tiles) {
      const t = tiles.get(hexKey(hex));
      if (!t) throw new Error(`zone ${zone.id}: tile ${hexKey(hex)} is outside the campus`);
      if (t.zoneId) throw new Error(`zone ${zone.id}: tile ${hexKey(hex)} already belongs to ${t.zoneId}`);
      t.kind = 'floor';
      t.zoneId = zone.id;
    }
    if (zone.walled) {
      const doorKeys = new Set(zone.doors.map(([a, b]) => edgeKey(a, b)));
      for (const [a, b] of zone.doors) {
        if (directionBetween(a, b) === null) throw new Error(`zone ${zone.id}: door tiles are not adjacent`);
        if (!zoneKeys.has(hexKey(a)) || zoneKeys.has(hexKey(b))) {
          throw new Error(`zone ${zone.id}: a door must lead from inside to outside`);
        }
      }
      for (const hex of zone.tiles) {
        for (const n of hexNeighbors(hex)) {
          if (zoneKeys.has(hexKey(n))) continue;
          const key = edgeKey(hex, n);
          if (!doorKeys.has(key)) walls.add(key);
        }
      }
    }
    zones.push(zone);
    zoneById.set(zone.id, zone);

    pieces.forEach((p, i) => {
      const hex = p.axial ?? O(p.col, p.row);
      const key = hexKey(hex);
      if (!zoneKeys.has(key)) throw new Error(`zone ${zone.id}: furniture ${p.type} at ${key} is outside the zone`);
      if (furnitureByHex.has(key)) throw new Error(`zone ${zone.id}: two pieces of furniture on ${key}`);
      const placement: FurniturePlacement = {
        id: `${zone.id}-${p.type}-${i}`,
        type: p.type,
        hex,
        rotationSteps: steps(p.rot),
        zoneId: zone.id,
      };
      furniture.push(placement);
      furnitureByHex.set(key, placement);
      if (FURNITURE_SPECS[p.type].blocksTile) blocked.add(key);
    });
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const t of tiles.values()) {
    const w = hexToWorld(t.hex);
    minX = Math.min(minX, w.x - HEX_RADIUS);
    maxX = Math.max(maxX, w.x + HEX_RADIUS);
    minZ = Math.min(minZ, w.z - HEX_RADIUS);
    maxZ = Math.max(maxZ, w.z + HEX_RADIUS);
  }

  return {
    name: 'Bot Crossing campus v1',
    hexRadius: HEX_RADIUS,
    tiles,
    zones,
    furniture,
    walls,
    blocked,
    furnitureByHex,
    zoneById,
    bounds: { minX, maxX, minZ, maxZ },
  };
}

export const CAMPUS: CampusLayout = buildCampus();

/** Walkable for pathfinding: a paved or interior tile that no furniture blocks. */
export function isWalkable(layout: CampusLayout, hex: HexCoord): boolean {
  const t = layout.tiles.get(hexKey(hex));
  if (!t || t.kind === 'sand') return false;
  return !layout.blocked.has(hexKey(hex));
}

/** Can an agent step from `a` to adjacent `b`? Walls block the shared edge. */
export function canTraverse(layout: CampusLayout, a: HexCoord, b: HexCoord): boolean {
  return !layout.walls.has(edgeKey(a, b));
}

/** Free (unfurnished, walkable) tiles of a zone, in a stable order. */
export function freeTilesOfZone(layout: CampusLayout, zoneId: string): HexCoord[] {
  const zone = layout.zoneById.get(zoneId);
  if (!zone) return [];
  return zone.tiles.filter((h) => isWalkable(layout, h));
}

export function furnitureOfType(layout: CampusLayout, type: FurnitureType, zoneId?: string): FurniturePlacement[] {
  return layout.furniture.filter((f) => f.type === type && (zoneId === undefined || f.zoneId === zoneId));
}

/** The direction index of the neighbour a walker must come from to use an anchor on the -Z side. */
export function behindDirection(placement: FurniturePlacement): HexDirection {
  return steps(placement.rotationSteps + 3);
}
