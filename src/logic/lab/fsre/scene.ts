/**
 * FSRE BUILDING — ONE FLOOR AS A SCENE. PURE, NO REACT.
 *
 * buildFloorScene turns (plan, state, selection) into everything a floor
 * draws: polygons sorted back to front, the HTML chips laid over them, the
 * real buttons that make the drawing clickable, the wall screens' content
 * and the floor tag. The component only maps these to elements, which is
 * what keeps it free of arithmetic and number literals, and what lets the
 * ten-company tests count folders without a DOM.
 *
 * Every state on a chip is glyph + word (rule 4): an agent chip says
 * "● fs-intake · Working", a folder chip "⚠ UNVR · Escalated", a pile
 * "⚠ 2 escalations". Every number goes through format.ts (rule 7).
 */
import { formatCount, formatNumber } from './format';
import {
  AGENT_FIGURE,
  CHIP_HEADROOM,
  CHIP_STAGGER_LEVELS,
  DOC_SHEET,
  FOLDER_BOX,
  FOLDER_STACK,
  HIT,
  ISSUE_BOARD,
  RACK_FIGURE,
  RING,
  WALL_FRAME,
} from './geometry';
import {
  AGENT_GLYPHS,
  AGENT_TONES,
  FOLDER_GLYPHS,
  FOLDER_TONES,
  GATE_GLYPHS,
  GATE_TONES,
  ISSUE_STATE_GLYPHS,
  ISSUE_STATE_TONES,
  PARTNER_KIND_GLYPHS,
  PARTNER_KIND_TONES,
  STAGE_GLYPHS,
  STAGE_TONES,
  type Tone,
} from './glyphs';
import {
  FLOOR_LABELS,
  FLOOR_ZONES,
  PARTNER_DESK,
  PARTNER_PILES,
  WALL_COUNTER_FIGURES,
  deskKeyForGate,
  deskKeyForSkill,
  resolveDesk,
  type DeskAnchor,
  type DeskKey,
  type FloorId,
  type FloorPlan,
  type WallContent,
} from './layout';
import {
  agentShape,
  boundsOf,
  boundsOfBox,
  boxFaces,
  floorShell,
  footprintPoints,
  glassFaces,
  monitorBoxes,
  plantShape,
  project,
  toPercentCentred,
  toPercentPoint,
  toPercentRect,
  wallPoints,
  wallRect,
  type AgentShape,
  type Box,
  type BoxFaces,
  type FloorShell,
  type PercentRect,
  type PlantShape,
  type Rect,
} from './projection';
import {
  agentStatus,
  currentStageStatus,
  effectiveStageStatus,
  folderStatus,
  foldersByDesk,
  gateAggregate,
  partnerItems,
  runTotals,
  stageAggregate,
  type CompanyState,
  type FsreContext,
  type FsreState,
} from './reducer';
import {
  AGENT_STATUSES,
  AGENT_STATUS_WORDS,
  FLOOR_TAG_WORDS,
  FOLDER_STATUS_WORDS,
  FOLDER_STATUSES,
  GATE_CHIP_WORDS,
  GATE_RESULT_WORDS,
  ISSUE_STATE_WORDS,
  PARTNER_KIND_COUNT_NOUNS,
  STAGE_STATUS_WORDS,
  UNASSIGNED_DESK_WORD,
  figureLabel,
  type AgentStatus,
  type FolderStatus,
  type PartnerItemKind,
  type StageStatus,
} from './statuses';
import type { FsreEvent } from './events';

/* ---------- selection ---------- */

export type FsreSelection =
  | { kind: 'folder'; ticker: string }
  | { kind: 'agent'; skill: string }
  | { kind: 'gate'; stageId: string }
  | { kind: 'partner' }
  | { kind: 'desk'; deskKey: DeskKey }
  /** v2: a seat of the synthetic office, by the agent at it (deskScene.ts). */
  | { kind: 'seat'; agentId: string };

export function selectionKey(selection: FsreSelection | null): string {
  if (!selection) return '';
  switch (selection.kind) {
    case 'folder':
      return `folder:${selection.ticker}`;
    case 'agent':
      return `agent:${selection.skill}`;
    case 'gate':
      return `gate:${selection.stageId}`;
    case 'partner':
      return 'partner';
    case 'desk':
      return `desk:${selection.deskKey}`;
    case 'seat':
      return `seat:${selection.agentId}`;
  }
}

