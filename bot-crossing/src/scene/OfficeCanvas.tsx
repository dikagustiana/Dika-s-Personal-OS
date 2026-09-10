'use client';
import { Canvas } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { useUiStore } from '@/stores/uiStore';
import { InspectorHtml } from './inspector/InspectorHtml';
import { SelectionRing } from './SelectionRing';
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
  const down = useRef<{ x: number; y: number } | null>(null);
  return (
    <Canvas
      onPointerDown={(e) => {
        down.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerMissed={(e) => {
        // A click on empty ground closes the inspector; an orbit drag does not.
        const d = down.current;
        if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
        if (useUiStore.getState().selectedAgentId) useUiStore.getState().setSelectedAgentId(null);
      }}
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
      <SelectionRing />
      <InspectorHtml onOpenOutput={(taskId) => useUiStore.getState().setOutputTaskId(taskId)} />
      <Effects />
      <PerfMeter />
    </Canvas>
  );
}
