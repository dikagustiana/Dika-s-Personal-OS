import { describe, expect, it } from 'vitest';
import { hexDistance, hexKey, hexNeighbors, hexToWorld, offsetToAxial, worldToHex } from '../hex/hex';
import { findPath } from '../pathfinding/astar';
import { campusGraph } from '../pathfinding/campusGraph';
import { CAMPUS, CAMPUS_COLS, CAMPUS_ROWS, freeTilesOfZone, furnitureOfType, isWalkable } from './campus';
import { FURNITURE_SPECS } from './furnitureSpecs';
import { anchorWorldPose, approachHexFor, furnitureWorldPose } from './resolve';

const graph = campusGraph(CAMPUS);

describe('campus layout data', () => {
  it('tiles the whole rectangle exactly once', () => {
    expect(CAMPUS.tiles.size).toBe(CAMPUS_COLS * CAMPUS_ROWS);
  });

  it('has every zone the spec names, each with tiles', () => {
    const kinds = CAMPUS.zones.map((z) => z.kind);
    expect(kinds.filter((k) => k === 'deskBay')).toHaveLength(4);
    expect(kinds.filter((k) => k === 'meeting')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'executive')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'lounge')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'output')).toHaveLength(1);
    const departments = new Set(CAMPUS.zones.map((z) => z.department).filter(Boolean));
    expect(departments).toEqual(new Set(['Engineering Bay', 'Research Bay', 'Creative Bay', 'QA Bay']));
    for (const z of CAMPUS.zones) expect(z.tiles.length).toBeGreaterThan(0);
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
        expect(CAMPUS.tiles.get(hexKey(outside))?.kind).toBe('path');
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

  it('has enough desks for twenty agents, five per department', () => {
    for (const z of CAMPUS.zones.filter((z) => z.kind === 'deskBay')) {
      expect(furnitureOfType(CAMPUS, 'workstation', z.id).length).toBeGreaterThanOrEqual(5);
    }
    expect(furnitureOfType(CAMPUS, 'workstation').length).toBeGreaterThanOrEqual(20);
  });

  it('each meeting room has one table and six chairs that face it', () => {
    for (const z of CAMPUS.zones.filter((z) => z.kind === 'meeting')) {
      const tables = furnitureOfType(CAMPUS, 'meetingTable', z.id);
      const chairs = furnitureOfType(CAMPUS, 'meetingChair', z.id);
      expect(tables).toHaveLength(1);
      expect(chairs).toHaveLength(6);
      const t = hexToWorld(tables[0].hex);
      for (const c of chairs) {
        expect(hexDistance(c.hex, tables[0].hex)).toBe(1);
        // The chair's sit anchor is closer to the table than the chair's tile centre.
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

  it('every usable anchor has a walkable approach tile reachable from the lounge', () => {
    const lounge = freeTilesOfZone(CAMPUS, 'lounge');
    expect(lounge.length).toBeGreaterThanOrEqual(20);
    const start = lounge[0];
    let checked = 0;
    for (const f of CAMPUS.furniture) {
      const spec = FURNITURE_SPECS[f.type];
      const anchors: Array<'anchor_sit' | 'anchor_deliver'> = [];
      if (spec.canSit) anchors.push('anchor_sit');
      if (spec.canDeliver) anchors.push('anchor_deliver');
      for (const name of anchors) {
        const approach = approachHexFor(f, name);
        expect(isWalkable(CAMPUS, approach)).toBe(true);
        expect(CAMPUS.walls.has(`${[hexKey(f.hex), hexKey(approach)].sort().join('|')}`)).toBe(false);
        const res = findPath(graph, start, approach);
        expect(res, `${f.id} ${name} unreachable from lounge`).not.toBeNull();
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(30);
  });

  it('every free tile of every zone is reachable from every other zone', () => {
    const starts = CAMPUS.zones.map((z) => freeTilesOfZone(CAMPUS, z.id)[0]);
    for (const a of starts) {
      for (const z of CAMPUS.zones) {
        for (const t of freeTilesOfZone(CAMPUS, z.id)) {
          expect(findPath(graph, a, t), `${hexKey(a)} → ${z.id}:${hexKey(t)}`).not.toBeNull();
        }
      }
    }
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
