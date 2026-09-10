'use client';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { makeTextSprite } from '../labels/textSprite';
import { AnimationController } from './AnimationController';
import type { AvatarMode, AvatarRuntime } from './avatarRuntime';
import { advanceAvatar } from './avatarRuntime';
import { RIG, RIG_URL, resolveClips, type ClipKey } from './rig';

export const DEPARTMENT_COLORS: Record<string, string> = {
  'Engineering Bay': '#4f8fd8',
  'Research Bay': '#8f6fd8',
  'Creative Bay': '#e0a04a',
  'QA Bay': '#4fb08a',
  'Executive Office': '#d85f6f',
};

const JOINT_COLOR = '#2a2f38';

export interface AvatarProps {
  runtime: AvatarRuntime;
  label: string;
  department: string;
  /** Called every frame after the runtime advanced, before animation is chosen. */
  onFrame?: (rt: AvatarRuntime, dt: number, controller: AnimationController) => void;
  /** Extra badge text above the name plate (state, warnings). */
  badge?: { text: string; color: string } | null;
}

function clipForMode(mode: AvatarMode, ctrl: AnimationController): ClipKey {
  switch (mode) {
    case 'walk':
    case 'carry':
      return 'walk';
    case 'sit':
      return 'sitIdle';
    case 'talkSit':
      return 'sitTalk';
    case 'talkStand':
      return 'talk';
    case 'deliver':
      return ctrl.has('interact') ? 'interact' : 'idle';
    default:
      return 'idle';
  }
}

/** A document folder held in the right hand while carrying. */
function makeDocument(): THREE.Mesh {
  const g = new THREE.BoxGeometry(0.3, 0.22, 0.035);
  const m = new THREE.MeshStandardMaterial({ color: '#e9eef5', roughness: 0.6 });
  const mesh = new THREE.Mesh(g, m);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.037), new THREE.MeshStandardMaterial({ color: '#37d2c6', emissive: '#37d2c6', emissiveIntensity: 1.5 }));
  strip.position.y = 0.06;
  mesh.add(strip);
  mesh.castShadow = true;
  return mesh;
}

/**
 * One skinned humanoid. The GLTF scene is cloned with its skeleton so each
 * avatar animates independently; materials are cloned so departments can be
 * colour-coded. Position, yaw and pose come from the runtime every frame.
 */
export function Avatar({ runtime, label, department, onFrame, badge }: AvatarProps) {
  const gltf = useGLTF(RIG_URL);
  const group = useRef<THREE.Group>(null);
  const resolved = useMemo(() => resolveClips(gltf.animations), [gltf.animations]);

  const model = useMemo(() => {
    const root = cloneSkeleton(gltf.scene) as THREE.Group;
    const body = new THREE.Color(DEPARTMENT_COLORS[department] ?? '#9aa6b8');
    root.traverse((o) => {
      if (o instanceof THREE.SkinnedMesh || o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = false;
        o.frustumCulled = false;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        o.material = mats.map((m) => {
          const c = (m as THREE.MeshStandardMaterial).clone();
          if (c.name === 'M_Joints') c.color.set(JOINT_COLOR);
          else c.color.copy(body);
          c.roughness = 0.7;
          return c;
        });
        if (o.material.length === 1) o.material = o.material[0];
      }
    });
    return root;
  }, [gltf.scene, department]);

  const controller = useMemo(() => {
    const c = new AnimationController(model, resolved);
    // Stagger loop phases per agent so a meeting never gestures in lockstep (B-3).
    let h = 0;
    for (const ch of runtime.agentId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    c.phase = (h % 1000) / 1000 * Math.PI * 2;
    return c;
  }, [model, resolved, runtime.agentId]);

  const plate = useMemo(() => {
    const s = makeTextSprite(label, { background: 'rgba(16,20,28,0.78)', accent: DEPARTMENT_COLORS[department] ?? '#9aa6b8', height: 0.42, fontSize: 40 });
    s.position.set(0, RIG.labelHeight, 0);
    return s;
  }, [label, department]);

  const badgeSprite = useMemo(() => {
    if (!badge) return null;
    const s = makeTextSprite(badge.text, { background: badge.color, color: '#0f1420', height: 0.36, fontSize: 38, mono: true });
    s.position.set(0, RIG.labelHeight + 0.45, 0);
    return s;
  }, [badge]);

  const missingSprite = useMemo(() => {
    if (resolved.missing.length === 0) return null;
    const s = makeTextSprite(`MISSING: ${resolved.missing.join(', ')}`, { background: '#ff5e6c', color: '#0f1420', height: 0.34, fontSize: 36, mono: true });
    s.position.set(0, RIG.labelHeight + 0.9, 0);
    return s;
  }, [resolved.missing]);

  // The document rides at a fixed chest socket rather than on the hand bone: the
  // carry overlay aims the arms toward it, and a socket cannot drift with a
  // procedural pose. During the delivery interaction it slides toward the
  // terminal slot and disappears.
  const document = useMemo(makeDocument, []);
  const deliverT = useRef(0);

  useEffect(
    () => () => {
      controller.dispose();
      plate.material.map?.dispose();
      plate.material.dispose();
    },
    [controller, plate],
  );

  const lastMode = useRef<AvatarMode | null>(null);
  useFrame((_, dtRaw) => {
    // Cap the step so a stalled tab does not teleport avatars; still large
    // enough that a slow (software-GL) frame rate keeps motion visible.
    const dt = Math.min(dtRaw, 0.25);
    const rt = runtime;
    advanceAvatar(rt, dt);
    onFrame?.(rt, dt, controller);
    const g = group.current;
    if (g) {
      g.position.set(rt.x, rt.y, rt.z);
      g.rotation.y = rt.yaw;
    }
    if (rt.mode !== lastMode.current) {
      lastMode.current = rt.mode;
      if (rt.mode === 'deliver') controller.playOnce('interact', 'idle');
      else controller.play(clipForMode(rt.mode, controller), { startAt: rt.mode === 'walk' || rt.mode === 'carry' ? 0 : (controller.phase / (Math.PI * 2)) * 1.5 });
    }
    const wantTyping = rt.mode === 'sit' ? 1 : 0;
    controller.typing += (wantTyping - controller.typing) * Math.min(1, dt * 6);
    const wantCarry = rt.mode === 'carry' ? 1 : 0;
    controller.carry += (wantCarry - controller.carry) * Math.min(1, dt * 8);
    if (rt.mode === 'deliver') {
      deliverT.current = Math.min(1, deliverT.current + dt / 1.2);
      const k = deliverT.current;
      document.visible = k < 0.95;
      document.position.set(0, 1.15 - 0.2 * k, 0.32 + 0.45 * k);
      document.rotation.set(-0.35 + 0.35 * k, 0, 0);
    } else {
      deliverT.current = 0;
      document.visible = controller.carry > 0.5;
      document.position.set(0, 1.15, 0.32);
      document.rotation.set(-0.35, 0, 0);
    }
    controller.update(dt);
  });

  return (
    <group ref={group}>
      <primitive object={model} />
      <primitive object={document} />
      <primitive object={plate} />
      {badgeSprite ? <primitive object={badgeSprite} /> : null}
      {missingSprite ? <primitive object={missingSprite} /> : null}
    </group>
  );
}

useGLTF.preload(RIG_URL);
