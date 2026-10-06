/**
 * FSRE BUILDING — THE FLOOR LAYOUT, AND WHICH SKILL SITS ON WHICH FLOOR.
 *
 * Two halves, kept apart on purpose:
 *
 *   FURNITURE (FLOORS below) is geometry: where each floor's desk row, glass
 *   rooms, plants, racks and wall features stand, in floor units. It names no
 *   stage and no skill.
 *
 *   ASSIGNMENT (planFloors) decides which skill works on which floor, and it
 *   reads that from the STAGE DATA — not from a second list. The source app
 *   gave every floor its own `skills` array, a copy of skills.json that
 *   would have silently disagreed with the router the first time a stage
 *   moved. The rule, applied to stages in pipeline order:
 *
 *     1. Gate stages split the pipeline into segments. A stage is a gate
 *        when its id is a gate id (GATE_STAGE_ID); both the provisional
 *        list (gate-1) and the router's state machine (gate1) match.
 *     2. Skills that run a gate work on the review floor (3F).
 *     0. A skill whose entry in skills.json names a `seat` (one of
 *        FLOOR_ZONE_IDS) works there. The real export seats the owner in
 *        the partner room and the router in the lobby: in the router's
 *        state machine the last stage is `closed`, run by the router, so
 *        rule 3 alone would put the router at the partner desk.
 *     3. Without any seat on `partner`, skills that run the LAST stage sit
 *        in the partner room (4F): the provisional list ends with sign-off.
 *     4. A skill that works in more than one segment (the router, which
 *        opens the run and holds the holdout) or in none (a skill in
 *        skills.json that runs no stage) works from the lobby (1F).
 *     5. Otherwise the first segment is the data room (B1), every later
 *        segment the modelling floor (2F).
 *
 * Desks are generated: each floor spreads its skills evenly along its desk
 * row, so ten skills or two both fit without hand-placed coordinates. Gate
 * rooms are generated the same way, one per gate stage.
 */
import type { FsreSkill, FsreStage } from './data';
import { AGENT_FIGURE, FOLDER_BOX } from './geometry';
import type { Box } from './projection';

export const FLOOR_IDS = ['b1', 'f1', 'f2', 'f3', 'f4'] as const;
export type FloorId = (typeof FLOOR_IDS)[number];

/** Display order, top of the building first. */
export const FLOOR_DISPLAY_ORDER: readonly FloorId[] = ['f4', 'f3', 'f2', 'f1', 'b1'];

/** The floor zones, which are also the seats a skill entry may name. */
export const FLOOR_ZONE_IDS = ['data', 'lobby', 'modelling', 'review', 'partner'] as const;
export type FloorZone = (typeof FLOOR_ZONE_IDS)[number];

export const FLOOR_ZONES: Record<FloorId, FloorZone> = {
  b1: 'data',
  f1: 'lobby',
  f2: 'modelling',
  f3: 'review',
  f4: 'partner',
};

const ZONE_FLOOR: Record<FloorZone, FloorId> = {
  data: 'b1',
  lobby: 'f1',
  modelling: 'f2',
  review: 'f3',
  partner: 'f4',
};

export const FLOOR_LABELS: Record<FloorId, string> = {
  f4: '4F Partner room',
  f3: '3F Review',
  f2: '2F Modelling',
  f1: '1F Lobby',
  b1: 'B1 Data',
};

/** The one gate predicate. Matches `gate-1` (provisional) and `gate1` (router). */
export const GATE_STAGE_ID = /^gate[-_]?\d+$/i;

export function isGateStage(stage: Pick<FsreStage, 'id'>): boolean {
  return GATE_STAGE_ID.test(stage.id);
}

/* ---------- furniture ---------- */

export type WallContent = 'stages' | 'figures' | 'issues' | 'lift' | 'blank';

export type Decoration =
  | { kind: 'plant'; id: string; x: number; y: number }
  | { kind: 'solid'; id: string; box: Box }
  | { kind: 'glass'; id: string; box: Box }
  | { kind: 'rack'; id: string; box: Box }
  | { kind: 'wall'; id: string; content: WallContent; x0: number; x1: number; z0: number; z1: number };

export interface DeskRow {
  x0: number;
  x1: number;
  /** Front edge of the desks. */
  y: number;
  monitors: boolean;
}

