/**
 * FSRE BUILDING v2 — THE OFFICE'S VIEW STATE. VIEW STATE ONLY.
 *
 * Which mode the building is in (Replay, Synthetic; Live is disabled until
 * milestone M3), which view of the synthetic office is open (Building,
 * Industries), what is selected in it, which engagement the building is
 * filtered to, and the two dialogs. The replay keeps its own view store
 * (useFsreViewStore.ts) unchanged; none of the building's state lives here.
 */
import { create } from 'zustand';
import type { FsreSelection } from '../../../logic/lab/fsre/scene';
import type { LiveViewId, ModeId } from '../../../logic/lab/fsre/statuses';

interface FsreOfficeState {
  mode: ModeId;
  liveView: LiveViewId;
  /** A seat or the partner room of the synthetic office. */
  selection: FsreSelection | null;
  /** The engagement the building is filtered to from the industries board (WO-5). */
  industriesFilter: string | null;
  engagementDialog: { open: boolean; prefilledText: string };
  composer: { open: boolean; agentId: string | null };
  setMode: (mode: ModeId) => void;
  setLiveView: (view: LiveViewId) => void;
  select: (selection: FsreSelection | null) => void;
  setIndustriesFilter: (engagementId: string | null) => void;
  openEngagementDialog: (prefilledText?: string) => void;
  closeEngagementDialog: () => void;
  openComposer: (agentId?: string | null) => void;
  closeComposer: () => void;
  reset: () => void;
}

const INITIAL = {
  mode: 'replay',
  liveView: 'building',
  selection: null,
  industriesFilter: null,
  engagementDialog: { open: false, prefilledText: '' },
  composer: { open: false, agentId: null },
} satisfies Partial<FsreOfficeState>;

export const useFsreOfficeStore = create<FsreOfficeState>((set) => ({
  ...INITIAL,
  // Live is shown disabled ("Not wired yet") and never becomes the mode.
  setMode: (mode) => set(mode === 'live' ? {} : { ...INITIAL, mode }),
  setLiveView: (liveView) => set({ liveView }),
  select: (selection) => set({ selection }),
  setIndustriesFilter: (industriesFilter) => set({ industriesFilter }),
  openEngagementDialog: (prefilledText = '') => set({ engagementDialog: { open: true, prefilledText } }),
  closeEngagementDialog: () => set({ engagementDialog: { open: false, prefilledText: '' } }),
  openComposer: (agentId = null) => set({ composer: { open: true, agentId } }),
  closeComposer: () => set({ composer: { open: false, agentId: null } }),
  reset: () => set(INITIAL),
}));
