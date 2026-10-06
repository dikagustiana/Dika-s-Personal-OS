/**
 * The synthetic office's store: nothing refreshes on a timer, the lists
 * follow the events (FX-8). Ported from the GLM workspace
 * (src/live/liveStore.test.ts at 5b5d186).
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import type { AgentEvent } from '../../../data/fsreTransport/contract';
import { useFsreLiveStore as useLiveStore } from './useFsreLiveStore';
import { hasMockControls } from '../../../data/fsreTransport/controls';
import { lastSignalEvent } from '../../../logic/lab/fsre/liveReducer';

afterEach(() => {
  useLiveStore.getState().stop();
  vi.useRealTimers();
});

function event(id: string, agentId: string, type: AgentEvent['type']): AgentEvent {
  return {
    id,
    seq: 1,
    at: '2026-10-06T09:05:00.000Z',
    agentId,
    engagementId: 'eng-1',
    ticker: 'SYNA',
    stageId: null,
    type,
    summary: 'Did something',
    sourceRef: null,
    counts: null,
    waitingOn: null,
    commandId: null,
    escalationId: null,
  };
}

describe('the live store refresh discipline (FX-8)', () => {
  it('makes no list fetches on a quiet clock: nothing changes on a timer', async () => {
    vi.useFakeTimers();
    const store = useLiveStore;
    await store.getState().start();
    const transport = store.getState().transport;
    if (!transport || !hasMockControls(transport)) throw new Error('mock controls missing');
    transport.setSpeed('pause');
    const listCommands = vi.spyOn(transport, 'listCommands');
    const listEngagements = vi.spyOn(transport, 'listEngagements');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(listCommands).not.toHaveBeenCalled();
    expect(listEngagements).not.toHaveBeenCalled();
  });

  it('refreshes after events arrive, without a timer of its own', async () => {
    vi.useFakeTimers();
    const store = useLiveStore;
    await store.getState().start();
    const transport = store.getState().transport;
    if (!transport || !hasMockControls(transport)) throw new Error('mock controls missing');
    const listCommands = vi.spyOn(transport, 'listCommands');
    transport.setSpeed('10x');
    await vi.advanceTimersByTimeAsync(10_000);
    // events flowed, so the debounced post-event refresh fetched the lists
    expect(listCommands).toHaveBeenCalled();
  });
});

describe('lastSignalEvent (FX-8)', () => {
  it('a heartbeat after an action leaves the flash target on the action’s desk', () => {
    const events = [event('h1', 'router', 'heartbeat'), event('a1', 'data-staff-a', 'action'), event('h2', 'router', 'heartbeat')];
    const last = lastSignalEvent(events);
    expect(last?.agentId).toBe('data-staff-a');
    expect(last?.type).toBe('action');
  });
});
