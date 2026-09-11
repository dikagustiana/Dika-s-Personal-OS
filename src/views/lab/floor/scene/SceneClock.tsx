import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { lightingAtHour } from '../../../../logic/floor/lighting/presets';
import { hourFloatInZone } from '../../../../logic/floor/time/clock';
import { useUiStore } from '../store/uiStore';
import { runtime } from './runtime';

/**
 * Resolves the clock once per frame — system time in the chosen zone, or the
 * scrubber — and writes the blended lighting into the runtime. Publishes a
 * throttled readout to the UI store for the HUD.
 */
export function SceneClock() {
  const lastPublish = useRef(0);
  useFrame(({ clock }) => {
    const s = useUiStore.getState();
    let hour: number;
    if (s.timeMode === 'scrub') {
      if (s.sweep) {
        const elapsed = performance.now() - s.sweep.startedAt;
        const frac = Math.min(1, elapsed / s.sweep.durationMs);
        hour = (s.sweep.startHour + frac * 24) % 24;
        if (frac >= 1) {
          s.stopSweep();
          s.setScrubHour(hour);
        }
      } else {
        hour = s.scrubHour;
      }
    } else {
      hour = hourFloatInZone(new Date(), s.timeZone);
    }
    runtime.hour = hour;
    runtime.lighting = lightingAtHour(hour);

    const t = clock.elapsedTime;
    if (t - lastPublish.current > 0.25) {
      lastPublish.current = t;
      s.setDisplayClock(hour, runtime.lighting.dominant);
    }
  });
  return null;
}
