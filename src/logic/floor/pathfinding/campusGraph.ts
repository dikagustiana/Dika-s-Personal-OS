import { hexKey, type HexCoord } from '../hex/hex';
import { canTraverse, isWalkable } from '../layout/campus';
import type { CampusLayout } from '../layout/types';
import type { HexGraph } from './astar';

/** The A* graph view of a campus layout. */
export function campusGraph(layout: CampusLayout): HexGraph {
  return {
    isWalkable: (h: HexCoord) => isWalkable(layout, h),
    canTraverse: (a: HexCoord, b: HexCoord) => canTraverse(layout, a, b),
    inBounds: (h: HexCoord) => layout.tiles.has(hexKey(h)),
  };
}
