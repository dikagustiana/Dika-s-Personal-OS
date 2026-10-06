/**
 * FSRE BUILDING v2 — THE REPLAY ON THE DEPARTMENT FLOORS (brief v2 WO-2).
 *
 * "The existing replay data predates departments. Map its per-skill agents
 * to the new desks by skill name; with one company, each department gets one
 * assigned staff desk." planDepartmentFloors does that, and returns the same
 * FloorPlan shape planFloors (layout.ts) returns, so the reducer, the scene,
 * the panels, the timeline and the search work unchanged on the new seats:
 * folders still go to the desk of whoever works their stage, gate rooms still
 * stand on 3F, the partner desk is still the owner's.
 *
 * Who sits where comes from data, never from a name written here:
 *
 *   1. The roster (ROSTER_V2, src/data/fsreTransport/provisional.ts, brief v2
 *      §3) gives each skill it names a role: lead, staff, router,
 *      methodology. A skill a lead and a staff entry both name sits at the
 *      lead's station (the review lead's skill; the checkers are standing
 *      desks of their own).
 *   2. A skill the roster does not name keeps the floor planFloors gives it
 *      from the stage data and the skill data's own `seat`: the partner room,
 *      a department's staff row, or the lobby beside reception.
 *
 * A department lead with two skills (the data lead's) is two people at one
 * station, side by side at the lead's seat: the replay records each skill as
 * its own agent. Staff desks nobody holds are drawn vacant ("Idle, no
 * assignment"), the review checkers among them.
 */
import type { DepartmentId } from '../../../data/fsreTransport/contract';
import { ROSTER_V2, type RosterEntry } from '../../../data/fsreTransport/provisional';
import type { FsreSkill, FsreStage } from './data';
import { DEPARTMENT_FLOOR, DEPARTMENT_FLOORS, agentSpotAt, staffSlotBoxes, staffSlotCount } from './departmentLayout';
import {
  FALLBACK_DESK_KEY,
  FLOOR_IDS,
  FLOOR_ZONES,
  GATE_ROOMS,
  LOBBY_FALLBACK,
  PARTNER_DESK,
  PARTNER_PILES,
  STANDARD_DESK,
  deskKeyForGate,
  deskKeyForSkill,
  folderSpotOn,
  planFloors,
  slotCentres,
  type DeskAnchor,
  type DeskKey,
  type FloorId,
  type FloorPlan,
} from './layout';
import type { Box } from './projection';
import { VACANT_DESK_TITLE } from './statuses';

/** Gap between the desks of a lead station holding two skills, in floor units. */
const STATION_GAP = 0.3;

/** Desks of lobby skills the roster does not name: a short row right of reception. */
const LOBBY_EXTRA_ROW = { x0: 20, x1: 28, y: 4.6 } as const;

type Placement =
  | { kind: 'lead'; departmentId: DepartmentId }
  | { kind: 'staff'; departmentId: DepartmentId }
  | { kind: 'router' }
  | { kind: 'methodology' }
  | { kind: 'partner' }
  | { kind: 'lobby' };

function rosterEntryOf(skill: string, roster: readonly RosterEntry[]): RosterEntry | null {
  return roster.find((entry) => entry.skills.includes(skill)) ?? null;
}

const ZONE_DEPARTMENT: Partial<Record<FloorId, DepartmentId>> = { b1: 'data', f2: 'modelling', f3: 'review' };

function placementOf(skill: string, fallbackFloor: FloorId, roster: readonly RosterEntry[]): Placement {
  const entry = rosterEntryOf(skill, roster);
  if (entry) {
    if ((entry.role === 'lead' || entry.role === 'staff') && entry.departmentId) return { kind: entry.role, departmentId: entry.departmentId };
    if (entry.role === 'router' || entry.role === 'methodology') return { kind: entry.role };
    return { kind: 'partner' };
  }
  if (FLOOR_ZONES[fallbackFloor] === 'partner') return { kind: 'partner' };
  const departmentId = ZONE_DEPARTMENT[fallbackFloor];
  return departmentId ? { kind: 'staff', departmentId } : { kind: 'lobby' };
}

/** `count` desks of standard size centred on `centre`, side by side. */
function station(centre: number, y: number, count: number): Box[] {
  const width = count * STANDARD_DESK.w + (count - 1) * STATION_GAP;
  return Array.from({ length: count }, (_, index) => ({
    x: centre - width / 2 + index * (STANDARD_DESK.w + STATION_GAP),
    y,
    w: STANDARD_DESK.w,
    d: STANDARD_DESK.d,
    h: STANDARD_DESK.h,
  }));
}

/** The titles the roster gives a department's standing staff desks (the checkers), in order. */
function standingTitles(departmentId: DepartmentId, roster: readonly RosterEntry[]): string[] {
  const titles = roster.filter((entry) => entry.departmentId === departmentId && entry.role === 'staff').map((entry) => entry.title);
  return titles.length > 1 ? titles : [];
}

