import { describe, expect, it } from 'vitest';
import { deriveDeskState } from './deskState';

const NOW = '2026-10-06T09:10:00.000Z';
const MIN = 60_000;

function iso(minutesAgo: number): string {
  return new Date(Date.parse(NOW) - minutesAgo * MIN).toISOString();
}

function base(overrides?: Partial<Parameters<typeof deriveDeskState>[0]>) {
  return {
    openEscalations: 0,
    hasOpenTask: false,
    waitingOn: null,
    lastSignalAt: null,
    now: NOW,
    ...overrides,
  };
}

describe('deriveDeskState', () => {
  it('is escalated above everything, even with a stale task', () => {
    const state = deriveDeskState(base({
      openEscalations: 1,
      hasOpenTask: true,
      lastSignalAt: iso(30),
    }));
    expect(state).toBe('escalated');
  });

  it('reads no_signal after 5 minutes without a signal on an open task', () => {
    const state = deriveDeskState(base({ hasOpenTask: true, lastSignalAt: iso(5) }));
    expect(state).toBe('no_signal');
  });

  it('stays working just under the threshold', () => {
    const state = deriveDeskState(base({ hasOpenTask: true, lastSignalAt: iso(4.99) }));
    expect(state).toBe('working');
  });

  it('never reads no_signal without a known last signal', () => {
    const state = deriveDeskState(base({ hasOpenTask: true, lastSignalAt: null }));
    expect(state).toBe('working');
  });

  it('never reads no_signal without an open task', () => {
    const state = deriveDeskState(base({ hasOpenTask: false, lastSignalAt: iso(30) }));
    expect(state).toBe('idle');
  });

  it('reads waiting when the agent waits on someone', () => {
    const state = deriveDeskState(base({
      hasOpenTask: true,
      waitingOn: 'review-lead',
      lastSignalAt: iso(1),
    }));
    expect(state).toBe('waiting');
  });

  it('ranks no_signal above waiting', () => {
    const state = deriveDeskState(base({
      hasOpenTask: true,
      waitingOn: 'review-lead',
      lastSignalAt: iso(9),
    }));
    expect(state).toBe('no_signal');
  });

  it('reads working on an open task', () => {
    const state = deriveDeskState(base({ hasOpenTask: true, lastSignalAt: iso(1) }));
    expect(state).toBe('working');
  });

  it('reads idle with nothing open', () => {
    expect(deriveDeskState(base())).toBe('idle');
  });

  it('follows the fixed precedence escalated > no_signal > waiting > working > idle', () => {
    const full = base({
      openEscalations: 2,
      hasOpenTask: true,
      waitingOn: 'owner',
      lastSignalAt: iso(9),
    });
    expect(deriveDeskState(full)).toBe('escalated');
    expect(deriveDeskState({ ...full, openEscalations: 0 })).toBe('no_signal');
    expect(deriveDeskState({ ...full, openEscalations: 0, lastSignalAt: iso(1) })).toBe('waiting');
    expect(deriveDeskState({ ...full, openEscalations: 0, lastSignalAt: iso(1), waitingOn: null })).toBe('working');
    expect(deriveDeskState({ ...full, openEscalations: 0, lastSignalAt: iso(1), waitingOn: null, hasOpenTask: false })).toBe('idle');
  });
});
