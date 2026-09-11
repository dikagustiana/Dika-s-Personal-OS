// Per-frame state, deliberately outside React and outside zustand's reactive
// path. The scene clock writes here every frame; lights, sky and emissive
// materials read from here every frame. Nothing subscribes, nothing re-renders.
import { lightingAtHour, type LightingState } from '../../../../logic/floor/lighting/presets';
import { activeCampus } from '../../../../logic/floor/layout/campus';

export interface SceneRuntime {
  hour: number;
  lighting: LightingState;
  /** World-space centre of the campus, for camera and shadow framing. */
  campusCenter: { x: number; z: number };
}

/**
 * The centre is read lazily and re-read when the floor changes: this module
 * is imported before the institution's rows have been read, so capturing
 * the fallback campus's bounds at import time would frame the camera on a
 * building that is about to be replaced.
 */
function centreOf(): { x: number; z: number } {
  const b = activeCampus().bounds;
  return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
}

export const runtime: SceneRuntime = {
  hour: 18,
  lighting: lightingAtHour(18),
  campusCenter: centreOf(),
};

/** Called by the floor when the layout changes, before the canvas mounts. */
export function refreshCampusCentre(): void {
  runtime.campusCenter = centreOf();
}

/** Top surface of walkable tiles; furniture and avatars stand here. */
export const FLOOR_Y = 0.3;