/** Sinks things resting on a surface just in front of it in the painter's order. */
export const ON_TOP = 0.001;

/* ---------- scene types ---------- */

export type BoxMaterial = 'furniture' | 'monitor' | 'bench' | 'folder' | 'doc-escalation' | 'doc-proposal';

export type DrawItem =
  | { kind: 'box'; key: string; sortY: number; faces: BoxFaces; material: BoxMaterial; dim?: boolean }
  | { kind: 'rack'; key: string; sortY: number; faces: BoxFaces; slats: Array<{ x1: number; y1: number; x2: number; y2: number }> }
  | { kind: 'agent'; key: string; sortY: number; skill: string; status: AgentStatus; shape: AgentShape; dim?: boolean }
  | { kind: 'plant'; key: string; sortY: number; shape: PlantShape }
  | { kind: 'glass'; key: string; sortY: number; polygons: string[] }
  | { kind: 'folders'; key: string; sortY: number; deskKey: DeskKey; boxes: BoxFaces[] }
  | { kind: 'pile'; key: string; sortY: number; pile: PartnerItemKind; sheets: BoxFaces[] };

export interface ChipSpec {
  id: string;
  anchor: { left: string; top: string };
  tone: Tone;
  glyph: string | null;
  text: string;
  /** 0 or 1: neighbouring chips sit at different heights. */
  stagger: number;
  strong: boolean;
  /** v2 desks: lines under the state (name plate, monitor text, in-tray). */
  detail?: string[];
  /** v2: the desk belongs to another engagement than the one the building is filtered to. */
  dim?: boolean;
}

export interface HitSpec {
  id: string;
  label: string;
  selection: FsreSelection;
  rect: PercentRect;
  selected: boolean;
}

export interface StageCell {
  stageId: string;
  name: string;
  status: StageStatus;
  glyph: string;
  word: string;
  tone: Tone;
}

export interface WallEntry {
  key: string;
  label: string;
  value: string;
}

export interface IssueEntry {
  key: string;
  subject: string;
  title: string;
  glyph: string;
  word: string;
  tone: Tone;
}

export type WallBody =
  | { content: 'stages'; cells: StageCell[] }
  | { content: 'figures'; entries: WallEntry[] }
  | { content: 'issues'; entries: IssueEntry[]; more: string | null }
  | { content: 'lift'; doors: string[] }
  | { content: 'blank' };

export interface WallSpec {
  id: string;
  frame: string;
  screen: string;
  /** The screen's box over the floor, for the HTML text laid on it. */
  rect: PercentRect;
  body: WallBody;
}

export interface FloorScene {
  floorId: FloorId;
  label: string;
  shell: FloorShell;
  walls: WallSpec[];
  items: DrawItem[];
  chips: ChipSpec[];
  hits: HitSpec[];
  ring: string | null;
  tag: string[];
}

export interface SceneView {
  selection: FsreSelection | null;
  agentStatuses: Record<string, AgentStatus>;
  /** The company the stage screen and wall counter speak for; null = the whole run. */
  focusTicker: string | null;
}

/* ---------- helpers ---------- */

export function agentStatuses(ctx: FsreContext, state: FsreState): Record<string, AgentStatus> {
  return Object.fromEntries(ctx.plan.agentSkills.map((skill) => [skill, agentStatus(ctx, state, skill)]));
}

function stageNameOf(plan: FloorPlan, stageId: string): string {
  return plan.stagesById[stageId]?.name ?? stageId;
}

/** The folder status that speaks for a stack: the most urgent one in it. */
const FOLDER_URGENCY: Record<FolderStatus, number> = Object.fromEntries(
  (['in-progress', 'approved', 'published', 'returned', 'blocked', 'failed', 'escalated'] as const).map((status, index) => [status, index]),
) as Record<FolderStatus, number>;

function worstFolder(statuses: FolderStatus[]): FolderStatus {
  return statuses.reduce<FolderStatus>((acc, status) => (FOLDER_URGENCY[status] > FOLDER_URGENCY[acc] ? status : acc), 'in-progress');
}

function folderBoxes(desk: DeskAnchor, count: number): BoxFaces[] {
  const drawn = Math.min(count, FOLDER_STACK.maxDrawn);
  return Array.from({ length: drawn }, (_, index) =>
    boxFaces({
      x: desk.folderSpot.x,
      y: desk.folderSpot.y,
      w: FOLDER_BOX.w,
      d: FOLDER_BOX.d,
      h: FOLDER_BOX.h,
      z: desk.folderSpot.z + index * (FOLDER_BOX.h + FOLDER_STACK.gap),
    }),
  );
}

