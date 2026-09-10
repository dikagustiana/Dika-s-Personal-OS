// The agent store's pure reducer. The renderer is a function of what this
// holds (B-1): the latest applied event per agent and nothing inferred.
import { isKnownState, type CanonicalEvent } from './schema';

export interface LogLine {
  /** Receipt time, ms epoch. */
  atMs: number;
  /** The event's own timestamp, for display. */
  timestamp: string;
  text: string;
  kind: 'state' | 'progress' | 'error' | 'unknown';
}

export interface TokenSample {
  atMs: number;
  tokens: number;
}

export interface AgentRecord {
  agentId: string;
  latest: CanonicalEvent;
  previous: CanonicalEvent | null;
  /** When the latest event was applied, ms epoch (receipt time, not event time). */
  appliedAtMs: number;
  /** The latest event's timestamp as a number, for ordering. */
  latestTimestampMs: number;
  knownState: boolean;
  log: LogLine[];
  tokenHistory: TokenSample[];
}

export interface StreamStats {
  received: number;
  applied: number;
  droppedInvalid: number;
  droppedStale: number;
  droppedDuplicate: number;
  unknownState: number;
}

export interface AgentsState {
  agents: Record<string, AgentRecord>;
  /** Recently seen ids for duplicate suppression (a snapshot replay after reconnect re-sends the latest events). */
  seenIds: string[];
  seenSet: Set<string>;
  stats: StreamStats;
}

export const MAX_LOG_LINES = 200;
export const MAX_TOKEN_SAMPLES = 120;
export const MAX_SEEN_IDS = 4000;

export function emptyAgentsState(): AgentsState {
  return {
    agents: {},
    seenIds: [],
    seenSet: new Set(),
    stats: { received: 0, applied: 0, droppedInvalid: 0, droppedStale: 0, droppedDuplicate: 0, unknownState: 0 },
  };
}

export type ApplyOutcome = 'applied' | 'duplicate' | 'stale';

function pushSeen(state: AgentsState, id: string): void {
  state.seenSet.add(id);
  state.seenIds.push(id);
  if (state.seenIds.length > MAX_SEEN_IDS) {
    const drop = state.seenIds.splice(0, state.seenIds.length - MAX_SEEN_IDS);
    for (const d of drop) state.seenSet.delete(d);
  }
}

function describe(ev: CanonicalEvent, prev: CanonicalEvent | null): LogLine | null {
  const kind: LogLine['kind'] = !isKnownState(ev.currentState)
    ? 'unknown'
    : ev.currentState === 'OFFICE_ERROR'
      ? 'error'
      : prev && prev.currentState === ev.currentState
        ? 'progress'
        : 'state';
  const t = ev.taskDetails;
  if (kind === 'progress') {
    const changed =
      !prev ||
      prev.taskDetails.progressPercentage !== t.progressPercentage ||
      prev.taskDetails.activeSubtask !== t.activeSubtask ||
      prev.taskDetails.tokensUsed !== t.tokensUsed ||
      prev.currentTaskId !== ev.currentTaskId;
    if (!changed) return null;
    return {
      atMs: 0,
      timestamp: ev.timestamp,
      text: `${t.activeSubtask || t.title} — ${Math.round(t.progressPercentage)}% · ${t.tokensUsed} tokens`,
      kind,
    };
  }
  const state = kind === 'unknown' ? `UNKNOWN_STATE (${ev.currentState})` : ev.currentState.replace('OFFICE_', '');
  const where =
    ev.currentState === 'OFFICE_WALKING' || ev.currentState === 'OFFICE_DELIVERING'
      ? ev.targetDestinationHex
        ? ` → (${ev.targetDestinationHex.q}, ${ev.targetDestinationHex.r})`
        : ''
      : '';
  const group = ev.collaborationGroupId ? ` with ${ev.collaborationGroupId}` : '';
  return {
    atMs: 0,
    timestamp: ev.timestamp,
    text: `${state}${where}${group}${t.title ? ` · ${t.title}` : ''}${t.activeSubtask ? ` · ${t.activeSubtask}` : ''}`,
    kind,
  };
}

/**
 * Apply one validated event. Mutates `state` in place (the store wraps it) and
 * reports whether it was applied. Rules:
 *  - a repeated eventId is a duplicate (snapshot replay, retransmit) → dropped;
 *  - an event older than the agent's latest by timestamp → stale, dropped;
 *  - equal timestamps apply in arrival order;
 *  - an unknown state applies (the renderer shows it as such) and is counted.
 */
export function applyCanonicalEvent(state: AgentsState, ev: CanonicalEvent, receivedAtMs: number): ApplyOutcome {
  state.stats.received++;
  if (state.seenSet.has(ev.eventId)) {
    state.stats.droppedDuplicate++;
    return 'duplicate';
  }
  pushSeen(state, ev.eventId);
  const ts = Date.parse(ev.timestamp);
  const existing = state.agents[ev.agentId];
  if (existing && ts < existing.latestTimestampMs) {
    state.stats.droppedStale++;
    return 'stale';
  }
  const known = isKnownState(ev.currentState);
  if (!known) state.stats.unknownState++;
  const line = describe(ev, existing?.latest ?? null);
  const log = existing ? existing.log.slice(-(MAX_LOG_LINES - 1)) : [];
  if (line) log.push({ ...line, atMs: receivedAtMs });
  const tokenHistory = existing ? existing.tokenHistory.slice(-(MAX_TOKEN_SAMPLES - 1)) : [];
  tokenHistory.push({ atMs: receivedAtMs, tokens: ev.taskDetails.tokensUsed });
  state.agents[ev.agentId] = {
    agentId: ev.agentId,
    latest: ev,
    previous: existing?.latest ?? null,
    appliedAtMs: receivedAtMs,
    latestTimestampMs: ts,
    knownState: known,
    log,
    tokenHistory,
  };
  state.stats.applied++;
  return 'applied';
}
