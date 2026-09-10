'use client';
// Primitive part builder for code-authored placeholder geometry. Every part
// carries per-vertex diffuse colour and per-vertex emissive colour so a whole
// piece of furniture merges into one geometry and one draw call per type.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface PartOptions {
  x?: number;
  y?: number;
  z?: number;
  /** Yaw about +Y, radians. */
  ry?: number;
  /** Pitch about +X, radians (applied before yaw). */
  rx?: number;
  color: string;
  /** Emissive colour; omit for none. */
  emissive?: string;
  /** Fraction of the emissive that is on regardless of the clock (screens stay faintly on by day). */
  emissiveBase?: number;
}

function paint(g: THREE.BufferGeometry, opts: PartOptions): THREE.BufferGeometry {
  const geom = g.index ? g.toNonIndexed() : g;
  const n = geom.attributes.position.count;
  const c = new THREE.Color(opts.color);
  const e = opts.emissive ? new THREE.Color(opts.emissive) : new THREE.Color(0, 0, 0);
  const colors = new Float32Array(n * 3);
  const emissive = new Float32Array(n * 3);
  const base = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
    emissive[i * 3] = e.r;
    emissive[i * 3 + 1] = e.g;
    emissive[i * 3 + 2] = e.b;
    base[i] = opts.emissiveBase ?? 0;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geom.setAttribute('emissiveColor', new THREE.BufferAttribute(emissive, 3));
  geom.setAttribute('emissiveBase', new THREE.BufferAttribute(base, 1));
  geom.deleteAttribute('uv');
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(opts.rx ?? 0, opts.ry ?? 0, 0, 'YXZ'));
  m.compose(new THREE.Vector3(opts.x ?? 0, opts.y ?? 0, opts.z ?? 0), q, new THREE.Vector3(1, 1, 1));
  geom.applyMatrix4(m);
  if (g !== geom) g.dispose();
  return geom;
}

/** Axis-aligned box of w × h × d centred at (x, y, z). */
export function box(w: number, h: number, d: number, opts: PartOptions): THREE.BufferGeometry {
  return paint(new THREE.BoxGeometry(w, h, d), opts);
}

/** Vertical cylinder of radius r and height h centred at (x, y, z). */
export function cyl(r: number, h: number, opts: PartOptions & { segments?: number; rTop?: number }): THREE.BufferGeometry {
  return paint(new THREE.CylinderGeometry(opts.rTop ?? r, r, h, opts.segments ?? 12), opts);
}

/** Low-poly ball. */
export function ball(r: number, opts: PartOptions): THREE.BufferGeometry {
  return paint(new THREE.IcosahedronGeometry(r, 1), opts);
}

/** Merge parts into one geometry; the inputs are disposed. */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('mergeGeometries returned null: attribute sets differ');
  for (const p of parts) p.dispose();
  merged.computeBoundingSphere();
  return merged;
}
