'use client';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { HEX_RADIUS, hexToWorld, parseHexKey, sharedEdgeCorners, type WorldXZ } from '@/core/hex/hex';
import { CAMPUS } from '@/core/layout/campus';
import { canopyMaterial, frameMaterial, glassMaterial, interiorMaterial } from '../materials/interiorMaterial';
import { box, cyl, merge } from '../furniture/parts';
import { FLOOR_Y } from '../runtime';

const WALL_HEIGHT = 2.6;
const CANOPY_Y = FLOOR_Y + WALL_HEIGHT + 0.1;

interface EdgeSeg {
  a: WorldXZ;
  b: WorldXZ;
  /** Unit direction from the tile inside the zone toward the outside; strips sit inside. */
  inward: WorldXZ;
  isDoor: boolean;
}

function edgeSegments(): EdgeSeg[] {
  const doorKeys = new Set<string>();
  for (const z of CAMPUS.zones) for (const [a, b] of z.doors) doorKeys.add([a, b].map((h) => `${h.q},${h.r}`).sort().join('|'));
  const out: EdgeSeg[] = [];
  const keys = new Set<string>([...CAMPUS.walls, ...doorKeys]);
  for (const key of keys) {
    const [ka, kb] = key.split('|');
    const ha = parseHexKey(ka);
    const hb = parseHexKey(kb);
    const seg = sharedEdgeCorners(ha, hb);
    if (!seg) continue;
    const ta = CAMPUS.tiles.get(ka);
    const inside = ta?.zoneId ? ha : hb;
    const outside = inside === ha ? hb : ha;
    const ci = hexToWorld(inside);
    const co = hexToWorld(outside);
    const len = Math.hypot(co.x - ci.x, co.z - ci.z) || 1;
    out.push({
      a: seg[0],
      b: seg[1],
      inward: { x: (ci.x - co.x) / len, z: (ci.z - co.z) / len },
      isDoor: doorKeys.has(key),
    });
  }
  return out;
}

function setSegmentMatrix(m: THREE.Matrix4, seg: EdgeSeg, y: number, offsetInward = 0): void {
  const mx = (seg.a.x + seg.b.x) / 2 + seg.inward.x * offsetInward;
  const mz = (seg.a.z + seg.b.z) / 2 + seg.inward.z * offsetInward;
  const ex = seg.b.x - seg.a.x;
  const ez = seg.b.z - seg.a.z;
  // Rotation about Y by θ maps local +X to (cos θ, 0, −sin θ).
  const yaw = Math.atan2(-ez, ex);
  m.makeRotationY(yaw);
  m.setPosition(mx, y, mz);
}

