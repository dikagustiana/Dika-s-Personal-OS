/**
 * FSRE BUILDING v2 — ONE FLOOR OF THE SYNTHETIC OFFICE, AS A SCENE.
 *
 * The replay's floors come from buildFloorScene (scene.ts) over the
 * department plan; the synthetic office's come from here, over the desk views
 * of the live state (deskViews.ts). Both return the same FloorScene, so one
 * component (FsreFloor) draws both, coloured only by index.css classes.
 *
 * A desk: the desk and its monitor, the person at it (when somebody sits
 * there), the in-tray when it holds anything, and one chip: the state as
 * glyph + word, then the name plate (title · ticker), the monitor's few
 * words and the in-tray count. A staffed desk is a named button; a vacant one
 * is drawn and labelled, never pressable. Nothing here moves on its own: the
 * one flash per event is FsreFloor's, keyed to the event that touched the desk.
 */
import { agentShape, boundsOf, boundsOfBox, boxFaces, floorShell, footprintPoints, glassFaces, monitorBoxes, plantShape, project, toPercentPoint, type Box } from './projection';
import { DEPARTMENT_FLOORS } from './departmentLayout';
import { floorTagParts, type DeskView, type FloorDesks } from './deskViews';
import { formatCount, formatNumber } from './format';
import { AGENT_FIGURE, CHIP_HEADROOM, HIT, RACK_FIGURE, RING } from './geometry';
import { DESK_FIGURE_STATUS } from './glyphs';
import { FLOOR_LABELS, PARTNER_DESK, type FloorId } from './layout';
import { ON_TOP, chipLevel, hitRect, liftDoors, selectionKey, wallGeometry, type ChipSpec, type DrawItem, type FloorScene, type FsreSelection, type HitSpec, type PlacedChip, type WallSpec } from './scene';
import { IN_TRAY_WORD, OTHER_WORK_WORD } from './statuses';

/** The in-tray: a short stack of sheets on the desk's right-hand corner. */
const IN_TRAY = { insetX: 0.25, insetY: 0.2, w: 0.55, d: 0.4, sheet: 0.05, maxSheets: 4 } as const;

export interface DeskSceneView {
  selection: FsreSelection | null;
  /** The header bell's count, which the partner room's button repeats (FX-7). */
  partnerWaiting: number;
}

function trayBox(surface: Box, count: number): Box {
  const sheets = Math.min(count, IN_TRAY.maxSheets);
  return {
    x: surface.x + surface.w - IN_TRAY.w - IN_TRAY.insetX,
    y: surface.y + IN_TRAY.insetY,
    w: IN_TRAY.w,
    d: IN_TRAY.d,
    h: sheets * IN_TRAY.sheet,
    z: (surface.z ?? 0) + surface.h,
  };
}

function plateText(desk: DeskView): string {
  return desk.ticker ? `${desk.title} · ${desk.ticker}` : desk.title;
}

/**
 * The chip's state line: the state, and the in-tray when it holds anything.
 * Two lines in all, so a back-row desk's chip stays on its own floor: the
 * state line, then the name plate with the monitor's few words after it.
 */
function stateLine(desk: DeskView): string {
  return desk.trayCount > 0 ? `${desk.stateWord} · ${IN_TRAY_WORD} ${formatNumber(desk.trayCount)}` : desk.stateWord;
}

/**
 * The name plate with the monitor's words after it. On a desk of another
 * engagement while the building is filtered, the dim label takes the
 * monitor's place, so every chip stays two lines.
 */
function detailLines(desk: DeskView): string[] {
  if (desk.dimLabel) return [`${plateText(desk)} · ${OTHER_WORK_WORD} ${desk.dimLabel}`];
  return [desk.monitorText ? `${plateText(desk)} — ${desk.monitorText}` : plateText(desk)];
}

function walls(floorId: FloorId): WallSpec[] {
  // The synthetic office writes nothing on the walls: the stage screen, the
  // counter and the issue board belong to the replay (scene.ts).
  return DEPARTMENT_FLOORS[floorId].decorations.flatMap((decoration) => {
    if (decoration.kind !== 'wall') return [];
    const geometry = wallGeometry(decoration);
    return [decoration.content === 'lift' ? { ...geometry, body: { content: 'lift', doors: liftDoors(decoration) } } : { ...geometry, body: { content: 'blank' } }];
  });
}

function decorationItems(floorId: FloorId): DrawItem[] {
  return DEPARTMENT_FLOORS[floorId].decorations.flatMap((decoration): DrawItem[] => {
    switch (decoration.kind) {
      case 'plant':
        return [{ kind: 'plant', key: decoration.id, sortY: decoration.y, shape: plantShape(decoration.x, decoration.y) }];
      case 'solid':
        return [{ kind: 'box', key: decoration.id, sortY: decoration.box.y, faces: boxFaces(decoration.box), material: 'furniture' }];
      case 'rack': {
        const box = decoration.box;
        const slats = RACK_FIGURE.slatZs.map((z) => {
          const a = project(box.x + RACK_FIGURE.slatInset, box.y, z);
          const b = project(box.x + box.w - RACK_FIGURE.slatInset, box.y, z);
          return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
        });
        return [{ kind: 'rack', key: decoration.id, sortY: box.y, faces: boxFaces(box), slats }];
      }
      case 'glass': {
        const faces = glassFaces(decoration.box);
        return [
          { kind: 'glass', key: `${decoration.id}-back`, sortY: decoration.box.y + decoration.box.d, polygons: faces.back },
          { kind: 'glass', key: `${decoration.id}-front`, sortY: decoration.box.y - ON_TOP, polygons: faces.front },
        ];
      }
      case 'wall':
        return [];
    }
  });
}

