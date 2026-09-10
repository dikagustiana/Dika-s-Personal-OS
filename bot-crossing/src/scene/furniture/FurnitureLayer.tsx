'use client';
import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CAMPUS } from '@/core/layout/campus';
import { furnitureWorldPose } from '@/core/layout/resolve';
import type { FurniturePlacement, FurnitureType } from '@/core/layout/types';
import { useUiStore } from '@/stores/uiStore';
import { interiorMaterial, setGreyPlaceholders, setInteriorEmissive } from '../materials/interiorMaterial';
import { FLOOR_Y, runtime } from '../runtime';
import { furnitureGeometry } from './catalog';

function TypeInstances({ type, placements }: { type: FurnitureType; placements: FurniturePlacement[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => furnitureGeometry(type), [type]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    placements.forEach((f, i) => {
      const pose = furnitureWorldPose(f, FLOOR_Y);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), pose.yaw);
      p.set(pose.x, pose.y, pose.z);
      m.compose(p, q, one);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [placements]);
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, interiorMaterial, placements.length]}
      castShadow
      receiveShadow
      frustumCulled={false}
      userData={{ furnitureType: type }}
    />
  );
}

/** Every piece of furniture in the campus, one InstancedMesh per type (B-4). */
export function FurnitureLayer() {
  const byType = useMemo(() => {
    const map = new Map<FurnitureType, FurniturePlacement[]>();
    for (const f of CAMPUS.furniture) {
      const list = map.get(f.type) ?? [];
      list.push(f);
      map.set(f.type, list);
    }
    return Array.from(map.entries());
  }, []);
  const grey = useUiStore((s) => s.greyPlaceholders);
  useEffect(() => setGreyPlaceholders(grey), [grey]);
  useFrame(() => setInteriorEmissive(runtime.lighting.interiorEmissiveIntensity));
  return (
    <group>
      {byType.map(([type, placements]) => (
        <TypeInstances key={type} type={type} placements={placements} />
      ))}
    </group>
  );
}
