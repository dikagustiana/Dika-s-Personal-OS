// Per-frame state, deliberately outside React and outside zustand's reactive
// path. The scene clock writes here every frame; lights, sky and emissive
// materials read from here every frame. Nothing subscribes, nothing re-renders.
import { lightingAtHour, type LightingState } from '@/core/lighting/presets';
import { CAMPUS } from '@/core/layout/campus';

export interface SceneRuntime {
  hour: number;
  lighting: LightingState;
  /** World-space centre of the campus, for camera and shadow framing. */
  campusCenter: { x: number; z: number };
}

const b = CAMPUS.bounds;

export const runtime: SceneRuntime = {
  hour: 18,
  lighting: lightingAtHour(18),
  campusCenter: { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 },
};

/** Top surface of walkable tiles; furniture and avatars stand here. */
export const FLOOR_Y = 0.3;