export interface FloorFurniture {
  deskRow: DeskRow;
  decorations: Decoration[];
}

export const STANDARD_DESK = { w: 2.4, d: 1, h: 0.75 } as const;

/** Gate rooms on 3F: generated along this span, one per gate stage. */
export const GATE_ROOMS = {
  x0: 10,
  x1: 29.5,
  y: 6,
  d: 4,
  h: 2,
  maxW: 5.5,
  gap: 0.5,
  table: { y: 7.3, w: 2, d: 1, h: 0.7 },
} as const;

/** The partner desk on 4F, and where the two document piles and the folders rest on it. */
export const PARTNER_DESK: Box = { x: 10, y: 4.5, w: 10, d: 1.6, h: 0.8 };
export const PARTNER_PILES = {
  escalation: { dx: 0.6 },
  proposal: { dx: 2.3 },
  folders: { dx: 7.6 },
} as const;

/** Where a folder rests when its desk is unknown to the plan (a skill no stage or file names). */
export const LOBBY_FALLBACK: Box = { x: 2, y: 1.2, w: 3.4, d: 1, h: 0.5 };

export const FLOORS: Record<FloorId, FloorFurniture> = {
  f4: {
    deskRow: { x0: PARTNER_DESK.x, x1: PARTNER_DESK.x + PARTNER_DESK.w, y: PARTNER_DESK.y, monitors: false },
    decorations: [
      { kind: 'solid', id: 'partner-chair', box: { x: 14.4, y: 6.6, w: 1.2, d: 0.9, h: 0.9 } },
      { kind: 'solid', id: 'bookshelf', box: { x: 3, y: 9.2, w: 5, d: 0.6, h: 2.2 } },
      { kind: 'plant', id: 'f4-plant-a', x: 26.5, y: 8.2 },
      { kind: 'plant', id: 'f4-plant-b', x: 1.2, y: 1.2 },
    ],
  },
  f3: {
    deskRow: { x0: 1.5, x1: 8.5, y: 6.2, monitors: true },
    decorations: [
      { kind: 'glass', id: 'review-office', box: { x: 1, y: 4, w: 8, d: 6, h: 2.2 } },
      { kind: 'plant', id: 'f3-plant-a', x: 9.6, y: 1 },
      { kind: 'plant', id: 'f3-plant-b', x: 28.6, y: 1 },
    ],
  },
  f2: {
    deskRow: { x0: 1, x1: 29, y: 4, monitors: true },
    decorations: [
      { kind: 'wall', id: 'issue-board', content: 'issues', x0: 7, x1: 23, z0: 0.75, z1: 2.85 },
      { kind: 'plant', id: 'f2-plant-a', x: 1.2, y: 8.4 },
      { kind: 'plant', id: 'f2-plant-b', x: 28.2, y: 8.4 },
    ],
  },
  f1: {
    deskRow: { x0: 6, x1: 24, y: 3.5, monitors: false },
    decorations: [
      { kind: 'wall', id: 'stage-screen', content: 'stages', x0: 2, x1: 25, z0: 0.55, z1: 2.85 },
      { kind: 'wall', id: 'lift-doors', content: 'lift', x0: 26, x1: 29, z0: 0, z1: 2.4 },
      { kind: 'solid', id: 'f1-bench', box: LOBBY_FALLBACK },
      { kind: 'plant', id: 'f1-plant-a', x: 1.2, y: 6.5 },
      { kind: 'plant', id: 'f1-plant-b', x: 28.4, y: 6.5 },
    ],
  },
  b1: {
    deskRow: { x0: 1, x1: 21, y: 4, monitors: false },
    decorations: [
      { kind: 'wall', id: 'data-counter', content: 'figures', x0: 2, x1: 15, z0: 1.1, z1: 2.5 },
      { kind: 'rack', id: 'rack-a', box: { x: 22.6, y: 7.6, w: 1.1, d: 1, h: 2.4 } },
      { kind: 'rack', id: 'rack-b', box: { x: 23.9, y: 7.6, w: 1.1, d: 1, h: 2.4 } },
      { kind: 'rack', id: 'rack-c', box: { x: 25.2, y: 7.6, w: 1.1, d: 1, h: 2.4 } },
      { kind: 'rack', id: 'rack-d', box: { x: 26.5, y: 7.6, w: 1.1, d: 1, h: 2.4 } },
      { kind: 'plant', id: 'b1-plant-a', x: 1, y: 8.6 },
      { kind: 'plant', id: 'b1-plant-b', x: 28.6, y: 1 },
    ],
  },
};

