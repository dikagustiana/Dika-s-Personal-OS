// Walking speed is shared by the server-side positioner (which schedules the
// arrival event) and the renderer (which interpolates the walk), so the two
// agree on when an avatar reaches its tile.
import { HEX_RADIUS } from '../hex/hex';

/** Metres per second for a brisk office walk. */
export const WALK_SPEED_MPS = 1.7;

/** Flat-to-flat tile width in metres — the distance between adjacent centres. */
export const TILE_STEP_M = Math.sqrt(3) * HEX_RADIUS;

/** Seconds to walk a path of `tileCount` tiles (inclusive of both ends), plus a settle margin for the final leg into an anchor. */
export function walkDurationSeconds(tileCount: number, settleSeconds = 0.8): number {
  const steps = Math.max(0, tileCount - 1);
  return (steps * TILE_STEP_M) / WALK_SPEED_MPS + settleSeconds;
}