function stackTop(desk: DeskAnchor, count: number): number {
  const drawn = Math.min(count, FOLDER_STACK.maxDrawn);
  return desk.folderSpot.z + drawn * (FOLDER_BOX.h + FOLDER_STACK.gap);
}

function pileBox(kind: PartnerItemKind, index: number): Box {
  return {
    x: PARTNER_DESK.x + PARTNER_PILES[kind].dx,
    y: PARTNER_DESK.y + (PARTNER_DESK.d - DOC_SHEET.d) / 2,
    w: DOC_SHEET.w,
    d: DOC_SHEET.d,
    h: DOC_SHEET.h,
    z: PARTNER_DESK.h + index * (DOC_SHEET.h + DOC_SHEET.gap),
  };
}

/** A hit button's box, centred: the CSS grows it to at least 44px around the centre. */
export function hitRect(rect: Rect): PercentRect {
  return toPercentCentred(rect);
}

/* ---------- the builder ---------- */

export function buildFloorScene(ctx: FsreContext, state: FsreState, floorId: FloorId, view: SceneView): FloorScene {
  const { plan } = ctx;
  // The plan carries each floor's furniture: planFloors gives layout.ts FLOORS,
  // the department plan (v2) its own (departmentLayout.ts).
  const decorations = plan.decorations[floorId];
  const zone = FLOOR_ZONES[floorId];
  const items: DrawItem[] = [];
  const chips: ChipSpec[] = [];
  const hits: HitSpec[] = [];
  const selKey = selectionKey(view.selection);
  const focus = view.focusTicker ? state.companies[view.focusTicker] ?? null : null;

  /* decorations */
  const walls: WallSpec[] = [];
  for (const decoration of decorations) {
    switch (decoration.kind) {
      case 'plant':
        items.push({ kind: 'plant', key: decoration.id, sortY: decoration.y, shape: plantShape(decoration.x, decoration.y) });
        break;
      case 'solid':
        items.push({ kind: 'box', key: decoration.id, sortY: decoration.box.y, faces: boxFaces(decoration.box), material: 'furniture' });
        break;
      case 'rack': {
        const box = decoration.box;
        const slats = RACK_FIGURE.slatZs.map((z) => {
          const a = project(box.x + RACK_FIGURE.slatInset, box.y, z);
          const b = project(box.x + box.w - RACK_FIGURE.slatInset, box.y, z);
          return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
        });
        items.push({ kind: 'rack', key: decoration.id, sortY: box.y, faces: boxFaces(box), slats });
        break;
      }
      case 'glass': {
        const faces = glassFaces(decoration.box);
        items.push({ kind: 'glass', key: `${decoration.id}-back`, sortY: decoration.box.y + decoration.box.d, polygons: faces.back });
        items.push({ kind: 'glass', key: `${decoration.id}-front`, sortY: decoration.box.y - ON_TOP, polygons: faces.front });
        break;
      }
      case 'wall':
        walls.push(buildWall(ctx, state, decoration, focus, floorId));
        break;
    }
  }

  /* desks, agents, gate rooms */
  const deskKeys = plan.desksOnFloor[floorId];
  let agentIndex = 0;
  // Gate rooms stand side by side on a floor (3F holds two); their long
  // result chips alternate heights like the agents' so neither covers the other.
  let gateIndex = 0;
  /** Gate desk key → the level its result chip took; the room's folder chip takes the other. */
  const gateLevels = new Map<string, number>();
  for (const key of deskKeys) {
    const desk = plan.desks[key];
    if (desk.kind === 'fallback') continue; // drawn as the lobby bench decoration
    if (desk.room) {
      const faces = glassFaces(desk.room);
      items.push({ kind: 'glass', key: `${key}-room-back`, sortY: desk.room.y + desk.room.d, polygons: faces.back });
      items.push({ kind: 'glass', key: `${key}-room-front`, sortY: desk.room.y - ON_TOP, polygons: faces.front });
    }
    // The partner desk is the room's furniture, drawn once below whoever signs off.
    if (desk.kind !== 'partner') {
      items.push({ kind: 'box', key: `${key}-surface`, sortY: desk.surface.y, faces: boxFaces(desk.surface), material: 'furniture' });
      if (desk.monitor) {
        monitorBoxes(desk.surface).forEach((box, index) =>
          items.push({ kind: 'box', key: `${key}-monitor-${index}`, sortY: desk.surface.y - ON_TOP, faces: boxFaces(box), material: 'monitor' }),
        );
      }
    }
    if (desk.agentSpot && desk.skill) {
      const skill = desk.skill;
      const status = view.agentStatuses[skill] ?? 'idle';
      const spot = desk.agentSpot;
      items.push({ kind: 'agent', key: `agent:${skill}`, sortY: spot.y, skill, status, shape: agentShape(spot.x, spot.y) });
      chips.push({
        id: `agent:${skill}`,
        anchor: toPercentPoint(project(spot.x, spot.y, CHIP_HEADROOM.agent)),
        tone: AGENT_TONES[status],
        glyph: AGENT_GLYPHS[status],
        text: `${skill} · ${AGENT_STATUS_WORDS[status]}`,
        // In the partner room the two document piles' chips take both levels
        // right below whoever signs off; that agent's chip goes on the upper one.
        stagger: desk.kind === 'partner' ? 1 : agentIndex % CHIP_STAGGER_LEVELS,
        strong: false,
      });
      agentIndex += 1;
      hits.push({
        id: `agent:${skill}`,
        label: `${skill}, agent, ${AGENT_STATUS_WORDS[status]}`,
        selection: { kind: 'agent', skill },
        selected: selKey === `agent:${skill}`,
        rect: hitRect(
          boundsOf([
            project(spot.x - HIT.agentHalfWidth, spot.y + HIT.agentHalfDepth, 0),
            project(spot.x + HIT.agentHalfWidth, spot.y + HIT.agentHalfDepth, 0),
            project(spot.x - HIT.agentHalfWidth, spot.y - HIT.agentHalfDepth, HIT.agentHeight),
            project(spot.x + HIT.agentHalfWidth, spot.y - HIT.agentHalfDepth, HIT.agentHeight),
          ]),
        ),
      });
    }
    if (desk.kind === 'vacant') {
      // A staff desk nobody holds (v2): its name plate and "Idle, no
      // assignment", never a state an event did not give it.
      const spot = { x: desk.surface.x + desk.surface.w / 2, y: desk.surface.y + AGENT_FIGURE.behindDesk };
      chips.push({
        id: key,
        anchor: toPercentPoint(project(spot.x, spot.y, CHIP_HEADROOM.agent)),
        tone: AGENT_TONES.idle,
        glyph: AGENT_GLYPHS.idle,
        text: `${desk.title ?? ''} · ${UNASSIGNED_DESK_WORD}`,
        stagger: agentIndex % CHIP_STAGGER_LEVELS,
        strong: false,
      });
      agentIndex += 1;
    }
    if (desk.kind === 'gate' && desk.stageId && desk.room) {
      const stageId = desk.stageId;
      const result = gateAggregate(state, stageId);
      const room = desk.room;
      chips.push({
        id: `gate:${stageId}`,
        anchor: toPercentPoint(project(room.x + room.w / 2, room.y, room.h + CHIP_HEADROOM.gate)),
        tone: GATE_TONES[result],
        glyph: GATE_GLYPHS[result],
        text: `${stageNameOf(plan, stageId)}: ${GATE_CHIP_WORDS[result]}`,
        stagger: gateIndex % CHIP_STAGGER_LEVELS,
        strong: false,
      });
      gateLevels.set(key, gateIndex % CHIP_STAGGER_LEVELS);
      gateIndex += 1;
      hits.push({
        id: `gate:${stageId}`,
        label: `${stageNameOf(plan, stageId)} gate room, ${GATE_RESULT_WORDS[result]}`,
        selection: { kind: 'gate', stageId },
        selected: selKey === `gate:${stageId}`,
        rect: hitRect(boundsOfBox(room)),
      });
    }
  }

  /* the partner room: its desk, the document piles and the room's button (before the folders, so a folder resting on the desk stays clickable above it) */
  if (zone === 'partner') {
    items.push({ kind: 'box', key: 'partner-desk', sortY: PARTNER_DESK.y, faces: boxFaces(PARTNER_DESK), material: 'furniture' });
    const open = partnerItems(state).filter((item) => item.state === 'open');
    for (const kind of ['escalation', 'proposal'] as const) {
      const count = open.filter((item) => item.kind === kind).length;
      if (count === 0) continue;
      const drawn = Math.min(count, DOC_SHEET.maxDrawn);
      items.push({
        kind: 'pile',
        key: `pile:${kind}`,
        sortY: PARTNER_DESK.y - ON_TOP,
        pile: kind,
        sheets: Array.from({ length: drawn }, (_, index) => boxFaces(pileBox(kind, index))),
      });
      const top = pileBox(kind, drawn);
      const nouns = PARTNER_KIND_COUNT_NOUNS[kind];
      chips.push({
        id: `pile:${kind}`,
        anchor: toPercentPoint(project(top.x + top.w / 2, top.y + top.d / 2, (top.z ?? 0) + CHIP_HEADROOM.doc)),
        tone: PARTNER_KIND_TONES[kind],
        glyph: PARTNER_KIND_GLYPHS[kind],
        text: `${formatCount(count, nouns.one, nouns.many)}${count > drawn ? ` (+${formatNumber(count - drawn)} not drawn)` : ''}`,
        stagger: kind === 'proposal' ? 1 : 0,
        strong: false,
      });
    }
    const chair = decorations.find((d) => d.kind === 'solid' && d.id === 'partner-chair');
    const deskRect = boundsOfBox(PARTNER_DESK);
    const chairRect = chair && chair.kind === 'solid' ? boundsOfBox(chair.box) : deskRect;
    const left = Math.min(deskRect.left, chairRect.left);
    const top = Math.min(deskRect.top, chairRect.top);
    const openCount = open.length;
    hits.push({
      id: 'partner-room',
      label: `Partner room, ${formatCount(openCount, 'item')} waiting`,
      selection: { kind: 'partner' },
      selected: selKey === 'partner',
      rect: hitRect({
        left,
        top,
        width: Math.max(deskRect.left + deskRect.width, chairRect.left + chairRect.width) - left,
        height: Math.max(deskRect.top + deskRect.height, chairRect.top + chairRect.height) - top,
      }),
    });
  }

  /* folders, grouped per desk */
  const byDesk = foldersByDesk(state);
  for (const [deskKey, tickers] of Object.entries(byDesk)) {
    const desk = resolveDesk(plan, deskKey);
    if (desk.floorId !== floorId) continue;
    const companies = tickers.map((ticker) => state.companies[ticker]);
    const statuses = companies.map((company) => folderStatus(state, company));
    const worst = worstFolder(statuses);
    items.push({ kind: 'folders', key: `folders:${desk.key}`, sortY: desk.surface.y - ON_TOP, deskKey: desk.key, boxes: folderBoxes(desk, tickers.length) });
    const single = tickers.length === 1 ? companies[0] : null;
    const worstCount = statuses.filter((status) => status === worst).length;
    chips.push({
      id: `folders:${desk.key}`,
      anchor: toPercentPoint(
        project(desk.folderSpot.x + FOLDER_BOX.w / 2, desk.folderSpot.y + FOLDER_BOX.d / 2, stackTop(desk, tickers.length) + CHIP_HEADROOM.folder),
      ),
      tone: FOLDER_TONES[worst],
      glyph: FOLDER_GLYPHS[worst],
      text: single
        ? `${single.ticker} · ${FOLDER_STATUS_WORDS[worst]}`
        : `${formatCount(tickers.length, 'folder')} · ${formatNumber(worstCount)} ${FOLDER_STATUS_WORDS[worst].toLowerCase()}`,
      // In a gate room the result chip stands at the same height: take the other level.
      stagger: gateLevels.has(desk.key) ? ((gateLevels.get(desk.key) ?? 0) + 1) % CHIP_STAGGER_LEVELS : 0,
      strong: true,
    });
    // A stack reads as pressed when the desk, or any folder in it, is selected.
    const selected = selKey === `desk:${desk.key}` || tickers.some((ticker) => selKey === `folder:${ticker}`);
    hits.push({
      id: `folders:${desk.key}`,
      label: single
        ? `${single.ticker} folder, ${FOLDER_STATUS_WORDS[worst]}`
        : `${formatCount(tickers.length, 'folder')} at this desk: ${tickers.join(', ')}`,
      selection: single ? { kind: 'folder', ticker: single.ticker } : { kind: 'desk', deskKey: desk.key },
      selected,
      rect: hitRect(
        boundsOfBox({
          x: desk.folderSpot.x - HIT.folderPad,
          y: desk.folderSpot.y - HIT.folderPad,
          w: FOLDER_BOX.w + HIT.folderPad * 2,
          d: FOLDER_BOX.d + HIT.folderPad * 2,
          h: stackTop(desk, tickers.length) - desk.folderSpot.z + HIT.folderHeadroom,
          z: desk.folderSpot.z,
        }),
      ),
    });
  }

  items.sort((a, b) => b.sortY - a.sortY);

  return {
    floorId,
    label: FLOOR_LABELS[floorId],
    shell: floorShell(),
    walls,
    items,
    chips,
    // Tab order within a floor: agents, gate rooms, the partner room, then
    // the folders resting on desks (last, so they also sit on top).
    hits,
    ring: selectionRing(ctx, state, floorId, view.selection),
    tag: floorTag(ctx, state, floorId, view),
  };
}

