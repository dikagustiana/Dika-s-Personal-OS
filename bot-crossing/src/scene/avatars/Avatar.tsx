'use client';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { makeTextSprite } from '../labels/textSprite';
import { AnimationController } from './AnimationController';
import type { AvatarRuntime } from './avatarRuntime';
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

export interface AvatarBadge {
  text: string;
  color: string;
  textColor?: string;
}

export interface AvatarProps {
  runtime: AvatarRuntime;
  label: string;
  department: string;
  /** Called every frame after the runtime advanced, before animation is chosen. */
  onFrame?: (rt: AvatarRuntime, dt: number, controller: AnimationController) => void;
  /** Badges stack above the name plate (state warnings, chat bubble). */
  badges?: AvatarBadge[];
  /** Hologram above a working agent: title and progress. */
  hologram?: { title: string; progress: number } | null;
  onClick?: (agentId: string) => void;
}

function clipFor(rt: AvatarRuntime): ClipKey {
  if (rt.pose === 'walk') return 'walk';
  if (rt.pose === 'sit') return rt.activity === 'talking' ? 'sitTalk' : 'sitIdle';
  return rt.activity === 'talking' ? 'talk' : 'idle';
}

/** A document folder held against the chest while carrying. */
function makeDocument(): THREE.Mesh {
  const g = new THREE.BoxGeometry(0.3, 0.22, 0.035);
  const m = new THREE.MeshStandardMaterial({ color: '#e9eef5', roughness: 0.6 });
  const mesh = new THREE.Mesh(g, m);
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.03, 0.037),
    new THREE.MeshStandardMaterial({ color: '#37d2c6', emissive: '#37d2c6', emissiveIntensity: 1.5 }),
  );
  strip.position.y = 0.06;
  mesh.add(strip);
  mesh.castShadow = true;
  return mesh;
}

/** Canvas hologram: title line and a progress bar. Rebuilt only when its text changes. */
function makeHologram(title: string, progress: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 112;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(16,20,28,0.72)';
  ctx.beginPath();
  ctx.roundRect(0, 0, 512, 112, 14);
  ctx.fill();
  ctx.fillStyle = '#E9EEF5';
  ctx.font = '600 34px ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  let text = title;
  while (text.length > 3 && ctx.measureText(text).width > 400) text = `${text.slice(0, -2)}…`;
  ctx.fillText(text, 22, 34);
  ctx.fillStyle = '#9AA6B8';
  ctx.font = '600 28px ui-monospace, Menlo, monospace';
  const pct = `${Math.round(progress)}%`;
  ctx.fillText(pct, 512 - 22 - ctx.measureText(pct).width, 34);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.roundRect(22, 70, 468, 16, 8);
  ctx.fill();
  ctx.fillStyle = '#37D2C6';
  ctx.beginPath();
  ctx.roundRect(22, 70, Math.max(16, 468 * Math.min(1, Math.max(0, progress / 100))), 16, 8);
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
  sprite.scale.set(1.9, 1.9 * (112 / 512), 1);
  return sprite;
}

/**
 * One skinned humanoid. The GLTF scene is cloned with its skeleton so each
 * avatar animates independently; materials are cloned so departments can be
 * colour-coded. Position, yaw and pose come from the runtime every frame.
 */
