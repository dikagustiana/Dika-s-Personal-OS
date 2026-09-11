// The floorplan IS the org chart (3-E), so these are assertions about the
// institution: a bay per department in pipeline order, a lead office
// adjoining each, a meeting cluster for its peer reviews, and the four
// rooms the pipeline begins and ends in. Plus the properties any campus
// must hold — no overlapping zones, every door onto pavement, every anchor
// reachable — because a floor that looks right and cannot be walked is
// worse than no floor.
import { describe, expect, it } from 'vitest';
import { hexDistance, hexKey, hexNeighbors, hexToWorld, offsetToAxial, worldToHex } from '../hex/hex';
import { findPath } from '../pathfinding/astar';
import { campusGraph } from '../pathfinding/campusGraph';
import {
  CAMPUS,
  FALLBACK_SPEC,
  buildCampus,
  campusGeometry,
  freeTilesOfZone,
  furnitureOfType,
  isWalkable,
  type FloorSpec,
} from './campus';
import { FURNITURE_SPECS } from './furnitureSpecs';
import { anchorWorldPose, approachHexFor, furnitureWorldPose } from './resolve';

const graph = campusGraph(CAMPUS);
const geometry = campusGeometry(FALLBACK_SPEC);

describe('the institution as a floorplan', () => {
  it('tiles the whole rectangle exactly once', () => {
    expect(CAMPUS.tiles.size).toBe(geometry.cols * geometry.rows);
  });

  it('gives every department a bay, a lead office and a meeting cluster', () => {
    for (const department of FALLBACK_SPEC.departments) {
      const bay = CAMPUS.zoneById.get(`bay-${department.slug}`);
      const lead = CAMPUS.zoneById.get(`lead-${department.slug}`);
      const meeting = CAMPUS.zoneById.get(`meet-${department.slug}`);
      expect(bay?.kind).toBe('deskBay');
      expect(lead?.kind).toBe('leadOffice');
      expect(meeting?.kind).toBe('meeting');
      expect(bay?.department).toBe(department.slug);
      expect(lead?.department).toBe(department.slug);
    }
  });

  it('has the four rooms a brief begins and ends in', () => {
    for (const [id, kind] of [
      ['program-office', 'programOffice'],
      ['library', 'library'],
      ['committee', 'meeting'],
      ['director', 'director'],
    ] as const) {
      expect(CAMPUS.zoneById.get(id)?.kind).toBe(kind);
    }
  });

  it('lays the bays out in pipeline order, so a brief’s path across the floor is its route', () => {
    // Bays read down the left column then down the right, in pipeline order:
    // department N is never above department N-1 in the same column.
    const order = FALLBACK_SPEC.departments.map((department) => {
      const bay = CAMPUS.zoneById.get(`bay-${department.slug}`);
      const first = bay?.tiles[0];
      const world = first ? hexToWorld(first) : { x: 0, z: 0 };
      return { slug: department.slug, pipelineOrder: department.pipelineOrder, x: world.x, z: world.z };
    });
    const left = order.filter((_entry, index) => index % 2 === 0);
    for (let i = 1; i < left.length; i += 1) expect(left[i].z).toBeGreaterThan(left[i - 1].z);
  });

  it('gives a department with more seats a desk for each of them', () => {
    const big = FALLBACK_SPEC.departments.find((department) => department.specialistSeats === 7);
    expect(big).toBeDefined();
    const desks = furnitureOfType(CAMPUS, 'workstation', `bay-${big?.slug}`);
    expect(desks.length).toBeGreaterThanOrEqual(7);
  });

  it('rebuilds for a different institution without touching the scene', () => {
    const spec: FloorSpec = {
      departments: [
        { slug: 'only-one', name: 'The Only Department', pipelineOrder: 1, specialistSeats: 2 },
      ],
    };
    const small = buildCampus(spec);
    expect(small.zoneById.get('bay-only-one')).toBeDefined();
    expect(small.zones.filter((zone) => zone.kind === 'deskBay')).toHaveLength(1);
    expect(small.tiles.size).toBeLessThan(CAMPUS.tiles.size);
    // Even one department keeps the four fixed rooms.
    for (const id of ['program-office', 'library', 'committee', 'director']) {
      expect(small.zoneById.get(id)).toBeDefined();
    }
  });

  it('zones do not overlap and all zone tiles are floor', () => {
    const seen = new Set<string>();
    for (const z of CAMPUS.zones) {
      for (const h of z.tiles) {
        const k = hexKey(h);
        expect(seen.has(k)).toBe(false);
        seen.add(k);
        expect(CAMPUS.tiles.get(k)?.kind).toBe('floor');
        expect(CAMPUS.tiles.get(k)?.zoneId).toBe(z.id);
      }
    }
  });

  it('every walled zone has at least one door whose outside tile is walkable pavement', () => {
    for (const z of CAMPUS.zones.filter((z) => z.walled)) {
      expect(z.doors.length).toBeGreaterThan(0);
      for (const [, outside] of z.doors) {
        expect(CAMPUS.tiles.get(hexKey(outside))?.kind, `${z.id} door`).toBe('path');
        expect(isWalkable(CAMPUS, outside)).toBe(true);
      }
    }
  });

  it('furniture sits inside its zone, one piece per tile, rotation snapped', () => {
    for (const f of CAMPUS.furniture) {
      expect(CAMPUS.tiles.get(hexKey(f.hex))?.zoneId).toBe(f.zoneId);
      expect(Number.isInteger(f.rotationSteps)).toBe(true);
      expect(f.rotationSteps).toBeGreaterThanOrEqual(0);
      expect(f.rotationSteps).toBeLessThanOrEqual(5);
      const pose = furnitureWorldPose(f);
      expect(worldToHex(pose.x, pose.z)).toEqual(f.hex);
    }
    expect(CAMPUS.furnitureByHex.size).toBe(CAMPUS.furniture.length);
  });

  it('each meeting cluster has one table and six chairs that face it', () => {
    for (const z of CAMPUS.zones.filter((z) => z.kind === 'meeting')) {
      const tables = furnitureOfType(CAMPUS, 'meetingTable', z.id);
      const chairs = furnitureOfType(CAMPUS, 'meetingChair', z.id);
      expect(tables).toHaveLength(1);
      expect(chairs).toHaveLength(6);
      const t = hexToWorld(tables[0].hex);
      for (const c of chairs) {
        expect(hexDistance(c.hex, tables[0].hex)).toBe(1);
        const sit = anchorWorldPose(c, 'anchor_sit');
        const cc = hexToWorld(c.hex);
        expect(Math.hypot(sit.x - t.x, sit.z - t.z)).toBeLessThan(Math.hypot(cc.x - t.x, cc.z - t.z));
      }
    }
  });

  it('anchors stay inside their own tile, never at the tile centre', () => {
    for (const f of CAMPUS.furniture) {
      const spec = FURNITURE_SPECS[f.type];
      for (const name of ['anchor_sit', 'anchor_stand', 'anchor_deliver'] as const) {
        const a = anchorWorldPose(f, name);
        const c = hexToWorld(f.hex);
        const d = Math.hypot(a.x - c.x, a.z - c.z);
        expect(d).toBeGreaterThan(0.04);
        expect(d).toBeLessThan(CAMPUS.hexRadius);
        expect(a.y).toBeGreaterThanOrEqual(0);
      }
      if (spec.canSit) {
        expect(FURNITURE_SPECS[f.type].anchors.anchor_sit.y).toBeGreaterThan(0.3);
      }
    }
  });

  it('every usable anchor has a walkable approach tile', () => {
    let checked = 0;
    for (const f of CAMPUS.furniture) {
      const spec = FURNITURE_SPECS[f.type];
      const anchors: Array<'anchor_sit' | 'anchor_deliver'> = [];
      if (spec.canSit) anchors.push('anchor_sit');
      if (spec.canDeliver) anchors.push('anchor_deliver');
      for (const name of anchors) {
        const approach = approachHexFor(f, name);
        expect(isWalkable(CAMPUS, approach), `${f.id} ${name} approach`).toBe(true);
        expect(CAMPUS.walls.has(`${[hexKey(f.hex), hexKey(approach)].sort().join('|')}`)).toBe(false);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(60);
  });

  /**
   * ONE flood fill, not all-pairs A*. The campus is an undirected graph, so
   * "everything reaches everything" is "everything is in one component" —
   * and at institution scale the all-pairs version the standalone build used
   * would run tens of thousands of searches to prove the same thing.
   */
  it('is one connected walk: every zone tile and every approach is reachable from the program office', () => {
    const start = freeTilesOfZone(CAMPUS, 'program-office')[0];
    expect(start).toBeDefined();
    const seen = new Set<string>([hexKey(start)]);
    const queue: typeof start[] = [start];
    while (queue.length > 0) {
      const current = queue.shift() as typeof start;
      for (const next of hexNeighbors(current)) {
        const key = hexKey(next);
        if (seen.has(key)) continue;
        if (!graph.inBounds(next) || !graph.isWalkable(next) || !graph.canTraverse(current, next)) continue;
        seen.add(key);
        queue.push(next);
      }
    }
    for (const zone of CAMPUS.zones) {
      for (const tile of freeTilesOfZone(CAMPUS, zone.id)) {
        expect(seen.has(hexKey(tile)), `${zone.id}:${hexKey(tile)} is walled off`).toBe(true);
      }
    }
    for (const f of CAMPUS.furniture) {
      const spec = FURNITURE_SPECS[f.type];
      if (!spec.canSit && !spec.canDeliver) continue;
      const approach = approachHexFor(f, spec.canSit ? 'anchor_sit' : 'anchor_deliver');
      expect(seen.has(hexKey(approach)), `${f.id} approach is walled off`).toBe(true);
    }
  });

  it('still finds a path between two rooms with A*', () => {
    const from = freeTilesOfZone(CAMPUS, 'program-office')[0];
    const to = freeTilesOfZone(CAMPUS, 'director')[0];
    expect(findPath(graph, from, to)).not.toBeNull();
  });

  it('sand is never walkable and walls sit only between a zone tile and a non-zone tile', () => {
    for (const t of CAMPUS.tiles.values()) {
      if (t.kind === 'sand') expect(isWalkable(CAMPUS, t.hex)).toBe(false);
    }
    for (const w of CAMPUS.walls) {
      const [a, b] = w.split('|').map((k) => k.split(',').map(Number));
      const ta = CAMPUS.tiles.get(`${a[0]},${a[1]}`);
      const tb = CAMPUS.tiles.get(`${b[0]},${b[1]}`);
      expect(Boolean(ta?.zoneId) !== Boolean(tb?.zoneId) || ta?.zoneId !== tb?.zoneId).toBe(true);
    }
  });

  it('paths are never enclosed: each path tile has a walkable neighbour', () => {
    for (const t of CAMPUS.tiles.values()) {
      if (t.kind !== 'path') continue;
      expect(hexNeighbors(t.hex).some((n) => isWalkable(CAMPUS, n))).toBe(true);
    }
  });

  it('the world bounds contain every tile centre', () => {
    for (const t of CAMPUS.tiles.values()) {
      const w = hexToWorld(t.hex);
      expect(w.x).toBeGreaterThan(CAMPUS.bounds.minX);
      expect(w.x).toBeLessThan(CAMPUS.bounds.maxX);
      expect(w.z).toBeGreaterThan(CAMPUS.bounds.minZ);
      expect(w.z).toBeLessThan(CAMPUS.bounds.maxZ);
    }
    expect(offsetToAxial(0, 0)).toEqual({ q: 0, r: 0 });
  });
});
