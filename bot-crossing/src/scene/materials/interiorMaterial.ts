'use client';
// One material for every piece of code-authored furniture and fitting. Diffuse
// comes from a per-vertex `color`; emissive comes from a per-vertex
// `emissiveColor` (rgb) and `emissiveBase` (how much of it is on regardless of
// the clock). The clock's interiorEmissiveIntensity is a single uniform (B-5),
// and there are zero light objects indoors (B-4): everything glows via bloom.
import * as THREE from 'three';

const uniforms = {
  uInteriorEmissive: { value: 0 },
  uEmissiveBoost: { value: 2.6 },
  uGreyPlaceholders: { value: 0 },
};

export const interiorMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.75,
  metalness: 0.05,
});
interiorMaterial.defines = { BC_INTERIOR: '' };
interiorMaterial.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
attribute vec3 emissiveColor;
attribute float emissiveBase;
varying vec3 vEmissiveColor;
varying float vEmissiveBase;`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
vEmissiveColor = emissiveColor;
vEmissiveBase = emissiveBase;`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
uniform float uInteriorEmissive;
uniform float uEmissiveBoost;
uniform float uGreyPlaceholders;
varying vec3 vEmissiveColor;
varying float vEmissiveBase;`,
    )
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42), uGreyPlaceholders);`,
    )
    .replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
float onAmount = vEmissiveBase + (1.0 - vEmissiveBase) * uInteriorEmissive;
totalEmissiveRadiance += vEmissiveColor * onAmount * uEmissiveBoost;`,
    );
};
interiorMaterial.customProgramCacheKey = () => 'bc-interior';

export function setInteriorEmissive(value: number): void {
  uniforms.uInteriorEmissive.value = value;
}

export function setGreyPlaceholders(on: boolean): void {
  uniforms.uGreyPlaceholders.value = on ? 1 : 0;
}

/** Glass for pod walls and canopies. Shared; never casts shadows. */
export const glassMaterial = new THREE.MeshStandardMaterial({
  color: new THREE.Color('#bfe6ee'),
  roughness: 0.08,
  metalness: 0.0,
  transparent: true,
  opacity: 0.22,
  depthWrite: false,
  side: THREE.DoubleSide,
});

/** Canopies are seen from above over every interior; kept fainter than the walls so furniture stays legible. */
export const canopyMaterial = new THREE.MeshStandardMaterial({
  color: new THREE.Color('#cdeef4'),
  roughness: 0.1,
  metalness: 0.0,
  transparent: true,
  opacity: 0.1,
  depthWrite: false,
  side: THREE.DoubleSide,
});

/** Anodised frame for posts and rails. */
export const frameMaterial = new THREE.MeshStandardMaterial({
  color: new THREE.Color('#5b4a3a'),
  roughness: 0.55,
  metalness: 0.6,
});
