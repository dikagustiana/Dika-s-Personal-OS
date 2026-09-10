'use client';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { QueryClientProvider } from '@tanstack/react-query';
import { useRef } from 'react';
import * as THREE from 'three';
import { InspectorPanel } from '@/hud/inspector/InspectorPanel';
import { queryClient } from '@/hud/queryClient';
import { useUiStore } from '@/stores/uiStore';
import { avatarRuntimes } from '../avatars/avatarRuntime';

const PANEL_W = 420;
const PANEL_H = 600;
const v = new THREE.Vector3();

/** Project the anchor, then keep the panel's box inside the canvas. */
function clampedPosition(el: THREE.Object3D, camera: THREE.Camera, size: { width: number; height: number }): [number, number] {
  v.setFromMatrixPosition(el.matrixWorld).project(camera);
  const x = ((v.x + 1) / 2) * size.width;
  const y = ((1 - v.y) / 2) * size.height;
  return [Math.min(Math.max(x, 12), Math.max(12, size.width - PANEL_W)), Math.min(Math.max(y, 12), Math.max(12, size.height - PANEL_H))];
}

/**
 * The one drei/Html in the scene (B-4): the inspector for the selected agent,
 * anchored above its avatar and following it every frame. Html renders into
 * its own React root, so it carries its own QueryClientProvider (same client).
 */
export function InspectorHtml({ onOpenOutput }: { onOpenOutput: (taskId: string) => void }) {
  const selected = useUiStore((s) => s.selectedAgentId);
  const setSelected = useUiStore((s) => s.setSelectedAgentId);
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = group.current;
    if (!g || !selected) return;
    const rt = avatarRuntimes.get(selected);
    if (rt) g.position.set(rt.x, rt.y + 2.2, rt.z);
  });
  if (!selected) return null;
  return (
    <group ref={group}>
      <Html wrapperClass="bc-html-root" zIndexRange={[30, 10]} style={{ pointerEvents: 'auto' }} calculatePosition={clampedPosition}>
        <div style={{ transform: 'translate(28px, -20px)' }}>
          <QueryClientProvider client={queryClient}>
            <InspectorPanel agentId={selected} onClose={() => setSelected(null)} onOpenOutput={onOpenOutput} />
          </QueryClientProvider>
        </div>
      </Html>
    </group>
  );
}
