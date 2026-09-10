'use client';
// Code-authored placeholder furniture (B-6): untextured primitives at the
// dimensions in furnitureSpecs.ts, in the same local frame as the anchors
// (+Z is the direction the agent faces; the agent occupies the -Z half).
// Every piece is listed in PLACEHOLDERS.md; a GLTF with anchor empties
// replaces each one.
import type * as THREE from 'three';
import { SEAT_HEIGHT } from '@/core/layout/furnitureSpecs';
import type { FurnitureType } from '@/core/layout/types';
import { ball, box, cyl, merge } from './parts';

const OAK = '#d8c3a3';
const WALNUT = '#b58a5c';
const METAL = '#3b414c';
const CHARCOAL = '#2a2f38';
const SCREEN_OFF = '#0f1218';
const SCREEN_GLOW = '#6fd2ff';
const LAMP_GLOW = '#ffd2a0';
const LED_GLOW = '#37d2c6';

function officeChair(z: number): THREE.BufferGeometry[] {
  // Seat pan top at SEAT_HEIGHT (0.49): pan is 0.06 thick, centred at 0.46.
  return [
    box(0.46, 0.06, 0.46, { y: SEAT_HEIGHT - 0.03, z, color: CHARCOAL }),
    box(0.46, 0.5, 0.05, { y: SEAT_HEIGHT + 0.28, z: z - 0.23, color: CHARCOAL }),
    cyl(0.03, SEAT_HEIGHT - 0.09, { y: (SEAT_HEIGHT - 0.06) / 2, z, color: METAL }),
    cyl(0.28, 0.03, { y: 0.03, z, color: METAL, segments: 8 }),
  ];
}

function monitor(z: number, x = 0): THREE.BufferGeometry[] {
  return [
    cyl(0.07, 0.03, { x, y: 0.755, z, color: METAL }),
    box(0.04, 0.22, 0.04, { x, y: 0.88, z: z + 0.02, color: METAL }),
    box(0.56, 0.34, 0.03, { x, y: 1.08, z: z + 0.02, color: '#20242e' }),
    // The lit face points -Z, toward the sitter.
    box(0.5, 0.29, 0.006, { x, y: 1.08, z: z + 0.002, color: SCREEN_OFF, emissive: SCREEN_GLOW, emissiveBase: 0.3 }),
  ];
}

function deskLamp(x: number, z: number): THREE.BufferGeometry[] {
  return [
    cyl(0.06, 0.02, { x, y: 0.76, z, color: METAL }),
    cyl(0.012, 0.36, { x, y: 0.94, z, color: METAL, segments: 6 }),
    cyl(0.1, 0.1, { x: x - 0.05, y: 1.15, z: z - 0.05, color: CHARCOAL, rTop: 0.045, segments: 10 }),
    ball(0.035, { x: x - 0.05, y: 1.11, z: z - 0.05, color: '#fff3dc', emissive: LAMP_GLOW }),
  ];
}