/** A wall feature's frame and screen, before anything is written on it. */
export function wallGeometry(wall: { id: string; x0: number; x1: number; z0: number; z1: number }): Omit<WallSpec, 'body'> {
  const inner = { x0: wall.x0 + WALL_FRAME.insetX, x1: wall.x1 - WALL_FRAME.insetX, z0: wall.z0 + WALL_FRAME.insetZ, z1: wall.z1 - WALL_FRAME.insetZ };
  return {
    id: wall.id,
    frame: wallPoints(wall.x0, wall.x1, wall.z0, wall.z1),
    screen: wallPoints(inner.x0, inner.x1, inner.z0, inner.z1),
    rect: toPercentRect(wallRect(inner.x0, inner.x1, inner.z0, inner.z1)),
  };
}

/** The lift's two doors inside its frame. */
export function liftDoors(wall: { x0: number; x1: number; z0: number; z1: number }): string[] {
  const inner = { x0: wall.x0 + WALL_FRAME.insetX, x1: wall.x1 - WALL_FRAME.insetX, z0: wall.z0 + WALL_FRAME.insetZ, z1: wall.z1 - WALL_FRAME.insetZ };
  const middle = (wall.x0 + wall.x1) / 2;
  return [wallPoints(inner.x0, middle - WALL_FRAME.insetX / 2, inner.z0, inner.z1), wallPoints(middle + WALL_FRAME.insetX / 2, inner.x1, inner.z0, inner.z1)];
}

