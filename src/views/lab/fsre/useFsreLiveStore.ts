/**
 * FSRE BUILDING v2 — THE SYNTHETIC OFFICE'S STORE.
 *
 * Owns the transport for the synthetic mode, folds its events through the
 * live reducer, and keeps the transport's lists (roster, engagements,
 * industries board, commands). The building is a pure function of this
 * state and the clock reading `now`.
 *
 * It talks only to FsreTransport (src/data/fsreTransport/contract.ts),
 * created by the factory; the simulated clock and the speed control are
 * MockControls, reached through their guard, so a transport without them
 * (the Supabase stub, later the real one) needs no change here (FX-5).
 *
 * The lists refresh once, 250 ms after the last event of a burst, and after
 * the owner's own actions; never on a timer (FX-8).
 *
 * The clock reading `now` is the one input that is not an event: "No signal
 * since HH.MM" needs time to pass. The mock streams its simulated clock; a
 * transport without one (the Supabase stub now, the real backend at M3) gets
 * the wall clock, read every WALL_CLOCK_TICK_MS, so a silent desk still turns
 * to No signal rather than reading Working for ever (review R5).
 *
 * Ported from the GLM workspace (src/live/liveStore.ts at 5b5d186).
 */
import { create } from 'zustand';
import type { Agent, Engagement, FsreTransport, IndustryProgressRow } from '../../../data/fsreTransport/contract';
import { hasMockControls, type MockControls, type MockSpeed } from '../../../data/fsreTransport/controls';
import { createTransport } from '../../../data/fsreTransport/index';
import { createInitialLiveState, mergeAgents, mergeCommands, reduceAgentEvent, type LiveState } from '../../../logic/lab/fsre/liveReducer';

/** One refresh this long after the last event of a burst. */
export const REFRESH_AFTER_EVENTS_MS = 250;

/** How often the wall clock is read when the transport has no clock of its own. */
export const WALL_CLOCK_TICK_MS = 15_000;

/**
 * The clock reading before the transport's clock first ticks: unknown. It
 * shows as "--.--" and cannot make a desk read No signal (deskState.ts
 * treats an unreadable time as no time passed).
 */
const BEFORE_START = '';

interface FsreLiveStore {
  active: boolean;
  transport: FsreTransport | null;
  agents: Agent[];
  engagements: Engagement[];
  progress: IndustryProgressRow[];
  state: LiveState;
  now: string;
  speed: MockSpeed;
  error: string | null;
  /** Opens the office on a transport; the synthetic mode's MockTransport unless a factory is given (tests). */
  start: (make?: () => FsreTransport) => Promise<void>;
  stop: () => void;
  setSpeed: (speed: MockSpeed) => void;
  refreshLists: () => Promise<void>;
}

let unsubscribe: (() => void) | null = null;
let clockUnsubscribe: (() => void) | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let wallClock: ReturnType<typeof setInterval> | null = null;

function clearRefresh(): void {
  if (refreshTimer !== null) clearTimeout(refreshTimer);
  refreshTimer = null;
}

export const useFsreLiveStore = create<FsreLiveStore>((set, get) => ({
  active: false,
  transport: null,
  agents: [],
  engagements: [],
  progress: [],
  state: createInitialLiveState([]),
  now: BEFORE_START,
  speed: '1x',
  error: null,

  start: async (make = () => createTransport('synthetic')) => {
    if (get().active) return;
    const transport = make();
    const controls: MockControls | null = hasMockControls(transport) ? transport : null;
    const scheduleRefresh = () => {
      clearRefresh();
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void get().refreshLists();
      }, REFRESH_AFTER_EVENTS_MS);
    };
    unsubscribe = transport.subscribeEvents((event) => {
      set((s) => ({ state: reduceAgentEvent(s.state, event) }));
      scheduleRefresh();
    });
    clockUnsubscribe = controls ? controls.subscribeClock((iso) => set({ now: iso })) : null;
    if (!controls) wallClock = setInterval(() => set({ now: new Date().toISOString() }), WALL_CLOCK_TICK_MS);
    set({ active: true, transport, state: createInitialLiveState([]), error: null, speed: '1x', now: controls ? BEFORE_START : new Date().toISOString() });
    await get().refreshLists();
  },

  stop: () => {
    const transport = get().transport;
    unsubscribe?.();
    unsubscribe = null;
    clockUnsubscribe?.();
    clockUnsubscribe = null;
    if (wallClock !== null) clearInterval(wallClock);
    wallClock = null;
    clearRefresh();
    if (transport && hasMockControls(transport)) transport.dispose();
    set({ active: false, transport: null, agents: [], engagements: [], progress: [], state: createInitialLiveState([]), now: BEFORE_START, speed: '1x', error: null });
  },

  setSpeed: (speed) => {
    const transport = get().transport;
    if (transport && hasMockControls(transport)) transport.setSpeed(speed);
    set({ speed });
  },

  refreshLists: async () => {
    const transport = get().transport;
    if (!transport) return;
    try {
      const [agents, engagements, progress, commands] = await Promise.all([
        transport.listAgents(),
        transport.listEngagements(),
        transport.getIndustryProgress(),
        transport.listCommands({}),
      ]);
      // A stop while the answers were on their way leaves the office closed.
      if (get().transport !== transport) return;
      set((s) => ({ agents, engagements, progress, state: mergeCommands(mergeAgents(s.state, agents), commands) }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },
}));
