import { describe, expect, it } from 'vitest';
import { OFFICE_STATES, isKnownState, parseCanonicalEvent } from './schema';

const GOOD = {
  eventId: 'evt-88301',
  timestamp: '2026-09-10T21:45:00Z',
  agentId: 'agent-senior-dev',
  agentRole: 'Software Architect',
  currentState: 'OFFICE_WORKING',
  currentLocationHex: { q: 2, r: -1 },
  targetDestinationHex: { q: 5, r: -3 },
  currentTaskId: 'task-4471',
  collaborationGroupId: null,
  taskDetails: {
    title: 'Refactoring Auth Middleware',
    department: 'Engineering Bay',
    progressPercentage: 72,
    activeSubtask: 'Running unit tests on JWT token parser',
    tokensUsed: 14200,
  },
};

describe('canonical event schema', () => {
  it('accepts the contract example, as an object and as a string', () => {
    expect(parseCanonicalEvent(GOOD).ok).toBe(true);
    expect(parseCanonicalEvent(JSON.stringify(GOOD)).ok).toBe(true);
  });

  it('accepts nulls where the contract allows them', () => {
    const r = parseCanonicalEvent({ ...GOOD, targetDestinationHex: null, currentTaskId: null, collaborationGroupId: null });
    expect(r.ok).toBe(true);
  });

  it('rejects non-JSON without throwing', () => {
    const r = parseCanonicalEvent('not json at all');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not JSON/);
  });

  it('rejects a missing field and names it', () => {
    const { taskDetails, ...rest } = GOOD;
    void taskDetails;
    const r = parseCanonicalEvent(rest);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/taskDetails/);
  });

  it('rejects an extra field (no adapter extends the schema)', () => {
    const r = parseCanonicalEvent({ ...GOOD, extra: 1 });
    expect(r.ok).toBe(false);
    const r2 = parseCanonicalEvent({ ...GOOD, taskDetails: { ...GOOD.taskDetails, taskDetails: {} } });
    expect(r2.ok).toBe(false);
  });

  it('rejects hex coordinates that are not integers, and a task id that is a coordinate pair', () => {
    expect(parseCanonicalEvent({ ...GOOD, currentLocationHex: { q: 1.5, r: 0 } }).ok).toBe(false);
    expect(parseCanonicalEvent({ ...GOOD, currentTaskId: { q: 1, r: 2 } }).ok).toBe(false);
  });

  it('rejects out-of-range progress and negative tokens', () => {
    expect(parseCanonicalEvent({ ...GOOD, taskDetails: { ...GOOD.taskDetails, progressPercentage: 101 } }).ok).toBe(false);
    expect(parseCanonicalEvent({ ...GOOD, taskDetails: { ...GOOD.taskDetails, tokensUsed: -1 } }).ok).toBe(false);
  });

  it('rejects a bad timestamp but accepts offsets', () => {
    expect(parseCanonicalEvent({ ...GOOD, timestamp: 'yesterday' }).ok).toBe(false);
    expect(parseCanonicalEvent({ ...GOOD, timestamp: '2026-09-10T21:45:00+07:00' }).ok).toBe(true);
  });

  it('lets an unknown state through validation so it can render as UNKNOWN_STATE', () => {
    const r = parseCanonicalEvent({ ...GOOD, currentState: 'OFFICE_DANCING' });
    expect(r.ok).toBe(true);
    expect(isKnownState('OFFICE_DANCING')).toBe(false);
    for (const s of OFFICE_STATES) expect(isKnownState(s)).toBe(true);
    expect(OFFICE_STATES).toHaveLength(6);
  });
});
