'use client';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { runtime } from '../runtime';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDir = normalize(wp.xyz);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uStars;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.2, 1.0);
  float g = smoothstep(-0.05, 0.55, h);
  vec3 col = mix(uHorizon, uZenith, g);
  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  col += uSunColor * (pow(sd, 380.0) * 2.2 + pow(sd, 12.0) * 0.28);
  // Below the horizon, fade toward the horizon colour so the ground plane edge reads as haze.
  col = mix(col, uHorizon, smoothstep(0.0, -0.2, d.y));
  if (uStars > 0.001 && d.y > 0.02) {
    vec3 cell = floor(d * 260.0);
    float s = hash(cell);
    float star = smoothstep(0.9965, 1.0, s) * uStars * smoothstep(0.02, 0.25, d.y);
    col += vec3(star);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

/** Gradient sky dome driven by the blended preset. Never fogged; never lit. */
export function SkyDome() {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uStars: { value: 0 },
    }),
    [],
  );
  useFrame(() => {
    const L = runtime.lighting;
    uniforms.uZenith.value.setRGB(L.skyZenith[0], L.skyZenith[1], L.skyZenith[2], THREE.SRGBColorSpace);
    uniforms.uHorizon.value.setRGB(L.skyHorizon[0], L.skyHorizon[1], L.skyHorizon[2], THREE.SRGBColorSpace);
    uniforms.uSunColor.value.setRGB(L.sunColor[0], L.sunColor[1], L.sunColor[2], THREE.SRGBColorSpace);
    uniforms.uSunDir.value.set(L.sunDirection[0], L.sunDirection[1], L.sunDirection[2]);
    uniforms.uStars.value = L.starIntensity;
  });
  return (
    <mesh frustumCulled={false} renderOrder={-100}>
      <sphereGeometry args={[600, 32, 16]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={VERT}
        fragmentShader={FRAG}
        uniforms={uniforms}
        side={THREE.BackSide}
        depthWrite={false}
        fog={false}
        toneMapped={false}
      />
    </mesh>
  );
}
