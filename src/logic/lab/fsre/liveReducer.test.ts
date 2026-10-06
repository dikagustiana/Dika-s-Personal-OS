import { describe, expect, it } from 'vitest';
import type { Agent, AgentEvent } from '../../../data/fsreTransport/contract';
import { createInitialLiveState, escalationsOfAgent, gateDisplayStatus, reduceAgentEvent, stageIndexOfCompany } from './liveReducer';
import { deriveDeskState } from './deskState';

const ROSTER: Agent[] = [
  { id: 'review-lead', role: 'lead', departmentId: 'review', title: 'Review lead', skills: ['review-manager'], assignedTicker: null },
  { id: 'model-staff-b', role: 'staff', departmentId: 'modelling', title: 'Modelling staff', skills: ['fs-driver-decomposition', 'financial-modeling'], assignedTicker: 'SYNB' },
];

let eventSeq = 0;

function event(patch: Partial<AgentEvent>): AgentEvent {
  return {
    id: patch.id ?? `evt-${++eventSeq}`,
    seq: 1,
    at: patch.at ?? '2026-10-06T09:05:00.000Z',
    agentId: 'review-lead',
    engagementId: 'eng-1',
    ticker: 'SYNA',
    stageId: null,
    type: 'action',
    summary: 'Did something',
    sourceRef: null,
    counts: null,
    waitingOn: null,
    commandId: null,
    escalationId: null,
    ...patch,
  };
}

