'use client';
import { useMemo } from 'react';
import * as THREE from 'three';
import { hexCornersWorld } from '@/core/hex/hex';
import { CAMPUS } from '@/core/layout/campus';
import { useUiStore, type HexGridMode } from '@/stores/uiStore';
import { tileTopY } from './HexTerrain';

function buildOutlines(mode: HexGridMode): THREE.BufferGeometry | null {
  if (mode === 'never') return null;
  const positions: number[] = [];
  for (const t of CAMPUS.tiles.values()) {
    if (mode === 'exterior-only' && t.kind === 'floor') continue;
    const y = tileTopY(t) + 0.012;
    const corners = hexCornersWorld(t.hex, 0.03);
    for (let i = 0; i < 6; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 6];
      positions.push(a.x, y, a.z, b.x, y, b.z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return g;
}

/**
 * The honeycomb outline, in three modes (0-B): always, never, exterior-only.
 * One LineSegments object; rebuilt only when the mode changes.
 */
export function HexGridLines() {
  const mode = useUiStore((s) => s.showHexGrid);
  const geometry = useMemo(() => buildOutlines(mode), [mode]);
  if (!geometry) return null;
  return (
    <lineSegments geometry={geometry} renderOrder={1}>
      <lineBasicMaterial color="#5a4630" transparent opacity={0.28} depthWrite={false} />
    </lineSegments>
  );
}
