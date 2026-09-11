import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { activeCampus } from '../../../../../logic/floor/layout/campus';
import { runtime } from '../runtime';

const SUN_DISTANCE = 90;

/**
 * The one shadow-casting light in the scene (B-4). Its shadow camera is bounded
 * to the campus by hand, never left on auto. The hemisphere light is exterior
 * ambient; there are no interior light objects anywhere.
 */
export function SunAndAmbient() {
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const { scene } = useThree();
  const target = useMemo(() => {
    const t = new THREE.Object3D();
    t.position.set(runtime.campusCenter.x, 0, runtime.campusCenter.z);
    return t;
  }, []);
  const fog = useMemo(() => new THREE.Fog(new THREE.Color('#dfe6ea'), 60, 160), []);

  useEffect(() => {
    scene.add(target);
    scene.fog = fog;
    const sun = sunRef.current;
    if (sun) {
      sun.target = target;
      const b = activeCampus().bounds;
      // Half-extents of the campus plus a margin; square so the frustum covers
      // the footprint at any sun azimuth.
      const half = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 6;
      const cam = sun.shadow.camera;
      cam.left = -half;
      cam.right = half;
      cam.top = half;
      cam.bottom = -half;
      cam.near = 1;
      cam.far = SUN_DISTANCE * 2 + 40;
      cam.updateProjectionMatrix();
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.03;
    }
    return () => {
      scene.remove(target);
      scene.fog = null;
    };
  }, [scene, target, fog]);

  useFrame(({ camera }) => {
    const L = runtime.lighting;
    const sun = sunRef.current;
    if (sun) {
      sun.position.set(
        runtime.campusCenter.x + L.sunDirection[0] * SUN_DISTANCE,
        L.sunDirection[1] * SUN_DISTANCE,
        runtime.campusCenter.z + L.sunDirection[2] * SUN_DISTANCE,
      );
      sun.color.setRGB(L.sunColor[0], L.sunColor[1], L.sunColor[2], THREE.SRGBColorSpace);
      sun.intensity = L.sunIntensity;
    }
    const hemi = hemiRef.current;
    if (hemi) {
      hemi.color.setRGB(L.hemiSkyColor[0], L.hemiSkyColor[1], L.hemiSkyColor[2], THREE.SRGBColorSpace);
      hemi.groundColor.setRGB(L.hemiGroundColor[0], L.hemiGroundColor[1], L.hemiGroundColor[2], THREE.SRGBColorSpace);
      hemi.intensity = L.hemiIntensity;
    }
    fog.color.setRGB(L.fogColor[0], L.fogColor[1], L.fogColor[2], THREE.SRGBColorSpace);
    // Fog is measured from the camera. The orthographic camera sits a fixed
    // ~120 m from the campus, so preset distances are offsets beyond that;
    // otherwise the whole campus would sit inside the haze.
    const camDist = camera.position.distanceTo(target.position);
    fog.near = camDist + L.fogNear;
    fog.far = camDist + L.fogFar;
  });

  return (
    <>
      <directionalLight ref={sunRef} castShadow intensity={2} />
      <hemisphereLight ref={hemiRef} intensity={0.8} />
    </>
  );
}