function Instanced({
  geometry,
  material,
  count,
  fill,
  shadows,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  count: number;
  fill: (setAt: (i: number, m: THREE.Matrix4) => void) => void;
  shadows: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    fill((i, m) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [fill]);
  if (count === 0) return null;
  return (
    <instancedMesh ref={ref} args={[geometry, material, count]} castShadow={shadows} receiveShadow={shadows} frustumCulled={false} />
  );
}

/**
 * Glass pods from the layout's wall edges: panels, corner posts, top rails,
 * LED floor strips (emissive), a translucent canopy per interior tile and
 * ceiling spots (emissive). Doors are wall edges without a panel.
 */
export function Architecture() {
  const segs = useMemo(edgeSegments, []);
  const walls = useMemo(() => segs.filter((s) => !s.isDoor), [segs]);
  const corners = useMemo(() => {
    const map = new Map<string, WorldXZ>();
    for (const s of segs) {
      for (const p of [s.a, s.b]) map.set(`${p.x.toFixed(3)},${p.z.toFixed(3)}`, p);
    }
    return Array.from(map.values());
  }, [segs]);
  const interiorTiles = useMemo(() => {
    const walled = new Set(CAMPUS.zones.filter((z) => z.walled).map((z) => z.id));
    return Array.from(CAMPUS.tiles.values()).filter((t) => t.zoneId && walled.has(t.zoneId));
  }, []);
  const spotTiles = useMemo(() => interiorTiles.filter((t) => (((t.hex.q + 2 * t.hex.r) % 3) + 3) % 3 === 0), [interiorTiles]);

  const panelGeo = useMemo(() => new THREE.BoxGeometry(HEX_RADIUS - 0.1, WALL_HEIGHT, 0.04), []);
  const postGeo = useMemo(() => new THREE.CylinderGeometry(0.06, 0.06, WALL_HEIGHT + 0.12, 8), []);
  const railGeo = useMemo(() => new THREE.BoxGeometry(HEX_RADIUS, 0.08, 0.12), []);
  const stripGeo = useMemo(() => merge([box(HEX_RADIUS * 0.86, 0.014, 0.035, { color: '#2a2f38', emissive: '#ffe2b8' })]), []);
  const canopyGeo = useMemo(() => new THREE.CylinderGeometry(HEX_RADIUS * 0.995, HEX_RADIUS * 0.995, 0.04, 6), []);
  const spotGeo = useMemo(() => merge([cyl(0.13, 0.05, { color: '#20242e', emissive: '#fff1d6', segments: 10 })]), []);

  const fillPanels = useMemo(
    () => (setAt: (i: number, m: THREE.Matrix4) => void) => {
      const m = new THREE.Matrix4();
      walls.forEach((s, i) => {
        setSegmentMatrix(m, s, FLOOR_Y + WALL_HEIGHT / 2);
        setAt(i, m);
      });
    },
    [walls],
  );
  const fillRails = useMemo(
    () => (setAt: (i: number, m: THREE.Matrix4) => void) => {
      const m = new THREE.Matrix4();
      segs.forEach((s, i) => {
        setSegmentMatrix(m, s, FLOOR_Y + WALL_HEIGHT + 0.04);
        setAt(i, m);
      });
    },
    [segs],
  );
  const fillStrips = useMemo(
    () => (setAt: (i: number, m: THREE.Matrix4) => void) => {
      const m = new THREE.Matrix4();
      walls.forEach((s, i) => {
        setSegmentMatrix(m, s, FLOOR_Y + 0.01, 0.09);
        setAt(i, m);
      });
    },
    [walls],
  );
  const fillPosts = useMemo(
    () => (setAt: (i: number, m: THREE.Matrix4) => void) => {
      const m = new THREE.Matrix4();
      corners.forEach((c, i) => {
        m.makeTranslation(c.x, FLOOR_Y + (WALL_HEIGHT + 0.12) / 2, c.z);
        setAt(i, m);
      });
    },
    [corners],
  );
  const fillCanopy = useMemo(
    () => (setAt: (i: number, m: THREE.Matrix4) => void) => {
      const m = new THREE.Matrix4();
      interiorTiles.forEach((t, i) => {
        const w = hexToWorld(t.hex);
        m.makeTranslation(w.x, CANOPY_Y, w.z);
        setAt(i, m);
      });
    },
    [interiorTiles],
  );
  const fillSpots = useMemo(
    () => (setAt: (i: number, m: THREE.Matrix4) => void) => {
      const m = new THREE.Matrix4();
      spotTiles.forEach((t, i) => {
        const w = hexToWorld(t.hex);
        m.makeTranslation(w.x, CANOPY_Y - 0.06, w.z);
        setAt(i, m);
      });
    },
    [spotTiles],
  );

  return (
    <group>
      <Instanced geometry={panelGeo} material={glassMaterial} count={walls.length} fill={fillPanels} shadows={false} />
      <Instanced geometry={postGeo} material={frameMaterial} count={corners.length} fill={fillPosts} shadows />
      <Instanced geometry={railGeo} material={frameMaterial} count={segs.length} fill={fillRails} shadows />
      <Instanced geometry={stripGeo} material={interiorMaterial} count={walls.length} fill={fillStrips} shadows={false} />
      <Instanced geometry={canopyGeo} material={canopyMaterial} count={interiorTiles.length} fill={fillCanopy} shadows={false} />
      <Instanced geometry={spotGeo} material={interiorMaterial} count={spotTiles.length} fill={fillSpots} shadows={false} />
    </group>
  );
}