function buildWall(
  ctx: FsreContext,
  state: FsreState,
  wall: { id: string; content: WallContent; x0: number; x1: number; z0: number; z1: number },
  focus: CompanyState | null,
  floorId: FloorId,
): WallSpec {
  const inner = { x0: wall.x0 + WALL_FRAME.insetX, x1: wall.x1 - WALL_FRAME.insetX, z0: wall.z0 + WALL_FRAME.insetZ, z1: wall.z1 - WALL_FRAME.insetZ };
  const base = {
    id: wall.id,
    frame: wallPoints(wall.x0, wall.x1, wall.z0, wall.z1),
    screen: wallPoints(inner.x0, inner.x1, inner.z0, inner.z1),
    rect: toPercentRect(wallRect(inner.x0, inner.x1, inner.z0, inner.z1)),
  };
  switch (wall.content) {
    case 'stages':
      return { ...base, body: { content: 'stages', cells: stageCells(ctx, state, focus) } };
    case 'figures':
      return { ...base, body: { content: 'figures', entries: wallFigures(state, focus) } };
    case 'issues': {
      const entries = openIssuesOnFloor(ctx, state, floorId);
      const hidden = entries.length - ISSUE_BOARD.maxShown;
      return { ...base, body: { content: 'issues', entries: entries.slice(0, ISSUE_BOARD.maxShown), more: hidden > 0 ? `and ${formatNumber(hidden)} more` : null } };
    }
    case 'lift': {
      const middle = (wall.x0 + wall.x1) / 2;
      return {
        ...base,
        body: {
          content: 'lift',
          doors: [wallPoints(inner.x0, middle - WALL_FRAME.insetX / 2, inner.z0, inner.z1), wallPoints(middle + WALL_FRAME.insetX / 2, inner.x1, inner.z0, inner.z1)],
        },
      };
    }
    default:
      return { ...base, body: { content: 'blank' } };
  }
}

