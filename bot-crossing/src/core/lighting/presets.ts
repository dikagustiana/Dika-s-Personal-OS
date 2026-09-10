// Four named lighting presets, blended by the clock (B-5). No solar model:
// the sun's position is whatever the preset says. `interiorEmissiveIntensity`
// is the single scalar behind "the office lights just came on".
export type PresetName = 'MORNING' | 'MIDDAY' | 'DUSK' | 'NIGHT';

export type RGB = [number, number, number];

export interface LightingPreset {
  name: PresetName;
  /** Unit-ish direction the sunlight comes FROM (also the sun's sky position). */
  sunDirection: [number, number, number];
  sunColor: RGB;
  sunIntensity: number;
  hemiSkyColor: RGB;
  hemiGroundColor: RGB;
  hemiIntensity: number;
  skyZenith: RGB;
  skyHorizon: RGB;
  /** 0 = no stars, 1 = full night sky. */
  starIntensity: number;
  fogColor: RGB;
  /** Fog start and end as distances BEYOND the camera's distance to the campus centre, in metres. */
  fogNear: number;
  fogFar: number;
  interiorEmissiveIntensity: number;
}

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export const PRESETS: Record<PresetName, LightingPreset> = {
  MORNING: {
    name: 'MORNING',
    sunDirection: [-0.75, 0.35, 0.55],
    sunColor: hexToRgb('#ffd9a8'),
    sunIntensity: 2.4,
    hemiSkyColor: hexToRgb('#c9dcf0'),
    hemiGroundColor: hexToRgb('#b9926a'),
    hemiIntensity: 0.75,
    skyZenith: hexToRgb('#6f9fd8'),
    skyHorizon: hexToRgb('#f6d9b5'),
    starIntensity: 0,
    fogColor: hexToRgb('#efd8bb'),
    fogNear: 26,
    fogFar: 150,
    interiorEmissiveIntensity: 0.12,
  },
  MIDDAY: {
    name: 'MIDDAY',
    sunDirection: [-0.25, 0.95, 0.3],
    sunColor: hexToRgb('#fff4e0'),
    sunIntensity: 3.2,
    hemiSkyColor: hexToRgb('#dbe9fb'),
    hemiGroundColor: hexToRgb('#c9a37a'),
    hemiIntensity: 0.9,
    skyZenith: hexToRgb('#3f7fd4'),
    skyHorizon: hexToRgb('#cfe0f2'),
    starIntensity: 0,
    fogColor: hexToRgb('#dfe6ea'),
    fogNear: 32,
    fogFar: 170,
    interiorEmissiveIntensity: 0.0,
  },
  DUSK: {
    name: 'DUSK',
    sunDirection: [0.85, 0.12, -0.4],
    sunColor: hexToRgb('#ff9a4a'),
    sunIntensity: 1.6,
    hemiSkyColor: hexToRgb('#8a7fb8'),
    hemiGroundColor: hexToRgb('#8c5a3c'),
    hemiIntensity: 0.55,
    skyZenith: hexToRgb('#3b3f7a'),
    skyHorizon: hexToRgb('#ff9d5c'),
    starIntensity: 0.15,
    fogColor: hexToRgb('#c68a72'),
    fogNear: 22,
    fogFar: 140,
    interiorEmissiveIntensity: 0.45,
  },
  NIGHT: {
    name: 'NIGHT',
    sunDirection: [0.3, 0.55, -0.7],
    sunColor: hexToRgb('#8fa0d0'),
    sunIntensity: 0.4,
    hemiSkyColor: hexToRgb('#34406a'),
    hemiGroundColor: hexToRgb('#221d17'),
    hemiIntensity: 0.42,
    skyZenith: hexToRgb('#070b1c'),
    skyHorizon: hexToRgb('#1d2440'),
    starIntensity: 1,
    fogColor: hexToRgb('#121728'),
    fogNear: 18,
    fogFar: 120,
    interiorEmissiveIntensity: 1.0,
  },
};