const BUILDERS: Record<FurnitureType, () => THREE.BufferGeometry> = {
  workstation: () =>
    merge([
      box(1.4, 0.04, 0.7, { y: 0.73, z: 0.38, color: OAK }),
      ...[-0.65, 0.65].flatMap((x) => [0.1, 0.66].map((z) => box(0.05, 0.71, 0.05, { x, y: 0.355, z, color: METAL }))),
      box(1.3, 0.012, 0.02, { y: 0.705, z: 0.04, color: CHARCOAL, emissive: LED_GLOW }),
      ...monitor(0.5),
      box(0.42, 0.02, 0.14, { y: 0.76, z: 0.18, color: CHARCOAL }),
      ...deskLamp(0.55, 0.55),
      ...officeChair(-0.28),
    ]),
  meetingTable: () =>
    merge([
      cyl(0.8, 0.05, { y: 0.72, color: OAK, segments: 24 }),
      cyl(0.12, 0.7, { y: 0.35, color: METAL }),
      cyl(0.4, 0.04, { y: 0.02, color: METAL, segments: 16 }),
      cyl(0.18, 0.02, { y: 0.755, color: '#1a2230', emissive: LED_GLOW, emissiveBase: 0.35, segments: 16 }),
    ]),
  meetingChair: () => merge(officeChair(0.05)),
  loungeSofa: () =>
    merge([
      box(1.8, 0.4, 0.8, { y: 0.2, color: '#3f7f86' }),
      box(1.8, 0.5, 0.2, { y: 0.65, z: -0.3, color: '#3f7f86' }),
      box(0.15, 0.6, 0.8, { x: -0.825, y: 0.35, color: '#356c72' }),
      box(0.15, 0.6, 0.8, { x: 0.825, y: 0.35, color: '#356c72' }),
      box(0.8, 0.1, 0.6, { x: -0.42, y: SEAT_HEIGHT - 0.05, z: 0.05, color: '#e6d5b8' }),
      box(0.8, 0.1, 0.6, { x: 0.42, y: SEAT_HEIGHT - 0.05, z: 0.05, color: '#e6d5b8' }),
    ]),
  coffeeBar: () =>
    merge([
      box(1.6, 0.95, 0.6, { y: 0.475, color: '#8a6a4a' }),
      box(1.65, 0.04, 0.65, { y: 0.97, color: '#e0d3c0' }),
      box(0.4, 0.45, 0.35, { x: 0.4, y: 1.215, z: -0.05, color: CHARCOAL }),
      box(0.25, 0.06, 0.006, { x: 0.4, y: 1.3, z: -0.228, color: SCREEN_OFF, emissive: '#ffb547', emissiveBase: 0.4 }),
      cyl(0.05, 0.09, { x: -0.3, y: 1.035, color: '#e9eef5', segments: 8 }),
      cyl(0.05, 0.09, { x: -0.55, y: 1.035, z: 0.12, color: '#e9eef5', segments: 8 }),
    ]),
  outputTerminal: () =>
    merge([
      box(1.3, 0.06, 0.7, { y: 0.03, z: 0.1, color: METAL }),
      box(1.2, 1.9, 0.6, { y: 0.95, z: 0.1, color: '#33394a' }),
      box(0.8, 0.5, 0.01, { y: 1.35, z: -0.205, color: SCREEN_OFF, emissive: SCREEN_GLOW, emissiveBase: 0.35 }),
      box(0.6, 0.05, 0.01, { y: 0.95, z: -0.205, color: SCREEN_OFF, emissive: LED_GLOW, emissiveBase: 0.5 }),
      ball(0.04, { x: 0.45, y: 1.75, z: -0.2, color: '#62d889', emissive: '#62d889', emissiveBase: 0.6 }),
    ]),
  archiveShelf: () => {
    const parts = [
      box(0.05, 2.0, 0.5, { x: -0.8, y: 1.0, color: OAK }),
      box(0.05, 2.0, 0.5, { x: 0.8, y: 1.0, color: OAK }),
      box(1.6, 2.0, 0.03, { y: 1.0, z: 0.24, color: '#c9b393' }),
    ];
    const folderColors = ['#37d2c6', '#ffb547', '#9aa6b8', '#ff5e6c', '#62d889'];
    [0.3, 0.8, 1.3, 1.8].forEach((y, shelf) => {
      parts.push(box(1.6, 0.04, 0.5, { y, color: OAK }));
      if (shelf < 3) {
        for (let i = 0; i < 5; i++) {
          parts.push(box(0.22, 0.32, 0.38, { x: -0.6 + i * 0.3, y: y + 0.18, z: 0.02, color: folderColors[(i + shelf) % 5] }));
        }
      }
    });
    return merge(parts);
  },
  managerDesk: () =>
    merge([
      box(2.0, 0.05, 0.9, { y: 0.74, z: 0.35, color: WALNUT }),
      box(0.05, 0.72, 0.9, { x: -0.97, y: 0.36, z: 0.35, color: WALNUT }),
      box(0.05, 0.72, 0.9, { x: 0.97, y: 0.36, z: 0.35, color: WALNUT }),
      box(1.9, 0.5, 0.04, { y: 0.47, z: 0.76, color: '#a37a4f' }),
      ...monitor(0.55),
      ...deskLamp(0.8, 0.6),
      box(0.3, 0.08, 0.02, { x: -0.6, y: 0.8, z: 0.1, color: '#e9eef5' }),
      ...officeChair(-0.4),
    ]),
  plant: () =>
    merge([
      cyl(0.22, 0.35, { y: 0.175, color: '#b07a52', rTop: 0.26 }),
      cyl(0.24, 0.03, { y: 0.36, color: '#4a3524' }),
      cyl(0.03, 0.4, { y: 0.55, color: '#6b4a2e', segments: 6 }),
      ball(0.32, { y: 0.85, color: '#4f8f57' }),
      ball(0.24, { x: 0.18, y: 1.08, z: 0.1, color: '#5aa063' }),
      ball(0.22, { x: -0.16, y: 1.05, z: -0.1, color: '#3f7f4a' }),
    ]),
};

const cache = new Map<FurnitureType, THREE.BufferGeometry>();

/** Geometry for a furniture type, built once and shared by its InstancedMesh. */
export function furnitureGeometry(type: FurnitureType): THREE.BufferGeometry {
  let g = cache.get(type);
  if (!g) {
    g = BUILDERS[type]();
    cache.set(type, g);
  }
  return g;
}