/** The stage screen: the focused company's statuses, or the worst across the run. */
export function stageCells(ctx: FsreContext, state: FsreState, focus: CompanyState | null): StageCell[] {
  return ctx.plan.stageOrder.map((stageId) => {
    const status = focus ? effectiveStageStatus(focus, stageId) : stageAggregate(state, stageId);
    return {
      stageId,
      name: stageNameOf(ctx.plan, stageId),
      status,
      glyph: STAGE_GLYPHS[status],
      word: STAGE_STATUS_WORDS[status],
      tone: STAGE_TONES[status],
    };
  });
}

/** The B1 counter: run totals summed from the companies, or the focused company's own. Empty before any figure arrives. */
export function wallFigures(state: FsreState, focus: CompanyState | null): WallEntry[] {
  const totals = runTotals(state, focus ? [focus.ticker] : state.companyOrder).figures;
  return WALL_COUNTER_FIGURES.filter((key) => totals[key]).map((key) => ({ key, label: figureLabel(key), value: formatNumber(totals[key].value) }));
}

/** Open review issues at stages worked on this floor, newest first. */
export function openIssuesOnFloor(ctx: FsreContext, state: FsreState, floorId: FloorId): IssueEntry[] {
  const onFloor = (stageId: string | null) => {
    if (!stageId) return false;
    const runner = ctx.plan.stageRunners[stageId]?.[0];
    return runner ? ctx.plan.floorOfSkill[runner] === floorId : false;
  };
  const issues = [
    ...state.companyOrder.flatMap((ticker) => state.companies[ticker].issues),
    ...state.runLevel.issues,
  ].filter((issue) => issue.state === 'open' && onFloor(issue.stageId));
  return issues.reverse().map((issue) => ({
    key: `${issue.ticker ?? 'run'}:${issue.eventId}`,
    subject: issue.ticker ?? 'Run',
    title: issue.title,
    glyph: ISSUE_STATE_GLYPHS[issue.state],
    word: ISSUE_STATE_WORDS[issue.state],
    tone: ISSUE_STATE_TONES[issue.state],
  }));
}