describe('the live reducer', () => {
  it('never opens a task from an action event', () => {
    let state = createInitialLiveState(ROSTER);
    state = reduceAgentEvent(state, event({ type: 'action', summary: 'First-line check: clear' }));
    expect(state.agents['review-lead']?.currentTask).toBeNull();
  });

  it('closes the review lead’s task when the gate is decided', () => {
    let state = createInitialLiveState(ROSTER);
    state = reduceAgentEvent(state, event({ type: 'task_started', stageId: 'gate-2', summary: 'Opening Gate 2 on SYNA' }));
    expect(state.agents['review-lead']?.currentTask).not.toBeNull();
    state = reduceAgentEvent(state, event({ type: 'gate_result', stageId: 'gate-2', counts: { gatesFailed: 0 } }));
    expect(state.agents['review-lead']?.currentTask).toBeNull();
    expect(state.gates['eng-1|SYNA|gate-2']).toBe('passed');
  });

  it('tracks escalations from opened to closed, counting by opener (FX-2)', () => {
    let state = createInitialLiveState(ROSTER);
    state = reduceAgentEvent(state, event({ type: 'escalation_opened', escalationId: 'esc-1', summary: 'Needs a decision' }));
    expect(escalationsOfAgent(state, 'review-lead')).toEqual({ opened: 1, open: 1, closed: 0 });
    state = reduceAgentEvent(state, event({ type: 'escalation_closed', escalationId: 'esc-1', summary: 'Owner chose' }));
    expect(escalationsOfAgent(state, 'review-lead')).toEqual({ opened: 1, open: 0, closed: 1 });
  });

  it('a second close of the same escalation changes nothing (FX-2)', () => {
    let state = createInitialLiveState(ROSTER);
    state = reduceAgentEvent(state, event({ type: 'escalation_opened', escalationId: 'esc-1', summary: 'Needs a decision' }));
    state = reduceAgentEvent(state, event({ id: 'evt-2', type: 'escalation_closed', escalationId: 'esc-1', summary: 'Owner chose' }));
    state = reduceAgentEvent(state, event({ id: 'evt-3', type: 'escalation_closed', escalationId: 'esc-1', summary: 'Owner chose again' }));
    expect(state.escalations).toHaveLength(1);
    expect(escalationsOfAgent(state, 'review-lead')).toEqual({ opened: 1, open: 0, closed: 1 });
  });

  it('the desk reads escalated from open escalation ids, not counters (FX-2)', () => {
    let state = createInitialLiveState(ROSTER);
    const open = (id: string) =>
      reduceAgentEvent(state, event({ id, type: 'escalation_opened', escalationId: `esc-${id}`, summary: 'Needs a decision' }));
    state = open('e1');
    state = reduceAgentEvent(state, event({ id: 'c1', type: 'escalation_closed', escalationId: 'esc-e1', summary: 'Owner chose' }));
    state = reduceAgentEvent(state, event({ id: 'c2', type: 'escalation_closed', escalationId: 'esc-e1', summary: 'Duplicate close' }));
    state = open('e2');
    expect(escalationsOfAgent(state, 'review-lead').open).toBe(1);
    expect(deriveDeskState({
      openEscalations: escalationsOfAgent(state, 'review-lead').open,
      hasOpenTask: false,
      waitingOn: null,
      lastSignalAt: null,
      now: '2026-10-06T09:20:00.000Z',
    })).toBe('escalated');
  });

  it('an escalation closed by a different agent leaves the opener’s desk not escalated (FX-2)', () => {
    let state = createInitialLiveState(ROSTER);
    state = reduceAgentEvent(state, event({ type: 'escalation_opened', escalationId: 'esc-1', summary: 'Needs a decision' }));
    state = reduceAgentEvent(state, event({ id: 'evt-2', agentId: 'owner', type: 'escalation_closed', escalationId: 'esc-1', summary: 'Owner resolved it directly' }));
    expect(escalationsOfAgent(state, 'review-lead').open).toBe(0);
    expect(escalationsOfAgent(state, 'review-lead').closed).toBe(1);
  });

  it('an event applied twice leaves the state unchanged (FX-2)', () => {
    let state = createInitialLiveState(ROSTER);
    const first = reduceAgentEvent(state, event({ id: 'evt-x', type: 'escalation_opened', escalationId: 'esc-1', summary: 'Needs a decision' }));
    const second = reduceAgentEvent(first, event({ id: 'evt-x', type: 'escalation_opened', escalationId: 'esc-1', summary: 'Needs a decision' }));
    expect(second).toBe(first);
    expect(second.events.length).toBe(first.events.length);
    expect(second.escalations).toEqual(first.escalations);
  });

  it('a gate_result without a numeric verdict leaves the gate pending (FX-4)', () => {
    let state = createInitialLiveState(ROSTER);
    state = reduceAgentEvent(state, event({ type: 'gate_result', stageId: 'gate-1', counts: null }));
    expect(gateDisplayStatus(state, 'eng-1', 'SYNA', 'gate-1')).toBe('pending');
    state = reduceAgentEvent(state, event({ type: 'gate_result', stageId: 'gate-1', counts: {} }));
    expect(gateDisplayStatus(state, 'eng-1', 'SYNA', 'gate-1')).toBe('pending');
    state = reduceAgentEvent(state, event({ type: 'gate_result', stageId: 'gate-1', counts: { gatesFailed: 1 } }));
    expect(gateDisplayStatus(state, 'eng-1', 'SYNA', 'gate-1')).toBe('failed');
    state = reduceAgentEvent(state, event({ type: 'gate_result', stageId: 'gate-1', counts: { gatesFailed: 0 } }));
    expect(gateDisplayStatus(state, 'eng-1', 'SYNA', 'gate-1')).toBe('passed');
  });

  it('ignores heartbeats as signals but keeps them out of the feed anyway', () => {
    let state = createInitialLiveState(ROSTER);
    state = reduceAgentEvent(state, event({ type: 'heartbeat', agentId: 'model-staff-b' }));
    expect(state.agents['model-staff-b']?.lastSignalAt).toBeNull();
    expect(state.agents['model-staff-b']?.events).toHaveLength(0);
  });

  it('derives the highest stage a company reached', () => {
    let state = createInitialLiveState(ROSTER);
    state = reduceAgentEvent(state, event({ type: 'task_started', stageId: 'intake' }));
    state = reduceAgentEvent(state, event({ id: 'evt-2', type: 'task_started', stageId: 'normalise' }));
    expect(stageIndexOfCompany(state, 'eng-1', 'SYNA')).toBe(6);
  });

  it('marks the engagement as waiting for the owner when the owner’s desk waits — by role, not by an agent id', () => {
    const owner: Agent = { id: 'partner-desk', role: 'owner', departmentId: null, title: 'Owner', skills: [], assignedTicker: null };
    let state = createInitialLiveState([...ROSTER, owner]);
    state = reduceAgentEvent(state, event({ agentId: 'review-lead', type: 'waiting', waitingOn: 'partner-desk' }));
    expect(state.engagementStatus['eng-1']).toBeUndefined();
    state = reduceAgentEvent(state, event({ agentId: 'partner-desk', type: 'waiting', summary: 'Waiting for the owner to approve version v1' }));
    expect(state.engagementStatus['eng-1']).toBe('waiting_owner');
  });
});
