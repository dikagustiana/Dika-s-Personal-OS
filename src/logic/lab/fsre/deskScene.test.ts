/**
 * One floor of the synthetic office as a scene (deskScene.ts): chips carry
 * glyph + word + name plate, staffed desks are named buttons, vacant ones
 * are drawn and labelled but never pressable, and the partner room's button
 * repeats the bell's count.
 */
import { describe, expect, it } from 'vitest';
import type { Agent, AgentEvent } from '../../../data/fsreTransport/contract';
import { buildDeskFloorScene } from './deskScene';
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
