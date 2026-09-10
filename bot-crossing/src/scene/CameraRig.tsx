'use client';
import { OrbitControls, OrthographicCamera } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useRef, type ElementRef } from 'react';
import * as THREE from 'three';
import { CAMPUS } from '@/core/layout/campus';
import { runtime } from './runtime';

// three-stdlib is drei's dependency, not ours; take the controls type from drei's ref.
type OrbitControlsImpl = NonNullable<ElementRef<typeof OrbitControls>>;

/** Shared handle so the inspector (Phase 6) can drive focus transitions. */
export const cameraRig: { controls: OrbitControlsImpl | null } = { controls: null };

const ISO_DIR = new THREE.Vector3(1, 1.15, 1).normalize();
const ISO_DISTANCE = 120;
const MARGIN = 6;

/**
 * Orthographic isometric view with smooth pan, zoom and orbit, bounded to the
 * campus (C-4). The bound is applied to the orbit target every frame, so no
 * gesture can leave the campus behind.
 */
export function CameraRig() {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const c = runtime.campusCenter;
  const b = CAMPUS.bounds;

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    cameraRig.controls = controls;
    const t = controls.target;
    const nx = THREE.MathUtils.clamp(t.x, b.minX - MARGIN, b.maxX + MARGIN);
    const nz = THREE.MathUtils.clamp(t.z, b.minZ - MARGIN, b.maxZ + MARGIN);
    if (nx !== t.x || nz !== t.z || t.y !== 0) {
      const cam = controls.object;
      cam.position.x += nx - t.x;
      cam.position.z += nz - t.z;
      cam.position.y -= t.y;
      t.set(nx, 0, nz);
    }
  });

  return (
    <>
      <OrthographicCamera
        makeDefault
        position={[c.x + ISO_DIR.x * ISO_DISTANCE, ISO_DIR.y * ISO_DISTANCE, c.z + ISO_DIR.z * ISO_DISTANCE]}
        zoom={16}
        near={1}
        far={500}
      />
      <OrbitControls
        ref={controlsRef}
        target={[c.x, 0, c.z]}
        enableDamping
        dampingFactor={0.12}
        minZoom={7}
        maxZoom={70}
        minPolarAngle={0.55}
        maxPolarAngle={1.25}
        screenSpacePanning={false}
        zoomToCursor
        mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
      />
    </>
  );
}