function selectionRing(ctx: FsreContext, state: FsreState, floorId: FloorId, selection: FsreSelection | null): string | null {
  if (!selection) return null;
  const { plan } = ctx;
  const ringAroundFolders = (desk: DeskAnchor) =>
    desk.floorId === floorId
      ? footprintPoints(
          { x: desk.folderSpot.x - RING.folderPad, y: desk.folderSpot.y - RING.folderPad, w: FOLDER_BOX.w + RING.folderPad * 2, d: FOLDER_BOX.d + RING.folderPad * 2 },
          desk.folderSpot.z,
        )
      : null;
  switch (selection.kind) {
    case 'agent': {
      const desk = plan.desks[deskKeyForSkill(selection.skill)];
      if (!desk || desk.floorId !== floorId || !desk.agentSpot) return null;
      const spot = desk.agentSpot;
      return footprintPoints({ x: spot.x - RING.agentHalfWidth, y: spot.y - RING.agentFront, w: RING.agentHalfWidth * 2, d: RING.agentDepth }, RING.lift);
    }
    case 'folder': {
      const company = state.companies[selection.ticker];
      return company?.deskKey ? ringAroundFolders(resolveDesk(plan, company.deskKey)) : null;
    }
    case 'desk':
      return ringAroundFolders(resolveDesk(plan, selection.deskKey));
    case 'gate': {
      const desk = plan.desks[deskKeyForGate(selection.stageId)];
      if (!desk || desk.floorId !== floorId || !desk.room) return null;
      return footprintPoints({ x: desk.room.x, y: desk.room.y, w: desk.room.w, d: desk.room.d }, RING.lift);
    }
    case 'seat':
      // The synthetic office draws its own rings (deskScene.ts).
      return null;
    case 'partner':
      return FLOOR_ZONES[floorId] === 'partner'
        ? footprintPoints(
            { x: PARTNER_DESK.x - RING.deskPadX, y: PARTNER_DESK.y - RING.deskPadFront, w: PARTNER_DESK.w + RING.deskPadX * 2, d: PARTNER_DESK.d + RING.deskPadBack },
            RING.lift,
          )
        : null;
  }
}

