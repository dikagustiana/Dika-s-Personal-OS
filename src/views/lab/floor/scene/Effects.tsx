import { Bloom, EffectComposer, N8AO, ToneMapping } from '@react-three/postprocessing';
import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';
import { useUiStore } from '../store/uiStore';

/**
 * Bloom (what makes emissive interiors glow at night) and N8AO. Tone mapping
 * runs inside the composer when it is on and on the renderer when it is off,
 * so toggling post never changes exposure.
 */
export function Effects() {
  const postEnabled = useUiStore((s) => s.postEnabled);
  const aoEnabled = useUiStore((s) => s.aoEnabled);
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    gl.toneMapping = postEnabled ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1;
  }, [gl, postEnabled]);

  if (!postEnabled) return null;
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      {aoEnabled ? (
        <N8AO aoRadius={1.6} intensity={1.6} distanceFalloff={1.2} quality="performance" halfRes depthAwareUpsampling />
      ) : (
        <></>
      )}
      <Bloom mipmapBlur luminanceThreshold={1.0} luminanceSmoothing={0.15} intensity={0.75} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}
