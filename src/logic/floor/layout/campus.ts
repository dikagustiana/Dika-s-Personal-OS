// =============================================================================
// THE INSTITUTION AS A FLOORPLAN (3-E)
// =============================================================================
//
// The org chart IS the campus. Everything here is data: zones as tile sets,
// furniture as (hex, type, rotation) rows, doors as edges. Scene code reads
// the resolved CampusLayout and never hardcodes a coordinate.
//
// WHAT CHANGED FROM THE STANDALONE BUILD. It used to be one fixed campus of
// four invented bays. It is now GENERATED from the institution's own rows:
// one desk bay per department in pipeline order, a lead office adjoining
// each bay, a meeting cluster per department for its peer reviews, plus the
// program office, the committee chamber, the library and the director's
// office. A department the institution adds is a bay on the floor; a seat
// nobody fills is a desk with a name plate and no one at it.
//
// Bays are laid out in pipeline order, so a brief's physical path across the
// floor IS its route through the institution, and a department it skips is
// visibly bypassed.
//
// Coordinates are offset (col, row) because rooms are rectangles and
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

// ---------------------------------------------------------------------------
// what the floorplan is generated FROM
// ---------------------------------------------------------------------------

export interface FloorDepartmentSpec {
  slug: string;
  name: string;
  /** Pipeline order; bays are laid out in it. */
  pipelineOrder: number;
  /** Every specialist seat, staffed or not — an empty desk is still a desk. */
  specialistSeats: number;
}

export interface FloorSpec {
  departments: FloorDepartmentSpec[];
  /** Shown on the library shelves; the corpus is the institution's memory. */
  corpusRecords?: number;
}

/** The shape the standalone build had, kept so a bare clone renders something. */
export const FALLBACK_SPEC: FloorSpec = {
  departments: [
    { slug: 'framing-office', name: 'Framing Office', pipelineOrder: 1, specialistSeats: 3 },
    { slug: 'methodology-desk', name: 'Methodology Desk', pipelineOrder: 2, specialistSeats: 3 },
    { slug: 'evidence-acquisition', name: 'Evidence & Data Acquisition', pipelineOrder: 3, specialistSeats: 7 },
    { slug: 'data-engineering', name: 'Data Engineering', pipelineOrder: 4, specialistSeats: 3 },
    { slug: 'quantitative-analysis', name: 'Quantitative Analysis', pipelineOrder: 5, specialistSeats: 4 },
    { slug: 'domain-synthesis', name: 'Domain Synthesis', pipelineOrder: 6, specialistSeats: 7 },
    { slug: 'verification', name: 'Verification', pipelineOrder: 7, specialistSeats: 6 },
    { slug: 'editorial', name: 'Editorial', pipelineOrder: 8, specialistSeats: 4 },
  ],
};

export const PATH_COLOR = '#e3d2b4';
export const SAND_COLOR = '#e4bd82';

const FLOOR_TINTS = ['#d5c8b4', '#cfc7bc', '#dccbb0', '#d2c9b8', '#d8cbb2', '#cdc5b8', '#dac9ae', '#d0c8bb'];

// ---------------------------------------------------------------------------
// room builders
// ---------------------------------------------------------------------------

/**
 * A desk bay, sized to the department. Workstations sit in two rows facing
 * north-east with an aisle behind each row, so every desk has an approach
 * tile that is not another desk.
 */
function deskBay(spec: FloorDepartmentSpec, col0: number, row0: number, tint: string, width: number): ZoneInput {
  const perRow = Math.ceil(Math.max(3, spec.specialistSeats) / 2);
  const furniture: PlacementInput[] = [];
  for (const row of [row0 + 1, row0 + 3]) {
    for (let i = 0; i < perRow; i += 1) {
      furniture.push({ type: 'workstation', col: col0 + 1 + i * 2, row, rot: 1 });
    }
  }
  furniture.push({ type: 'plant', col: col0 + width - 1, row: row0 + 4, rot: 0 });
  return {
    def: {
      id: `bay-${spec.slug}`,
      kind: 'deskBay',
      label: spec.name,
      department: spec.slug,
      tiles: offsetRect(col0, row0, width, 5),
      walled: true,
      doors: [door(col0 + 1, row0 + 4, col0 + 1, row0 + 5)],
      floorColor: tint,
    },
    furniture,
  };
}

