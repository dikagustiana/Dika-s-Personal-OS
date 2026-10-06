/**
 * FSRE BUILDING — THE VIEW STORE. VIEW STATE ONLY.
 *
 * Which source is open, how many of its events are applied (the cursor),
 * playback, the selection and the search text. None of the building's state
 * lives here: that is the reducer's, computed from the events and the
 * cursor. Stepping changes the cursor and nothing else, which is why
 * stepping back is as pure as stepping forward.
 *
 * `animate` records whether the cursor last moved FORWARD by one event (a
 * step or a playback tick). Only then does the building move: loading,
 * restarting, switching runs and stepping back change what is shown without
 * motion, because no event was just applied.
 */
import { create } from 'zustand';
import type { FsreSelection } from '../../../logic/lab/fsre/scene';

/** Replay pacing; the label is the control's copy, the rate drives playback. */
export const REPLAY_SPEEDS = [
  { label: 'Slow', eventsPerSecond: 0.5 },
  { label: 'Normal', eventsPerSecond: 1 },
  { label: 'Fast', eventsPerSecond: 2 },
  { label: 'Very fast', eventsPerSecond: 4 },
] as const;

export const DEFAULT_SPEED_INDEX = 1;
const MS_PER_SECOND = 1000;

export function playbackIntervalMs(speedIndex: number): number {
  const speed = REPLAY_SPEEDS[speedIndex] ?? REPLAY_SPEEDS[DEFAULT_SPEED_INDEX];
  return MS_PER_SECOND / speed.eventsPerSecond;
}

interface FsreViewState {
  /** Null: the first source offered. */
  sourceId: string | null;
  cursor: number;
  playing: boolean;
  speedIndex: number;
  animate: boolean;
  selection: FsreSelection | null;
  query: string;
  highlightStageId: string | null;
  setSource: (sourceId: string) => void;
  /** Jump without motion (a load, a live append that the reader follows). */
  setCursor: (cursor: number) => void;
  stepForward: (total: number) => void;
  stepBack: () => void;
  restart: () => void;
  /** Start playing; from the end, start again at the beginning. */
  play: (total: number) => void;
  pause: () => void;
  /** One playback tick: apply the next event, or stop at the end. */
  tick: (total: number) => void;
  setSpeedIndex: (speedIndex: number) => void;
  select: (selection: FsreSelection | null) => void;
  setQuery: (query: string) => void;
  setHighlightStage: (stageId: string | null) => void;
  reset: () => void;
}

const INITIAL = {
  sourceId: null,
  cursor: 0,
  playing: false,
  speedIndex: DEFAULT_SPEED_INDEX,
  animate: false,
  selection: null,
  query: '',
  highlightStageId: null,
} satisfies Partial<FsreViewState>;

export const useFsreViewStore = create<FsreViewState>((set) => ({
  ...INITIAL,
  setSource: (sourceId) => set({ sourceId, cursor: 0, playing: false, animate: false, selection: null, highlightStageId: null }),
  setCursor: (cursor) => set({ cursor: Math.max(0, cursor), animate: false }),
  stepForward: (total) => set((s) => (s.cursor < total ? { cursor: s.cursor + 1, animate: true } : {})),
  stepBack: () => set((s) => (s.cursor > 0 ? { cursor: s.cursor - 1, animate: false } : {})),
  restart: () => set({ cursor: 0, playing: false, animate: false }),
  play: (total) => set((s) => (s.cursor >= total ? { cursor: 0, playing: true, animate: false } : { playing: true })),
  pause: () => set({ playing: false }),
  tick: (total) => set((s) => (s.cursor >= total ? { playing: false } : { cursor: s.cursor + 1, animate: true })),
  setSpeedIndex: (speedIndex) => set({ speedIndex }),
  select: (selection) => set({ selection }),
  setQuery: (query) => set({ query }),
  setHighlightStage: (highlightStageId) => set({ highlightStageId }),
  reset: () => set(INITIAL),
}));
