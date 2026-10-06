/**
 * FSRE BUILDING v2 — WHAT EACH SYNTHETIC DESK SHOWS.
 *
 * A DeskView is one seat of the live office: its name plate (title and
 * ticker), the monitor's few words (the current task), the in-tray count
 * (queued items and open commands) and the status chip (glyph + word + tone).
 * Every value is derived from the live event state and the clock; nothing is
 * stored (brief v2 §2). The replay does not use this: it seats its per-skill
 * agents through planDepartmentFloors and draws them with the replay scene.
 *
 * Ported from the GLM workspace (src/live/deskViews.ts at 5b5d186, after
 * FX-2 and FX-9 of brief v2.1): desk escalations are counted from open
 * escalation ids by opener, and the floor tag counts every desk in every
 * state, drawn or not.
 */
import type { Agent, DepartmentId, Engagement } from '../../../data/fsreTransport/contract';
import { OWNER_ROLE, ROSTER_V2 } from '../../../data/fsreTransport/provisional';
import { deriveDeskState } from './deskState';
import { DEPARTMENT_FLOORS, DEPARTMENT_FLOOR, staffSlotBoxes, staffSlotCount, type SeatBox, type SeatKind } from './departmentLayout';
import { formatCount, formatHHMM, formatNumber } from './format';
import { DESK_GLYPHS, DESK_TONES, type Tone } from './glyphs';
import { FLOOR_DISPLAY_ORDER, FLOOR_IDS, type FloorId } from './layout';
import { commandsPendingFor, escalationsOfAgent, type LiveState } from './liveReducer';
import {
  DESK_STATES,
  DESK_STATE_WORDS,
  FLOOR_TAG_WORDS,
  OTHER_ENGAGEMENT_WORD,
  UNASSIGNED_DESK_WORD,
  VACANT_DESK_TITLE,
  noSignalSinceText,
  type DeskState,
} from './statuses';

export interface DeskView {
  deskId: string;
  floorId: FloorId;
  seatKind: SeatKind;
  slot: number;
  seat: SeatBox;
  /** Null for a staff desk with nobody at it. */
  agentId: string | null;
  /** Name plate: the agent's title, or the seat's title when nobody sits there. */
  title: string;
  ticker: string | null;
  monitorText: string | null;
  trayCount: number;
  state: DeskState;
  /** The chip's full words: "Working", "Idle, no assignment", "No signal since 09.14". */
  stateWord: string;
  glyph: string;
  tone: Tone;
  engagementId: string | null;
  /** The ticker the desk's current work concerns (for the dim label). */
  workTicker: string | null;
  /** Set when the industries view filters the building to another engagement. */
  dimLabel: string | null;
}

export interface FloorDesks {
  desks: DeskView[];
  /** Agents a department has beyond the drawn desks: counted, not drawn (FX-9). */
  hidden: DeskView[];
}

function emptyFloors(): Record<FloorId, FloorDesks> {
  const none = (): FloorDesks => ({ desks: [], hidden: [] });
  return { b1: none(), f1: none(), f2: none(), f3: none(), f4: none() };
}

function liveDeskView(agent: Agent, floorId: FloorId, seat: SeatBox, seatKind: SeatKind, slot: number, live: LiveState, now: string): DeskView {
  const view = live.agents[agent.id];
  const lastSignalAt = view?.lastSignalAt ?? null;
  const state = deriveDeskState({
    openEscalations: escalationsOfAgent(live, agent.id).open,
    hasOpenTask: view?.currentTask != null,
    waitingOn: view?.waitingOn ?? null,
    lastSignalAt,
    now,
  });
  const stateWord = state === 'no_signal' && lastSignalAt ? noSignalSinceText(formatHHMM(lastSignalAt)) : DESK_STATE_WORDS[state];
  return {
    deskId: `desk:${agent.id}`,
    floorId,
    seatKind,
    slot,
    seat,
    agentId: agent.id,
    title: agent.title,
    ticker: agent.assignedTicker,
    monitorText: view?.currentTask ?? null,
    trayCount: (view?.queueDepth ?? 0) + commandsPendingFor(live, agent.id).length,
    state,
    stateWord,
    glyph: DESK_GLYPHS[state],
    tone: DESK_TONES[state],
    engagementId: view?.currentEngagementId ?? null,
    workTicker: view?.currentTicker ?? agent.assignedTicker,
    dimLabel: null,
  };
}

/** The roster's titles for a department's standing staff (the review checkers), in roster order. */
function standingStaffTitles(departmentId: DepartmentId): string[] {
  return ROSTER_V2.filter((entry) => entry.departmentId === departmentId && entry.role === 'staff').map((entry) => entry.title);
}

function vacantDeskView(floorId: FloorId, departmentId: DepartmentId, slot: number, seat: SeatBox): DeskView {
  const titles = standingStaffTitles(departmentId);
  // A department whose roster names several standing desks gives each its own title.
  const title = titles.length > 1 ? (titles[slot] ?? VACANT_DESK_TITLE) : VACANT_DESK_TITLE;
  return {
    deskId: `desk:${seat.id}`,
    floorId,
    seatKind: 'staff',
    slot,
    seat,
    agentId: null,
    title,
    ticker: null,
    monitorText: null,
    trayCount: 0,
    state: 'idle',
    stateWord: UNASSIGNED_DESK_WORD,
    glyph: DESK_GLYPHS.idle,
    tone: DESK_TONES.idle,
    engagementId: null,
    workTicker: null,
    dimLabel: null,
  };
}

