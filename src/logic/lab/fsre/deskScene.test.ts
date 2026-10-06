/**
 * One floor of the synthetic office as a scene (deskScene.ts): chips carry
 * glyph + word + name plate, staffed desks are named buttons, vacant ones
 * are drawn and labelled but never pressable, and the partner room's button
 * repeats the bell's count.
 */
import { describe, expect, it } from 'vitest';
import type { Agent, AgentEvent } from '../../../data/fsreTransport/contract';
import { buildDeskFloorScene } from './deskScene';
import { AGENT_FIGURE, BUILDING_MIN_PX, CHIP_CSS, CHIP_HEADROOM, FLOOR_SVG, HIT } from './geometry';
import { boundsOf, project } from './projection';
import type { ChipSpec } from './scene';
import type { DeskView } from './deskViews';
import { applyDimming, syntheticDeskViews } from './deskViews';
import { createInitialLiveState, reduceAgentEvent } from './liveReducer';
import { DESK_STATE_WORDS, UNASSIGNED_DESK_WORD } from './statuses';

const NOW = '2026-10-06T09:20:00.000Z';
const ROSTER: Agent[] = [
  { id: 'data-lead', role: 'lead', departmentId: 'data', title: 'Data lead', skills: [], assignedTicker: null },
  { id: 'data-staff-a', role: 'staff', departmentId: 'data', title: 'Data staff', skills: [], assignedTicker: 'SYNA' },
  { id: 'data-staff-b', role: 'staff', departmentId: 'data', title: 'Data staff', skills: [], assignedTicker: 'SYNB' },
  { id: 'owner', role: 'owner', departmentId: null, title: 'Owner', skills: [], assignedTicker: null },
];

function event(patch: Partial<AgentEvent>): AgentEvent {
  return { id: 'e1', seq: 1, at: '2026-10-06T09:19:00.000Z', agentId: 'data-staff-a', engagementId: 'eng-1', ticker: 'SYNA', stageId: 'intake', type: 'task_started', summary: 'Loading SYNA facts', sourceRef: null, counts: null, waitingOn: null, commandId: null, escalationId: null, ...patch };
}

describe('a synthetic floor as a scene', () => {
  const state = reduceAgentEvent(createInitialLiveState(ROSTER), event({}));
  const views = syntheticDeskViews(state, ROSTER, NOW);
  const b1 = buildDeskFloorScene('b1', views.b1, { selection: null, partnerWaiting: 0 });

  it('writes every desk’s state as glyph + word, with its name plate and the monitor’s words', () => {
    const chip = b1.chips.find((c) => c.id === 'desk:data-staff-a');
    expect(chip?.glyph).toBeTruthy();
    expect(chip?.text).toBe(DESK_STATE_WORDS.working);
    expect(chip?.detail?.join(' ')).toContain('Data staff · SYNA');
    expect(chip?.detail?.join(' ')).toContain('Loading SYNA facts');
  });

  it('makes each staffed desk a named button, and the vacant desk none', () => {
    expect(b1.hits.map((h) => h.label)).toEqual(expect.arrayContaining(['Data lead desk, Idle', 'Data staff · SYNA desk, Working', 'Data staff · SYNB desk, Idle']));
    const vacant = b1.chips.filter((c) => c.text === UNASSIGNED_DESK_WORD);
    expect(vacant).toHaveLength(1);
    expect(b1.hits.some((h) => h.id === vacant[0].id)).toBe(false);
  });

  it('counts the floor in its tag, the vacant desk as unstaffed', () => {
    expect(b1.tag).toEqual(['B1 Data', '1 working', '2 idle', '1 unstaffed']);
  });

  it('rings the selected seat and only that one', () => {
    const selected = buildDeskFloorScene('b1', views.b1, { selection: { kind: 'seat', agentId: 'data-staff-a' }, partnerWaiting: 0 });
    expect(selected.ring).not.toBeNull();
    expect(selected.hits.filter((h) => h.selected).map((h) => h.id)).toEqual(['desk:data-staff-a']);
    expect(b1.ring).toBeNull();
  });

  it('gives the partner room a button that repeats the bell’s count', () => {
    const f4 = buildDeskFloorScene('f4', views.f4, { selection: null, partnerWaiting: 1 });
    expect(f4.hits.find((h) => h.id === 'partner-room')?.label).toBe('Partner room, 1 item waiting');
    expect(f4.chips.some((c) => c.id === 'desk:owner')).toBe(true);
  });

  it('dims and labels desks of another engagement when the building is filtered', () => {
    const dimmed = applyDimming(views, [], 'eng-other');
    const scene = buildDeskFloorScene('b1', dimmed.b1, { selection: null, partnerWaiting: 0 });
    const chip = scene.chips.find((c) => c.id === 'desk:data-staff-a');
    expect(chip?.dim).toBe(true);
    expect(chip?.detail?.join(' ')).toContain('other work: SYNA');
  });
});

/* ---------- FX-11 on screen ---------- */

