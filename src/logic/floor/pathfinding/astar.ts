// A* over the hex graph. Pure. Tiles blocked by furniture are impassable except
// as the destination (a walker must be able to reach its own desk), and walled
// edges are never crossed. Cost is uniform, so the heuristic (hex distance) is
// admissible and the result is a shortest path.
import { hexDistance, hexKey, hexNeighbors, type HexCoord } from '../hex/hex';

export interface HexGraph {
  /** Can a walker stand on this tile while passing through? */
  isWalkable(hex: HexCoord): boolean;
  /** Can a walker step across the edge between two adjacent tiles? */
  canTraverse(a: HexCoord, b: HexCoord): boolean;
  /** Is this tile inside the world at all? (Bounds check; furniture is not "outside".) */
  inBounds(hex: HexCoord): boolean;
}

export interface PathResult {
  path: HexCoord[];
  /** Nodes expanded; recorded so tests can catch a heuristic regression. */
  expanded: number;
}

interface Node {
  key: string;
  hex: HexCoord;
  g: number;
  f: number;
  parent: Node | null;
}

class MinHeap {
  private items: Node[] = [];
  get size(): number {
    return this.items.length;
  }
  push(n: Node): void {
    this.items.push(n);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.items[p].f <= this.items[i].f) break;
      [this.items[p], this.items[i]] = [this.items[i], this.items[p]];
      i = p;
    }
  }
  pop(): Node | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0 && last) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.items[l].f < this.items[m].f) m = l;
        if (r < this.items.length && this.items[r].f < this.items[m].f) m = r;
        if (m === i) break;
        [this.items[m], this.items[i]] = [this.items[i], this.items[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Shortest path from `start` to `goal`, inclusive of both. Returns null when
 * the goal is unreachable or out of bounds. `start` is trusted even if it is
 * on a blocked tile (an agent leaving its desk starts on the desk tile).
 */
export function findPath(graph: HexGraph, start: HexCoord, goal: HexCoord, maxExpansions = 20000): PathResult | null {
  if (!graph.inBounds(goal)) return null;
  const goalKey = hexKey(goal);
  const startKey = hexKey(start);
  if (startKey === goalKey) return { path: [{ ...start }], expanded: 0 };

  const open = new MinHeap();
  const best = new Map<string, number>();
  const closed = new Set<string>();
  const startNode: Node = { key: startKey, hex: start, g: 0, f: hexDistance(start, goal), parent: null };
  open.push(startNode);
  best.set(startKey, 0);
  let expanded = 0;

  while (open.size > 0) {
    const cur = open.pop() as Node;
    if (closed.has(cur.key)) continue;
    if (cur.key === goalKey) {
      const path: HexCoord[] = [];
      for (let n: Node | null = cur; n; n = n.parent) path.push(n.hex);
      path.reverse();
      return { path, expanded };
    }
    closed.add(cur.key);
    expanded++;
    if (expanded > maxExpansions) return null;

    for (const n of hexNeighbors(cur.hex)) {
      const nk = hexKey(n);
      if (closed.has(nk)) continue;
      if (!graph.inBounds(n)) continue;
      if (!graph.canTraverse(cur.hex, n)) continue;
      const isGoal = nk === goalKey;
      if (!isGoal && !graph.isWalkable(n)) continue;
      const g = cur.g + 1;
      const known = best.get(nk);
      if (known !== undefined && known <= g) continue;
      best.set(nk, g);
      open.push({ key: nk, hex: n, g, f: g + hexDistance(n, goal), parent: cur });
    }
  }
  return null;
}