/** The figure keys the B1 wall counter shows, in order; their labels come from FIGURE_LABELS. */
export const WALL_COUNTER_FIGURES = ['factsLoaded', 'rows', 'unmappedConcepts', 'rowsTraced'] as const;

/* ---------- desks ---------- */

export type DeskKey = string;

export function deskKeyForSkill(skill: string): DeskKey {
  return `desk:${skill}`;
}

export function deskKeyForGate(stageId: string): DeskKey {
  return `gate:${stageId}`;
}

export const FALLBACK_DESK_KEY: DeskKey = 'lobby:fallback';

export interface DeskAnchor {
  key: DeskKey;
  floorId: FloorId;
  /** `vacant`: a v2 staff desk nobody holds (departmentPlan.ts); drawn, never seated. */
  kind: 'desk' | 'gate' | 'partner' | 'fallback' | 'vacant';
  /** The skill at the desk (desks), or null (gate rooms, fallback). */
  skill: string | null;
  /** The gate stage (gate rooms), or null. */
  stageId: string | null;
  /** The desk or table the folders rest on. */
  surface: Box;
  /** Folders are centred here, on top of the surface. */
  folderSpot: { x: number; y: number; z: number };
  /** Where the skill's agent sits, when the skill is an agent. */
  agentSpot: { x: number; y: number } | null;
  /** The glass room around a gate table. */
  room: Box | null;
  monitor: boolean;
  /** A vacant desk's name plate ("Tie-out checker", "Staff desk"); null for every other kind. */
  title: string | null;
}

export interface FloorPlan {
  /** Stages in pipeline order, from the stage data. */
  stageOrder: string[];
  stagesById: Record<string, FsreStage>;
  /** Stage id → the skills that run it (the stage data's own list). */
  stageRunners: Record<string, string[]>;
  gateStageIds: string[];
  /** The last stage's skills: whoever signs off. Folders go to their desk on `published`. */
  partnerSkills: string[];
  /** Skills listed in skills.json: the agents. */
  agentSkills: string[];
  floorOfSkill: Record<string, FloorId>;
  /** Each floor's skills, derived from the stage data by the rule above. */
  skillsOnFloor: Record<FloorId, string[]>;
  desks: Record<DeskKey, DeskAnchor>;
  /** Desk keys per floor, in drawing order. */
  desksOnFloor: Record<FloorId, DeskKey[]>;
  /** Each floor's plants, racks, glass rooms and wall features, drawn by the scene. */
  decorations: Record<FloorId, readonly Decoration[]>;
}

function emptyByFloor<T>(make: () => T): Record<FloorId, T> {
  return { b1: make(), f1: make(), f2: make(), f3: make(), f4: make() };
}

/** Spread `count` slots evenly along [x0, x1]; returns each slot's centre. */
export function slotCentres(x0: number, x1: number, count: number): number[] {
  if (count <= 0) return [];
  const width = (x1 - x0) / count;
  return Array.from({ length: count }, (_, index) => x0 + width * (index + 0.5));
}

export function folderSpotOn(surface: Box, dx?: number): { x: number; y: number; z: number } {
  return {
    x: dx === undefined ? surface.x + (surface.w - FOLDER_BOX.w) / 2 : surface.x + dx,
    y: surface.y + (surface.d - FOLDER_BOX.d) / 2,
    z: (surface.z ?? 0) + surface.h,
  };
}

/** Who sits in the partner room: the skills seated there, or else the last stage's (rules 0 and 3). */
function partnerSeats(stages: readonly FsreStage[], skills: readonly FsreSkill[]): Set<string> {
  const seated = skills.filter((skill) => skill.seat === 'partner').map((skill) => skill.name);
  if (seated.length) return new Set(seated);
  const lastStage = stages[stages.length - 1];
  return new Set(lastStage && !isGateStage(lastStage) ? lastStage.skills : []);
}