/** A lead's office: one desk, one visitor sofa, adjoining its bay. */
function leadOffice(spec: FloorDepartmentSpec, col0: number, row0: number, tint: string): ZoneInput {
  return {
    def: {
      id: `lead-${spec.slug}`,
      kind: 'leadOffice',
      label: `${spec.name} — lead`,
      department: spec.slug,
      tiles: offsetRect(col0, row0, 4, 5),
      walled: true,
      doors: [door(col0 + 1, row0 + 4, col0 + 1, row0 + 5)],
      floorColor: tint,
    },
    furniture: [
      { type: 'managerDesk', col: col0 + 1, row: row0 + 1, rot: 1 },
      { type: 'loungeSofa', col: col0 + 2, row: row0 + 3, rot: 4 },
    ],
  };
}

/** A meeting cluster: table in the centre, six chairs facing it, door to the west. */
function meetingRoom(id: string, label: string, department: string | undefined, centerCol: number, centerRow: number): ZoneInput {
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
      ...(department ? { department } : {}),
      tiles: hexSpiral(center, 2),
      walled: true,
      doors: [[west2, west3]],
      floorColor: '#cbc2b4',
    },
    furniture: [{ type: 'meetingTable', axial: center, rot: 0 }, ...chairs],
  };
}

/** A plain walled room with a door on its south edge. */
function room(
  id: string,
  kind: ZoneDef['kind'],
  label: string,
  col0: number,
  row0: number,
  width: number,
  height: number,
  tint: string,
  furniture: PlacementInput[],
): ZoneInput {
  return {
    def: {
      id,
      kind,
      label,
      tiles: offsetRect(col0, row0, width, height),
      walled: true,
      doors: [door(col0 + 1, row0 + height - 1, col0 + 1, row0 + height)],
      floorColor: tint,
    },
    furniture,
  };
}

// ---------------------------------------------------------------------------
// the campus
// ---------------------------------------------------------------------------

export interface CampusGeometry {
  cols: number;
  rows: number;
}

interface Plan {
  zones: ZoneInput[];
  paths: Array<[number, number, number, number]>;
  geometry: CampusGeometry;
}

const BLOCK_H = 5;
const GAP = 2;
const LEFT = 3;
const TOP = 1;

function planCampus(spec: FloorSpec): Plan {
  const departments = [...spec.departments].sort((a, b) => a.pipelineOrder - b.pipelineOrder);
  const bayWidth = (department: FloorDepartmentSpec) =>
    Math.ceil(Math.max(3, department.specialistSeats) / 2) * 2 + 2;
  const maxBay = Math.max(8, ...departments.map(bayWidth));
  // bay | gap | lead office (4) | gap | meeting cluster (5 wide)
  const blockWidth = maxBay + 1 + 4 + 1 + 5;
  const columns = 2;
  const blockRows = Math.ceil(departments.length / columns);

  const colX = (column: number) => LEFT + column * (blockWidth + GAP);
  // The top band holds the program office and the library; the bottom band
  // the committee chamber and the director's office.
  const bandH = 5;
  const rowY = (blockRow: number) => TOP + bandH + GAP + blockRow * (BLOCK_H + GAP);
  const bottomY = rowY(blockRows);

  const zones: ZoneInput[] = [];

  // The top band. The program office sits where it can see the pipeline: at
  // the head of the floor, beside the library every later piece of work cites.
  zones.push(
    room('program-office', 'programOffice', 'Program Office', LEFT, TOP, 8, bandH, '#d6c6ad', [
      { type: 'managerDesk', col: LEFT + 1, row: TOP + 1, rot: 1 },
      { type: 'loungeSofa', col: LEFT + 4, row: TOP + 3, rot: 4 },
      { type: 'plant', col: LEFT + 6, row: TOP + 1, rot: 0 },
    ]),
  );
  zones.push(
    room('library', 'library', 'Library & Archive', LEFT + 10, TOP, 9, bandH, '#c8c3bd', [
      { type: 'archiveShelf', col: LEFT + 11, row: TOP, rot: 5 },
      { type: 'archiveShelf', col: LEFT + 13, row: TOP, rot: 5 },
      { type: 'archiveShelf', col: LEFT + 15, row: TOP, rot: 5 },
      { type: 'archiveShelf', col: LEFT + 17, row: TOP, rot: 5 },
      { type: 'outputTerminal', col: LEFT + 13, row: TOP + 3, rot: 1 },
      { type: 'plant', col: LEFT + 17, row: TOP + 4, rot: 0 },
    ]),
  );

  // One block per department, in pipeline order.
  departments.forEach((department, index) => {
    const column = index % columns;
    const blockRow = Math.floor(index / columns);
    const x = colX(column);
    const y = rowY(blockRow);
    const tint = FLOOR_TINTS[index % FLOOR_TINTS.length];
    zones.push(deskBay(department, x, y, tint, maxBay));
    zones.push(leadOffice(department, x + maxBay + 1, y, tint));
    zones.push(
      meetingRoom(
        `meet-${department.slug}`,
        `${department.name} — peer review`,
        department.slug,
        x + maxBay + 1 + 4 + 1 + 2,
        y + 2,
      ),
    );
  });

  // The bottom band. The committee chamber is a meeting cluster of its own:
  // debates happen at a table, not in a corridor.
  zones.push(meetingRoom('committee', 'Editorial Committee', undefined, LEFT + 2, bottomY + 2));
  zones.push(
    room('director', 'director', "Director's Office", LEFT + 8, bottomY, 9, bandH, '#dcc7ad', [
      { type: 'managerDesk', col: LEFT + 9, row: bottomY + 1, rot: 1 },
      { type: 'archiveShelf', col: LEFT + 12, row: bottomY, rot: 5 },
      { type: 'outputTerminal', col: LEFT + 14, row: bottomY + 3, rot: 1 },
      { type: 'loungeSofa', col: LEFT + 11, row: bottomY + 3, rot: 4 },
      { type: 'plant', col: LEFT + 16, row: bottomY + 4, rot: 0 },
    ]),
  );

  const cols = colX(columns - 1) + blockWidth + LEFT;
  const rows = bottomY + bandH + 2;

  // Paved walkways. Every room's door opens onto one of these, and the
  // spines join them, so the campus is one connected walk.
  const paths: Array<[number, number, number, number]> = [
    [1, 1, 2, rows - 2], // west spine
    [cols - 3, 1, 2, rows - 2], // east spine
    [1, TOP + bandH, cols - 2, GAP], // under the top band
    [1, bottomY - GAP, cols - 2, GAP], // above the bottom band
    [1, rows - 2, cols - 2, 1], // south edge
  ];
  for (let blockRow = 0; blockRow < blockRows; blockRow += 1) {
    const y = rowY(blockRow);
    paths.push([1, y + BLOCK_H, cols - 2, GAP]); // corridor under each block row
  }
  // A meeting cluster's door faces west, into the strip between the lead
  // office and the cluster. That strip has to be pavement or the department
  // cannot reach its own peer-review room — the layout test says so.
  departments.forEach((_department, index) => {
    const column = index % columns;
    const blockRow = Math.floor(index / columns);
    const x = colX(column) + maxBay + 1 + 4;
    const y = rowY(blockRow);
    paths.push([x, y, 1, BLOCK_H]);
  });
  // The committee chamber's door faces west too.
  paths.push([LEFT, bottomY, 2, bandH]);
  // Vertical corridor between the two block columns, and one down the middle
  // of the top band so the library and program office doors reach it.
  paths.push([colX(0) + blockWidth, TOP, GAP, rows - TOP - 1]);

  return { zones, paths, geometry: { cols, rows } };
}

