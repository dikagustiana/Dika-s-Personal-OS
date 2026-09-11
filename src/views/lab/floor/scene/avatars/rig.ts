// The one humanoid rig (A-3): Quaternius Universal Animation Library
// mannequin, CC0, trimmed to the clips in use (public/models/ual-mannequin.glb,
// see ASSETS.md). Every clip already targets this skeleton, so there is no
// retargeting step. Constants below were measured from the file, not guessed.
import type * as THREE from 'three';

export const RIG_URL = '/models/ual-mannequin.glb';

export const RIG = {
  /** Mesh height in metres at rest. */
  height: 1.83,
  /** In the seated clips the hips rest this high above the floor. Chair pans are built to this height. */
  sitHipHeight: 0.49,
  /** In the seated clips the hips sit this far behind the origin (the feet stay at the origin). */
  sitHipBack: 0.33,
  /** Where a name plate floats. */
  labelHeight: 2.15,
  bones: {
    pelvis: 'pelvis',
    spine: 'spine_02',
    head: 'Head',
    upperArmL: 'upperarm_l',
    upperArmR: 'upperarm_r',
    lowerArmL: 'lowerarm_l',
    lowerArmR: 'lowerarm_r',
    handL: 'hand_l',
    handR: 'hand_r',
  },
} as const;

/** Logical clip → clip name inside the GLB. */
export const CLIP_NAMES = {
  idle: 'Idle_Loop',
  walk: 'Walk_Loop',
  sitIdle: 'Sitting_Idle_Loop',
  sitTalk: 'Sitting_Talking_Loop',
  talk: 'Idle_Talking_Loop',
  interact: 'Interact',
  pickUp: 'PickUp_Table',
  sitEnter: 'Sitting_Enter',
  sitExit: 'Sitting_Exit',
} as const;

export type ClipKey = keyof typeof CLIP_NAMES;

/**
 * The five clips A-3 requires and how each is served. Two are code-driven
 * stand-ins on top of real clips from the same rig (PLACEHOLDERS.md).
 */
export const REQUIRED_CLIPS: Record<'idle' | 'walk' | 'sit_typing' | 'talk' | 'carry_walk', { source: ClipKey; procedural: boolean }> = {
  idle: { source: 'idle', procedural: false },
  walk: { source: 'walk', procedural: false },
  sit_typing: { source: 'sitIdle', procedural: true },
  talk: { source: 'talk', procedural: false },
  carry_walk: { source: 'walk', procedural: true },
};

export interface ResolvedClips {
  clips: Partial<Record<ClipKey, THREE.AnimationClip>>;
  missing: ClipKey[];
}

export function resolveClips(animations: THREE.AnimationClip[]): ResolvedClips {
  const clips: Partial<Record<ClipKey, THREE.AnimationClip>> = {};
  const missing: ClipKey[] = [];
  for (const key of Object.keys(CLIP_NAMES) as ClipKey[]) {
    const clip = animations.find((a) => a.name === CLIP_NAMES[key]);
    if (clip) clips[key] = clip;
    else missing.push(key);
  }
  return { clips, missing };
}