/** Which floor each skill works on, by the rule in the header comment. */
function assignFloors(stages: readonly FsreStage[], skills: readonly FsreSkill[]): Record<string, FloorId> {
  const segmentsOf = new Map<string, Set<number>>();
  const gateSkills = new Set<string>();
  let segment = 0;
  for (const stage of stages) {
    if (isGateStage(stage)) {
      for (const skill of stage.skills) gateSkills.add(skill);
      segment += 1;
      continue;
    }
    for (const skill of stage.skills) {
      const set = segmentsOf.get(skill) ?? new Set<number>();
      set.add(segment);
      segmentsOf.set(skill, set);
    }
  }
  const seated = new Map(skills.filter((skill) => skill.seat).map((skill) => [skill.name, skill.seat as FloorZone]));
  const partnerSkills = partnerSeats(stages, skills);

  const floorOf: Record<string, FloorId> = {};
  const everySkill = [...stages.flatMap((stage) => stage.skills), ...skills.map((skill) => skill.name)];
  for (const skill of everySkill) {
    if (floorOf[skill]) continue;
    const segments = segmentsOf.get(skill);
    const seat = seated.get(skill);
    if (seat) floorOf[skill] = ZONE_FLOOR[seat];
    else if (partnerSkills.has(skill)) floorOf[skill] = ZONE_FLOOR.partner;
    else if (gateSkills.has(skill)) floorOf[skill] = ZONE_FLOOR.review;
    else if (!segments || segments.size !== 1) floorOf[skill] = ZONE_FLOOR.lobby;
    else floorOf[skill] = [...segments][0] === 0 ? ZONE_FLOOR.data : ZONE_FLOOR.modelling;
  }
  return floorOf;
}