export function Avatar({ runtime, label, department, onFrame, badges, hologram, onClick }: AvatarProps) {
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
        const cloned = mats.map((m) => {
          const c = (m as THREE.MeshStandardMaterial).clone();
          if (c.name === 'M_Joints') c.color.set(JOINT_COLOR);
          else c.color.copy(body);
          c.roughness = 0.7;
          return c;
        });
        o.material = cloned.length === 1 ? cloned[0] : cloned;
      }
    });
    return root;
  }, [gltf.scene, department]);

  const controller = useMemo(() => {
    const c = new AnimationController(model, resolved);
    // Stagger loop phases per agent so a meeting never gestures in lockstep (B-3).
    let h = 0;
    for (const ch of runtime.agentId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    c.phase = ((h % 1000) / 1000) * Math.PI * 2;
    return c;
  }, [model, resolved, runtime.agentId]);

  const plate = useMemo(() => {
    const s = makeTextSprite(label, { background: 'rgba(16,20,28,0.78)', accent: DEPARTMENT_COLORS[department] ?? '#9aa6b8', height: 0.42, fontSize: 40 });
    s.position.set(0, RIG.labelHeight, 0);
    return s;
  }, [label, department]);

  const badgeKey = (badges ?? []).map((b) => `${b.text}|${b.color}`).join('||');
  const badgeSprites = useMemo(() => {
    return (badges ?? []).map((b, i) => {
      const s = makeTextSprite(b.text, { background: b.color, color: b.textColor ?? '#0f1420', height: 0.34, fontSize: 36, mono: true });
      s.position.set(0, RIG.labelHeight + 0.42 + i * 0.38, 0);
      return s;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [badgeKey]);

  const missingSprite = useMemo(() => {
    if (resolved.missing.length === 0) return null;
    const s = makeTextSprite(`MISSING: ${resolved.missing.join(', ')}`, { background: '#ff5e6c', color: '#0f1420', height: 0.34, fontSize: 36, mono: true });
    s.position.set(0, RIG.labelHeight + 1.3, 0);
    return s;
  }, [resolved.missing]);

  const holoKey = hologram ? `${hologram.title}|${Math.round(hologram.progress)}` : '';
  const holoSprite = useMemo(() => {
    if (!hologram) return null;
    const s = makeHologram(hologram.title, hologram.progress);
    s.position.set(0, RIG.labelHeight + 0.75, 0);
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holoKey]);

  // The document rides at a fixed chest socket rather than on the hand bone: the
  // carry overlay aims the arms toward it, and a socket cannot drift with a
  // procedural pose. During the hand-over it slides toward the terminal slot.
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
  useEffect(
    () => () => {
      for (const s of badgeSprites) {
        s.material.map?.dispose();
        s.material.dispose();
      }
    },
    [badgeSprites],
  );
  useEffect(
    () => () => {
      holoSprite?.material.map?.dispose();
      holoSprite?.material.dispose();
    },
    [holoSprite],
  );

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

    // Hand-over: play the interact clip once and slide the document into the slot.
    if (rt.activity === 'delivering') {
      if (deliverT.current === 0) controller.playOnce('interact', 'idle');
      deliverT.current = Math.min(1, deliverT.current + dt / 1.6);
      const k = deliverT.current;
      document.visible = k < 0.9;
      document.position.set(0, 1.15 - 0.2 * k, 0.32 + 0.45 * k);
      document.rotation.set(-0.35 + 0.35 * k, 0, 0);
      if (k >= 1) {
        rt.activity = 'idle';
        rt.carrying = false;
      }
    } else {
      deliverT.current = 0;
      const wanted = clipFor(rt);
      if (controller.playing !== wanted) controller.play(wanted, { startAt: rt.pose === 'walk' ? 0 : (controller.phase / (Math.PI * 2)) * 1.5 });
      document.visible = controller.carry > 0.5;
      document.position.set(0, 1.15, 0.32);
      document.rotation.set(-0.35, 0, 0);
    }
    const wantTyping = rt.pose === 'sit' && rt.activity === 'typing' ? 1 : 0;
    controller.typing += (wantTyping - controller.typing) * Math.min(1, dt * 6);
    const wantCarry = rt.carrying && rt.activity !== 'delivering' ? 1 : 0;
    controller.carry += (wantCarry - controller.carry) * Math.min(1, dt * 8);
    controller.update(dt);
  });

  return (
    <group
      ref={group}
      onClick={
        onClick
          ? (e) => {
              e.stopPropagation();
              onClick(runtime.agentId);
            }
          : undefined
      }
    >
      <primitive object={model} />
      <primitive object={document} />
      <primitive object={plate} />
      {badgeSprites.map((s, i) => (
        <primitive key={i} object={s} />
      ))}
      {holoSprite ? <primitive object={holoSprite} /> : null}
      {missingSprite ? <primitive object={missingSprite} /> : null}
    </group>
  );
}

useGLTF.preload(RIG_URL);
