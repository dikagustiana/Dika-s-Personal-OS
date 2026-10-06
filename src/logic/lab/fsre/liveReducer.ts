/**
 * FSRE BUILDING v2 — THE LIVE OFFICE IS A PURE FUNCTION OF EVENTS.
 *
 * reduceAgentEvent folds one contract-v2 AgentEvent into LiveState and
 * returns a new state; nothing mutates and nothing moves unless an event says
 * so (brief v2 §2). Heartbeats never change a desk's signal. Every event
 * applies once, however often it is delivered (audit F3).
 *
 * Ported from the GLM workspace (src/live/liveReducer.ts at 5b5d186, after
 * fixes FX-2, FX-3, FX-4, FX-7 and FX-8 of brief v2.1). Two changes for this
 * repository's rule 2 (no name from data written as a literal): the owner is
 * recognised by its role, not by an agent id, and the gate stages are read
 * from the provisional stage list, not written out.
 */
import type { Agent, AgentEvent, Command, EngagementStatus, GateStatus } from '../../../data/fsreTransport/contract';
import { OWNER_ROLE, STAGES_PROVISIONAL } from '../../../data/fsreTransport/provisional';
import { isGateStage } from './layout';

/** The live gate stages, in pipeline order: G1, G2, G3 (brief v2 §3). */
export const LIVE_GATE_STAGES = STAGES_PROVISIONAL.filter((stage) => isGateStage(stage));

/** A live stage's place in the provisional pipeline, 1-based; null for an unknown id. */
export function liveStageOrder(stageId: string): number | null {
  return STAGES_PROVISIONAL.find((stage) => stage.id === stageId)?.order ?? null;
}

/** A live stage's name from the provisional list; the id itself when the list does not know it. */
export function liveStageName(stageId: string | null): string {
  if (!stageId) return '';
  return STAGES_PROVISIONAL.find((stage) => stage.id === stageId)?.name ?? stageId;
}

export interface LiveAgent {
  agent: Agent;
  currentTask: string | null;
  currentStageId: string | null;
  currentTicker: string | null;
  currentEngagementId: string | null;
  sourceRef: AgentEvent['sourceRef'];
  waitingOn: string | null;
  /** Last event that counts as a signal (heartbeat excluded). */
  lastSignalAt: string | null;
  lastSignalSummary: string | null;
  /** Newest first, capped. */
  events: AgentEvent[];
  queueDepth: number | null;
}

export interface LiveEscalation {
  id: string;
  engagementId: string | null;
  ticker: string | null;
  stageId: string | null;
  summary: string;
  /** The agent that emitted the escalation_opened event. */
  openedBy: string;
  openedAt: string;
  closedAt: string | null;
}

export interface LiveState {
  agents: Record<string, LiveAgent>;
  /** Newest first, capped. */
  events: AgentEvent[];
  /** Every event id already folded; a repeated id leaves the state unchanged. */
  appliedEventIds: string[];
  escalations: LiveEscalation[];
  /** key `${engagementId}|${ticker}|${gateStage}` → raw verdict. */
  gates: Record<string, 'pending' | 'passed' | 'failed'>;
  commands: Record<string, Command>;
  engagementStatus: Record<string, EngagementStatus>;
  /** engagementId → published version, set by the owner's approval. */
  publishedVersions: Record<string, string>;
  /** Latest factsLoaded per `engagementId|ticker`; the card shows the sum. */
  factsLoadedByCompany: Record<string, number>;
  publishedCount: number;
}

/** The most recent event that may move the building: heartbeats never flash (FX-8). */
export function lastSignalEvent(events: AgentEvent[]): AgentEvent | null {
  return events.find((e) => e.type !== 'heartbeat') ?? null;
}

/** The summary card's "Facts loaded": the sum over companies (FX-7). */
export function factsLoadedTotal(state: LiveState): number {
  return Object.values(state.factsLoadedByCompany).reduce((a, b) => a + b, 0);
}

const MAX_AGENT_EVENTS = 40;
const MAX_EVENTS = 250;
/** Applied ids remembered for deduplication; far more than a run delivers twice. */
const MAX_APPLIED_IDS = 1000;

export function createInitialLiveState(agents: Agent[]): LiveState {
  return {
    appliedEventIds: [],
    agents: Object.fromEntries(
      agents.map((agent) => [
        agent.id,
        {
          agent,
          currentTask: null,
          currentStageId: null,
          currentTicker: null,
          currentEngagementId: null,
          sourceRef: null,
          waitingOn: null,
          lastSignalAt: null,
          lastSignalSummary: null,
          events: [],
          queueDepth: null,
        } satisfies LiveAgent,
      ]),
    ),
    events: [],
    escalations: [],
    gates: {},
    commands: {},
    engagementStatus: {},
    publishedVersions: {},
    factsLoadedByCompany: {},
    publishedCount: 0,
  };
}

