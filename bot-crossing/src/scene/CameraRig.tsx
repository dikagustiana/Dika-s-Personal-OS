'use client';
import { OrbitControls, OrthographicCamera } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useRef, type ElementRef } from 'react';
import * as THREE from 'three';
import { CAMPUS } from '@/core/layout/campus';
import { useUiStore } from '@/stores/uiStore';
import { avatarRuntimes } from './avatars/avatarRuntime';
import { runtime } from './runtime';

// three-stdlib is drei's dependency, not ours; take the controls type from drei's ref.
type OrbitControlsImpl = NonNullable<ElementRef<typeof OrbitControls>>;

/** Shared handle so the inspector (Phase 6) can drive focus transitions. */
export const cameraRig: { controls: OrbitControlsImpl | null } = { controls: null };

declare global {
  interface Window {
    __bcCamera?: { setOrbit(polar: number, azimuth: number): void; getOrbit(): { polar: number; azimuth: number } };
  }
}

/** Place the camera on the orbit sphere around the current target (dev/scripted verification). */
function setOrbit(controls: OrbitControlsImpl, polar: number, azimuth: number): void {
  const cam = controls.object;
  const t = controls.target;
  const r = cam.position.distanceTo(t);
  const p = THREE.MathUtils.clamp(polar, controls.minPolarAngle, controls.maxPolarAngle);
  cam.position.set(t.x + r * Math.sin(p) * Math.sin(azimuth), t.y + r * Math.cos(p), t.z + r * Math.sin(p) * Math.cos(azimuth));
  cam.lookAt(t);
  controls.update();
}

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

  useFrame((_, dt) => {
    const controls = controlsRef.current;
    if (!controls) return;
    if (cameraRig.controls !== controls) {
      cameraRig.controls = controls;
      if (useUiStore.getState().devTools) {
        window.__bcCamera = {
          setOrbit: (polar, azimuth) => setOrbit(controls, polar, azimuth),
          getOrbit: () => ({ polar: controls.getPolarAngle(), azimuth: controls.getAzimuthalAngle() }),
        };
      }
    }
    const t = controls.target;
    const ui = useUiStore.getState();
    // Follow: ease the orbit target onto the avatar, carrying the camera with it.
    if (ui.followAgentId) {
      const rt = avatarRuntimes.get(ui.followAgentId);
      if (rt) {
        const k = Math.min(1, dt * 4);
        const dx = (rt.x - t.x) * k;
        const dz = (rt.z - t.z) * k;
        const dy = (rt.y + 0.9 - t.y) * k;
        t.x += dx;
        t.z += dz;
        t.y += dy;
        controls.object.position.x += dx;
        controls.object.position.z += dz;
        controls.object.position.y += dy;
      }
    }
    const cam = controls.object;
    if (ui.cameraZoom !== null && cam instanceof THREE.OrthographicCamera && Math.abs(cam.zoom - ui.cameraZoom) > 1e-3) {
      cam.zoom += (ui.cameraZoom - cam.zoom) * Math.min(1, dt * 4);
      cam.updateProjectionMatrix();
    }
    const nx = THREE.MathUtils.clamp(t.x, b.minX - MARGIN, b.maxX + MARGIN);
    const nz = THREE.MathUtils.clamp(t.z, b.minZ - MARGIN, b.maxZ + MARGIN);
    if (nx !== t.x || nz !== t.z) {
      cam.position.x += nx - t.x;
      cam.position.z += nz - t.z;
      t.x = nx;
      t.z = nz;
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
