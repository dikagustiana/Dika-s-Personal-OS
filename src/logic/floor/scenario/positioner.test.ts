import { describe, expect, it } from 'vitest';
import { hexEquals, hexKey } from '../hex/hex';
import { CAMPUS, furnitureOfType } from '../layout/campus';
import { parseCanonicalEvent } from '../events/schema';
import { Positioner } from './positioner';
import type { SemanticEvent } from './semantic';

const base: SemanticEvent = {
  agentId: 'agent-a',
  agentRole: 'Engineer',
  department: 'framing-office',
  state: 'working',
  taskId: 'task-1',
  title: 'T',
  subtask: 'S',
  progress: 10,
  tokens: 100,
};

describe('positioner', () => {
  it('emits WALKING now and WORKING at the desk after a real walk, all valid on the wire', () => {
    const p = new Positioner(CAMPUS);
    const out = p.apply(base, 10_000);
    expect(out).toHaveLength(2);
    const [walk, arrive] = out;
    expect(walk.atMs).toBe(10_000);
    expect(walk.event.currentState).toBe('OFFICE_WALKING');
    expect(walk.event.targetDestinationHex).not.toBeNull();
    expect(arrive.event.currentState).toBe('OFFICE_WORKING');
    expect(arrive.event.targetDestinationHex).toBeNull();
    expect(arrive.atMs).toBeGreaterThan(walk.atMs + 500);
    expect(hexEquals(arrive.event.currentLocationHex, walk.event.targetDestinationHex)).toBe(true);
    for (const e of out) expect(parseCanonicalEvent(JSON.stringify(e.event)).ok).toBe(true);
    // The desk is a workstation in that department's own bay.
    const desk = CAMPUS.furnitureByHex.get(hexKey(arrive.event.currentLocationHex));
    expect(desk?.type).toBe('workstation');
    expect(desk?.zoneId).toBe('bay-framing-office');
  });

  it('seats each agent of a department at its own desk in that department\'s bay', () => {
    // There is no lounge on this floor: an idle agent is at ITS desk, and
    // two agents of the same department never share one while the bay has
    // free desks (3-D — the quiet case is the normal case).
    const p = new Positioner(CAMPUS);
    const desks = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const out = p.apply({ ...base, agentId: `agent-${i}`, state: 'idle' }, 0);
      const arrival = out[out.length - 1];
      expect(arrival.event.currentState).toBe('OFFICE_IDLE');
      const desk = CAMPUS.furnitureByHex.get(hexKey(arrival.event.currentLocationHex));
      expect(desk?.zoneId).toBe('bay-framing-office');
      desks.add(desk?.id ?? '');
    }
    expect(desks.size).toBe(3);
  });

  it('sits a lead in its own office, not in the bay', () => {
    const p = new Positioner(CAMPUS);
    const out = p.apply({ ...base, agentId: 'framing-lead', role: 'lead', state: 'working' }, 0);
    const arrival = out[out.length - 1];
    const desk = CAMPUS.furnitureByHex.get(hexKey(arrival.event.currentLocationHex));
    expect(desk?.zoneId).toBe('lead-framing-office');
    expect(desk?.type).toBe('managerDesk');
  });

  it('a progress tick mid-walk re-sends WALKING from the interpolated position and keeps the arrival time', () => {
    const p = new Positioner(CAMPUS);
    const first = p.apply(base, 0);
    const arrivalMs = first[1].atMs;
    const mid = Math.round(arrivalMs / 2);
    const second = p.apply({ ...base, progress: 20 }, mid);
    expect(second).toHaveLength(2);
    expect(second[0].event.currentState).toBe('OFFICE_WALKING');
    expect(second[0].event.taskDetails.progressPercentage).toBe(20);
    expect(hexEquals(second[0].event.currentLocationHex, first[0].event.currentLocationHex)).toBe(false);
    expect(second[1].atMs).toBe(arrivalMs);
    expect(second[1].event.currentState).toBe('OFFICE_WORKING');
  });

  it('a progress tick after arrival emits a single WORKING event in place', () => {
    const p = new Positioner(CAMPUS);
    const first = p.apply(base, 0);
    p.markArrived('agent-a', first[1].atMs);
    const tick = p.apply({ ...base, progress: 40 }, first[1].atMs + 5000);
    expect(tick).toHaveLength(1);
    expect(tick[0].event.currentState).toBe('OFFICE_WORKING');
    expect(tick[0].event.targetDestinationHex).toBeNull();
  });

  it('an error mid-walk stops the agent where it is', () => {
    const p = new Positioner(CAMPUS);
    // A real trip: the agent starts at its desk, so send it to a review to
    // have somewhere to be interrupted on the way to.
    const first = p.apply({ ...base, state: 'collaborating', groupId: 'g-err' }, 0);
    const mid = Math.round(first[1].atMs * 0.6);
    const err = p.apply({ ...base, state: 'error', subtask: 'boom' }, mid);
    expect(err).toHaveLength(1);
    expect(err[0].event.currentState).toBe('OFFICE_ERROR');
    expect(err[0].event.targetDestinationHex).toBeNull();
    expect(hexEquals(err[0].event.currentLocationHex, first[1].event.currentLocationHex)).toBe(false);
    // Resuming work walks from there.
    const resume = p.apply(base, mid + 1000);
    expect(resume[0].event.currentState).toBe('OFFICE_WALKING');
    expect(hexEquals(resume[0].event.currentLocationHex, err[0].event.currentLocationHex)).toBe(true);
  });

  it('three agents sharing a collaborationGroupId get distinct chairs around one table', () => {
    const p = new Positioner(CAMPUS);
    const ids = ['a', 'b', 'c'];
    const seats = new Map<string, string>();
    for (const id of ids) {
      const out = p.apply({ ...base, agentId: id, state: 'collaborating', groupId: 'g1' }, 0);
      const arrive = out[out.length - 1].event;
      expect(arrive.currentState).toBe('OFFICE_COLLABORATING');
      expect(arrive.collaborationGroupId).toBe('g1');
      const chair = CAMPUS.furnitureByHex.get(hexKey(arrive.currentLocationHex));
      expect(chair?.type).toBe('meetingChair');
      seats.set(id, chair!.id);
      // A peer review meets in ITS OWN department's cluster.
      expect(chair!.zoneId).toBe('meet-framing-office');
    }
    expect(new Set(seats.values()).size).toBe(3);
    // A review in another department meets in that department's cluster.
    const other = p.apply(
      { ...base, agentId: 'z', department: 'verification', state: 'collaborating', groupId: 'g2' },
      0,
    );
    const chair = CAMPUS.furnitureByHex.get(hexKey(other[other.length - 1].event.currentLocationHex));
    expect(chair?.zoneId).toBe('meet-verification');
  });

  it('delivering moves as DELIVERING with the terminal as target and arrives with target null', () => {
    const p = new Positioner(CAMPUS);
    const first = p.apply(base, 0);
    p.markArrived('agent-a', first[1].atMs);
    const out = p.apply({ ...base, state: 'delivering', progress: 100 }, first[1].atMs + 1000);
    expect(out).toHaveLength(2);
    expect(out[0].event.currentState).toBe('OFFICE_DELIVERING');
    // Output goes to the LIBRARY terminal: the corpus is where work is
    // archived and cited from.
    const terminal = furnitureOfType(CAMPUS, 'outputTerminal', 'library')[0];
    expect(hexEquals(out[0].event.targetDestinationHex, terminal.hex)).toBe(true);
    expect(out[1].event.currentState).toBe('OFFICE_DELIVERING');
    expect(out[1].event.targetDestinationHex).toBeNull();
    expect(hexEquals(out[1].event.currentLocationHex, terminal.hex)).toBe(true);
    // Anything for the director goes to the director's office.
    const toManager = p.apply({ ...base, state: 'delivering', deliverTo: 'manager' }, out[1].atMs + 1000);
    const desk = furnitureOfType(CAMPUS, 'managerDesk', 'director')[0];
    expect(hexEquals(toManager[0].event.targetDestinationHex, desk.hex)).toBe(true);
  });

  it('unknown semantic state passes the raw name through as currentState', () => {
    const p = new Positioner(CAMPUS);
    const out = p.apply({ ...base, state: 'unknown', unknownStateName: 'OFFICE_DANCING' }, 0);
    expect(out[0].event.currentState).toBe('OFFICE_DANCING');
    expect(parseCanonicalEvent(out[0].event).ok).toBe(true);
  });

  it('the executive department is seated at the manager desk', () => {
    const p = new Positioner(CAMPUS);
    const out = p.apply({ ...base, agentId: 'boss', department: 'Executive Office' }, 0);
    const desk = CAMPUS.furnitureByHex.get(hexKey(out[1].event.currentLocationHex));
    expect(desk?.type).toBe('managerDesk');
  });
});
