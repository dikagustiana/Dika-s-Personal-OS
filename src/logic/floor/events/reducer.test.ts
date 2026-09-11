import { describe, expect, it } from 'vitest';
import { applyCanonicalEvent, emptyAgentsState } from './reducer';
import type { CanonicalEvent } from './schema';

function ev(over: Partial<CanonicalEvent> & { eventId: string; timestamp: string }): CanonicalEvent {
  return {
    agentId: 'agent-a',
    agentRole: 'Engineer',
    currentState: 'OFFICE_WORKING',
    currentLocationHex: { q: 1, r: 1 },
    targetDestinationHex: null,
    currentTaskId: 'task-1',
    collaborationGroupId: null,
    taskDetails: { title: 'T', department: 'Engineering Bay', progressPercentage: 10, activeSubtask: 'a', tokensUsed: 100 },
    ...over,
  };
}

describe('agent reducer', () => {
  it('applies a first event and records a state log line', () => {
    const s = emptyAgentsState();
    expect(applyCanonicalEvent(s, ev({ eventId: 'e1', timestamp: '2026-01-01T00:00:00Z' }), 1000)).toBe('applied');
    expect(s.agents['agent-a'].latest.eventId).toBe('e1');
    expect(s.agents['agent-a'].log).toHaveLength(1);
    expect(s.agents['agent-a'].log[0].kind).toBe('state');
    expect(s.stats.applied).toBe(1);
  });

  it('drops a duplicate eventId (snapshot replay)', () => {
    const s = emptyAgentsState();
    const e = ev({ eventId: 'e1', timestamp: '2026-01-01T00:00:00Z' });
    applyCanonicalEvent(s, e, 1000);
    expect(applyCanonicalEvent(s, e, 2000)).toBe('duplicate');
    expect(s.stats.droppedDuplicate).toBe(1);
    expect(s.stats.applied).toBe(1);
  });

  it('drops an out-of-order older event and keeps the newer state', () => {
    const s = emptyAgentsState();
    applyCanonicalEvent(s, ev({ eventId: 'e2', timestamp: '2026-01-01T00:00:10Z', currentState: 'OFFICE_IDLE' }), 1000);
    expect(applyCanonicalEvent(s, ev({ eventId: 'e1', timestamp: '2026-01-01T00:00:05Z', currentState: 'OFFICE_WORKING' }), 1001)).toBe(
      'stale',
    );
    expect(s.agents['agent-a'].latest.currentState).toBe('OFFICE_IDLE');
    expect(s.stats.droppedStale).toBe(1);
  });

  it('applies equal timestamps in arrival order', () => {
    const s = emptyAgentsState();
    applyCanonicalEvent(s, ev({ eventId: 'e1', timestamp: '2026-01-01T00:00:10Z', currentState: 'OFFICE_IDLE' }), 1000);
    expect(applyCanonicalEvent(s, ev({ eventId: 'e2', timestamp: '2026-01-01T00:00:10Z', currentState: 'OFFICE_WORKING' }), 1001)).toBe(
      'applied',
    );
    expect(s.agents['agent-a'].latest.currentState).toBe('OFFICE_WORKING');
  });

  it('flags an unknown state without mapping it', () => {
    const s = emptyAgentsState();
    applyCanonicalEvent(s, ev({ eventId: 'e1', timestamp: '2026-01-01T00:00:00Z', currentState: 'OFFICE_DANCING' }), 1000);
    const rec = s.agents['agent-a'];
    expect(rec.knownState).toBe(false);
    expect(rec.latest.currentState).toBe('OFFICE_DANCING');
    expect(rec.log[0].kind).toBe('unknown');
    expect(s.stats.unknownState).toBe(1);
  });

  it('logs progress only when something changed, and keeps token history bounded', () => {
    const s = emptyAgentsState();
    let t = 0;
    for (let i = 0; i < 300; i++) {
      t += 1000;
      applyCanonicalEvent(
        s,
        ev({
          eventId: `e${i}`,
          timestamp: new Date(t).toISOString(),
          taskDetails: { title: 'T', department: 'Engineering Bay', progressPercentage: Math.min(100, i % 2 === 0 ? i / 3 : (i - 1) / 3), activeSubtask: 'a', tokensUsed: 100 },
        }),
        t,
      );
    }
    const rec = s.agents['agent-a'];
    expect(rec.tokenHistory.length).toBeLessThanOrEqual(120);
    expect(rec.log.length).toBeLessThanOrEqual(200);
    // Odd events repeat the previous progress → no line for them.
    expect(rec.log.length).toBeLessThan(200);
  });

  it('a silent agent keeps its last state — the reducer never times anything out', () => {
    const s = emptyAgentsState();
    applyCanonicalEvent(s, ev({ eventId: 'e1', timestamp: '2026-01-01T00:00:00Z', currentState: 'OFFICE_WORKING' }), 1000);
    // Nothing else arrives; there is no API that would change this record.
    expect(s.agents['agent-a'].latest.currentState).toBe('OFFICE_WORKING');
  });
});
