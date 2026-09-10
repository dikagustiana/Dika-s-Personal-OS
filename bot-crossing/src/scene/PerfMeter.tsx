'use client';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useUiStore, type PerfSample } from '@/stores/uiStore';

declare global {
  interface Window {
    __bcPerf?: PerfSample & { samples: number[] };
  }
}

/** Frame-rate meter. Publishes once a second; the raw fps history is exposed on window for scripted measurement. */
export function PerfMeter() {
  const gl = useThree((s) => s.gl);
  const frames = useRef(0);
  const acc = useRef(0);
  const history = useRef<number[]>([]);
  // With the composer on, each pass calls renderer.render, and autoReset would
  // leave only the last pass's counts. Accumulate per frame and reset here.
  useEffect(() => {
    gl.info.autoReset = false;
    return () => {
      gl.info.autoReset = true;
    };
  }, [gl]);
  useFrame((_, delta) => {
    frames.current += 1;
    acc.current += delta;
    if (acc.current >= 1) {
      const fps = frames.current / acc.current;
      const sample: PerfSample = {
        fps: Math.round(fps * 10) / 10,
        frameMs: Math.round((1000 / Math.max(fps, 1e-3)) * 10) / 10,
        drawCalls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        agents: Object.keys(useAgentStore.getState().agents).length,
      };
      history.current.push(sample.fps);
      if (history.current.length > 120) history.current.shift();
      useUiStore.getState().setPerf(sample);
      if (typeof window !== 'undefined') window.__bcPerf = { ...sample, samples: [...history.current] };
      frames.current = 0;
      acc.current = 0;
    }
    gl.info.reset();
  }, -1000);
  return null;
}
