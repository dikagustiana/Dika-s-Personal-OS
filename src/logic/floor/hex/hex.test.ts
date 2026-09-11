import { describe, expect, it } from 'vitest';
import { Grid, ring as hcRing, spiral as hcSpiral } from 'honeycomb-grid';
import {
  CampusHex,
  HEX_RADIUS,
  axialToOffset,
  directionBetween,
  edgeKey,
  hexCornersWorld,
  hexDistance,
  hexLine,
  hexNeighbors,
  hexRing,
  hexSpiral,
  hexToWorld,
  offsetRect,
  offsetToAxial,
  rotationStepsToYaw,
  sharedEdgeCorners,
  worldToHex,
} from './hex';

const SAMPLE = [
  { q: 0, r: 0 },
  { q: 3, r: -2 },
  { q: -4, r: 7 },
  { q: 12, r: 9 },
  { q: -9, r: -9 },
];

describe('hex ↔ world', () => {
  it('matches honeycomb-grid centres for the same settings', () => {
    for (const h of SAMPLE) {
      const hc = new CampusHex(h);
      const w = hexToWorld(h);
      expect(w.x).toBeCloseTo(hc.x, 9);
      expect(w.z).toBeCloseTo(hc.y, 9);
    }
  });

  it('round-trips tile centres and points jittered inside the tile', () => {
    for (const h of SAMPLE) {
      const c = hexToWorld(h);
      expect(worldToHex(c.x, c.z)).toEqual(h);
      // Inradius is (√3/2)·R; stay well inside it.
      const jitter = HEX_RADIUS * 0.4;
      for (const [dx, dz] of [
        [jitter, 0],
        [-jitter, 0],
        [0, jitter],
        [0, -jitter],
        [jitter * 0.7, jitter * 0.7],
      ]) {
        expect(worldToHex(c.x + dx, c.z + dz)).toEqual(h);
      }
    }
  });

  it('adjacent tiles are exactly one flat-to-flat width apart', () => {
    const width = Math.sqrt(3) * HEX_RADIUS;
    for (const h of SAMPLE) {
      const c = hexToWorld(h);
      for (const n of hexNeighbors(h)) {
        const w = hexToWorld(n);
        expect(Math.hypot(w.x - c.x, w.z - c.z)).toBeCloseTo(width, 9);
      }
    }
  });

  it('corner ring lies on the circumradius', () => {
    const c = hexToWorld({ q: 2, r: 1 });
    for (const corner of hexCornersWorld({ q: 2, r: 1 })) {
      expect(Math.hypot(corner.x - c.x, corner.z - c.z)).toBeCloseTo(HEX_RADIUS, 9);
    }
  });
});