function staffOf(agents: readonly Agent[], departmentId: DepartmentId): Agent[] {
  return agents.filter((agent) => agent.departmentId === departmentId && agent.role === 'staff').sort((a, b) => a.id.localeCompare(b.id));
}

/** The agent that holds a special seat: the owner at the partner desk, the router and methodology by role. */
function agentForSpecial(agents: readonly Agent[], kind: Exclude<SeatKind, 'lead' | 'staff'>): Agent | null {
  if (kind === 'partner') return agents.find((agent) => agent.role === OWNER_ROLE) ?? null;
  return agents.find((agent) => agent.role === kind) ?? null;
}

export function syntheticDeskViews(live: LiveState, agents: readonly Agent[], now: string): Record<FloorId, FloorDesks> {
  const views = emptyFloors();
  for (const floorId of FLOOR_DISPLAY_ORDER) {
    const floor = DEPARTMENT_FLOORS[floorId];
    const desks: DeskView[] = [];
    const hidden: DeskView[] = [];

    if (floor.lead && floor.departmentId) {
      const departmentId = floor.departmentId;
      const lead = agents.find((agent) => agent.role === 'lead' && agent.departmentId === departmentId) ?? null;
      if (lead) desks.push(liveDeskView(lead, floorId, floor.lead, 'lead', 0, live, now));
    }

    for (const special of floor.special) {
      const agent = agentForSpecial(agents, special.kind);
      if (agent) desks.push(liveDeskView(agent, floorId, special.seat, special.kind, 0, live, now));
    }

    if (floor.staffStrip && floor.departmentId) {
      const departmentId = floor.departmentId;
      const staff = staffOf(agents, departmentId);
      const slotCount = staffSlotCount(departmentId, staff.length);
      const seats = staffSlotBoxes(floorId, slotCount);
      seats.forEach((seat, slot) => {
        const agent = staff[slot];
        desks.push(agent ? liveDeskView(agent, floorId, seat, 'staff', slot, live, now) : vacantDeskView(floorId, departmentId, slot, seat));
      });
      // Staff beyond the drawn desks are counted with their real states (FX-9).
      const [lastSeat] = seats.slice(-1);
      if (lastSeat) {
        staff.slice(slotCount).forEach((agent, index) => hidden.push(liveDeskView(agent, floorId, lastSeat, 'staff', slotCount + index, live, now)));
      }
    }

    views[floorId] = { desks, hidden };
  }
  return views;
}

/** The floor a department's desks are on (for the floor of an agent). */
export function floorOfAgent(agent: Agent | undefined): FloorId | null {
  if (!agent) return null;
  if (agent.role === OWNER_ROLE) return 'f4';
  if (agent.role === 'router' || agent.role === 'methodology') return 'f1';
  return agent.departmentId ? DEPARTMENT_FLOOR[agent.departmentId] : null;
}

/**
 * The floor tag: every desk in every state, drawn or not (FX-9). Words come
 * from the vocabulary; vacant desks are counted as unstaffed.
 */
export function floorTagParts(desks: readonly DeskView[], hiddenDesks: readonly DeskView[]): string[] {
  const parts: string[] = [];
  const counted = [...desks, ...hiddenDesks].filter((desk) => desk.agentId !== null);
  for (const state of DESK_STATES) {
    const n = counted.filter((desk) => desk.state === state).length;
    if (n > 0) {
      const word = DESK_STATE_WORDS[state].toLowerCase();
      parts.push(formatCount(n, word, word));
    }
  }
  const unstaffed = desks.filter((desk) => desk.agentId === null).length;
  if (unstaffed > 0) parts.push(`${formatNumber(unstaffed)} ${FLOOR_TAG_WORDS.unstaffed}`);
  if (hiddenDesks.length > 0) parts.push(`${formatNumber(hiddenDesks.length)} ${FLOOR_TAG_WORDS.notDrawn}`);
  return parts;
}

/** WO-5: with a filter set, desks of other engagements are dimmed and labelled. */
export function applyDimming(views: Record<FloorId, FloorDesks>, engagements: readonly Engagement[], filterEngagementId: string | null): Record<FloorId, FloorDesks> {
  if (!filterEngagementId) return views;
  const engagement = engagements.find((e) => e.id === filterEngagementId);
  const tickers = new Set(engagement?.plan.tickers ?? []);
  const out = emptyFloors();
  for (const floorId of FLOOR_IDS) {
    const { desks, hidden } = views[floorId];
    out[floorId] = {
      desks: desks.map((desk) => {
        const onFilter =
          desk.engagementId === filterEngagementId ||
          (desk.workTicker !== null && tickers.has(desk.workTicker)) ||
          (desk.ticker !== null && tickers.has(desk.ticker)) ||
          desk.seatKind === 'partner';
        return onFilter ? { ...desk, dimLabel: null } : { ...desk, dimLabel: desk.workTicker ?? desk.ticker ?? OTHER_ENGAGEMENT_WORD };
      }),
      hidden,
    };
  }
  return out;
}