function deskHitLabel(desk: DeskView): string {
  return `${plateText(desk)} desk, ${desk.stateWord}`;
}

export function buildDeskFloorScene(floorId: FloorId, floor: FloorDesks, view: DeskSceneView): FloorScene {
  const items: DrawItem[] = decorationItems(floorId);
  const chips: ChipSpec[] = [];
  const hits: HitSpec[] = [];
  const selKey = selectionKey(view.selection);
  let ring: string | null = null;

  // Left to right: neighbours alternate chip levels and the buttons tab in reading order.
  // A lead's chip stays on the lower level, in the front row's own band (FX-11).
  const byPosition = [...floor.desks].sort((a, b) => a.seat.surface.x - b.seat.surface.x);
  const placed: PlacedChip[] = [];
  byPosition.forEach((desk) => {
    const surface = desk.seat.surface;
    const dim = desk.dimLabel !== null;
    const spot = { x: surface.x + surface.w / 2, y: surface.y + AGENT_FIGURE.behindDesk };
    // The partner room's desk is the room's furniture; every other seat draws its own.
    if (desk.seatKind !== 'partner') {
      items.push({ kind: 'box', key: `${desk.deskId}-surface`, sortY: surface.y, faces: boxFaces(surface), material: 'furniture', dim });
      if (desk.seat.monitor) {
        monitorBoxes(surface).forEach((box, n) =>
          items.push({ kind: 'box', key: `${desk.deskId}-monitor-${n}`, sortY: surface.y - ON_TOP, faces: boxFaces(box), material: 'monitor', dim }),
        );
      }
    }
    if (desk.trayCount > 0) {
      items.push({ kind: 'box', key: `${desk.deskId}-tray`, sortY: surface.y - ON_TOP, faces: boxFaces(trayBox(surface, desk.trayCount)), material: 'folder', dim });
    }
    if (desk.agentId) {
      items.push({ kind: 'agent', key: `person:${desk.agentId}`, sortY: spot.y, skill: desk.agentId, status: DESK_FIGURE_STATUS[desk.state], shape: agentShape(spot.x, spot.y), dim });
    }
    const lead = desk.seatKind === 'lead';
    const level = lead ? 0 : chipLevel(placed, spot.x, spot.y);
    placed.push({ x: spot.x, y: spot.y, level });
    chips.push({
      id: desk.deskId,
      anchor: toPercentPoint(project(spot.x, spot.y, CHIP_HEADROOM.agent)),
      tone: desk.tone,
      glyph: desk.glyph,
      text: stateLine(desk),
      stagger: level,
      strong: lead,
      detail: detailLines(desk),
      dim,
      lead,
    });
    if (!desk.agentId) return;
    const selection: FsreSelection = { kind: 'seat', agentId: desk.agentId };
    const selected = selKey === selectionKey(selection);
    hits.push({
      id: desk.deskId,
      label: deskHitLabel(desk),
      selection,
      selected,
      rect: hitRect(
        boundsOf([
          project(spot.x - HIT.agentHalfWidth, spot.y + HIT.agentHalfDepth, 0),
          project(spot.x + HIT.agentHalfWidth, spot.y + HIT.agentHalfDepth, 0),
          project(spot.x - HIT.agentHalfWidth, spot.y - HIT.agentHalfDepth, HIT.agentHeight),
          project(spot.x + HIT.agentHalfWidth, spot.y - HIT.agentHalfDepth, HIT.agentHeight),
        ]),
      ),
    });
    if (selected) ring = footprintPoints({ x: spot.x - RING.agentHalfWidth, y: spot.y - RING.agentFront, w: RING.agentHalfWidth * 2, d: RING.agentDepth }, RING.lift);
  });

  if (floorId === 'f4') {
    items.push({ kind: 'box', key: 'partner-desk', sortY: PARTNER_DESK.y, faces: boxFaces(PARTNER_DESK), material: 'furniture' });
    hits.push({
      id: 'partner-room',
      label: `Partner room, ${formatCount(view.partnerWaiting, 'item')} waiting`,
      selection: { kind: 'partner' },
      selected: selKey === 'partner',
      rect: hitRect(boundsOfBox(PARTNER_DESK)),
    });
    if (selKey === 'partner') {
      ring = footprintPoints(
        { x: PARTNER_DESK.x - RING.deskPadX, y: PARTNER_DESK.y - RING.deskPadFront, w: PARTNER_DESK.w + RING.deskPadX * 2, d: PARTNER_DESK.d + RING.deskPadBack },
        RING.lift,
      );
    }
  }

  items.sort((a, b) => b.sortY - a.sortY);
  return {
    floorId,
    label: FLOOR_LABELS[floorId],
    shell: floorShell(),
    walls: walls(floorId),
    items,
    chips,
    hits,
    ring,
    tag: [FLOOR_LABELS[floorId], ...floorTagParts(floor.desks, floor.hidden)],
  };
}
