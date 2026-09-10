'use client';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { Architecture } from './architecture/Architecture';
import { AvatarsLayer } from './avatars/AvatarsLayer';
import { CameraRig } from './CameraRig';
import { FurnitureLayer } from './furniture/FurnitureLayer';
import { ZoneSigns } from './labels/ZoneSigns';
import { Effects } from './Effects';
import { PerfMeter } from './PerfMeter';
import { SceneClock } from './SceneClock';
import { SkyDome } from './lighting/SkyDome';
import { SunAndAmbient } from './lighting/SunAndAmbient';
import { DesertGround } from './terrain/DesertGround';
import { HexGridLines } from './terrain/HexGridLines';
import { HexTerrain } from './terrain/HexTerrain';

/** The whole 3D world. Everything inside the canvas lives under src/scene. */
export function OfficeCanvas() {
  return (
    <Canvas
      shadows="soft"
      dpr={[1, 1.5]}
      gl={{
        antialias: true,
        powerPreference: 'high-performance',
        toneMapping: THREE.NoToneMapping,
        outputColorSpace: THREE.SRGBColorSpace,
      }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <SceneClock />
      <CameraRig />
      <SkyDome />
      <SunAndAmbient />
      <DesertGround />
      <HexTerrain />
      <HexGridLines />
      <FurnitureLayer />
      <Architecture />
      <ZoneSigns />
      <AvatarsLayer />
      <Effects />
      <PerfMeter />
    </Canvas>
  );
}