describe('offset ↔ axial', () => {
  it('round-trips and agrees with honeycomb-grid', () => {
    for (let row = -3; row <= 6; row++) {
      for (let col = -2; col <= 5; col++) {
        const a = offsetToAxial(col, row);
        expect(axialToOffset(a)).toEqual({ col, row });
        const hc = new CampusHex({ col, row });
        expect({ q: hc.q, r: hc.r }).toEqual(a);
      }
    }
  });

  it('offsetRect yields cols × rows distinct tiles in one contiguous block', () => {
    const tiles = offsetRect(2, 3, 5, 4);
    expect(tiles).toHaveLength(20);
    expect(new Set(tiles.map((t) => `${t.q},${t.r}`)).size).toBe(20);
    // Every tile has at least two neighbours inside the block.
    const keys = new Set(tiles.map((t) => `${t.q},${t.r}`));
    for (const t of tiles) {
      const inside = hexNeighbors(t).filter((n) => keys.has(`${n.q},${n.r}`)).length;
      expect(inside).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('distance, neighbours, rings', () => {
  it('neighbours are at distance 1 and directionBetween recovers the index', () => {
    for (const h of SAMPLE) {
      hexNeighbors(h).forEach((n, i) => {
        expect(hexDistance(h, n)).toBe(1);
        expect(directionBetween(h, n)).toBe(i);
      });
      expect(directionBetween(h, { q: h.q + 2, r: h.r })).toBeNull();
    }
  });

  it('ring(k) has 6k tiles all at distance k, and matches honeycomb-grid as a set', () => {
    const center = { q: 3, r: -2 };
    for (let k = 1; k <= 4; k++) {
      const mine = hexRing(center, k);
      expect(mine).toHaveLength(6 * k);
      for (const t of mine) expect(hexDistance(center, t)).toBe(k);
      const grid = new Grid(CampusHex, hcRing({ center, radius: k }));
      const theirs = new Set(grid.toArray().map((h) => `${h.q},${h.r}`));
      expect(new Set(mine.map((t) => `${t.q},${t.r}`))).toEqual(theirs);
    }
  });

  it('spiral(k) has 3k² + 3k + 1 tiles and matches honeycomb-grid', () => {
    const center = { q: -1, r: 4 };
    const mine = hexSpiral(center, 3);
    expect(mine).toHaveLength(37);
    const grid = new Grid(CampusHex, hcSpiral({ start: center, radius: 3 }));
    expect(new Set(mine.map((t) => `${t.q},${t.r}`))).toEqual(
      new Set(grid.toArray().map((h) => `${h.q},${h.r}`)),
    );
  });

  it('line covers distance+1 tiles, each step adjacent', () => {
    const a = { q: 0, r: 0 };
    const b = { q: 5, r: -3 };
    const line = hexLine(a, b);
    expect(line).toHaveLength(hexDistance(a, b) + 1);
    expect(line[0]).toEqual(a);
    expect(line[line.length - 1]).toEqual(b);
    for (let i = 1; i < line.length; i++) expect(hexDistance(line[i - 1], line[i])).toBe(1);
  });
});

describe('rotation snapping and edges', () => {
  it('yaw steps are 60° apart and face the neighbour', () => {
    const center = { q: 0, r: 0 };
    const c = hexToWorld(center);
    for (let s = 0; s < 6; s++) {
      const yaw = rotationStepsToYaw(s);
      const n = hexToWorld(hexNeighbors(center)[s]);
      // An object facing +Z rotated by yaw points along (sin yaw, cos yaw).
      const dx = n.x - c.x;
      const dz = n.z - c.z;
      const len = Math.hypot(dx, dz);
      expect(Math.sin(yaw)).toBeCloseTo(dx / len, 9);
      expect(Math.cos(yaw)).toBeCloseTo(dz / len, 9);
    }
    const a = rotationStepsToYaw(1) - rotationStepsToYaw(0);
    expect(Math.abs(((a + Math.PI) % (2 * Math.PI)) - Math.PI)).toBeCloseTo(Math.PI / 3, 9);
    expect(rotationStepsToYaw(7)).toBeCloseTo(rotationStepsToYaw(1), 12);
    expect(rotationStepsToYaw(-1)).toBeCloseTo(rotationStepsToYaw(5), 12);
  });

  it('sharedEdgeCorners returns the one edge two neighbours share, of length R', () => {
    const a = { q: 2, r: 1 };
    for (const b of hexNeighbors(a)) {
      const seg = sharedEdgeCorners(a, b);
      expect(seg).not.toBeNull();
      const [p, q] = seg!;
      expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeCloseTo(HEX_RADIUS, 9);
      // The midpoint of the edge is the midpoint between the two tile centres.
      const ca = hexToWorld(a);
      const cb = hexToWorld(b);
      expect((p.x + q.x) / 2).toBeCloseTo((ca.x + cb.x) / 2, 9);
      expect((p.z + q.z) / 2).toBeCloseTo((ca.z + cb.z) / 2, 9);
    }
    expect(sharedEdgeCorners(a, { q: 4, r: 1 })).toBeNull();
  });

  it('edgeKey is order independent', () => {
    expect(edgeKey({ q: 1, r: 2 }, { q: 2, r: 2 })).toBe(edgeKey({ q: 2, r: 2 }, { q: 1, r: 2 }));
    expect(edgeKey({ q: 1, r: 2 }, { q: 2, r: 2 })).not.toBe(edgeKey({ q: 1, r: 2 }, { q: 1, r: 3 }));
  });
});
