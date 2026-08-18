/**
 * What is running in the Lab RIGHT NOW, published by the two dispatch choke
 * points (labModel.runLabAgent for the execution layer, labEvidenceAgents'
 * call for the evidence layer) and read by the Flow surfaces.
 *
 * MEASURED, NEVER ESTIMATED. This store carries facts the client actually
 * has: which agent was dispatched, when, at which chain step, and how the
 * last dispatch ended. It carries NO percentage, no ETA, and no "time
 * remaining" — one call executes one action, and the system does not know
 * how much work a document still holds. Elapsed time counts up because it
 * is measured; nothing here counts down.
 *
 * The run ROW stays the record (the executor finalizes it server-side
 * whatever happens to this tab); this store is only the live window, which
 * is why `generation` exists — the Flow screen re-reads the tables when a
 * dispatch ends, so what it shows is always the rows, not this echo.
 *
 * Single-user app, one dispatch at a time by construction (every screen
 * awaits its call); if two ever overlap, last-write-wins here while both
 * run rows land intact — the record never degrades, only the live window.
 */
import { create } from 'zustand';

export interface LabLiveRun {
  agentSlug: string;
  /** 'run' for the execution layer; the evidence action name otherwise. */
  action: string;
  chainId?: string;
  stepIndex?: number;
  stepCount?: number;
  runId?: string;
  /** Epoch ms at dispatch — the banner's count-up base. */
  startedAt: number;
}

export interface LabLiveOutcome {
  agentSlug: string;
  action: string;
  ok: boolean;
  /** The server's stated reason — shown verbatim; a failed run must never
   *  leave the view looking idle. */
  error?: string;
  runId?: string;
  chainId?: string;
  stepIndex?: number;
  endedAt: number;
}

interface LabLiveState {
  live: LabLiveRun | null;
  lastOutcome: LabLiveOutcome | null;
  /** Bumped on every end — subscribers re-read the tables. */
  generation: number;
  start: (run: Omit<LabLiveRun, 'startedAt'> & { startedAt?: number }) => void;
  setRunId: (runId: string) => void;
  end: (outcome: Omit<LabLiveOutcome, 'endedAt'>) => void;
  clearOutcome: () => void;
}

export const useLabLiveStore = create<LabLiveState>((set) => ({
  live: null,
  lastOutcome: null,
  generation: 0,
  start: (run) => set({ live: { startedAt: run.startedAt ?? Date.now(), ...run } }),
  setRunId: (runId) =>
    set((state) => (state.live ? { live: { ...state.live, runId } } : {})),
  end: (outcome) =>
    set((state) => ({
      live: null,
      lastOutcome: { endedAt: Date.now(), ...outcome },
      generation: state.generation + 1,
    })),
  clearOutcome: () => set({ lastOutcome: null }),
}));