/** "3F Review, 1 escalated" — the floor's busy agents counted by status, or the partner room's open items. */
function floorTag(ctx: FsreContext, state: FsreState, floorId: FloorId, view: SceneView): string[] {
  const parts = [FLOOR_LABELS[floorId]];
  if (FLOOR_ZONES[floorId] === 'partner') {
    const open = partnerItems(state).filter((item) => item.state === 'open');
    for (const kind of ['escalation', 'proposal'] as const) {
      const count = open.filter((item) => item.kind === kind).length;
      if (count > 0) parts.push(formatCount(count, PARTNER_KIND_COUNT_NOUNS[kind].one, PARTNER_KIND_COUNT_NOUNS[kind].many));
    }
    return parts;
  }
  const agents = ctx.plan.skillsOnFloor[floorId].filter((skill) => ctx.plan.agentSkills.includes(skill));
  // Idle is the resting state, not news: counting it would put a number on
  // an untouched building ("4 idle") that no event produced. Each agent's
  // own chip still says Idle.
  for (const status of AGENT_STATUSES.filter((s) => s !== 'idle')) {
    const count = agents.filter((skill) => (view.agentStatuses[skill] ?? 'idle') === status).length;
    // Status words do not pluralise: "2 idle", never "2 idles".
    const word = AGENT_STATUS_WORDS[status].toLowerCase();
    if (count > 0) parts.push(formatCount(count, word, word));
  }
  const vacant = ctx.plan.desksOnFloor[floorId].filter((key) => ctx.plan.desks[key]?.kind === 'vacant').length;
  if (vacant > 0) parts.push(`${formatNumber(vacant)} ${FLOOR_TAG_WORDS.unstaffed}`);
  return parts;
}

/* ---------- what an event touched (for motion) ---------- */

export interface Touched {
  /** Chip ids that changed with this event; they flash once. */
  chips: Set<string>;
  /** A desk a folder just arrived at from another floor; its stack slides in. */
  arrivals: Set<DeskKey>;
}

/**
 * Motion only ever follows an event: compare the states either side of the
 * last applied event and name what it moved. Nothing here runs on a timer.
 */
export function touchedBy(ctx: FsreContext, before: FsreState, after: FsreState, event: FsreEvent | null): Touched {
  const chips = new Set<string>();
  const arrivals = new Set<DeskKey>();
  if (!event || before === after) return { chips, arrivals };
  for (const skill of ctx.plan.agentSkills) {
    if (agentStatus(ctx, before, skill) !== agentStatus(ctx, after, skill)) chips.add(`agent:${skill}`);
  }
  if (event.stageId && ctx.plan.gateStageIds.includes(event.stageId)) chips.add(`gate:${event.stageId}`);
  if (event.ticker) {
    const was = before.companies[event.ticker];
    const now = after.companies[event.ticker];
    if (now?.deskKey) {
      chips.add(`folders:${now.deskKey}`);
      const from = was?.deskKey ? resolveDesk(ctx.plan, was.deskKey).floorId : null;
      if (from !== resolveDesk(ctx.plan, now.deskKey).floorId) arrivals.add(now.deskKey);
    }
  }
  if (before.partnerOrder !== after.partnerOrder || partnerItems(before).length !== partnerItems(after).length) {
    chips.add('pile:escalation');
    chips.add('pile:proposal');
  }
  return { chips, arrivals };
}

/** The folder status words in their list order, for the legend. */
export const FOLDER_LEGEND: ReadonlyArray<{ status: FolderStatus; glyph: string; word: string; tone: Tone }> = FOLDER_STATUSES.map((status) => ({
  status,
  glyph: FOLDER_GLYPHS[status],
  word: FOLDER_STATUS_WORDS[status],
  tone: FOLDER_TONES[status],
}));

export const AGENT_LEGEND: ReadonlyArray<{ status: AgentStatus; glyph: string; word: string; tone: Tone }> = AGENT_STATUSES.map((status) => ({
  status,
  glyph: AGENT_GLYPHS[status],
  word: AGENT_STATUS_WORDS[status],
  tone: AGENT_TONES[status],
}));

/** The company a stage screen and counter should speak for, given the selection. */
export function focusTickerOf(selection: FsreSelection | null): string | null {
  return selection?.kind === 'folder' ? selection.ticker : null;
}

/** For a folder panel heading: where the company is, as words. */
export function whereIs(ctx: FsreContext, company: CompanyState): { stage: string | null; status: StageStatus } {
  return { stage: company.stageId ? stageNameOf(ctx.plan, company.stageId) : null, status: currentStageStatus(company) };
}