export function planFloors(stages: readonly FsreStage[], skills: readonly FsreSkill[]): FloorPlan {
  const ordered = [...stages].sort((a, b) => a.order - b.order);
  const agentSkills = skills.map((skill) => skill.name);
  const agentSet = new Set(agentSkills);
  const floorOfSkill = assignFloors(ordered, skills);
  const gateStageIds = ordered.filter(isGateStage).map((stage) => stage.id);
  const partnerSkills = Object.keys(floorOfSkill).filter((skill) => floorOfSkill[skill] === ZONE_FLOOR.partner);

  const skillsOnFloor = emptyByFloor<string[]>(() => []);
  for (const [skill, floorId] of Object.entries(floorOfSkill)) skillsOnFloor[floorId].push(skill);

  const desks: Record<DeskKey, DeskAnchor> = {};
  const desksOnFloor = emptyByFloor<DeskKey[]>(() => []);
  const addDesk = (desk: DeskAnchor) => {
    desks[desk.key] = desk;
    desksOnFloor[desk.floorId].push(desk.key);
  };

  for (const floorId of FLOOR_IDS) {
    const furniture = FLOORS[floorId];
    const onFloor = skillsOnFloor[floorId];
    if (FLOOR_ZONES[floorId] === 'partner') {
      // Every sign-off skill shares the one partner desk: there is one room.
      for (const skill of onFloor) {
        addDesk({
          key: deskKeyForSkill(skill),
          floorId,
          kind: 'partner',
          skill,
          stageId: null,
          surface: PARTNER_DESK,
          folderSpot: folderSpotOn(PARTNER_DESK, PARTNER_PILES.folders.dx),
          agentSpot: agentSet.has(skill) ? { x: PARTNER_DESK.x + PARTNER_DESK.w / 2, y: PARTNER_DESK.y + AGENT_FIGURE.behindDesk } : null,
          room: null,
          monitor: false,
          title: null,
        });
      }
      continue;
    }
    const row = furniture.deskRow;
    const centres = slotCentres(row.x0, row.x1, onFloor.length);
    const slotWidth = onFloor.length > 0 ? (row.x1 - row.x0) / onFloor.length : 0;
    const deskW = Math.min(STANDARD_DESK.w, slotWidth * 0.8);
    onFloor.forEach((skill, index) => {
      const centre = centres[index];
      const surface: Box = { x: centre - deskW / 2, y: row.y, w: deskW, d: STANDARD_DESK.d, h: STANDARD_DESK.h };
      addDesk({
        key: deskKeyForSkill(skill),
        floorId,
        kind: 'desk',
        skill,
        stageId: null,
        surface,
        folderSpot: folderSpotOn(surface),
        agentSpot: agentSet.has(skill) ? { x: centre, y: row.y + AGENT_FIGURE.behindDesk } : null,
        room: null,
        monitor: row.monitors,
        title: null,
      });
    });
  }

  // Gate rooms on the review floor, one per gate stage, spread along the span.
  const reviewFloor = ZONE_FLOOR.review;
  const roomCentres = slotCentres(GATE_ROOMS.x0, GATE_ROOMS.x1, gateStageIds.length);
  const roomSlot = gateStageIds.length > 0 ? (GATE_ROOMS.x1 - GATE_ROOMS.x0) / gateStageIds.length : 0;
  const roomW = Math.min(GATE_ROOMS.maxW, roomSlot - GATE_ROOMS.gap);
  gateStageIds.forEach((stageId, index) => {
    const centre = roomCentres[index];
    const room: Box = { x: centre - roomW / 2, y: GATE_ROOMS.y, w: roomW, d: GATE_ROOMS.d, h: GATE_ROOMS.h };
    const tableW = Math.min(GATE_ROOMS.table.w, roomW * 0.8);
    const surface: Box = { x: centre - tableW / 2, y: GATE_ROOMS.table.y, w: tableW, d: GATE_ROOMS.table.d, h: GATE_ROOMS.table.h };
    addDesk({
      key: deskKeyForGate(stageId),
      floorId: reviewFloor,
      kind: 'gate',
      skill: null,
      stageId,
      surface,
      folderSpot: folderSpotOn(surface),
      agentSpot: null,
      room,
      monitor: false,
      title: null,
    });
  });

  addDesk({
    key: FALLBACK_DESK_KEY,
    floorId: ZONE_FLOOR.lobby,
    kind: 'fallback',
    skill: null,
    stageId: null,
    surface: LOBBY_FALLBACK,
    folderSpot: folderSpotOn(LOBBY_FALLBACK),
    agentSpot: null,
    room: null,
    monitor: false,
    title: null,
  });

  return {
    stageOrder: ordered.map((stage) => stage.id),
    stagesById: Object.fromEntries(ordered.map((stage) => [stage.id, stage])),
    stageRunners: Object.fromEntries(ordered.map((stage) => [stage.id, [...stage.skills]])),
    gateStageIds,
    partnerSkills,
    agentSkills,
    floorOfSkill,
    skillsOnFloor,
    desks,
    desksOnFloor,
    decorations: { b1: FLOORS.b1.decorations, f1: FLOORS.f1.decorations, f2: FLOORS.f2.decorations, f3: FLOORS.f3.decorations, f4: FLOORS.f4.decorations },
  };
}

/** The first skill that runs a stage, or null. */
export function runnerOf(plan: FloorPlan, stageId: string | undefined): string | null {
  if (!stageId) return null;
  return plan.stageRunners[stageId]?.[0] ?? null;
}

/** Stages a skill runs, from the stage data. */
export function stagesRunBy(plan: FloorPlan, skill: string): string[] {
  return plan.stageOrder.filter((stageId) => plan.stageRunners[stageId]?.includes(skill));
}

/**
 * Where a company's folder rests while it is at a stage: in the gate room
 * for a gate, at the desk of the skill working it otherwise.
 */
export function deskKeyForStage(plan: FloorPlan, stageId: string | undefined, skill: string | null): DeskKey {
  if (stageId && plan.gateStageIds.includes(stageId)) return deskKeyForGate(stageId);
  const worker = skill ?? runnerOf(plan, stageId);
  return worker ? deskKeyForSkill(worker) : FALLBACK_DESK_KEY;
}

/** The desk a key names, or the lobby bench for a desk the plan does not have. */
export function resolveDesk(plan: FloorPlan, key: DeskKey): DeskAnchor {
  return plan.desks[key] ?? plan.desks[FALLBACK_DESK_KEY];
}

/** Where the folders go once published: the partner desk. */
export function partnerDeskKey(plan: FloorPlan): DeskKey {
  const skill = plan.partnerSkills[0];
  return skill ? deskKeyForSkill(skill) : FALLBACK_DESK_KEY;
}