/** Clock keyframes: (hour, preset). Between two keyframes the presets are lerped; the track wraps at 24h. */
export const KEYFRAMES: ReadonlyArray<readonly [hour: number, preset: PresetName]> = [
  [5.5, 'NIGHT'],
  [7.5, 'MORNING'],
  [12.0, 'MIDDAY'],
  [16.5, 'MIDDAY'],
  [18.25, 'DUSK'],
  [20.0, 'NIGHT'],
];

export interface LightingState extends Omit<LightingPreset, 'name'> {
  /** The two presets being blended and the blend weight toward `to`. */
  from: PresetName;
  to: PresetName;
  t: number;
  /** The nearer of the two, for the HUD readout. */
  dominant: PresetName;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpRgb(a: RGB, b: RGB, t: number): RGB {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Normalise an hour into [0, 24). */
export function wrapHour(h: number): number {
  const w = h % 24;
  return w < 0 ? w + 24 : w;
}

/** Find the keyframe pair surrounding `hour` and the raw 0..1 position between them. */
export function segmentAt(hour: number): { from: PresetName; to: PresetName; t: number } {
  const h = wrapHour(hour);
  const n = KEYFRAMES.length;
  for (let i = 0; i < n; i++) {
    const [h0, p0] = KEYFRAMES[i];
    const [h1raw, p1] = KEYFRAMES[(i + 1) % n];
    const h1 = i === n - 1 ? h1raw + 24 : h1raw;
    const hh = i === n - 1 && h < h0 ? h + 24 : h;
    if (hh >= h0 && hh < h1) {
      return { from: p0, to: p1, t: (hh - h0) / (h1 - h0) };
    }
  }
  // Only reachable if KEYFRAMES is empty or unsorted; treat as deep night.
  return { from: 'NIGHT', to: 'NIGHT', t: 0 };
}

export function blendPresets(a: LightingPreset, b: LightingPreset, tRaw: number, from: PresetName, to: PresetName): LightingState {
  const t = smoothstep(Math.min(1, Math.max(0, tRaw)));
  const dir: [number, number, number] = [
    lerp(a.sunDirection[0], b.sunDirection[0], t),
    lerp(a.sunDirection[1], b.sunDirection[1], t),
    lerp(a.sunDirection[2], b.sunDirection[2], t),
  ];
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  return {
    from,
    to,
    t,
    dominant: t < 0.5 ? from : to,
    sunDirection: [dir[0] / len, dir[1] / len, dir[2] / len],
    sunColor: lerpRgb(a.sunColor, b.sunColor, t),
    sunIntensity: lerp(a.sunIntensity, b.sunIntensity, t),
    hemiSkyColor: lerpRgb(a.hemiSkyColor, b.hemiSkyColor, t),
    hemiGroundColor: lerpRgb(a.hemiGroundColor, b.hemiGroundColor, t),
    hemiIntensity: lerp(a.hemiIntensity, b.hemiIntensity, t),
    skyZenith: lerpRgb(a.skyZenith, b.skyZenith, t),
    skyHorizon: lerpRgb(a.skyHorizon, b.skyHorizon, t),
    starIntensity: lerp(a.starIntensity, b.starIntensity, t),
    fogColor: lerpRgb(a.fogColor, b.fogColor, t),
    fogNear: lerp(a.fogNear, b.fogNear, t),
    fogFar: lerp(a.fogFar, b.fogFar, t),
    interiorEmissiveIntensity: lerp(a.interiorEmissiveIntensity, b.interiorEmissiveIntensity, t),
  };
}

/** The lighting state for a clock hour (0..24, fractional). */
export function lightingAtHour(hour: number): LightingState {
  const seg = segmentAt(hour);
  return blendPresets(PRESETS[seg.from], PRESETS[seg.to], seg.t, seg.from, seg.to);
}