export function reduceAgentEvent(prev: LiveState, event: AgentEvent): LiveState {
  if (prev.appliedEventIds.includes(event.id)) {
    // every event applies exactly once, however often it is delivered
    return prev;
  }
  const state: LiveState = {
    ...prev,
    appliedEventIds: [...prev.appliedEventIds, event.id].slice(-MAX_APPLIED_IDS),
    agents: { ...prev.agents },
    events: [event, ...prev.events].slice(0, MAX_EVENTS),
    escalations: [...prev.escalations],
    gates: { ...prev.gates },
    commands: { ...prev.commands },
    engagementStatus: { ...prev.engagementStatus },
    publishedVersions: { ...prev.publishedVersions },
    factsLoadedByCompany: { ...prev.factsLoadedByCompany },
    publishedCount: prev.publishedCount,
  };

  const agentView: LiveAgent = state.agents[event.agentId]
    ? { ...state.agents[event.agentId], events: [...state.agents[event.agentId].events] }
    : {
        agent: {
          id: event.agentId,
          role: 'staff',
          departmentId: null,
          title: event.agentId,
          skills: [],
          assignedTicker: null,
        },
        currentTask: null,
        currentStageId: null,
        currentTicker: null,
        currentEngagementId: null,
        sourceRef: null,
        waitingOn: null,
        lastSignalAt: null,
        lastSignalSummary: null,
        events: [],
        queueDepth: null,
      };

  if (event.type !== 'heartbeat') {
    agentView.lastSignalAt = event.at;
    agentView.lastSignalSummary = event.summary;
    agentView.events = [event, ...agentView.events].slice(0, MAX_AGENT_EVENTS);
  }

  switch (event.type) {
    case 'task_started':
      agentView.currentTask = event.summary;
      agentView.currentStageId = event.stageId;
      agentView.currentTicker = event.ticker;
      agentView.currentEngagementId = event.engagementId;
      agentView.waitingOn = null;
      break;
    case 'action':
      if (event.sourceRef) agentView.sourceRef = event.sourceRef;
      if (event.counts?.queueDepth !== undefined) agentView.queueDepth = event.counts.queueDepth;
      // an action is one shot of work, not a task: it must never open one,
      // or a desk that did a quick check and went quiet would read No signal
      if (event.counts?.factsLoaded !== undefined && event.engagementId && event.ticker) {
        state.factsLoadedByCompany[`${event.engagementId}|${event.ticker}`] = event.counts.factsLoaded;
      }
      break;
    case 'task_done':
      agentView.currentTask = null;
      agentView.currentStageId = null;
      agentView.waitingOn = null;
      if (event.counts?.factsLoaded !== undefined && event.engagementId && event.ticker) {
        state.factsLoadedByCompany[`${event.engagementId}|${event.ticker}`] = event.counts.factsLoaded;
      }
      break;
    case 'gate_result':
      // the gate is decided: the review lead's task closes with it, and the
      // verdict is recorded per engagement+ticker+gate
      agentView.currentTask = null;
      agentView.currentStageId = null;
      agentView.waitingOn = null;
      if (event.engagementId && event.ticker && event.stageId && typeof event.counts?.gatesFailed === 'number') {
        const key = `${event.engagementId}|${event.ticker}|${event.stageId}`;
        state.gates[key] = event.counts.gatesFailed > 0 ? 'failed' : 'passed';
      }
      break;
    case 'handoff':
      agentView.waitingOn = null;
      if (event.counts?.queueDepth !== undefined) agentView.queueDepth = event.counts.queueDepth;
      break;
    case 'waiting':
      agentView.waitingOn = event.waitingOn;
      if (agentView.agent.role === OWNER_ROLE && event.engagementId) {
        state.engagementStatus[event.engagementId] = 'waiting_owner';
      }
      break;
    case 'escalation_opened':
      if (event.escalationId) {
        state.escalations = [
          {
            id: event.escalationId,
            engagementId: event.engagementId,
            ticker: event.ticker,
            stageId: event.stageId,
            summary: event.summary,
            openedBy: event.agentId,
            openedAt: event.at,
            closedAt: null,
          },
          ...state.escalations.filter((e) => e.id !== event.escalationId),
        ];
      }
      break;
    case 'escalation_closed':
      // closing an escalation that is already closed changes nothing
      if (event.escalationId && state.escalations.some((e) => e.id === event.escalationId && e.closedAt === null)) {
        state.escalations = state.escalations.map((e) =>
          e.id === event.escalationId && e.closedAt === null ? { ...e, closedAt: event.at } : e,
        );
      }
      break;
    case 'command_received':
    case 'command_done':
    case 'command_declined': {
      if (event.commandId) {
        const command = state.commands[event.commandId];
        if (command) {
          state.commands[event.commandId] = {
            ...command,
            status:
              event.type === 'command_received' ? 'received' : event.type === 'command_done' ? 'done' : 'declined',
            statusAt: event.at,
          };
        }
      }
      if (event.type === 'command_declined' && event.commandId) {
        // the event summary carries the placeholder rule and its explanation;
        // the authoritative Command record comes from listCommands
        const ruleMatch = event.summary.match(/R1_HOLDOUT|R2_GATE_BYPASS|R3_APPROVAL/);
        const command = state.commands[event.commandId];
        if (command && ruleMatch) {
          state.commands[event.commandId] = {
            ...command,
            status: 'declined',
            statusAt: event.at,
            declinedRule: ruleMatch[0] as Command['declinedRule'],
            response: event.summary.includes(': ')
              ? event.summary.slice(event.summary.indexOf(': ') + 2)
              : command.response,
          };
        }
      }
      break;
    }
    case 'heartbeat':
      break;
  }

  state.agents[event.agentId] = agentView;
  return state;
}

