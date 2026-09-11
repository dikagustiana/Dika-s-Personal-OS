import { Canvas } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { useUiStore } from '../store/uiStore';
import { setActiveCampus } from '../../../../logic/floor/layout/campus';
import type { CampusLayout } from '../../../../logic/floor/layout/types';
import type { FloorMarker } from '../../../../logic/floor/institution/project';
import { refreshCampusCentre } from './runtime';
import type { PhantomSeat } from './avatars/AvatarsLayer';
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

/**
 * The whole 3D world.
 *
 * The layout arrives as a prop and is installed as the active floor BEFORE
 * anything inside the canvas reads it — several scene modules resolve the
 * campus at module scope. The caller keys this component on the layout's
 * name, so a floorplan change unmounts the old building instead of leaving
 * memoised geometry from it on screen.
 */
export function OfficeCanvas({
  layout,
  phantoms = [],
  markers = [],
}: {
  layout: CampusLayout;
  phantoms?: PhantomSeat[];
  markers?: FloorMarker[];
}) {
  setActiveCampus(layout);
  refreshCampusCentre();
  const down = useRef<{ x: number; y: number } | null>(null);
  void markers;
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
      <AvatarsLayer phantoms={phantoms} />
      <SelectionRing />
      <InspectorHtml onOpenOutput={(taskId) => useUiStore.getState().setOutputTaskId(taskId)} />
      <Effects />
      <PerfMeter />
    </Canvas>
  );
}
