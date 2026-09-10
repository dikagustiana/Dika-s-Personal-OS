'use client';
import { OrbitControls, OrthographicCamera } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
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
    __bcCamera?: {
      setOrbit(polar: number, azimuth: number): void;
      getOrbit(): { polar: number; azimuth: number };
      getTarget(): { x: number; y: number; z: number };
    };
    /** World point → CSS pixel position on the canvas (scripted clicks). */
    __bcProject?: (x: number, y: number, z: number) => { x: number; y: number };
  }
}

const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

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
  const lastZoomPublish = useRef(0);
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);

  useFrame((_, dt) => {
    const controls = controlsRef.current;
    if (!controls) return;
    if (cameraRig.controls !== controls) {
      cameraRig.controls = controls;
      if (useUiStore.getState().devTools) {
        window.__bcCamera = {
          setOrbit: (polar, azimuth) => setOrbit(controls, polar, azimuth),
          getOrbit: () => ({ polar: controls.getPolarAngle(), azimuth: controls.getAzimuthalAngle() }),
          getTarget: () => ({ x: controls.target.x, y: controls.target.y, z: controls.target.z }),
        };
        window.__bcProject = (x, y, z) => {
          const v = new THREE.Vector3(x, y, z).project(controls.object);
          const rect = gl.domElement.getBoundingClientRect();
          return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
        };
      }
    }
    const t = controls.target;
    const ui = useUiStore.getState();
    // Focus transitions are exponential eases toward a goal, so retargeting is
    // just changing the goal: nothing queues, nothing fights (C-4).
    const ease = reducedMotion ? 1 : Math.min(1, dt * 4);
    const goal = ui.followAgentId ? avatarRuntimes.get(ui.followAgentId) : null;
    const focus = goal ? { x: goal.x, y: goal.y + 0.9, z: goal.z } : ui.cameraFocus ? { x: ui.cameraFocus.x, y: 0.9, z: ui.cameraFocus.z } : null;
    if (focus) {
      const dx = (focus.x - t.x) * ease;
      const dz = (focus.z - t.z) * ease;
      const dy = (focus.y - t.y) * ease;
      t.x += dx;
      t.z += dz;
      t.y += dy;
      controls.object.position.x += dx;
      controls.object.position.z += dz;
      controls.object.position.y += dy;
    }
    const cam = controls.object;
    if (ui.cameraZoom !== null && cam instanceof THREE.OrthographicCamera && Math.abs(cam.zoom - ui.cameraZoom) > 1e-3) {
      cam.zoom += (ui.cameraZoom - cam.zoom) * ease;
      cam.updateProjectionMatrix();
    }
    if (cam instanceof THREE.OrthographicCamera) {
      lastZoomPublish.current += dt;
      if (lastZoomPublish.current > 0.5 && Math.abs(ui.liveZoom - cam.zoom) > 0.2) {
        lastZoomPublish.current = 0;
        ui.setLiveZoom(cam.zoom);
      }
    }
    void size;
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
        onStart={() => {
          // The user took the camera: stop following and stop any zoom transition.
          const ui = useUiStore.getState();
          if (ui.followAgentId) ui.setFollowAgentId(null);
          if (ui.cameraFocus) ui.setCameraFocus(null);
          if (ui.cameraZoom !== null) ui.setCameraZoom(null);
        }}
        mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
      />
    </>
  );
}
