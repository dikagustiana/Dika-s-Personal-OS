/**
 * FSRE BUILDING v2 — WHAT THE SYNTHETIC OFFICE'S PANELS SAY, DERIVED.
 *
 * The summary card, the partner room's lock and gate lines, the desk panel's
 * lists, the industries board's groups and the plan card's chain position,
 * as pure functions of the live state and the transport's lists. Components
 * render these and compute nothing (this repository's rule 2 keeps number
 * literals and arithmetic out of them).
 *
 * Ported from the GLM workspace's panels (LiveSidePanel, MetricsBar,
 * IndustriesView, EngagementDialog, Composer at 5b5d186, after FX-3, FX-6 and
 * FX-7), where this logic sat inside the components.
 */
import type { Agent, AgentEvent, Command, Engagement, IndustryProgressRow } from '../../../data/fsreTransport/contract';
import { DEPARTMENT_FLOOR } from './departmentLayout';
import type { DeskView, FloorDesks } from './deskViews';
import { formatCount, formatNumber } from './format';
import { FLOOR_IDS, FLOOR_LABELS, type FloorId } from './layout';
import {
  LIVE_GATE_STAGES,
  escalationsOpenCount,
  factsLoadedTotal,
  gateDisplayStatus,
  openEscalationsFor,
  type LiveState,
} from './liveReducer';
import { CHAIN_GROUPS, DEPARTMENT_WORDS, gateStatusLabel, type ChainGroup, type LiveGateStatus } from './statuses';

/** How many of an agent's recent events the desk panel lists (brief v2 WO-3: the last 5). */
export const DESK_PANEL_EVENTS = 5;

/** A desk's last events for its panel, newest first (the live reducer keeps them newest first). */
export function recentEvents(view: { events: readonly AgentEvent[] } | undefined): AgentEvent[] {
  return view ? view.events.slice(0, DESK_PANEL_EVENTS) : [];
}

/** "G1", "G2", "G3": a gate's short name from its place among the gate stages. */
export function gateShortName(index: number): string {
  return `G${formatNumber(index + 1)}`;
}

/** "Data department · B1 Data", or null for the router, methodology and the owner. */
export function departmentLabel(agent: Agent): string | null {
  if (!agent.departmentId) return null;
  return `${DEPARTMENT_WORDS[agent.departmentId]} · ${FLOOR_LABELS[DEPARTMENT_FLOOR[agent.departmentId]]}`;
}

/** The lead every staff agent's commands copy (Cc). Leads, the router and methodology have none. */
export function leadOfAgent(agent: Agent, agents: readonly Agent[]): Agent | null {
  if (!agent.departmentId || agent.role !== 'staff') return null;
  return agents.find((a) => a.role === 'lead' && a.departmentId === agent.departmentId) ?? null;
}

