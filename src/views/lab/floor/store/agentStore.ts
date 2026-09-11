// Event-driven agent state (zustand). Updated only when an event arrives — a few
// times a second — never per frame. The scene reads it through getState()/
// subscribe; the HUD through selectors.
import { create } from 'zustand';
import { applyCanonicalEvent, emptyAgentsState, type AgentRecord, type AgentsState, type StreamStats } from '../../../../logic/floor/events/reducer';
import { parseCanonicalEvent } from '../../../../logic/floor/events/schema';
import type { ConnectionStatus } from '../transport/types';

export interface TransportLogLine {
  atMs: number;
  level: 'info' | 'warn' | 'error';
  text: string;
}

export interface RecentEvent {
  atMs: number;
  agentId: string;
  state: string;
  eventId: string;
}

interface AgentStoreState {
  agents: Record<string, AgentRecord>;
  stats: StreamStats;
  connection: { status: ConnectionStatus; detail?: string; since: number; lastFrameAt: number | null };
  transportLog: TransportLogLine[];
  recent: RecentEvent[];
  /** Bumps on every applied event so per-frame readers can cheaply detect change. */
  version: number;
  ingestFrame(text: string, receivedAtMs: number): void;
  setConnection(status: ConnectionStatus, detail?: string): void;
  reset(): void;
}

const MAX_TRANSPORT_LOG = 60;
const MAX_RECENT = 12;

let internal: AgentsState = emptyAgentsState();

const devLog = import.meta.env.DEV;

export const useAgentStore = create<AgentStoreState>((set) => ({
  agents: {},
  stats: internal.stats,
  connection: { status: 'closed', since: Date.now(), lastFrameAt: null },
  transportLog: [],
  recent: [],
  version: 0,

  ingestFrame: (text, receivedAtMs) => {
    const parsed = parseCanonicalEvent(text);
    if (!parsed.ok) {
      internal.stats.received++;
      internal.stats.droppedInvalid++;
      const line: TransportLogLine = {
        atMs: receivedAtMs,
        level: 'error',
        text: `Dropped malformed event: ${parsed.reason}`,
      };
      // Raw payload goes to the console (B-2) and the inspector shows the reason.
      console.warn('[bot-crossing] dropped malformed event', parsed.reason, parsed.raw);
      set((s) => ({
        stats: { ...internal.stats },
        transportLog: [...s.transportLog.slice(-(MAX_TRANSPORT_LOG - 1)), line],
        connection: { ...s.connection, lastFrameAt: receivedAtMs },
      }));
      return;
    }
    const ev = parsed.event;
    const outcome = applyCanonicalEvent(internal, ev, receivedAtMs);
    if (devLog) console.debug(`[bot-crossing] ${outcome} ${ev.eventId} ${ev.agentId} ${ev.currentState}`, ev);
    if (outcome === 'applied') {
      set((s) => ({
        agents: { ...internal.agents },
        stats: { ...internal.stats },
        recent: [...s.recent.slice(-(MAX_RECENT - 1)), { atMs: receivedAtMs, agentId: ev.agentId, state: ev.currentState, eventId: ev.eventId }],
        connection: { ...s.connection, lastFrameAt: receivedAtMs },
        version: s.version + 1,
      }));
    } else {
      const line: TransportLogLine = {
        atMs: receivedAtMs,
        level: 'warn',
        text: outcome === 'stale' ? `Dropped out-of-order event ${ev.eventId} for ${ev.agentId}` : `Ignored duplicate event ${ev.eventId}`,
      };
      set((s) => ({
        stats: { ...internal.stats },
        transportLog: outcome === 'duplicate' ? s.transportLog : [...s.transportLog.slice(-(MAX_TRANSPORT_LOG - 1)), line],
        connection: { ...s.connection, lastFrameAt: receivedAtMs },
      }));
    }
  },

  setConnection: (status, detail) =>
    set((s) => ({
      connection: { status, detail, since: Date.now(), lastFrameAt: s.connection.lastFrameAt },
      transportLog:
        status === s.connection.status
          ? s.transportLog
          : [...s.transportLog.slice(-(MAX_TRANSPORT_LOG - 1)), { atMs: Date.now(), level: status === 'open' ? 'info' : 'warn', text: `Connection ${status}${detail ? `: ${detail}` : ''}` }],
    })),

  reset: () => {
    internal = emptyAgentsState();
    set({ agents: {}, stats: internal.stats, recent: [], version: 0 });
  },
}));

/** Direct, non-reactive access for per-frame code. */
export function getAgentRecords(): Record<string, AgentRecord> {
  return useAgentStore.getState().agents;
}