/**
 * Leads read as leads by position, checked where it matters: on screen. The
 * scene's chip anchors are turned into the rectangles the CSS draws (chip
 * sizes from CHIP_CSS, at the building's narrowest width, where a chip is
 * largest against the drawing), and the lead's chip must meet no staff desk,
 * staff person or staff chip, nor any staff chip the lead's desk.
 */
describe('a lead’s chip on screen (FX-11)', () => {
  const svgPerPx = FLOOR_SVG.width / BUILDING_MIN_PX;
  const chipHeight = (CHIP_CSS.lines * CHIP_CSS.minFontPx * CHIP_CSS.lineHeight + 2 * CHIP_CSS.borderPx) * svgPerPx;
  const staffChipWidth = (CHIP_CSS.detailMaxPx + 2 * CHIP_CSS.paddingXPx + 2 * CHIP_CSS.borderPx) * svgPerPx;
  const leadChipWidth = CHIP_CSS.leadMaxPx * svgPerPx;
  const gap = CHIP_CSS.staggerGapEm * CHIP_CSS.minFontPx * svgPerPx;

  type R = { left: number; top: number; right: number; bottom: number };
  const meets = (a: R, b: R) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const anchorOf = (chip: ChipSpec) => ({ x: (parseFloat(chip.anchor.left) / 100) * FLOOR_SVG.width, y: (parseFloat(chip.anchor.top) / 100) * FLOOR_SVG.height });
  function chipRect(chip: ChipSpec, width: number): R {
    const { x, y } = anchorOf(chip);
    const bottom = chip.stagger ? y - chipHeight - gap : y;
    return { left: x - width / 2, right: x + width / 2, top: bottom - chipHeight, bottom };
  }
  /** A seat on screen: its desk, and its person up to where the chip starts. */
  function seatRect(desk: DeskView): R {
    const s = desk.seat.surface;
    const spot = { x: s.x + s.w / 2, y: s.y + AGENT_FIGURE.behindDesk };
    const r = boundsOf([
      project(s.x, s.y, 0),
      project(s.x + s.w, s.y, 0),
      project(s.x, s.y + s.d, s.h),
      project(s.x + s.w, s.y + s.d, s.h),
      project(spot.x - HIT.agentHalfWidth, spot.y, 0),
      project(spot.x + HIT.agentHalfWidth, spot.y, CHIP_HEADROOM.agent),
    ]);
    return { left: r.left, top: r.top, right: r.left + r.width, bottom: r.top + r.height };
  }

  function floorWith(floorId: 'b1' | 'f2' | 'f3', staffCount: number) {
    const departmentId = floorId === 'b1' ? 'data' : floorId === 'f2' ? 'modelling' : 'review';
    const roster: Agent[] = [
      { id: 'lead', role: 'lead', departmentId, title: 'Lead', skills: [], assignedTicker: null },
      ...Array.from({ length: staffCount }, (_, i): Agent => ({ id: `staff-${i}`, role: 'staff', departmentId, title: 'Modelling staff', skills: [], assignedTicker: `SYN${String.fromCharCode(65 + i)}` })),
    ];
    const views = syntheticDeskViews(createInitialLiveState(roster), roster, NOW)[floorId];
    return { views, scene: buildDeskFloorScene(floorId, views, { selection: null, partnerWaiting: 0 }) };
  }

  const CASES: Array<['b1' | 'f2' | 'f3', number]> = [
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n): ['b1', number] => ['b1', n]),
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n): ['f2', number] => ['f2', n]),
    ['f3', 2],
  ];

  it.each(CASES)('%s with %i staff: the lead’s chip covers no staff desk, person or chip, and no staff chip covers the lead', (floorId, staffCount) => {
    const { views, scene } = floorWith(floorId, staffCount);
    const leadDesk = views.desks.find((d) => d.seatKind === 'lead');
    const leadChip = scene.chips.find((c) => c.lead);
    if (!leadDesk || !leadChip) throw new Error('no lead');
    expect(leadChip.stagger).toBe(0);
    const lead = chipRect(leadChip, leadChipWidth);
    for (const desk of views.desks.filter((d) => d.seatKind === 'staff')) {
      const chip = scene.chips.find((c) => c.id === desk.deskId);
      if (!chip) throw new Error(desk.deskId);
      expect(meets(lead, seatRect(desk)), `${desk.deskId} seat`).toBe(false);
      expect(meets(lead, chipRect(chip, staffChipWidth)), `${desk.deskId} chip`).toBe(false);
      expect(meets(seatRect(leadDesk), chipRect(chip, staffChipWidth)), `${desk.deskId} chip over the lead`).toBe(false);
    }
  });

  it('owes that to the cap (negative control): an uncapped lead chip would meet the nearest staff desk', () => {
    const { views, scene } = floorWith('b1', 8);
    const leadChip = scene.chips.find((c) => c.lead);
    if (!leadChip) throw new Error('no lead');
    const uncapped = chipRect(leadChip, staffChipWidth);
    expect(views.desks.filter((d) => d.seatKind === 'staff').some((desk) => meets(uncapped, seatRect(desk)))).toBe(true);
  });
});
