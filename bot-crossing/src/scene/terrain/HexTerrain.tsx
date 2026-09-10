'use client';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { HEX_RADIUS, hexToWorld } from '@/core/hex/hex';
import { CAMPUS, PATH_COLOR, SAND_COLOR } from '@/core/layout/campus';
import type { TileDef } from '@/core/layout/types';
import { FLOOR_Y } from '../runtime';

/** Deterministic 0..1 noise per tile so the sand reads as ground, not a board. */
function tileNoise(q: number, r: number): number {
  const n = Math.sin(q * 127.1 + r * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

export function tileTopY(t: TileDef): number {
  if (t.kind === 'sand') return 0.1 + tileNoise(t.hex.q, t.hex.r) * 0.08;
  return FLOOR_Y;
}

/**
 * Every tile of the campus in one InstancedMesh (B-4). Per-instance colour
 * carries the zone tint; per-instance scale carries the tile height.
 */
export function HexTerrain() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const tiles = useMemo(() => Array.from(CAMPUS.tiles.values()), []);
  const geometry = useMemo(() => {
    // Unit-height prism; a vertex points along +Z to match pointy-top tiles.
    const g = new THREE.CylinderGeometry(HEX_RADIUS * 0.985, HEX_RADIUS * 0.985, 1, 6, 1, false);
    g.translate(0, 0.5, 0);
    return g;
  }, []);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    tiles.forEach((t, i) => {
      const w = hexToWorld(t.hex);
      const top = tileTopY(t);
      m.makeScale(1, top, 1);
      m.setPosition(w.x, 0, w.z);
      mesh.setMatrixAt(i, m);
      if (t.kind === 'sand') {
        color.set(SAND_COLOR);
        const v = 0.94 + tileNoise(t.hex.r, t.hex.q) * 0.1;
        color.multiplyScalar(v);
      } else if (t.kind === 'path') {
        color.set(PATH_COLOR);
        color.multiplyScalar(0.97 + tileNoise(t.hex.q + 7, t.hex.r) * 0.05);
      } else {
        const zone = t.zoneId ? CAMPUS.zoneById.get(t.zoneId) : undefined;
        color.set(zone?.floorColor ?? '#cccccc');
      }
      mesh.setColorAt(i, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [tiles]);

  return (
    <instancedMesh ref={ref} args={[geometry, undefined, tiles.length]} castShadow receiveShadow frustumCulled={false}>
      <meshStandardMaterial roughness={0.92} metalness={0} />
    </instancedMesh>
  );
}