/** The command thread of a desk: commands to it or copied to it, oldest first. */
export function commandsOfAgent(state: LiveState, agentId: string): Command[] {
  return Object.values(state.commands)
    .filter((command) => command.toAgentId === agentId || command.ccAgentIds.includes(agentId))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** Commands still on their way: sent or received, not yet done or declined. */
export function openCommandCount(commands: readonly Command[]): number {
  return commands.filter((command) => command.status === 'sent' || command.status === 'received').length;
}

/** "1 queued item · 2 open commands": a desk's in-tray, in words. */
export function queueLine(queueDepth: number | null, openCommands: number): string {
  return `${formatCount(queueDepth ?? 0, 'queued item')} · ${formatCount(openCommands, 'open command')}`;
}

/** The desk view of one agent, wherever it sits (drawn or counted beyond the drawn desks). */
export function deskViewOf(views: Record<FloorId, FloorDesks>, agentId: string): DeskView | null {
  for (const floorId of FLOOR_IDS) {
    const found = [...views[floorId].desks, ...views[floorId].hidden].find((desk) => desk.agentId === agentId);
    if (found) return found;
  }
  return null;
}

/** "Mapping cost-of-revenue note (rowsMapped 14, rowsTotal 37)": an event's counts, through the one formatter. */
export function countsText(counts: Record<string, number> | null): string | null {
  if (!counts) return null;
  const entries = Object.entries(counts);
  return entries.length ? entries.map(([key, value]) => `${key} ${formatNumber(value)}`).join(', ') : null;
}

/* ---------- the partner room ---------- */

/**
 * The owner-visible lock, from event-derived state (FX-6): an open
 * escalation on the engagement, or any gate of either company not passed.
 * The transport stays the authority; this only disables the button and says why.
 */
export function approvalLock(state: LiveState, engagement: Engagement): string | null {
  const open = state.escalations.filter((e) => e.closedAt === null && e.engagementId === engagement.id);
  if (open.length) {
    const [first] = open;
    const ticker = first.ticker ?? engagement.plan.tickers.join(' + ');
    return open.length === 1 ? `Locked: 1 escalation open on ${ticker}. Resolve it first.` : `Locked: ${formatNumber(open.length)} escalations open. Resolve them first.`;
  }
  for (const ticker of engagement.plan.tickers) {
    for (const stage of LIVE_GATE_STAGES) {
      const status = gateDisplayStatus(state, engagement.id, ticker, stage.id);
      if (status !== 'passed') return `Locked: ${stage.name} on ${ticker} is ${gateStatusLabel(status, openEscalationsFor(state, engagement.id, ticker, stage.id))}.`;
    }
  }
  return null;
}

/** "SYNA: G1 Passed · G2 Passed, 1 escalation open · G3 Pending", with each gate's real open count (FX-3). */
export function gateLine(state: LiveState, engagement: Engagement, ticker: string): string {
  const gates = LIVE_GATE_STAGES.map((stage, index) => {
    const status = gateDisplayStatus(state, engagement.id, ticker, stage.id);
    return `${gateShortName(index)} ${gateStatusLabel(status, openEscalationsFor(state, engagement.id, ticker, stage.id))}`;
  });
  return `${ticker}: ${gates.join(' · ')}`;
}

/* ---------- the summary card ---------- */

export interface SummaryGate {
  label: string;
  status: LiveGateStatus;
  open: number;
}

export interface SummaryCard {
  companies: number;
  escalationsOpen: number;
  /** The engagement the gate metrics speak for: the filtered one, else the oldest live one (FX-7). */
  focus: Engagement | null;
  gates: SummaryGate[];
  waitingOwner: number;
  factsLoaded: number;
}

function isLive(engagement: Engagement): boolean {
  return engagement.status === 'running' || engagement.status === 'waiting_owner';
}

function pairGate(state: LiveState, engagement: Engagement, stageId: string): { status: LiveGateStatus; open: number } {
  const statuses = engagement.plan.tickers.map((ticker) => gateDisplayStatus(state, engagement.id, ticker, stageId));
  const open = engagement.plan.tickers.reduce((sum, ticker) => sum + openEscalationsFor(state, engagement.id, ticker, stageId), 0);
  if (statuses.every((s) => s === 'passed')) return { status: 'passed', open };
  if (statuses.some((s) => s === 'failed')) return { status: 'failed', open };
  if (statuses.some((s) => s === 'passed_with_open_escalations')) return { status: 'passed_with_open_escalations', open };
  return { status: 'pending', open };
}

export function summaryCard(state: LiveState, engagements: readonly Engagement[], filterEngagementId: string | null): SummaryCard {
  const live = engagements.filter(isLive);
  const focus = live.find((e) => e.id === filterEngagementId) ?? live[0] ?? null;
  return {
    companies: new Set(live.flatMap((e) => e.plan.tickers)).size,
    escalationsOpen: escalationsOpenCount(state),
    focus,
    gates: LIVE_GATE_STAGES.map((stage) => {
      const label = focus ? `${stage.name} · ${focus.plan.tickers.join(' + ')}` : stage.name;
      return focus ? { label, ...pairGate(state, focus, stage.id) } : { label, status: 'pending' as const, open: 0 };
    }),
    waitingOwner: engagements.filter((e) => e.status === 'waiting_owner').length,
    factsLoaded: factsLoadedTotal(state),
  };
}

/** The header bell's count in the synthetic office: open escalations, which the partner room's button repeats (FX-7). */
export function partnerWaiting(state: LiveState): number {
  return escalationsOpenCount(state);
}

/* ---------- the industries board ---------- */

/** The board's two columns: the sub-industry, and its companies' progress. */
export const INDUSTRIES_COLUMNS = 2;

export interface IndustriesTopLine {
  covered: number;
  total: number;
  running: number;
  escalationsOpen: number;
}

export function industriesTopLine(progress: readonly IndustryProgressRow[], engagements: readonly Engagement[], state: LiveState): IndustriesTopLine {
  return {
    covered: progress.filter((row) => row.covered).length,
    total: progress.length,
    running: engagements.filter((e) => e.status === 'running').length,
    escalationsOpen: escalationsOpenCount(state),
  };
}

/** The board's rows grouped by chain group, in chain order; empty groups left out. */
export function industriesGroups(progress: readonly IndustryProgressRow[]): Array<{ group: ChainGroup; rows: IndustryProgressRow[] }> {
  return CHAIN_GROUPS.map((group) => ({ group, rows: progress.filter((row) => row.chainGroup === group) })).filter((entry) => entry.rows.length > 0);
}

/** The engagement a row's "Open in the building" opens: the first of its engagements the office knows. */
export function openableEngagement(row: IndustryProgressRow, engagements: readonly Engagement[]): string | null {
  const known = new Set(engagements.map((e) => e.id));
  return row.companies.map((company) => company.engagementId).find((id) => known.has(id)) ?? null;
}

/** A company's stage bar: one segment per stage, the first `stageIndex` of them reached. */
export function stageSegments(stageIndex: number, stagesTotal: number): boolean[] {
  return Array.from({ length: stagesTotal }, (_, index) => index < stageIndex);
}

/* ---------- the plan card ---------- */

/** "Chain position 3 of 8", or "Not placed on the chain yet". */
export function chainPositionText(chainNodeId: string | null): string {
  const [notPlaced] = CHAIN_GROUPS.slice(-1);
  if (chainNodeId === null) return notPlaced;
  const placedGroups = CHAIN_GROUPS.length - 1;
  return `Chain position ${chainNodeId.replace('chain-', '')} of ${formatNumber(placedGroups)}`;
}