function buildFromPlan(plan: Plan, name: string): CampusLayout {
  const { cols, rows } = plan.geometry;
  const tiles = new Map<string, TileDef>();
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const hex = O(col, row);
      tiles.set(hexKey(hex), { hex, kind: 'sand', zoneId: null });
    }
  }
  for (const [c, r, w, h] of plan.paths) {
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

  for (const { def, furniture: pieces } of plan.zones) {
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
    name,
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

/** Build the campus for one institution. Pure: the same spec gives the same floor. */
export function buildCampus(spec: FloorSpec = FALLBACK_SPEC): CampusLayout {
  const plan = planCampus(spec);
  return buildFromPlan(plan, `Institution floor (${spec.departments.length} departments)`);
}

export function campusGeometry(spec: FloorSpec = FALLBACK_SPEC): CampusGeometry {
  return planCampus(spec).geometry;
}

/**
 * The default floor, for a client that has not read the institution's rows
 * yet. It is the real department list, so a slow read shows the right shape
 * and then fills in — never a different building.
 */
export const CAMPUS: CampusLayout = buildCampus(FALLBACK_SPEC);

/**
 * THE ACTIVE FLOOR.
 *
 * The scene reads the campus in a dozen places, several of them at module
 * scope (the pathfinding graph, the camera framing, the instanced terrain).
 * Threading a layout prop through all of them would be a large, risky
 * refactor of code that currently works; a module-level holder the floor
 * sets ONCE before the canvas mounts is the smaller change, and the
 * property that matters is unchanged — the layout still comes from the
 * institution's rows, not from a constant in this file.
 *
 * The floorplan changing means the building changed: the canvas is keyed on
 * the layout's name, so React unmounts the old scene rather than leaving
 * memoised geometry from a different building on screen.
 */
let active: CampusLayout = CAMPUS;

export function setActiveCampus(layout: CampusLayout): void {
  active = layout;
}

export function activeCampus(): CampusLayout {
  return active;
}

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
