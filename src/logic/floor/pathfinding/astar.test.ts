import { describe, expect, it } from 'vitest';
import { edgeKey, hexDistance, hexKey, offsetRect, type HexCoord } from '../hex/hex';
import { findPath, type HexGraph } from './astar';

function gridGraph(cols: number, rows: number, blocked: HexCoord[] = [], walls: Array<[HexCoord, HexCoord]> = []): HexGraph {
  const tiles = new Set(offsetRect(0, 0, cols, rows).map(hexKey));
  const blockedKeys = new Set(blocked.map(hexKey));
  const wallKeys = new Set(walls.map(([a, b]) => edgeKey(a, b)));
  return {
    inBounds: (h) => tiles.has(hexKey(h)),
    isWalkable: (h) => tiles.has(hexKey(h)) && !blockedKeys.has(hexKey(h)),
    canTraverse: (a, b) => !wallKeys.has(edgeKey(a, b)),
  };
}

const at = (col: number, row: number) => offsetRect(col, row, 1, 1)[0];

describe('A* on a hex grid', () => {
  it('finds a straight path of length distance+1 on an open grid', () => {
    const g = gridGraph(12, 12);
    const a = at(1, 1);
    const b = at(9, 8);
    const res = findPath(g, a, b);
    expect(res).not.toBeNull();
    expect(res!.path[0]).toEqual(a);
    expect(res!.path[res!.path.length - 1]).toEqual(b);
    expect(res!.path).toHaveLength(hexDistance(a, b) + 1);
    for (let i = 1; i < res!.path.length; i++) expect(hexDistance(res!.path[i - 1], res!.path[i])).toBe(1);
  });

  it('routes around a blocked line and never steps on a blocked tile', () => {
    const blocked = offsetRect(5, 0, 1, 11); // a wall of furniture, gap at row 11
    const g = gridGraph(12, 12, blocked);
    const res = findPath(g, at(1, 1), at(10, 1));
    expect(res).not.toBeNull();
    const blockedKeys = new Set(blocked.map(hexKey));
    for (const h of res!.path) expect(blockedKeys.has(hexKey(h))).toBe(false);
    expect(res!.path.length).toBeGreaterThan(hexDistance(at(1, 1), at(10, 1)) + 1);
  });

  it('may end on a blocked tile (its own desk) but not pass through one', () => {
    const desk = at(6, 6);
    const g = gridGraph(12, 12, [desk, at(7, 6)]);
    const res = findPath(g, at(1, 6), desk);
    expect(res).not.toBeNull();
    expect(res!.path[res!.path.length - 1]).toEqual(desk);
    expect(res!.path.some((h) => hexKey(h) === hexKey(at(7, 6)))).toBe(false);
  });

  it('may start on a blocked tile (leaving its desk)', () => {
    const desk = at(2, 2);
    const g = gridGraph(8, 8, [desk]);
    const res = findPath(g, desk, at(6, 6));
    expect(res).not.toBeNull();
    expect(res!.path[0]).toEqual(desk);
  });

  it('respects walled edges', () => {
    // Wall off every edge between column 4 and column 5 across all rows, except row 7.
    const walls: Array<[HexCoord, HexCoord]> = [];
    const tiles = offsetRect(0, 0, 10, 8);
    const keys = new Set(tiles.map(hexKey));
    for (const t of offsetRect(4, 0, 1, 7)) {
      for (const n of [
        { q: t.q + 1, r: t.r },
        { q: t.q + 1, r: t.r - 1 },
        { q: t.q, r: t.r + 1 },
        { q: t.q, r: t.r - 1 },
        { q: t.q - 1, r: t.r + 1 },
      ]) {
        if (keys.has(hexKey(n)) && offsetRect(5, 0, 1, 8).some((h) => hexKey(h) === hexKey(n))) walls.push([t, n]);
      }
    }
    const g = gridGraph(10, 8, [], walls);
    const res = findPath(g, at(1, 1), at(8, 1));
    expect(res).not.toBeNull();
    for (let i = 1; i < res!.path.length; i++) {
      expect(g.canTraverse(res!.path[i - 1], res!.path[i])).toBe(true);
    }
  });

  it('returns null for an unreachable target', () => {
    // Island: the goal is fenced in by blocked tiles on all six sides.
    const goal = at(5, 5);
    const ring = [
      { q: goal.q + 1, r: goal.r },
      { q: goal.q + 1, r: goal.r - 1 },
      { q: goal.q, r: goal.r - 1 },
      { q: goal.q - 1, r: goal.r },
      { q: goal.q - 1, r: goal.r + 1 },
      { q: goal.q, r: goal.r + 1 },
    ];
    const g = gridGraph(12, 12, ring);
    expect(findPath(g, at(0, 0), goal)).toBeNull();
  });

  it('returns null for an out-of-bounds target and a trivial path for start === goal', () => {
    const g = gridGraph(4, 4);
    expect(findPath(g, at(0, 0), { q: 40, r: 40 })).toBeNull();
    expect(findPath(g, at(1, 1), at(1, 1))!.path).toEqual([at(1, 1)]);
  });

  it('expands far fewer nodes than the grid size on an open field (heuristic is live)', () => {
    const g = gridGraph(40, 40);
    const res = findPath(g, at(0, 0), at(39, 39));
    expect(res).not.toBeNull();
    // 1600 tiles; uniform costs leave many equal-f ties, so allow half the grid.
    expect(res!.expanded).toBeLessThan(800);
  });
});
