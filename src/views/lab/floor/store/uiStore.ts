// Low-frequency UI state: settings, selection, connection. Anything touched
// per frame lives in scene/runtime.ts instead, outside React's reactive path.
import { create } from 'zustand';
import { systemTimeZone } from '../../../../logic/floor/time/clock';

export type HexGridMode = 'always' | 'never' | 'exterior-only';
export type TimeMode = 'system' | 'scrub';

export interface PerfSample {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  agents: number;
}

interface UiState {
  devTools: boolean;
  setDevTools(on: boolean): void;

  timeMode: TimeMode;
  /** Hour 0..24 shown when timeMode is 'scrub'. */
  scrubHour: number;
  timeZone: string;
  /** A running sweep of the 24-hour scrubber; null when idle. */
  sweep: { startHour: number; startedAt: number; durationMs: number } | null;
  setTimeMode(mode: TimeMode): void;
  setScrubHour(hour: number): void;
  setTimeZone(tz: string): void;
  startSweep(durationMs?: number): void;
  stopSweep(): void;
  /** Throttled clock readout for the HUD (≈4 Hz), written by the scene clock. */
  displayHour: number;
  displayPreset: string;
  setDisplayClock(hour: number, preset: string): void;

  showHexGrid: HexGridMode;
  setShowHexGrid(mode: HexGridMode): void;
  postEnabled: boolean;
  aoEnabled: boolean;
  setPostEnabled(on: boolean): void;
  setAoEnabled(on: boolean): void;
  /** Render every code-authored placeholder in flat grey so stubs are unmistakable (B-6). */
  greyPlaceholders: boolean;
  setGreyPlaceholders(on: boolean): void;

  /**
   * 3-C: the director has asked to see INTERNAL-lane task content in this
   * session. Off at every load and never persisted — a default that
   * survives a reload is a default nobody re-decides, and the thing being
   * defaulted here is whether SAMB's own figures are on screen when someone
   * photographs the monitor.
   */
  revealInternal: boolean;
  setRevealInternal(on: boolean): void;

  perf: PerfSample;
  setPerf(sample: PerfSample): void;

  /** Dev harness: one scripted avatar, clearly labelled, never stream data. */
  avatarTestDrive: boolean;
  setAvatarTestDrive(on: boolean): void;
  /** The agent whose inspector is open (Phase 6). Selecting also follows and zooms in; closing restores the zoom. */
  selectedAgentId: string | null;
  setSelectedAgentId(id: string | null): void;
  /** Task whose output document modal is open. */
  outputTaskId: string | null;
  setOutputTaskId(id: string | null): void;
  /** One-off camera focus point (world XZ) when not following an agent, e.g. a clicked empty desk. */
  cameraFocus: { x: number; z: number } | null;
  setCameraFocus(p: { x: number; z: number } | null): void;
  /** The camera's actual zoom, written by the rig at a low rate; restored when the inspector closes. */
  liveZoom: number;
  setLiveZoom(z: number): void;
  zoomBeforeSelect: number | null;
  /** Camera follows this agent's avatar while set. */
  followAgentId: string | null;
  setFollowAgentId(id: string | null): void;
  /** Orthographic zoom override for close-ups; null keeps the user's zoom. */
  cameraZoom: number | null;
  setCameraZoom(zoom: number | null): void;
}

export const useUiStore = create<UiState>((set) => ({
  devTools: false,
  setDevTools: (on) => set({ devTools: on }),

  revealInternal: false,
  setRevealInternal: (on) => set({ revealInternal: on }),

  timeMode: 'system',
  scrubHour: 18,
  timeZone: typeof window === 'undefined' ? 'UTC' : systemTimeZone(),
  sweep: null,
  setTimeMode: (mode) => set({ timeMode: mode, sweep: null }),
  setScrubHour: (hour) => set({ scrubHour: hour, timeMode: 'scrub', sweep: null }),
  setTimeZone: (tz) => set({ timeZone: tz }),
  startSweep: (durationMs = 8000) =>
    set((s) => ({ timeMode: 'scrub', sweep: { startHour: s.scrubHour, startedAt: performance.now(), durationMs } })),
  stopSweep: () => set({ sweep: null }),
  displayHour: 0,
  displayPreset: '',
  setDisplayClock: (hour, preset) => set({ displayHour: hour, displayPreset: preset }),

  showHexGrid: 'exterior-only',
  setShowHexGrid: (mode) => set({ showHexGrid: mode }),
  postEnabled: true,
  aoEnabled: true,
  setPostEnabled: (on) => set({ postEnabled: on }),
  setAoEnabled: (on) => set({ aoEnabled: on }),
  greyPlaceholders: false,
  setGreyPlaceholders: (on) => set({ greyPlaceholders: on }),

  perf: { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, agents: 0 },
  setPerf: (sample) => set({ perf: sample }),

  avatarTestDrive: false,
  setAvatarTestDrive: (on) => set({ avatarTestDrive: on }),
  selectedAgentId: null,
  setSelectedAgentId: (id) =>
    set((s) => {
      if (id) {
        return {
          selectedAgentId: id,
          followAgentId: id,
          cameraFocus: null,
          cameraZoom: 40,
          zoomBeforeSelect: s.selectedAgentId ? s.zoomBeforeSelect : s.liveZoom,
        };
      }
      return { selectedAgentId: null, followAgentId: null, cameraZoom: s.zoomBeforeSelect, zoomBeforeSelect: null };
    }),
  outputTaskId: null,
  setOutputTaskId: (id) => set({ outputTaskId: id }),
  cameraFocus: null,
  setCameraFocus: (p) => set({ cameraFocus: p, followAgentId: p ? null : undefined } as Partial<UiState>),
  liveZoom: 16,
  setLiveZoom: (z) => set({ liveZoom: z }),
  zoomBeforeSelect: null,
  followAgentId: null,
  setFollowAgentId: (id) => set({ followAgentId: id }),
  cameraZoom: null,
  setCameraZoom: (zoom) => set({ cameraZoom: zoom }),
}));