export function planDepartmentFloors(stages: readonly FsreStage[], skills: readonly FsreSkill[], roster: readonly RosterEntry[] = ROSTER_V2): FloorPlan {
  const base = planFloors(stages, skills);
  const agentSet = new Set(base.agentSkills);
  // Every skill the stage data or the skill data names gets a place, agent or not.
  const everySkill = Object.keys(base.floorOfSkill);
  const placements = new Map(everySkill.map((skill) => [skill, placementOf(skill, base.floorOfSkill[skill], roster)]));

  const desks: Record<DeskKey, DeskAnchor> = {};
  const desksOnFloor: Record<FloorId, DeskKey[]> = { b1: [], f1: [], f2: [], f3: [], f4: [] };
  const floorOfSkill: Record<string, FloorId> = {};
  const addDesk = (desk: DeskAnchor) => {
    desks[desk.key] = desk;
    desksOnFloor[desk.floorId].push(desk.key);
    if (desk.skill) floorOfSkill[desk.skill] = desk.floorId;
  };
  const skillDesk = (skill: string, floorId: FloorId, surface: Box, monitor: boolean): DeskAnchor => ({
    key: deskKeyForSkill(skill),
    floorId,
    kind: 'desk',
    skill,
    stageId: null,
    surface,
    folderSpot: folderSpotOn(surface),
    agentSpot: agentSet.has(skill) ? agentSpotAt(surface) : null,
    room: null,
    monitor,
    title: null,
  });
  const skillsWith = (match: (placement: Placement) => boolean) =>
    everySkill.filter((skill) => {
      const placement = placements.get(skill);
      return placement ? match(placement) : false;
    });

  for (const departmentId of ['data', 'modelling', 'review'] as const) {
    const floorId = DEPARTMENT_FLOOR[departmentId];
    const floor = DEPARTMENT_FLOORS[floorId];

    // The lead's station, at the head of the room.
    const leads = skillsWith((p) => p.kind === 'lead' && p.departmentId === departmentId);
    if (floor.lead && leads.length) {
      const seat = floor.lead.surface;
      station(seat.x + seat.w / 2, seat.y, leads.length).forEach((surface, index) => addDesk(skillDesk(leads[index], floorId, surface, floor.lead?.monitor ?? true)));
    }

    // The staff row: the department's staff skills, then vacant desks.
    const staff = skillsWith((p) => p.kind === 'staff' && p.departmentId === departmentId);
    const titles = standingTitles(departmentId, roster);
    const slots = staffSlotBoxes(floorId, Math.max(staffSlotCount(departmentId, staff.length), titles.length));
    slots.forEach((slot, index) => {
      const skill = staff[index];
      if (skill) {
        addDesk(skillDesk(skill, floorId, slot.surface, slot.monitor));
        return;
      }
      addDesk({
        key: `vacant:${slot.id}`,
        floorId,
        kind: 'vacant',
        skill: null,
        stageId: null,
        surface: slot.surface,
        folderSpot: folderSpotOn(slot.surface),
        agentSpot: null,
        room: null,
        monitor: slot.monitor,
        title: titles[index] ?? VACANT_DESK_TITLE,
      });
    });
  }

  // The lobby: reception, the training room, and a short row for anyone else.
  for (const special of DEPARTMENT_FLOORS.f1.special) {
    const kind = special.kind;
    const onSeat = skillsWith((p) => p.kind === kind);
    if (!onSeat.length) continue;
    const seat = special.seat.surface;
    station(seat.x + seat.w / 2, seat.y, onSeat.length).forEach((surface, index) => addDesk(skillDesk(onSeat[index], 'f1', surface, special.seat.monitor)));
  }
  const lobbyExtras = skillsWith((p) => p.kind === 'lobby');
  const extraCentres = slotCentres(LOBBY_EXTRA_ROW.x0, LOBBY_EXTRA_ROW.x1, lobbyExtras.length);
  lobbyExtras.forEach((skill, index) => {
    const surface: Box = { x: extraCentres[index] - STANDARD_DESK.w / 2, y: LOBBY_EXTRA_ROW.y, w: STANDARD_DESK.w, d: STANDARD_DESK.d, h: STANDARD_DESK.h };
    addDesk(skillDesk(skill, 'f1', surface, false));
  });

  // The partner room: every sign-off skill shares the one partner desk, as in planFloors.
  for (const skill of skillsWith((p) => p.kind === 'partner')) {
    addDesk({
      key: deskKeyForSkill(skill),
      floorId: 'f4',
      kind: 'partner',
      skill,
      stageId: null,
      surface: PARTNER_DESK,
      folderSpot: folderSpotOn(PARTNER_DESK, PARTNER_PILES.folders.dx),
      agentSpot: agentSet.has(skill) ? agentSpotAt(PARTNER_DESK) : null,
      room: null,
      monitor: false,
      title: null,
    });
  }

  // Gate rooms and the lobby bench come from planFloors unchanged: same span, same rooms.
  for (const stageId of base.gateStageIds) addDesk(base.desks[deskKeyForGate(stageId)]);
  addDesk({ ...base.desks[FALLBACK_DESK_KEY], surface: LOBBY_FALLBACK });

  const skillsOnFloor: Record<FloorId, string[]> = { b1: [], f1: [], f2: [], f3: [], f4: [] };
  for (const floorId of FLOOR_IDS) skillsOnFloor[floorId] = everySkill.filter((skill) => floorOfSkill[skill] === floorId);

  return {
    ...base,
    partnerSkills: everySkill.filter((skill) => floorOfSkill[skill] === 'f4'),
    floorOfSkill,
    skillsOnFloor,
    desks,
    desksOnFloor,
    decorations: { b1: DEPARTMENT_FLOORS.b1.decorations, f1: DEPARTMENT_FLOORS.f1.decorations, f2: DEPARTMENT_FLOORS.f2.decorations, f3: DEPARTMENT_FLOORS.f3.decorations, f4: DEPARTMENT_FLOORS.f4.decorations },
  };
}

/** The gate rooms' span on 3F is planFloors'; re-exported for the layout test that checks nothing overlaps it. */
export const GATE_ROOM_SPAN = { x0: GATE_ROOMS.x0, x1: GATE_ROOMS.x1, y: GATE_ROOMS.y } as const;
