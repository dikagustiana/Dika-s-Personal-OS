import { describe, expect, it } from 'vitest';
import type { Agent } from '../../../data/fsreTransport/contract';
import { createInitialLiveState, reduceAgentEvent, type LiveState } from './liveReducer';
import { floorTagParts, syntheticDeskViews } from './deskViews';

const NOW = '2026-10-06T10:00:00.000Z';

function agent(id: string, department: 'data' | 'modelling' | 'review'): Agent {
  return {
    id,
    role: 'staff',
    departmentId: department,
    title: 'Data staff',
    skills: ['fs-intake', 'fs-normalize'],
    assignedTicker: null,
  };
}

function baseState(agents: Agent[]): LiveState {
  return createInitialLiveState(agents);
}

describe('floorTagParts (FX-9)', () => {
  it('counts a no-signal desk: the tag contains "1 no signal"', () => {
    const agents = [agent('s1', 'data'), agent('s2', 'data'), agent('s3', 'data')];
    let state = baseState(agents);
    // s1: open task, last signal 6 minutes ago → No signal
    state = reduceAgentEvent(state, {
      id: 'e1', seq: 1, at: '2026-10-06T09:54:00.000Z', agentId: 's1', engagementId: 'eng-1',
      ticker: 'SYNA', stageId: 'intake', type: 'task_started', summary: 'Loading SYNA facts',
      sourceRef: null, counts: null, waitingOn: null, commandId: null, escalationId: null,
    });
    // s2: idle, s3: idle
    const views = syntheticDeskViews(state, [...agents, { ...agents[0], id: 'lead', role: 'lead', title: 'Data lead' }], NOW);
    const parts = floorTagParts(views.b1.desks, views.b1.hidden);
    expect(parts).toContain('1 no signal');
  });

  it('counts staff beyond the drawn slots and adds "more not drawn"', () => {
    const staff = Array.from({ length: 10 }, (_, i) => agent(`s${i + 1}`, 'data'));
    const lead: Agent = { ...staff[0], id: 'lead', role: 'lead', title: 'Data lead' };
    const state = baseState([...staff, lead]);
    const views = syntheticDeskViews(state, [...staff, lead], NOW);
    expect(views.b1.desks.filter((d) => d.agentId !== null)).toHaveLength(9); // 8 staff + lead
    expect(views.b1.hidden).toHaveLength(2);
    const parts = floorTagParts(views.b1.desks, views.b1.hidden);
    // every staffed desk is counted: 10 staff + the lead, all idle
    expect(parts).toContain('11 idle');
    expect(parts).toContain('2 more not drawn');
  });
});

describe('the owner’s desk (review R6)', () => {
  const owner: Agent = { id: 'owner', role: 'owner', departmentId: null, title: 'Owner', skills: [], assignedTicker: null };

  it('never reads Working or No signal: it waits while something waits for the owner, else rests', () => {
    let state = baseState([owner]);
    state = reduceAgentEvent(state, {
      id: 'o1', seq: 1, at: '2026-10-06T09:40:00.000Z', agentId: 'owner', engagementId: 'eng-1',
      ticker: 'SYNB', stageId: 'sign-off', type: 'task_started', summary: 'SYNB v1 is ready for sign-off',
      sourceRef: null, counts: null, waitingOn: null, commandId: null, escalationId: null,
    });
    const idle = syntheticDeskViews(state, [owner], NOW).f4.desks.find((d) => d.agentId === 'owner');
    expect(idle?.state).toBe('idle');
    const waiting = syntheticDeskViews(state, [owner], NOW, true).f4.desks.find((d) => d.agentId === 'owner');
    expect(waiting?.state).toBe('waiting');
  });
});