/** Merge a fetched command list (status trail lives with the events). */
export function mergeCommands(prev: LiveState, commands: Command[]): LiveState {
  const merged = { ...prev.commands };
  for (const command of commands) {
    merged[command.id] = command;
  }
  return { ...prev, commands: merged };
}

/** Record agents from a roster refresh (staff appear as engagements start). */
export function mergeAgents(prev: LiveState, agents: Agent[]): LiveState {
  const next = { ...prev.agents };
  for (const agent of agents) {
    next[agent.id] = next[agent.id] ? { ...next[agent.id], agent } : createInitialLiveState([agent]).agents[agent.id];
  }
  return { ...prev, agents: next };
}

/* ---------- selectors ---------- */

/** A desk's escalations, counted from the escalation list by opener. */
export function escalationsOfAgent(
  state: LiveState,
  agentId: string,
): { opened: number; open: number; closed: number } {
  const mine = state.escalations.filter((e) => e.openedBy === agentId);
  return {
    opened: mine.length,
    open: mine.filter((e) => e.closedAt === null).length,
    closed: mine.filter((e) => e.closedAt !== null).length,
  };
}

export function gateKey(engagementId: string, ticker: string, gateStage: string): string {
  return `${engagementId}|${ticker}|${gateStage}`;
}

/** Display status of one gate; an open escalation on the same gate+ticker outranks a clean pass. */
export function gateDisplayStatus(
  state: LiveState,
  engagementId: string,
  ticker: string,
  gateStage: string,
): GateStatus {
  const raw = state.gates[gateKey(engagementId, ticker, gateStage)] ?? 'pending';
  if (raw !== 'passed') return raw;
  const open = state.escalations.some(
    (e) => e.closedAt === null && e.engagementId === engagementId && e.ticker === ticker && e.stageId === gateStage,
  );
  return open ? 'passed_with_open_escalations' : 'passed';
}

/** Highest stage order the company has started, 0 when none. */
export function stageIndexOfCompany(state: LiveState, engagementId: string, ticker: string): number {
  let max = 0;
  for (const event of state.events) {
    if (event.engagementId !== engagementId || event.ticker !== ticker) continue;
    if (!event.stageId) continue;
    if (event.type !== 'task_started' && event.type !== 'gate_result') continue;
    max = Math.max(max, liveStageOrder(event.stageId) ?? 0);
  }
  return max;
}

export function escalationsOpenCount(state: LiveState): number {
  return state.escalations.filter((e) => e.closedAt === null).length;
}

/** Open escalations on one company's one gate (FX-3). */
export function openEscalationsFor(
  state: LiveState,
  engagementId: string,
  ticker: string,
  gateStage: string,
): number {
  return state.escalations.filter(
    (e) =>
      e.closedAt === null &&
      e.engagementId === engagementId &&
      e.ticker === ticker &&
      e.stageId === gateStage,
  ).length;
}

export function commandsPendingFor(state: LiveState, agentId: string): Command[] {
  return Object.values(state.commands).filter(
    (c) => c.toAgentId === agentId && (c.status === 'sent' || c.status === 'received'),
  );
}
